/**
 * @file transfers.ts — Bank transfers + crypto transactions
 */
import { db } from './connection.js';
import type { BankTransferRow, CryptoTransactionRow, OrderRow } from './connection.js';
import { rowToOrder } from './orders.js';
import type { OrderData } from './connection.js';

// === Bank Transfer Recording (Phase C) ===
export function recordBankTransfer(data: {
  orderId?: string; bankAccountId?: number; senderName?: string;
  amount: number; transferDate: string; reference?: string;
  verificationMethod?: string; status?: string;
}): number {
  const result = db.prepare(
    `INSERT INTO bank_transfers (order_id, bank_account_id, sender_name, amount, transfer_date, reference, verification_method, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.orderId || null, data.bankAccountId || null, data.senderName || null,
    data.amount, data.transferDate, data.reference || null,
    data.verificationMethod || 'manual', data.status || 'unmatched', Date.now()
  );
  return result.lastInsertRowid as number;
}

export function getBankTransfers(options?: { status?: string; orderId?: string; limit?: number }): BankTransferRow[] {
  let sql = 'SELECT * FROM bank_transfers';
  const conditions: string[] = [];
  const vals: (string | number)[] = [];
  if (options?.status) { conditions.push('status = ?'); vals.push(options.status); }
  if (options?.orderId) { conditions.push('order_id = ?'); vals.push(options.orderId); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  if (options?.limit) { sql += ' LIMIT ?'; vals.push(options.limit); }
  return db.prepare(sql).all(...vals) as BankTransferRow[];
}

export function updateBankTransfer(id: number, data: { orderId?: string; status?: string; matchedAt?: number }): void {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (data.orderId !== undefined) { sets.push('order_id = ?'); vals.push(data.orderId); }
  if (data.status) { sets.push('status = ?'); vals.push(data.status); }
  if (data.matchedAt) { sets.push('matched_at = ?'); vals.push(data.matchedAt); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE bank_transfers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getUnmatchedBankTransfers(): BankTransferRow[] {
  return db.prepare('SELECT * FROM bank_transfers WHERE status = ? ORDER BY created_at ASC').all('unmatched') as BankTransferRow[];
}

// === Crypto Transaction Recording ===
export function recordCryptoTransaction(orderId: string, data: { txId: string; crypto: string; amount: number; toAddress: string; status: string }): void {
  db.prepare(`INSERT INTO crypto_transactions (order_id, tx_id, crypto, amount, to_address, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    orderId, data.txId, data.crypto, data.amount, data.toAddress, data.status, Date.now()
  );
}

export function getCryptoTransactions(orderId?: string): CryptoTransactionRow[] {
  if (orderId) {
    return db.prepare('SELECT * FROM crypto_transactions WHERE order_id = ? ORDER BY created_at DESC').all(orderId) as CryptoTransactionRow[];
  }
  return db.prepare('SELECT * FROM crypto_transactions ORDER BY created_at DESC LIMIT 100').all() as CryptoTransactionRow[];
}

/** Get transactions that were sent but not yet confirmed on-chain */
export function getUnconfirmedTransactions(): CryptoTransactionRow[] {
  return db.prepare("SELECT * FROM crypto_transactions WHERE status = 'sent' AND confirmed_at IS NULL ORDER BY created_at ASC").all() as CryptoTransactionRow[];
}

/** Update transaction status and confirmation timestamp */
export function updateCryptoTransactionStatus(txId: string, status: string, confirmedAt?: number): void {
  if (confirmedAt) {
    db.prepare('UPDATE crypto_transactions SET status = ?, confirmed_at = ? WHERE tx_id = ?').run(status, confirmedAt, txId);
  } else {
    db.prepare('UPDATE crypto_transactions SET status = ? WHERE tx_id = ?').run(status, txId);
  }
}
