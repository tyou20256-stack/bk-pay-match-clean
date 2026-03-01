/**
 * @file profitTracker.ts — 損益トラッキング
 * @description 注文完了時の利益を記録・集計するサービス。
 */
import db from './database.js';
import { getSetting, setSetting } from './database.js';

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

export function recordProfit(order: any, marketRate?: number): void {
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

  try {
    db.prepare(`INSERT OR REPLACE INTO profit_records (order_id, direction, crypto, customer_jpy, market_rate, customer_rate, spread_profit, fee_profit, total_profit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      order.id, direction, crypto, customerJpy, mRate, customerRate,
      Math.round(spreadProfit), Math.round(feeProfit), Math.round(totalProfit)
    );
  } catch (e: any) {
    console.error('[ProfitTracker] Failed to record:', e.message);
  }
}

export function getDailyProfit(date: string) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) = ?
  `).get(date) as any;
  return {
    totalProfit: row.totalProfit,
    spreadProfit: row.spreadProfit,
    feeProfit: row.feeProfit,
    orderCount: row.orderCount,
    avgProfitPerOrder: row.orderCount > 0 ? Math.round(row.totalProfit / row.orderCount) : 0,
  };
}

export function getMonthlyProfit(year: number, month: number): any[] {
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  return db.prepare(`
    SELECT date(created_at) as date,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records
    WHERE strftime('%Y-%m', created_at) = ?
    GROUP BY date(created_at)
    ORDER BY date(created_at)
  `).all(monthStr) as any[];
}

export function getProfitSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const todayData = getDailyProfit(today);

  const weekRow = db.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) >= date('now', '-7 days')
  `).get() as any;

  const monthRow = db.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get() as any;

  const allRow = db.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records
  `).get() as any;

  const byCrypto = db.prepare(`
    SELECT crypto,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) = date('now')
    GROUP BY crypto
  `).all() as any[];

  const mkSummary = (r: any) => ({
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

export function getHourlyProfit(date: string): any[] {
  const rows = db.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) = ?
    GROUP BY hour ORDER BY hour
  `).all(date) as any[];

  const hourMap = new Map(rows.map((r: any) => [r.hour, r]));
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

export function get7DayTrend(): any[] {
  return db.prepare(`
    SELECT date(created_at) as date,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COUNT(*) as orderCount
    FROM profit_records
    WHERE date(created_at) >= date('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY date(created_at)
  `).all() as any[];
}
