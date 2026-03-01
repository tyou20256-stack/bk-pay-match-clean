/**
 * @file reportService.ts — 売上レポートサービス
 */
import db from './database.js';

export interface DailyReport {
  date: string;
  totalOrders: number;
  completedOrders: number;
  totalJpyVolume: number;
  totalUsdtVolume: number;
  avgRate: number;
  byMethod: Record<string, { orders: number; jpyVolume: number; usdtVolume: number }>;
}

export function getDailyReport(date: string): DailyReport {
  const startMs = new Date(date + 'T00:00:00+09:00').getTime();
  const endMs = startMs + 24 * 60 * 60 * 1000;

  const rows = db.prepare(
    'SELECT * FROM orders WHERE created_at >= ? AND created_at < ?'
  ).all(startMs, endMs) as any[];

  const completed = rows.filter(r => r.status === 'completed');
  const totalJpy = completed.reduce((s: number, r: any) => s + (r.amount || 0), 0);
  const totalUsdt = completed.reduce((s: number, r: any) => s + (r.crypto_amount || 0), 0);
  const avgRate = completed.length > 0
    ? completed.reduce((s: number, r: any) => s + (r.rate || 0), 0) / completed.length
    : 0;

  const byMethod: Record<string, { orders: number; jpyVolume: number; usdtVolume: number }> = {};
  for (const r of completed) {
    const m = r.pay_method || 'unknown';
    if (!byMethod[m]) byMethod[m] = { orders: 0, jpyVolume: 0, usdtVolume: 0 };
    byMethod[m].orders++;
    byMethod[m].jpyVolume += r.amount || 0;
    byMethod[m].usdtVolume += r.crypto_amount || 0;
  }

  return {
    date,
    totalOrders: rows.length,
    completedOrders: completed.length,
    totalJpyVolume: totalJpy,
    totalUsdtVolume: Math.round(totalUsdt * 100) / 100,
    avgRate: Math.round(avgRate * 100) / 100,
    byMethod,
  };
}

export function getMonthlyReport(year: number, month: number): { year: number; month: number; days: DailyReport[] } {
  const daysInMonth = new Date(year, month, 0).getDate();
  const days: DailyReport[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push(getDailyReport(dateStr));
  }
  return { year, month, days };
}

export function getSummaryReport(): DailyReport[] {
  const result: DailyReport[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    result.push(getDailyReport(dateStr));
  }
  return result;
}
