/**
 * @file fees.ts — Fee settings, cost config, transaction costs
 */
import { db } from './connection.js';
import type {
  FeeSettingsRow, FeeSettingsUpdate,
  FeeReportTotalRow, FeeReportDayRow, FeeReportCryptoRow,
  CostConfig, TransactionCost,
} from './connection.js';

export function getFeeSettings(): FeeSettingsRow | undefined {
  return db.prepare('SELECT * FROM fee_settings WHERE id = 1').get() as FeeSettingsRow | undefined;
}

export function updateFeeSettings(settings: FeeSettingsUpdate): void {
  const allowed = ['base_fee_rate','vip_bronze_rate','vip_silver_rate','vip_gold_rate','vip_platinum_rate'];
  const fields: string[] = [];
  const vals: (string | number)[] = [];
  for (const [k, v] of Object.entries(settings)) {
    if (allowed.includes(k) && v !== undefined) { fields.push(`${k} = ?`); vals.push(v as number); }
  }
  fields.push("updated_at = datetime('now')");
  if (vals.length > 0) db.prepare(`UPDATE fee_settings SET ${fields.join(', ')} WHERE id = 1`).run(...vals);
}

export function getFeeRateForRank(rank: string): number {
  const s = getFeeSettings();
  if (!s) return 0.02;
  switch (rank) {
    case 'platinum': return s.vip_platinum_rate;
    case 'gold': return s.vip_gold_rate;
    case 'silver': return s.vip_silver_rate;
    default: return s.vip_bronze_rate;
  }
}

export function getFeeReport(from: string, to: string): { total: FeeReportTotalRow; byDay: FeeReportDayRow[]; byCrypto: FeeReportCryptoRow[] } {
  const total = db.prepare(`
    SELECT COALESCE(SUM(fee_jpy),0) as total_fee_jpy, COALESCE(SUM(fee_crypto),0) as total_fee_crypto, COUNT(*) as order_count
    FROM orders WHERE status='completed' AND datetime(created_at/1000,'unixepoch') BETWEEN ? AND ?
  `).get(from, to + ' 23:59:59') as FeeReportTotalRow;
  const byDay = db.prepare(`
    SELECT date(created_at/1000,'unixepoch') as day, COALESCE(SUM(fee_jpy),0) as fee_jpy, COALESCE(SUM(fee_crypto),0) as fee_crypto, COUNT(*) as order_count
    FROM orders WHERE status='completed' AND datetime(created_at/1000,'unixepoch') BETWEEN ? AND ?
    GROUP BY day ORDER BY day DESC
  `).all(from, to + ' 23:59:59') as FeeReportDayRow[];
  const byCrypto = db.prepare(`
    SELECT crypto, COALESCE(SUM(fee_jpy),0) as fee_jpy, COALESCE(SUM(fee_crypto),0) as fee_crypto, COUNT(*) as order_count
    FROM orders WHERE status='completed' AND datetime(created_at/1000,'unixepoch') BETWEEN ? AND ?
    GROUP BY crypto
  `).all(from, to + ' 23:59:59') as FeeReportCryptoRow[];
  return { total, byDay, byCrypto };
}

// === Transaction Cost Config & Margin Safety ===

export function getCostConfig(): CostConfig {
  const row = db.prepare('SELECT * FROM cost_config WHERE id = 1').get() as CostConfig | undefined;
  return row || {
    id: 1, tron_gas_jpy: 50, bank_transfer_fee_jpy: 0,
    exchange_fee_rate: 0.001, min_margin_jpy: 100, min_margin_rate: 0.005,
    auto_adjust_fee: 1, updated_at: Date.now(),
  };
}

export function updateCostConfig(updates: Partial<CostConfig>): void {
  const allowed = ['tron_gas_jpy', 'bank_transfer_fee_jpy', 'exchange_fee_rate',
    'min_margin_jpy', 'min_margin_rate', 'auto_adjust_fee'];
  const fields: string[] = [];
  const vals: (string | number)[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!allowed.includes(k) || v === undefined) continue;
    const num = Number(v);
    if (isNaN(num) || num < 0) continue; // NaN/負の値を拒否
    if (k === 'exchange_fee_rate' && num > 1) continue; // 取引所手数料率は100%以下
    if (k === 'min_margin_rate' && num > 1) continue; // マージン率は100%以下
    fields.push(`${k} = ?`);
    vals.push(num);
  }
  fields.push(`updated_at = ${Date.now()}`);
  if (vals.length > 0) db.prepare(`UPDATE cost_config SET ${fields.join(', ')} WHERE id = 1`).run(...vals);
}

export function recordTransactionCost(orderId: string, costType: string, amountJpy: number, description?: string): void {
  db.prepare(
    `INSERT INTO transaction_costs (order_id, cost_type, amount_jpy, description, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, costType, amountJpy, description || null, Date.now());
}

export function getTransactionCosts(orderId: string): TransactionCost[] {
  return db.prepare('SELECT * FROM transaction_costs WHERE order_id = ?').all(orderId) as TransactionCost[];
}

export function getTotalTransactionCost(orderId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(amount_jpy), 0) as total FROM transaction_costs WHERE order_id = ?').get(orderId) as { total: number };
  return row.total;
}

/**
 * 取引のコストを見積もり、最低必要手数料を計算する。
 * @returns { estimatedCost, minFeeJpy, minFeeRate }
 */
export function estimateOrderCost(amountJpy: number, direction: 'buy' | 'sell'): {
  estimatedCost: number;
  minFeeJpy: number;
  minFeeRate: number;
} {
  const cc = getCostConfig();

  // 見積もりコスト = TRONガス + 銀行振込手数料 + 取引所手数料
  let estimatedCost = cc.tron_gas_jpy + cc.bank_transfer_fee_jpy;
  if (direction === 'buy') {
    // 購入時: 取引所手数料 = 金額 × exchange_fee_rate
    estimatedCost += amountJpy * cc.exchange_fee_rate;
  } else {
    // 売却時: ガス代のみ（顧客がUSDT送付）
    estimatedCost += amountJpy * cc.exchange_fee_rate;
  }

  // 最低必要手数料 = max(コスト + min_margin_jpy, 金額 × min_margin_rate)
  const minFeeByAmount = amountJpy * cc.min_margin_rate;
  const minFeeByMargin = estimatedCost + cc.min_margin_jpy;
  const minFeeJpy = Math.max(minFeeByAmount, minFeeByMargin);
  const minFeeRate = amountJpy > 0 ? minFeeJpy / amountJpy : 1;

  return {
    estimatedCost: Math.round(estimatedCost),
    minFeeJpy: Math.ceil(minFeeJpy),
    minFeeRate: parseFloat(minFeeRate.toFixed(6)),
  };
}
