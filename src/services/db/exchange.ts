/**
 * @file exchange.ts — Exchange orders (Auto-Trade)
 */
import { db } from './connection.js';
import type { ExchangeOrderRow, ExchangeOrderData } from './connection.js';
import { safeJsonParse } from './connection.js';

export function createExchangeOrder(data: {
  orderId: string; exchange: string; channel: string; exchangeOrderId?: string;
  status?: string; sellerName?: string; sellerBankInfo?: Record<string, unknown>;
  amountJpy?: number; cryptoAmount?: number; rate?: number;
}): number {
  const now = Date.now();
  const r = db.prepare(`INSERT INTO exchange_orders
    (order_id, exchange, channel, exchange_order_id, status, seller_name, seller_bank_info, amount_jpy, crypto_amount, rate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    data.orderId, data.exchange, data.channel, data.exchangeOrderId || null,
    data.status || 'creating', data.sellerName || null,
    data.sellerBankInfo ? JSON.stringify(data.sellerBankInfo) : null,
    data.amountJpy ?? null, data.cryptoAmount ?? null, data.rate ?? null,
    now, now
  );
  return r.lastInsertRowid as number;
}

export function getExchangeOrder(orderId: string): ExchangeOrderData | null {
  const row = db.prepare('SELECT * FROM exchange_orders WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(orderId) as ExchangeOrderRow | undefined;
  if (!row) return null;
  return { ...row, sellerBankInfo: safeJsonParse(row.seller_bank_info) };
}

export function getExchangeOrderById(id: number): ExchangeOrderData | null {
  const row = db.prepare('SELECT * FROM exchange_orders WHERE id = ?').get(id) as ExchangeOrderRow | undefined;
  if (!row) return null;
  return { ...row, sellerBankInfo: safeJsonParse(row.seller_bank_info) };
}

export function updateExchangeOrder(id: number, updates: Record<string, unknown>): void {
  const allowed = ['channel','exchange_order_id','status','seller_name','seller_bank_info','error_message','screenshot_path','completed_at'];
  const fields: string[] = ['updated_at = ?'];
  const vals: unknown[] = [Date.now()];
  for (const [k, v] of Object.entries(updates)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
    if (allowed.includes(col)) {
      fields.push(`${col} = ?`);
      vals.push(col === 'seller_bank_info' && typeof v === 'object' ? JSON.stringify(v) : v);
    }
  }
  vals.push(id);
  db.prepare(`UPDATE exchange_orders SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
}

export function listExchangeOrders(limit = 100): ExchangeOrderData[] {
  return (db.prepare('SELECT * FROM exchange_orders ORDER BY created_at DESC LIMIT ?').all(limit) as ExchangeOrderRow[]).map(row => ({
    ...row, sellerBankInfo: safeJsonParse(row.seller_bank_info),
  }));
}

export function listActiveExchangeOrders(): ExchangeOrderData[] {
  return (db.prepare("SELECT * FROM exchange_orders WHERE status IN ('creating','placed','paid') ORDER BY created_at ASC").all() as ExchangeOrderRow[]).map(row => ({
    ...row, sellerBankInfo: safeJsonParse(row.seller_bank_info),
  }));
}
