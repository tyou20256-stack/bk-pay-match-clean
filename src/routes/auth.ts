/**
 * @file routes/auth.ts — 認証ルート
 * @description ログイン、ログアウト、MFA、パスワード変更、セッションチェック。
 *   すべてのルートは /api/auth/* プレフィックスで登録される。
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  authenticateUser,
  verifyMfaAndLogin,
  setupMfa,
  enableMfa,
  disableMfa,
  getMfaStatus,
  verifyUserPassword,
  deleteSession,
  deleteAllUserSessions,
  getSessionUserId,
  validateSession,
  changePassword,
  recordAuditLog,
} from '../services/database';
import { setCsrfCookie } from '../middleware/auth';

const router = Router();

// Cookie options (secure in production)
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'strict' as const, secure: IS_PRODUCTION };

// Rate limiter for login endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many login attempts. Try again later.' },
});

// POST /api/auth/login
router.post('/login', loginLimiter, (req: Request, res: Response) => {
  const { username, password } = req.body;
  const ip = req.ip || req.socket.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';
  const result = authenticateUser(username, password, ip, ua);
  if (!result) {
    recordAuditLog({ action: 'login_failed', details: `username=${username}`, ipAddress: ip });
    return res.json({ success: false, error: 'Invalid credentials' });
  }
  if (result.mfaRequired) {
    recordAuditLog({ userId: result.userId, username, action: 'login_mfa_pending', ipAddress: ip });
    return res.json({ success: true, mfaRequired: true, mfaPendingToken: result.token });
  }
  recordAuditLog({ userId: result.userId, username, action: 'login', ipAddress: ip });
  res.cookie('bkpay_token', result.token, { ...COOKIE_OPTS, maxAge: 24 * 60 * 60 * 1000 });
  const csrfToken = setCsrfCookie(res);
  res.json({
    success: true,
    forcePasswordChange: result.forcePasswordChange,
    csrfToken,
    token: result.token,
  });
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_token;
  if (token) {
    const userId = getSessionUserId(token);
    if (userId) {
      recordAuditLog({ userId, action: 'logout', ipAddress: req.ip || '' });
      deleteAllUserSessions(userId);
    } else {
      deleteSession(token);
    }
  }
  res.clearCookie('bkpay_token');
  res.json({ success: true });
});

// POST /api/auth/change-password
router.post('/change-password', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.json({ success: false, error: 'Both passwords required' });
  if (newPassword.length < 12) return res.json({ success: false, error: 'Password must be at least 12 characters' });
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*()_+\-=\[\]{};:'"\\|,.<>\/?]/.test(newPassword)) {
    return res.json({ success: false, error: 'Password must contain letters, numbers, and special characters' });
  }
  // Check against common passwords
  const commonPasswords = ['password123!', 'admin12345!', 'qwerty12345!', 'P@ssw0rd123', 'Passw0rd!23'];
  if (commonPasswords.some(p => newPassword.toLowerCase() === p.toLowerCase())) {
    return res.json({ success: false, error: 'This password is too common' });
  }
  const userId = getSessionUserId(token);
  const changed = changePassword(token, currentPassword, newPassword);
  if (!changed) return res.json({ success: false, error: 'Current password incorrect' });
  recordAuditLog({ userId, action: 'password_change', ipAddress: req.ip || '' });
  if (userId) deleteAllUserSessions(userId);
  res.clearCookie('bkpay_token');
  res.json({ success: true, message: 'Password changed successfully. Please login again.' });
});

// POST /api/auth/mfa/verify — complete login with TOTP code
router.post('/mfa/verify', loginLimiter, (req: Request, res: Response) => {
  const { mfaPendingToken, totpCode } = req.body;
  if (!mfaPendingToken || !totpCode) return res.json({ success: false, error: 'Token and TOTP code required' });
  if (typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) return res.json({ success: false, error: 'TOTP code must be 6 digits' });
  const ip = req.ip || req.socket.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';
  const result = verifyMfaAndLogin(mfaPendingToken, totpCode, ip, ua);
  if (!result) {
    recordAuditLog({ action: 'login_mfa_failed', ipAddress: ip });
    return res.json({ success: false, error: 'Invalid or expired TOTP code' });
  }
  recordAuditLog({ userId: result.userId, action: 'login_mfa_success', ipAddress: ip });
  res.cookie('bkpay_token', result.token, { ...COOKIE_OPTS, maxAge: 24 * 60 * 60 * 1000 });
  const csrfToken = setCsrfCookie(res);
  res.json({ success: true, csrfToken });
});

// POST /api/auth/mfa/setup — generate secret + QR code URL (requires auth)
router.post('/mfa/setup', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const userId = getSessionUserId(token);
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const mfaData = setupMfa(userId);
  if (!mfaData) return res.json({ success: false, error: 'Failed to setup MFA' });
  res.json({ success: true, secret: mfaData.secret, otpauthUrl: mfaData.otpauthUrl });
});

// POST /api/auth/mfa/enable — verify TOTP code and activate MFA
router.post('/mfa/enable', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const userId = getSessionUserId(token);
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { totpCode } = req.body;
  if (!totpCode || typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) return res.json({ success: false, error: 'TOTP code must be 6 digits' });
  const ip = req.ip || req.socket.remoteAddress || '';
  const enabled = enableMfa(userId, totpCode);
  if (!enabled) return res.json({ success: false, error: 'Invalid TOTP code' });
  recordAuditLog({ userId, action: 'mfa_enabled', ipAddress: ip });
  res.json({ success: true, message: 'MFA enabled' });
});

// POST /api/auth/mfa/disable — turn off MFA (requires password verification)
router.post('/mfa/disable', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const userId = getSessionUserId(token);
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { password } = req.body;
  if (!password) return res.json({ success: false, error: 'Password required to disable MFA' });
  if (!verifyUserPassword(userId, password)) {
    const ip = req.ip || req.socket.remoteAddress || '';
    recordAuditLog({ userId, action: 'mfa_disable_failed', details: 'wrong password', ipAddress: ip });
    return res.json({ success: false, error: 'Incorrect password' });
  }
  const ip = req.ip || req.socket.remoteAddress || '';
  disableMfa(userId);
  recordAuditLog({ userId, action: 'mfa_disabled', ipAddress: ip });
  res.json({ success: true, message: 'MFA disabled' });
});

// GET /api/auth/mfa/status — check if current user has MFA enabled
router.get('/mfa/status', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.json({ success: false });
  const userId = getSessionUserId(token);
  if (!userId) return res.json({ success: false });
  const mfaEnabled = getMfaStatus(userId);
  res.json({ success: true, mfaEnabled });
});

// GET /api/auth/check
router.get('/check', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_token;
  res.json({ success: !!(token && validateSession(token, req.ip)) });
});

export default router;
