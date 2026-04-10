/**
 * @file profitTracker.ts — 損益トラッキング
 * @description 注文完了時の利益を記録・集計するサービス。
 */
import db from './database.js';
import { getSetting, setSetting, getTotalTransactionCost } from './database.js';
import logger from './logger.js';

// === Schema ===
db.exec(`
  CREATE TABLE IF NOT EXISTS profit_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT UNIQUE,
    direction TEXT,
    crypto TEXT,
    customer_jpy REAL,
    market_rate REAL,
    customer_rate REAL,
    spread_profit REAL,
    fee_profit REAL,
    total_profit REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

export interface ProfitRecord {
  orderId: string;
  direction: 'buy' | 'sell';
  crypto: string;
  customerAmount: number;
  marketRate: number;
  customerRate: number;
  spreadProfit: number;
  feeProfit: number;
  totalProfit: number;
  timestamp: string;
}

interface ProfitOrderInput {
  id: string;
  direction?: string;
  crypto?: string;
  amount?: number;
  rate?: number;
  cryptoAmount?: number;
  feeJpy?: number;
  estimatedCost?: number;
}

interface ProfitAggregateRow {
  totalProfit: number;
  spreadProfit: number;
  feeProfit: number;
  totalCost: number;
  netProfit: number;
  orderCount: number;
}

interface ProfitDailyRow {
  date: string;
  totalProfit: number;
  spreadProfit: number;
  feeProfit: number;
  totalCost: number;
  netProfit: number;
  orderCount: number;
}

interface ProfitHourlyRow {
  hour: number;
  totalProfit: number;
  spreadProfit: number;
  feeProfit: number;
  orderCount: number;
}

interface ProfitCryptoRow {
  crypto: string;
  totalProfit: number;
  orderCount: number;
}

interface ProfitTrendRow {
  date: string;
  totalProfit: number;
  orderCount: number;
}

export function recordProfit(order: ProfitOrderInput, marketRate?: number): void {
  const direction = order.direction || 'buy';
  const crypto = order.crypto || 'USDT';
  const customerJpy = order.amount || 0;
  const customerRate = order.rate || 0;
  const mRate = marketRate || customerRate;
  const cryptoAmount = order.cryptoAmount || 0;

  let spreadProfit = 0;
  if (direction === 'buy') {
    spreadProfit = (customerRate - mRate) * cryptoAmount;
  } else {
    spreadProfit = (mRate - customerRate) * cryptoAmount;
  }

  const feeProfit = order.feeJpy || 0;
  const totalProfit = spreadProfit + feeProfit;

  // Calculate actual costs recorded for this order
  let totalCost = 0;
  try {
    totalCost = getTotalTransactionCost(order.id);
  } catch { /* cost table may not have entries yet */ }
  // Fall back to estimated cost if no actual costs recorded
  if (totalCost === 0 && order.estimatedCost) {
    totalCost = order.estimatedCost;
  }
  const netProfit = totalProfit - totalCost;

  try {
    db.prepare(`INSERT OR REPLACE INTO profit_records (order_id, direction, crypto, customer_jpy, market_rate, customer_rate, spread_profit, fee_profit, total_profit, total_cost, net_profit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      order.id, direction, crypto, customerJpy, mRate, customerRate,
      Math.round(spreadProfit), Math.round(feeProfit), Math.round(totalProfit),
      Math.round(totalCost), Math.round(netProfit)
    );
  } catch (e: unknown) {
    logger.error('Failed to record profit', { error: e instanceof Error ? e.message : String(e) });
  }
}

export function getDailyProfit(date: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COALESCE(SUM(total_cost),0) as totalCost,
           COALESCE(SUM(net_profit),0) as netProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) = ?
  `).get(date) as ProfitAggregateRow;
  return {
    totalProfit: row.totalProfit,
    spreadProfit: row.spreadProfit,
    feeProfit: row.feeProfit,
    totalCost: row.totalCost,
    netProfit: row.netProfit,
    orderCount: row.orderCount,
    avgProfitPerOrder: row.orderCount > 0 ? Math.round(row.totalProfit / row.orderCount) : 0,
  };
}

export function getMonthlyProfit(year: number, month: number): ProfitDailyRow[] {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  return db.prepare(`
    SELECT date(created_at) as date,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COALESCE(SUM(total_cost),0) as totalCost,
           COALESCE(SUM(net_profit),0) as netProfit,
           COUNT(*) as orderCount
    FROM profit_records
    WHERE strftime('%Y-%m', created_at) = ?
    GROUP BY date(created_at)
    ORDER BY date(created_at)
  `).all(monthStr) as ProfitDailyRow[];
}

export function getProfitSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const todayData = getDailyProfit(today);

  const weekRow = db.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COALESCE(SUM(total_cost),0) as totalCost,
           COALESCE(SUM(net_profit),0) as netProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) >= date('now', '-7 days')
  `).get() as ProfitAggregateRow;

  const monthRow = db.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COALESCE(SUM(total_cost),0) as totalCost,
           COALESCE(SUM(net_profit),0) as netProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get() as ProfitAggregateRow;

  const allRow = db.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COALESCE(SUM(total_cost),0) as totalCost,
           COALESCE(SUM(net_profit),0) as netProfit,
           COUNT(*) as orderCount
    FROM profit_records
  `).get() as ProfitAggregateRow;

  const byCrypto = db.prepare(`
    SELECT crypto,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) = date('now')
    GROUP BY crypto
  `).all() as ProfitCryptoRow[];

  const mkSummary = (r: ProfitAggregateRow) => ({
    ...r,
    avgProfitPerOrder: r.orderCount > 0 ? Math.round(r.totalProfit / r.orderCount) : 0,
  });

  return {
    today: mkSummary(todayData),
    thisWeek: mkSummary(weekRow),
    thisMonth: mkSummary(monthRow),
    allTime: mkSummary(allRow),
    byCrypto,
  };
}

export function getHourlyProfit(date: string): ProfitHourlyRow[] {
  const rows = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) = ?
    GROUP BY hour ORDER BY hour
  `).all(date) as ProfitHourlyRow[];

  const hourMap = new Map(rows.map((r) => [r.hour, r]));
  const result = [];
  for (let h = 0; h < 24; h++) {
    const data = hourMap.get(h);
    result.push({
      hour: h,
      totalProfit: data?.totalProfit || 0,
      spreadProfit: data?.spreadProfit || 0,
      feeProfit: data?.feeProfit || 0,
      orderCount: data?.orderCount || 0,
    });
  }
  return result;
}

export function getProfitGoal(): number {
  const val = getSetting('profitGoalDaily', '50000');
  return parseInt(val) || 50000;
}

export function setProfitGoal(amount: number): void {
  setSetting('profitGoalDaily', String(amount));
}

export function get7DayTrend(): ProfitTrendRow[] {
  return db.prepare(`
    SELECT date(created_at) as date,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COUNT(*) as orderCount
    FROM profit_records
    WHERE date(created_at) >= date('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY date(created_at)
  `).all() as ProfitTrendRow[];
}
