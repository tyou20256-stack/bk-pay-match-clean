/**
 * @file orders.ts — Order CRUD, status transitions, sell orders
 */
import { db } from './connection.js';
import type { OrderRow, OrderData, OrderStatusExtra } from './connection.js';
import { safeJsonParse } from './connection.js';

export function rowToOrder(row: OrderRow): OrderData {
  return {
    id: row.id, mode: row.mode, status: row.status, amount: row.amount, crypto: row.crypto,
    cryptoAmount: row.crypto_amount, rate: row.rate, payMethod: row.pay_method, exchange: row.exchange,
    merchantName: row.merchant_name, merchantCompletionRate: row.merchant_completion_rate,
    paymentInfo: safeJsonParse(row.payment_info, null) as Record<string, unknown> | null, createdAt: row.created_at,
    expiresAt: row.expires_at, paidAt: row.paid_at, completedAt: row.completed_at,
    direction: row.direction || 'buy', customerWallet: row.customer_wallet || '', customerBankInfo: safeJsonParse(row.customer_bank_info, {}) as Record<string, unknown>,
    feeRate: row.fee_rate || 0, feeJpy: row.fee_jpy || 0, feeCrypto: row.fee_crypto || 0,
    verifiedAt: row.verified_at || null, txId: row.tx_id || null,
    customerWalletAddress: row.customer_wallet_address || null,
    webhookUrl: row.webhook_url || null,
    merchantApiKeyId: row.merchant_api_key_id || null,
    sellerId: row.seller_id || null,
    sellerConfirmedAt: row.seller_confirmed_at || null,
    withdrawalId: row.withdrawal_id || null,
    orderToken: row.order_token || null,
  };
}

export function saveOrder(order: Record<string, unknown>): void {
  db.prepare(`INSERT OR REPLACE INTO orders (id, mode, status, amount, crypto, crypto_amount, rate, pay_method, exchange, merchant_name, merchant_completion_rate, payment_info, created_at, expires_at, paid_at, completed_at, fee_rate, fee_jpy, fee_crypto, customer_wallet_address, order_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    order.id, order.mode, order.status, order.amount, order.crypto, order.cryptoAmount, order.rate,
    order.payMethod, order.exchange, order.merchantName, order.merchantCompletionRate,
    JSON.stringify(order.paymentInfo), order.createdAt, order.expiresAt, order.paidAt || null, order.completedAt || null,
    order.feeRate || 0, order.feeJpy || 0, order.feeCrypto || 0, order.customerWalletAddress || null,
    order.orderToken || null
  );
}

export function getOrder(id: string): OrderData | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!row) return null;
  return rowToOrder(row);
}

export function getAllOrders(limit = 100): OrderData[] {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit) as OrderRow[];
  return rows.map(rowToOrder);
}

export function updateOrderStatus(id: string, status: string, extra: OrderStatusExtra = {}): void {
  const sets = ['status = ?'];
  const vals: (string | number)[] = [status];
  if (extra.paidAt) { sets.push('paid_at = ?'); vals.push(extra.paidAt); }
  if (extra.completedAt) { sets.push('completed_at = ?'); vals.push(extra.completedAt); }
  if (extra.verifiedAt) { sets.push('verified_at = ?'); vals.push(extra.verifiedAt); }
  if (extra.txId) { sets.push('tx_id = ?'); vals.push(extra.txId); }
  vals.push(id);
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/**
 * Find all orders in `pending_payment` status whose expiry has passed.
 * Used by the expire cleanup interval — previously iterated only the
 * in-memory Map, missing orders created before the last process restart.
 */
export function getExpiredPendingOrders(now: number): OrderData[] {
  return (db.prepare(`
    SELECT * FROM orders
    WHERE status = 'pending_payment' AND expires_at < ?
    ORDER BY expires_at ASC
    LIMIT 100
  `).all(now) as OrderRow[]).map(rowToOrder);
}

/**
 * Atomically transition an order from one status to another using a
 * compare-and-swap (CAS) UPDATE. Returns true only if this caller
 * successfully flipped the status — the DB row was unchanged if another
 * process / request had already moved it to a different state.
 *
 * This replaces the read-then-write pattern used in orderManager.ts
 * which was vulnerable to TOCTOU races: two concurrent requests could
 * both read status='pending_payment', both pass canTransition, and
 * both issue UPDATE, overwriting each other and desynchronizing the
 * state machine (e.g. an already-expired order getting re-paid).
 *
 * Callers MUST check the return value and abort downstream side-effects
 * (notifier calls, webhook dispatch, P2P seller balance release) when
 * this returns false.
 */
export function transitionOrderStatus(
  id: string,
  fromStatus: string,
  toStatus: string,
  extra: OrderStatusExtra = {}
): boolean {
  const sets = ['status = ?'];
  const vals: (string | number)[] = [toStatus];
  if (extra.paidAt) { sets.push('paid_at = ?'); vals.push(extra.paidAt); }
  if (extra.completedAt) { sets.push('completed_at = ?'); vals.push(extra.completedAt); }
  if (extra.verifiedAt) { sets.push('verified_at = ?'); vals.push(extra.verifiedAt); }
  if (extra.txId) { sets.push('tx_id = ?'); vals.push(extra.txId); }
  vals.push(id, fromStatus);
  const result = db.prepare(
    `UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND status = ?`
  ).run(...vals);
  return result.changes > 0;
}

/**
 * Atomically claim an order for crypto sending (CAS: compare-and-swap).
 * Sets status to 'sending_crypto' only if current status is 'payment_verified'.
 * Returns true if claim succeeded (this process owns the send), false if already claimed.
 */
export function claimOrderForSending(id: string): boolean {
  const result = db.prepare(
    `UPDATE orders SET status = 'sending_crypto' WHERE id = ? AND status = 'payment_verified'`
  ).run(id);
  return result.changes > 0;
}

// === Sell Orders ===
export function createSellOrder(data: {
  id: string;
  cryptoAmount: number;
  crypto: string;
  rate: number;
  jpyAmount: number;
  customerWallet?: string;
  customerBankInfo: Record<string, unknown>;
  expiresAt: number;
}): void {
  const now = Date.now();
  db.prepare(`INSERT INTO orders (id, mode, status, amount, crypto, crypto_amount, rate, pay_method, exchange, merchant_name, merchant_completion_rate, payment_info, created_at, expires_at, direction, customer_wallet, customer_bank_info)
    VALUES (?, 'self', 'awaiting_deposit', ?, ?, ?, ?, 'bank', 'BK Pay（自社決済）', 'BK Stock', 100, '{}', ?, ?, 'sell', ?, ?)`).run(
    data.id, data.jpyAmount, data.crypto, data.cryptoAmount, data.rate,
    now, data.expiresAt,
    data.customerWallet || '',
    JSON.stringify(data.customerBankInfo)
  );
}

export function getSellOrdersAwaitingDeposit(): OrderData[] {
  const rows = db.prepare("SELECT * FROM orders WHERE direction = 'sell' AND status = 'awaiting_deposit' ORDER BY created_at DESC").all() as OrderRow[];
  return rows.map(r => ({ ...rowToOrder(r), direction: r.direction || 'sell', customerWallet: r.customer_wallet || '', customerBankInfo: safeJsonParse(r.customer_bank_info, {}) as Record<string, unknown> }));
}

export function getConfirmingOrders(): OrderData[] {
  return db.prepare("SELECT * FROM orders WHERE status = 'confirming' ORDER BY paid_at ASC").all().map((r) => rowToOrder(r as OrderRow));
}

export function saveOrderSellerId(orderId: string, sellerId: number): void {
  db.prepare('UPDATE orders SET seller_id = ? WHERE id = ?').run(sellerId, orderId);
}

export function confirmOrderBySeller(orderId: string, sellerId: number): void {
  db.prepare('UPDATE orders SET seller_confirmed_at = ? WHERE id = ? AND seller_id = ?').run(Date.now(), orderId, sellerId);
}

export function getOrdersBySellerId(sellerId: number): { id: string; amount: number; cryptoAmount: number; status: string; payMethod: string; createdAt: number; completedAt: number | null; txId: string | null }[] {
  return db.prepare(`
    SELECT id, amount, crypto_amount as cryptoAmount, status,
           pay_method as payMethod, created_at as createdAt,
           completed_at as completedAt, tx_id as txId
    FROM orders WHERE seller_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(sellerId) as { id: string; amount: number; cryptoAmount: number; status: string; payMethod: string; createdAt: number; completedAt: number | null; txId: string | null }[];
}

export function saveOrderWithdrawalId(orderId: string, withdrawalId: number): void {
  db.prepare('UPDATE orders SET withdrawal_id = ? WHERE id = ?').run(withdrawalId, orderId);
}

export function saveOrderWithMerchantKey(order: { id: string }, merchantApiKeyId: number, webhookUrl?: string): void {
  db.prepare(`UPDATE orders SET merchant_api_key_id = ?, webhook_url = ? WHERE id = ?`).run(
    merchantApiKeyId, webhookUrl || null, order.id
  );
}
