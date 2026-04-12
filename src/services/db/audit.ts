/**
 * @file audit.ts — Audit log
 */
import { db } from './connection.js';
import type { AuditLogEntry } from './connection.js';

/** Record an admin action for compliance audit trail */
export function recordAuditLog(entry: {
  userId?: number;
  username?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
  ipAddress?: string;
}): void {
  db.prepare(
    `INSERT INTO audit_log (user_id, username, action, target_type, target_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.userId ?? null,
    entry.username ?? null,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.details ?? null,
    entry.ipAddress ?? null,
    Date.now(),
  );
}

/** Query audit log with optional filters */
export function getAuditLog(filters?: {
  userId?: number;
  action?: string;
  limit?: number;
  offset?: number;
}): AuditLogEntry[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters?.userId) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }
  if (filters?.action) {
    conditions.push('action = ?');
    params.push(filters.action);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit || 100;
  const offset = filters?.offset || 0;

  return db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as AuditLogEntry[];
}
