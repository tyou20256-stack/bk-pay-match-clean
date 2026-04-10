/**
 * @file rbac.ts — ロールベースアクセス制御（RBAC）
 * @description 4ロール(Admin/Trader/Operator/Viewer)の権限管理。
 *   admin_usersテーブルにroleカラムを追加し、各APIエンドポイントの
 *   アクセス制御を実現する。
 */
import db from './database.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import logger from './logger.js';

// === Schema Migration ===
try {
  const cols = db.pragma('table_info(admin_users)') as { name: string }[];
  if (!cols.some((c) => c.name === 'role')) {
    db.exec(`ALTER TABLE admin_users ADD COLUMN role TEXT DEFAULT 'admin'`);
  }
} catch (e) {
  logger.error('RBAC schema migration failed', { error: e instanceof Error ? e.message : String(e) });
}

// === Role Definitions ===
export const ROLES = {
  admin: 'admin',
  trader: 'trader',
  operator: 'operator',
  viewer: 'viewer',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

export const PERMISSIONS = {
  view: 'view',
  trade: 'trade',
  rules: 'rules',
  limits: 'limits',
  users: 'users',
  api: 'api',
  settings: 'settings',
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['view', 'trade', 'rules', 'limits', 'users', 'api', 'settings'],
  trader: ['view', 'trade', 'rules'],
  operator: ['view', 'trade'],
  viewer: ['view'],
};

// === Permission Checking ===
export function hasPermission(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms ? perms.includes(permission) : false;
}

export function getRolePermissions(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

export function getAllRoles(): { name: Role; permissions: Permission[] }[] {
  return Object.entries(ROLE_PERMISSIONS).map(([name, permissions]) => ({
    name: name as Role,
    permissions,
  }));
}

// === Session with Role ===
export interface SessionInfo {
  valid: boolean;
  userId?: number;
  username?: string;
  role?: Role;
}

export function getSessionInfo(token: string): SessionInfo {
  if (!token) return { valid: false };
  const session = db.prepare(
    'SELECT s.user_id, u.username, u.role FROM sessions s JOIN admin_users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > ?'
  ).get(token, Date.now()) as { user_id: number; username: string; role: string } | undefined;
  if (!session) return { valid: false };
  return {
    valid: true,
    userId: session.user_id,
    username: session.username,
    role: (session.role || 'viewer') as Role,
  };
}

// === User Management ===
export interface AdminUser {
  id: number;
  username: string;
  role: Role;
  created_at: number;
}

export function getAllAdminUsers(): AdminUser[] {
  return db.prepare('SELECT id, username, role, created_at FROM admin_users ORDER BY id').all() as AdminUser[];
}

export function createAdminUserWithRole(username: string, password: string, role: Role): { success: boolean; error?: string; id?: number } {
  if (!Object.keys(ROLES).includes(role)) {
    return { success: false, error: `Invalid role: ${role}` };
  }
  if (password.length < 8) return { success: false, error: 'Password must be at least 8 characters' };
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { success: false, error: 'Password must contain both letters and numbers' };
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
    return { success: true, id: result.lastInsertRowid as number };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) return { success: false, error: 'Username already exists' };
    return { success: false, error: msg };
  }
}

export function updateUserRole(userId: number, role: Role): { success: boolean; error?: string } {
  if (!Object.keys(ROLES).includes(role)) return { success: false, error: `Invalid role: ${role}` };
  // Prevent demoting the last admin
  if (role !== 'admin') {
    const user = db.prepare('SELECT role FROM admin_users WHERE id = ?').get(userId) as { role: string } | undefined;
    if (user?.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) as c FROM admin_users WHERE role = 'admin'").get() as { c: number };
      if (admins.c <= 1) {
        return { success: false, error: 'Cannot demote the last admin user' };
      }
    }
  }
  const result = db.prepare('UPDATE admin_users SET role = ? WHERE id = ?').run(role, userId);
  return { success: result.changes > 0 };
}

export function deleteAdminUser(userId: number): { success: boolean; error?: string } {
  // Prevent deleting the last admin
  const admins = db.prepare("SELECT COUNT(*) as c FROM admin_users WHERE role = 'admin'").get() as { c: number };
  const user = db.prepare('SELECT role FROM admin_users WHERE id = ?').get(userId) as { role: string } | undefined;
  if (user?.role === 'admin' && admins.c <= 1) {
    return { success: false, error: 'Cannot delete the last admin user' };
  }
  // Delete sessions first
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  const result = db.prepare('DELETE FROM admin_users WHERE id = ?').run(userId);
  return { success: result.changes > 0 };
}

export function resetUserPassword(userId: number, newPassword: string): { success: boolean; error?: string } {
  if (newPassword.length < 8) return { success: false, error: 'Password must be at least 8 characters' };
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return { success: false, error: 'Password must contain both letters and numbers' };
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  const result = db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, userId);
  return { success: result.changes > 0 };
}

// Ensure default admin has 'admin' role
try {
  db.prepare("UPDATE admin_users SET role = 'admin' WHERE role IS NULL OR role = ''").run();
} catch {}

logger.info('Role-based access control initialized');
