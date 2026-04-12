/**
 * @file auth.test.ts — Unit tests for src/services/db/auth.ts
 * @description Covers admin user creation, password auth with bcrypt,
 *   password change re-hashing, session lifecycle (create/validate/expiry/delete).
 */
import './setup.js';
import { describe, it, expect, beforeAll } from 'vitest';
import bcrypt from 'bcryptjs';
import * as dbSvc from '../../src/services/db/index.js';
import { db } from '../../src/services/db/connection.js';

beforeAll(async () => {
  const { runMigrations } = await import('../../src/services/migrationManager.js');
  runMigrations();
});

function uniqueUser(prefix = 'user'): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

describe('auth: createAdminUser', () => {
  it('creates a user with a bcrypt-hashed password', () => {
    const username = uniqueUser('create');
    const ok = dbSvc.createAdminUser(username, 'S3cret!pass');
    expect(ok).toBe(true);

    const row = db
      .prepare('SELECT password_hash FROM admin_users WHERE username = ?')
      .get(username) as { password_hash: string } | undefined;
    expect(row).toBeDefined();
    // bcryptjs hashes start with $2a$ or $2b$ and are 60 chars
    expect(row!.password_hash.length).toBeGreaterThanOrEqual(60);
    expect(row!.password_hash.startsWith('$2')).toBe(true);
    expect(bcrypt.compareSync('S3cret!pass', row!.password_hash)).toBe(true);
  });

  it('returns false when username is duplicated', () => {
    const username = uniqueUser('dup');
    expect(dbSvc.createAdminUser(username, 'pw1')).toBe(true);
    expect(dbSvc.createAdminUser(username, 'pw2')).toBe(false);
  });
});

describe('auth: authenticateUser', () => {
  it('rejects authentication with wrong password', () => {
    const username = uniqueUser('wrongpw');
    dbSvc.createAdminUser(username, 'correct-password');
    const res = dbSvc.authenticateUser(username, 'nope');
    expect(res).toBeNull();
  });

  it('accepts authentication with correct password and returns a token', () => {
    const username = uniqueUser('rightpw');
    dbSvc.createAdminUser(username, 'correct-password');
    const res = dbSvc.authenticateUser(username, 'correct-password');
    expect(res).not.toBeNull();
    expect(typeof res!.token).toBe('string');
    expect(res!.token.length).toBeGreaterThan(16);
    expect(res!.userId).toBeTypeOf('number');
  });

  it('returns null for unknown usernames', () => {
    expect(dbSvc.authenticateUser('not-a-real-user-xyz', 'whatever')).toBeNull();
  });
});

describe('auth: session type + validateSession', () => {
  it('creates sessions with session_type=admin', () => {
    const username = uniqueUser('sesstype');
    dbSvc.createAdminUser(username, 'pw');
    const res = dbSvc.authenticateUser(username, 'pw');
    expect(res).not.toBeNull();

    const row = db
      .prepare('SELECT session_type FROM sessions WHERE token = ?')
      .get(res!.token) as { session_type: string | null } | undefined;
    expect(row?.session_type).toBe('admin');
  });

  it('validateSession returns true for a fresh session', () => {
    const username = uniqueUser('validate');
    dbSvc.createAdminUser(username, 'pw');
    const res = dbSvc.authenticateUser(username, 'pw')!;
    expect(dbSvc.validateSession(res.token)).toBe(true);
  });

  it('validateSession returns false for an expired session', () => {
    const username = uniqueUser('expired');
    dbSvc.createAdminUser(username, 'pw');
    const res = dbSvc.authenticateUser(username, 'pw')!;
    // Manually force the session expiry into the past.
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?')
      .run(Date.now() - 1000, res.token);
    expect(dbSvc.validateSession(res.token)).toBe(false);
  });

  it('validateSession returns false for an unknown token', () => {
    expect(dbSvc.validateSession('bogus-token-that-does-not-exist')).toBe(false);
  });
});

describe('auth: deleteSession', () => {
  it('removes a session from the DB', () => {
    const username = uniqueUser('delsess');
    dbSvc.createAdminUser(username, 'pw');
    const res = dbSvc.authenticateUser(username, 'pw')!;
    expect(dbSvc.validateSession(res.token)).toBe(true);

    dbSvc.deleteSession(res.token);
    expect(dbSvc.validateSession(res.token)).toBe(false);
    const row = db.prepare('SELECT token FROM sessions WHERE token = ?').get(res.token);
    expect(row).toBeUndefined();
  });
});

describe('auth: changePassword', () => {
  it('rejects change when current password is wrong', () => {
    const username = uniqueUser('pwwrong');
    dbSvc.createAdminUser(username, 'old-pw');
    const res = dbSvc.authenticateUser(username, 'old-pw')!;
    const ok = dbSvc.changePassword(res.token, 'not-the-right-pw', 'brand-new-pw');
    expect(ok).toBe(false);
  });

  it('rehashes the password at the new bcrypt cost factor', () => {
    const username = uniqueUser('pwrehash');
    dbSvc.createAdminUser(username, 'old-pw');
    const res = dbSvc.authenticateUser(username, 'old-pw')!;

    const before = (db.prepare('SELECT password_hash FROM admin_users WHERE username = ?')
      .get(username) as { password_hash: string }).password_hash;

    const ok = dbSvc.changePassword(res.token, 'old-pw', 'brand-new-pw');
    expect(ok).toBe(true);

    const after = (db.prepare('SELECT password_hash FROM admin_users WHERE username = ?')
      .get(username) as { password_hash: string }).password_hash;

    expect(after).not.toBe(before);
    expect(after.startsWith('$2')).toBe(true);
    expect(bcrypt.compareSync('brand-new-pw', after)).toBe(true);
    expect(bcrypt.compareSync('old-pw', after)).toBe(false);
  });

  it('invalidates all existing sessions for the user after password change', () => {
    const username = uniqueUser('pwinval');
    dbSvc.createAdminUser(username, 'old-pw');
    const res = dbSvc.authenticateUser(username, 'old-pw')!;
    expect(dbSvc.changePassword(res.token, 'old-pw', 'new-pw')).toBe(true);
    expect(dbSvc.validateSession(res.token)).toBe(false);
  });
});
