/**
 * @file auth.ts — Admin user management, authentication, MFA, sessions, password
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import logger from '../logger.js';
import { db } from './connection.js';
import type { AdminUserRow, SessionRow } from './connection.js';
import { encrypt, decrypt } from './encryption.js';

function legacySha256Hash(pw: string): string {
  return crypto.createHash('sha256').update(pw + 'bkpay-salt').digest('hex');
}

function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10);
}

export function createAdminUser(username: string, password: string): boolean {
  try {
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
    return true;
  } catch { return false; }
}

export function authenticateUser(username: string, password: string, ip?: string, userAgent?: string): { token: string; userId: number; forcePasswordChange?: boolean; mfaRequired?: boolean } | null {
  const user = db.prepare('SELECT id, password_hash, force_pw_change, mfa_enabled FROM admin_users WHERE username = ?').get(username) as AdminUserRow | undefined;
  if (!user) return null;

  let valid = false;
  if (user.password_hash.length === 64) {
    // Legacy SHA-256 hash — verify and auto-upgrade to bcrypt
    if (legacySha256Hash(password) === user.password_hash) {
      valid = true;
      const bcryptHash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(bcryptHash, user.id);
    }
  } else {
    valid = bcrypt.compareSync(password, user.password_hash);
  }

  if (!valid) return null;

  // If MFA is enabled, return pending state (no session yet)
  if (user.mfa_enabled) {
    // Issue a short-lived MFA pending token (5 min)
    const mfaPending = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000;
    db.prepare('INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)').run(`mfa:${mfaPending}`, user.id, expiresAt, ip || null, userAgent || null);
    return { token: mfaPending, userId: user.id, mfaRequired: true };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)').run(token, user.id, expiresAt, ip || null, userAgent || null);
  return { token, userId: user.id, forcePasswordChange: !!user.force_pw_change };
}

/** Verify MFA TOTP code and issue full session */
export function verifyMfaAndLogin(pendingToken: string, totpCode: string, ip?: string, userAgent?: string): { token: string; userId: number } | null {
  const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(`mfa:${pendingToken}`) as SessionRow | undefined;
  if (!session || session.expires_at < Date.now()) return null;

  const user = db.prepare('SELECT id, mfa_secret, mfa_enabled FROM admin_users WHERE id = ?').get(session.user_id) as AdminUserRow | undefined;
  if (!user || !user.mfa_enabled || !user.mfa_secret) return null;

  // Decrypt MFA secret (stored encrypted since security hardening)
  const mfaSecret = user.mfa_secret.includes(':') ? decrypt(user.mfa_secret) : user.mfa_secret;
  if (!mfaSecret || mfaSecret === '[DECRYPTION_FAILED]') return null;

  // Verify TOTP (import at top level would cause issues, use dynamic require pattern)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { authenticator } = require('otplib');
  const valid = authenticator.check(totpCode, mfaSecret);
  if (!valid) return null;

  // Delete pending token, issue full session
  db.prepare('DELETE FROM sessions WHERE token = ?').run(`mfa:${pendingToken}`);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)').run(token, user.id, expiresAt, ip || null, userAgent || null);
  return { token, userId: user.id };
}

/** Setup MFA for a user — generate secret and return otpauth URL */
export function setupMfa(userId: number): { secret: string; otpauthUrl: string } | null {
  const user = db.prepare('SELECT username FROM admin_users WHERE id = ?').get(userId) as { username: string } | undefined;
  if (!user) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { authenticator } = require('otplib');
  const secret = authenticator.generateSecret();
  db.prepare('UPDATE admin_users SET mfa_secret = ? WHERE id = ?').run(encrypt(secret), userId);
  const otpauthUrl = authenticator.keyuri(user.username, 'BK-Pay-Match', secret);
  return { secret, otpauthUrl };
}

/** Enable MFA after verifying first TOTP code */
export function enableMfa(userId: number, totpCode: string): boolean {
  const user = db.prepare('SELECT mfa_secret FROM admin_users WHERE id = ?').get(userId) as { mfa_secret: string | null } | undefined;
  if (!user?.mfa_secret) return false;
  const mfaSecret = user.mfa_secret.includes(':') ? decrypt(user.mfa_secret) : user.mfa_secret;
  if (!mfaSecret || mfaSecret === '[DECRYPTION_FAILED]') return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { authenticator } = require('otplib');
  if (!authenticator.check(totpCode, mfaSecret)) return false;
  db.prepare('UPDATE admin_users SET mfa_enabled = 1 WHERE id = ?').run(userId);
  return true;
}

/** Verify password for a given userId (used for sensitive operations like MFA disable) */
export function verifyUserPassword(userId: number, password: string): boolean {
  const user = db.prepare('SELECT password_hash FROM admin_users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
  if (!user) return false;
  if (user.password_hash.length === 64) {
    return legacySha256Hash(password) === user.password_hash;
  }
  return bcrypt.compareSync(password, user.password_hash);
}

/** Check if MFA is enabled for a user */
export function getMfaStatus(userId: number): boolean {
  const user = db.prepare('SELECT mfa_enabled FROM admin_users WHERE id = ?').get(userId) as { mfa_enabled: number } | undefined;
  return !!user?.mfa_enabled;
}

/** Disable MFA for a user */
export function disableMfa(userId: number): void {
  db.prepare('UPDATE admin_users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(userId);
}

export function validateSession(token: string, ip?: string): boolean {
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as SessionRow | undefined;
  if (!session) return false;
  // IP binding: strict for admin, soft for customer
  // Skip in test mode — the test harness hits the server from the same
  // process but Node's fetch can resolve localhost to ::1 on one call and
  // 127.0.0.1 on the next, causing spurious "IP mismatch — invalidating"
  // on every request. Production is behind Cloudflare + Caddy where the
  // client IP is stable via X-Forwarded-For.
  const skipIpBinding = process.env.NODE_ENV === 'test';
  if (!skipIpBinding && session.ip_address && ip && session.ip_address !== ip) {
    const isCustomer = (session as unknown as Record<string, unknown>).user_agent?.toString().includes('customer');
    if (!isCustomer) {
      logger.warn('Admin session IP mismatch — invalidating', { sessionId: token.slice(0, 8), expected: session.ip_address, actual: ip });
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return false;
    }
    logger.warn('Customer session IP mismatch (soft)', { sessionId: token.slice(0, 8), expected: session.ip_address, actual: ip });
  }
  return true;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Delete all sessions for a given user (e.g. after password change) */
export function deleteAllUserSessions(userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Resolve session token to user_id (returns undefined if invalid/expired) */
export function getSessionUserId(token: string): number | undefined {
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as SessionRow | undefined;
  return row?.user_id;
}

export function changePassword(token: string, currentPassword: string, newPassword: string): boolean {
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as SessionRow | undefined;
  if (!session) return false;
  const user = db.prepare('SELECT id, password_hash FROM admin_users WHERE id = ?').get(session.user_id) as AdminUserRow | undefined;
  if (!user) return false;
  let currentValid = false;
  if (user.password_hash.length === 64) {
    currentValid = legacySha256Hash(currentPassword) === user.password_hash;
  } else {
    currentValid = bcrypt.compareSync(currentPassword, user.password_hash);
  }
  if (!currentValid) return false;
  db.prepare('UPDATE admin_users SET password_hash = ?, force_pw_change = 0 WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  // Invalidate all sessions for this user (forces re-login with new password)
  deleteAllUserSessions(user.id);
  return true;
}
