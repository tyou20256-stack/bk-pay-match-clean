/**
 * @file p2p.ts — P2P sellers (create, get, list, balance ops)
 */
import logger from '../logger.js';
import { db } from './connection.js';
import type { P2PSellerRow } from './connection.js';

export function createP2PSeller(data: {
  name: string; email: string; passwordHash: string; confirmToken: string;
  paypayId?: string; linepayId?: string; aupayId?: string;
  minAmount?: number; maxAmount?: number; payMethods?: string[];
}): number {
  const r = db.prepare(`INSERT INTO p2p_sellers
    (name, email, password_hash, confirm_token, paypay_id, linepay_id, aupay_id, min_amount, max_amount, pay_methods, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    data.name, data.email, data.passwordHash, data.confirmToken,
    data.paypayId || null, data.linepayId || null, data.aupayId || null,
    data.minAmount || 1000, data.maxAmount || 500000,
    JSON.stringify(data.payMethods || ['paypay']),
    Date.now()
  );
  return r.lastInsertRowid as number;
}

export function getP2PSeller(id: number): P2PSellerRow | null {
  return (db.prepare('SELECT * FROM p2p_sellers WHERE id = ?').get(id) as P2PSellerRow | undefined) || null;
}

export function getP2PSellerByEmail(email: string): P2PSellerRow | null {
  return (db.prepare('SELECT * FROM p2p_sellers WHERE email = ?').get(email) as P2PSellerRow | undefined) || null;
}

export function getP2PSellerByToken(token: string): P2PSellerRow | null {
  return (db.prepare('SELECT * FROM p2p_sellers WHERE confirm_token = ?').get(token) as P2PSellerRow | undefined) || null;
}

export function listP2PSellers(): P2PSellerRow[] {
  return db.prepare('SELECT * FROM p2p_sellers ORDER BY created_at DESC').all() as P2PSellerRow[];
}

export function listActiveP2PSellers(payMethod: string, minAmount: number, maxAmount: number): P2PSellerRow[] {
  return (db.prepare(`SELECT * FROM p2p_sellers WHERE status = 'active'
    AND min_amount <= ? AND max_amount >= ?`).all(minAmount, maxAmount) as P2PSellerRow[])
    .filter(s => {
      try {
        const methods: string[] = JSON.parse(s.pay_methods || '[]');
        return methods.includes(payMethod);
      } catch { return false; }
    });
}

export function updateP2PSellerStatus(id: number, status: string): void {
  db.prepare('UPDATE p2p_sellers SET status = ? WHERE id = ?').run(status, id);
}

export function updateP2PSeller(id: number, data: Partial<{
  name: string; paypayId: string; linepayId: string; aupayId: string;
  minAmount: number; maxAmount: number; payMethods: string[]; telegramChatId: string;
}>): void {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.paypayId !== undefined) { sets.push('paypay_id = ?'); vals.push(data.paypayId); }
  if (data.linepayId !== undefined) { sets.push('linepay_id = ?'); vals.push(data.linepayId); }
  if (data.aupayId !== undefined) { sets.push('aupay_id = ?'); vals.push(data.aupayId); }
  if (data.minAmount !== undefined) { sets.push('min_amount = ?'); vals.push(data.minAmount); }
  if (data.maxAmount !== undefined) { sets.push('max_amount = ?'); vals.push(data.maxAmount); }
  if (data.payMethods !== undefined) { sets.push('pay_methods = ?'); vals.push(JSON.stringify(data.payMethods)); }
  if (data.telegramChatId !== undefined) { sets.push('telegram_chat_id = ?'); vals.push(data.telegramChatId); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE p2p_sellers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function creditP2PSellerBalance(id: number, amount: number): void {
  // Guard against negative or zero amounts — callers must not use credit
  // as a backdoor deduct. Log and drop rather than corrupt the balance.
  if (!Number.isFinite(amount) || amount <= 0) {
    logger.error('creditP2PSellerBalance rejected non-positive amount', { id, amount });
    return;
  }
  db.prepare('UPDATE p2p_sellers SET usdt_balance = usdt_balance + ? WHERE id = ?').run(amount, id);
}

export function lockP2PSellerBalance(id: number, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) {
    logger.error('lockP2PSellerBalance rejected non-positive amount', { id, amount });
    return false;
  }
  const r = db.prepare(`UPDATE p2p_sellers SET usdt_locked = usdt_locked + ?
    WHERE id = ? AND (usdt_balance - usdt_locked) >= ?`).run(amount, id, amount);
  return r.changes > 0;
}

export function releaseP2PSellerBalance(id: number, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    logger.error('releaseP2PSellerBalance rejected non-positive amount', { id, amount });
    return;
  }
  db.prepare('UPDATE p2p_sellers SET usdt_locked = MAX(0, usdt_locked - ?) WHERE id = ?').run(amount, id);
}

/**
 * Atomically deduct from seller balance. Returns false if the seller
 * has insufficient locked funds — caller must handle (e.g. mark match
 * as error rather than silently succeed).
 *
 * Previously this used `MAX(0, usdt_balance - ?)` which silently
 * zeroed a non-existent balance when the locked amount was wrong.
 * The new `WHERE usdt_locked >= ?` guard makes concurrency races and
 * bookkeeping errors visible at the DB layer.
 */
export function deductP2PSellerBalance(id: number, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) {
    logger.error('deductP2PSellerBalance rejected non-positive amount', { id, amount });
    return false;
  }
  const r = db.prepare(`UPDATE p2p_sellers SET
    usdt_balance = usdt_balance - ?,
    usdt_locked = usdt_locked - ?,
    total_trades = total_trades + 1,
    last_active = ?
    WHERE id = ?
      AND usdt_locked >= ?
      AND usdt_balance >= ?`).run(amount, amount, Date.now(), id, amount, amount);
  if (r.changes === 0) {
    logger.error('deductP2PSellerBalance: insufficient funds or missing seller', { id, amount });
    return false;
  }
  return true;
}

export function listActiveP2PSellersAnyMethod(minAvailableUsdt: number): P2PSellerRow[] {
  return db.prepare(`
    SELECT * FROM p2p_sellers
    WHERE status = 'active' AND (usdt_balance - usdt_locked) >= ?
    ORDER BY total_trades DESC
  `).all(minAvailableUsdt) as P2PSellerRow[];
}
