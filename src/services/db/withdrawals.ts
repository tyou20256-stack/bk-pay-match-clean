/**
 * @file withdrawals.ts — Withdrawal CRUD + claim
 */
import { db } from './connection.js';
import type { WithdrawalRow, WithdrawalData } from './connection.js';
import { encryptBankField, decryptBankField } from './encryption.js';

function rowToWithdrawal(row: WithdrawalRow): WithdrawalData {
  return {
    id: row.id,
    externalRef: row.external_ref || null,
    trackingToken: row.tracking_token,
    merchantApiKeyId: row.merchant_api_key_id || null,
    amount: row.amount,
    payMethod: row.pay_method,
    bankName: row.bank_name || null,
    branchName: row.branch_name || null,
    accountType: row.account_type || '普通',
    accountNumber: decryptBankField(row.account_number || ''),
    accountHolder: decryptBankField(row.account_holder || ''),
    paypayId: row.paypay_id || null,
    status: row.status,
    matchedOrderId: row.matched_order_id || null,
    matchedSellerId: row.matched_seller_id || null,
    webhookUrl: row.webhook_url || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at || null,
  };
}

export function createWithdrawal(data: {
  trackingToken: string; merchantApiKeyId?: number; externalRef?: string;
  amount: number; payMethod: string;
  bankName?: string; branchName?: string; accountType?: string;
  accountNumber?: string; accountHolder?: string; paypayId?: string;
  webhookUrl?: string; expiresAt: number;
}): number {
  const r = db.prepare(`
    INSERT INTO withdrawals (tracking_token, merchant_api_key_id, external_ref, amount, pay_method,
      bank_name, branch_name, account_type, account_number, account_holder, paypay_id,
      webhook_url, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.trackingToken, data.merchantApiKeyId || null, data.externalRef || null,
    data.amount, data.payMethod,
    data.bankName || null, data.branchName || null, data.accountType || '普通',
    data.accountNumber ? encryptBankField(data.accountNumber) : null,
    data.accountHolder ? encryptBankField(data.accountHolder) : null,
    data.paypayId || null,
    data.webhookUrl || null, Date.now(), data.expiresAt
  );
  return r.lastInsertRowid as number;
}

export function getWithdrawal(id: number): WithdrawalData | null {
  const row = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id) as WithdrawalRow | undefined;
  return row ? rowToWithdrawal(row) : null;
}

export function getWithdrawalByToken(token: string): WithdrawalData | null {
  const row = db.prepare('SELECT * FROM withdrawals WHERE tracking_token = ?').get(token) as WithdrawalRow | undefined;
  return row ? rowToWithdrawal(row) : null;
}

export function getWithdrawalByExternalRef(ref: string): WithdrawalData | null {
  const row = db.prepare('SELECT * FROM withdrawals WHERE external_ref = ?').get(ref) as WithdrawalRow | undefined;
  return row ? rowToWithdrawal(row) : null;
}

export function updateWithdrawalStatus(id: number, status: string, extra?: {
  matchedOrderId?: string; matchedSellerId?: number; completedAt?: number;
}): void {
  const sets = ['status = ?'];
  const vals: (string | number)[] = [status];
  if (extra?.matchedOrderId !== undefined) { sets.push('matched_order_id = ?'); vals.push(extra.matchedOrderId); }
  if (extra?.matchedSellerId !== undefined) { sets.push('matched_seller_id = ?'); vals.push(extra.matchedSellerId); }
  if (extra?.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(extra.completedAt); }
  vals.push(id);
  db.prepare(`UPDATE withdrawals SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function listWithdrawals(limit: number = 100): WithdrawalData[] {
  return (db.prepare('SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT ?').all(limit) as WithdrawalRow[])
    .map(rowToWithdrawal);
}

/**
 * Revert a withdrawal back to 'pending' ONLY if it's still matched to
 * the expected order. Prevents a cancel-then-remarch race where the
 * trupayMatcher has already moved the withdrawal to another state or
 * matched it to a different order.
 */
export function revertWithdrawalToPending(id: number, expectedOrderId: string): boolean {
  const result = db.prepare(`
    UPDATE withdrawals SET status = 'pending', matched_order_id = NULL, matched_seller_id = NULL
    WHERE id = ? AND status = 'matched' AND matched_order_id = ?
  `).run(id, expectedOrderId);
  return result.changes > 0;
}

/**
 * Atomically claim a pending withdrawal for matching with a new order.
 * Replaces the non-atomic find-then-update pattern that allowed two
 * concurrent createOrder calls to both match the same withdrawal.
 *
 * Returns the claimed withdrawal row (now in 'matched' state) or null
 * if no eligible withdrawal exists or another process claimed it first.
 *
 * Note: because SQLite doesn't support `SELECT FOR UPDATE` over WAL,
 * we use an UPDATE-then-SELECT pattern inside a synchronous
 * better-sqlite3 transaction (which holds the RESERVED lock for the
 * duration). The `matched_order_id` uniquely identifies this claim
 * so the follow-up SELECT returns exactly the row we just claimed.
 */
export function claimPendingWithdrawalByAmount(
  amount: number,
  payMethod: string,
  orderId: string,
  sellerId: number
): WithdrawalData | null {
  const now = Date.now();
  const claim = db.transaction(() => {
    // Find oldest eligible withdrawal still pending
    const candidate = db.prepare(`
      SELECT id FROM withdrawals
      WHERE status = 'pending' AND amount = ? AND pay_method = ? AND expires_at > ?
      ORDER BY created_at ASC LIMIT 1
    `).get(amount, payMethod, now) as { id: number } | undefined;
    if (!candidate) return null;
    // Claim it via CAS
    const r = db.prepare(`
      UPDATE withdrawals
      SET status = 'matched', matched_order_id = ?, matched_seller_id = ?
      WHERE id = ? AND status = 'pending'
    `).run(orderId, sellerId, candidate.id);
    if (r.changes === 0) return null; // another process won the race
    // Return the claimed row
    const row = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(candidate.id) as WithdrawalRow | undefined;
    return row ? rowToWithdrawal(row) : null;
  });
  return claim();
}

export function findPendingWithdrawalByAmount(amount: number, payMethod: string): WithdrawalData | null {
  const now = Date.now();
  const row = db.prepare(`
    SELECT * FROM withdrawals
    WHERE status = 'pending' AND amount = ? AND pay_method = ? AND expires_at > ?
    ORDER BY created_at ASC LIMIT 1
  `).get(amount, payMethod, now) as WithdrawalRow | undefined;
  return row ? rowToWithdrawal(row) : null;
}
