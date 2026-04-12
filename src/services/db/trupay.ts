/**
 * @file trupay.ts — TruPay withdrawals + matches + pending buyers
 */
import { db } from './connection.js';
import type { TruPayWithdrawalRow, TruPayMatchRow, CountRow } from './connection.js';

const TRUPAY_QUEUE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

// === TruPay Withdrawals ===

export function insertTruPayWithdrawal(data: {
  trupay_id: number;
  system_transaction_id: string;
  transaction_id: string;
  amount_jpy: number;
  bank_name: string;
  branch_name: string;
  account_number: string;
  account_name: string;
  account_type?: string;
}): number {
  const now = Date.now();
  const result = db.prepare(`
    INSERT OR IGNORE INTO trupay_withdrawals
      (trupay_id, system_transaction_id, transaction_id, amount_jpy, bank_name, branch_name, account_number, account_name, account_type, trupay_status, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 31, 'queued', ?, ?)
  `).run(
    data.trupay_id, data.system_transaction_id, data.transaction_id,
    data.amount_jpy, data.bank_name, data.branch_name,
    data.account_number, data.account_name, data.account_type || 'savings',
    now, now
  );
  return result.changes;
}

export function getTruPayWithdrawalById(id: number): TruPayWithdrawalRow | undefined {
  return db.prepare('SELECT * FROM trupay_withdrawals WHERE id = ?').get(id) as TruPayWithdrawalRow | undefined;
}

export function getTruPayWithdrawalByTruPayId(trupayId: number): TruPayWithdrawalRow | undefined {
  return db.prepare('SELECT * FROM trupay_withdrawals WHERE trupay_id = ?').get(trupayId) as TruPayWithdrawalRow | undefined;
}

export function getQueuedTruPayWithdrawals(): TruPayWithdrawalRow[] {
  const cutoff = Date.now() - TRUPAY_QUEUE_MAX_AGE_MS;
  return db.prepare('SELECT * FROM trupay_withdrawals WHERE status = ? AND created_at > ? ORDER BY created_at ASC').all('queued', cutoff) as TruPayWithdrawalRow[];
}

/**
 * 48時間以上古いqueued出金をexpiredに移行
 */
export function expireOldQueuedWithdrawals(): number {
  const cutoff = Date.now() - TRUPAY_QUEUE_MAX_AGE_MS;
  const result = db.prepare("UPDATE trupay_withdrawals SET status = 'expired', updated_at = ? WHERE status = 'queued' AND created_at <= ?").run(Date.now(), cutoff);
  return result.changes;
}

export function getTruPayWithdrawals(status?: string, limit = 50, offset = 0): TruPayWithdrawalRow[] {
  if (status) {
    return db.prepare('SELECT * FROM trupay_withdrawals WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, limit, offset) as TruPayWithdrawalRow[];
  }
  return db.prepare('SELECT * FROM trupay_withdrawals ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as TruPayWithdrawalRow[];
}

const TRUPAY_WD_EXTRA_COLS = new Set(['trupay_status', 'matched_at', 'completed_at']);

export function updateTruPayWithdrawalStatus(id: number, status: string, extra?: Record<string, unknown>): void {
  const now = Date.now();
  if (extra && Object.keys(extra).length > 0) {
    const filtered = Object.entries(extra).filter(([k]) => TRUPAY_WD_EXTRA_COLS.has(k));
    const sets = filtered.map(([k]) => `${k} = ?`).join(', ');
    const values = filtered.map(([, v]) => v);
    if (sets) {
      db.prepare(`UPDATE trupay_withdrawals SET status = ?, ${sets}, updated_at = ? WHERE id = ?`).run(status, ...values, now, id);
    } else {
      db.prepare('UPDATE trupay_withdrawals SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    }
  } else {
    db.prepare('UPDATE trupay_withdrawals SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }
}

// === TruPay Matches ===

export function insertTruPayMatch(data: {
  withdrawal_id: number;
  buyer_id: string;
  buyer_wallet: string;
  rate_jpy_usdt: number;
  amount_jpy: number;
  amount_usdt: number;
  timeout_at: number;
}): number {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO trupay_matches
      (withdrawal_id, buyer_id, buyer_wallet, rate_jpy_usdt, amount_jpy, amount_usdt, timeout_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting_transfer', ?, ?)
  `).run(
    data.withdrawal_id, data.buyer_id, data.buyer_wallet,
    data.rate_jpy_usdt, data.amount_jpy, data.amount_usdt,
    data.timeout_at, now, now
  );
  return Number(result.lastInsertRowid);
}

export function getTruPayMatch(id: number): TruPayMatchRow | undefined {
  return db.prepare('SELECT * FROM trupay_matches WHERE id = ?').get(id) as TruPayMatchRow | undefined;
}

export function getTruPayMatchByWithdrawalId(withdrawalId: number): TruPayMatchRow | undefined {
  return db.prepare('SELECT * FROM trupay_matches WHERE withdrawal_id = ? AND status NOT IN (?, ?) ORDER BY created_at DESC LIMIT 1')
    .get(withdrawalId, 'timeout', 'cancelled') as TruPayMatchRow | undefined;
}

export function getActiveTruPayMatches(): TruPayMatchRow[] {
  return db.prepare("SELECT * FROM trupay_matches WHERE status IN ('waiting_transfer', 'buyer_paid', 'needs_review', 'transfer_confirmed') ORDER BY created_at ASC").all() as TruPayMatchRow[];
}

export function getTruPayMatches(status?: string, limit = 50, offset = 0): TruPayMatchRow[] {
  if (status) {
    return db.prepare('SELECT * FROM trupay_matches WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, limit, offset) as TruPayMatchRow[];
  }
  return db.prepare('SELECT * FROM trupay_matches ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as TruPayMatchRow[];
}

const TRUPAY_MATCH_EXTRA_COLS = new Set(['usdt_tx_hash', 'reference_number', 'proof_image', 'proof_score', 'proof_analysis']);

export function updateTruPayMatchStatus(id: number, status: string, extra?: Record<string, unknown>): void {
  const now = Date.now();
  if (extra && Object.keys(extra).length > 0) {
    const filtered = Object.entries(extra).filter(([k]) => TRUPAY_MATCH_EXTRA_COLS.has(k));
    const sets = filtered.map(([k]) => `${k} = ?`).join(', ');
    const values = filtered.map(([, v]) => v);
    if (sets) {
      db.prepare(`UPDATE trupay_matches SET status = ?, ${sets}, updated_at = ? WHERE id = ?`).run(status, ...values, now, id);
    } else {
      db.prepare('UPDATE trupay_matches SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    }
  } else {
    db.prepare('UPDATE trupay_matches SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }
}

export function getTruPayStats(): { queued: number; matched: number; completed: number; timeout: number; total_jpy: number; total_usdt: number } {
  const queued = (db.prepare("SELECT COUNT(*) as c FROM trupay_withdrawals WHERE status = 'queued'").get() as CountRow).c;
  const matched = (db.prepare("SELECT COUNT(*) as c FROM trupay_matches WHERE status IN ('waiting_transfer', 'transfer_confirmed')").get() as CountRow).c;
  const completed = (db.prepare("SELECT COUNT(*) as c FROM trupay_matches WHERE status = 'completed'").get() as CountRow).c;
  const timeout = (db.prepare("SELECT COUNT(*) as c FROM trupay_matches WHERE status = 'timeout'").get() as CountRow).c;
  const totals = db.prepare("SELECT COALESCE(SUM(amount_jpy), 0) as total_jpy, COALESCE(SUM(amount_usdt), 0) as total_usdt FROM trupay_matches WHERE status = 'completed'").get() as { total_jpy: number; total_usdt: number };
  return { queued, matched, completed, timeout, total_jpy: totals.total_jpy, total_usdt: totals.total_usdt };
}

// === TruPay Pending Buyers (DB-backed) ===

export function dbInsertPendingBuyer(buyer: { id: string; walletAddress: string; minAmountJpy: number; maxAmountJpy: number; registeredAt: number }): void {
  db.prepare('INSERT OR REPLACE INTO trupay_pending_buyers (id, wallet_address, min_amount_jpy, max_amount_jpy, registered_at, status) VALUES (?, ?, ?, ?, ?, ?)').run(buyer.id, buyer.walletAddress, buyer.minAmountJpy, buyer.maxAmountJpy, buyer.registeredAt, 'active');
}

export function dbGetActivePendingBuyers(): Array<{ id: string; wallet_address: string; min_amount_jpy: number; max_amount_jpy: number; registered_at: number }> {
  return db.prepare("SELECT * FROM trupay_pending_buyers WHERE status = 'active'").all() as Array<{ id: string; wallet_address: string; min_amount_jpy: number; max_amount_jpy: number; registered_at: number }>;
}

export function dbDeletePendingBuyer(id: string): boolean {
  return db.prepare('DELETE FROM trupay_pending_buyers WHERE id = ?').run(id).changes > 0;
}

export function dbExpireOldPendingBuyers(): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return db.prepare("UPDATE trupay_pending_buyers SET status = 'expired' WHERE status = 'active' AND registered_at <= ?").run(cutoff).changes;
}
