/**
 * @file merchantScoring.ts — マーチャントスコアリング
 * @description P2Pマーチャントの完了率/注文数/オンライン状態から独自スコアを算出。
 *   aggregatorのレート更新ごとにスコアを更新し、ダッシュボードに表示。
 */
import db from './database.js';
import { AggregatedRates, P2POrder } from '../types.js';
import logger from './logger.js';

// === Schema ===
db.exec(`
  CREATE TABLE IF NOT EXISTS merchant_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL,
    merchant_name TEXT NOT NULL,
    completion_rate REAL DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    is_online INTEGER DEFAULT 0,
    avg_price_premium REAL DEFAULT 0,
    score REAL DEFAULT 0,
    last_seen TEXT DEFAULT (datetime('now')),
    first_seen TEXT DEFAULT (datetime('now')),
    times_seen INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(exchange, merchant_name)
  );
`);

// === Types ===
export interface MerchantScore {
  id: number;
  exchange: string;
  merchant_name: string;
  completion_rate: number;
  order_count: number;
  is_online: boolean;
  avg_price_premium: number;
  score: number;
  last_seen: string;
  first_seen: string;
  times_seen: number;
}

// === Scoring Algorithm ===
// Weights: completionRate(40%) + orderCount(20%) + online(10%) + recency(15%) + premium(15%)
export function calculateScore(merchant: {
  completionRate: number;
  orderCount: number;
  isOnline: boolean;
  avgPricePremium?: number;
  timesSeen?: number;
}): number {
  // Completion rate: 0-100 → 0-40 points
  const completionScore = Math.min(merchant.completionRate, 100) * 0.4;

  // Order count: logarithmic, 1000+ orders = max (20 points)
  const orderScore = Math.min(Math.log10(Math.max(merchant.orderCount, 1)) / 3, 1) * 20;

  // Online: 0 or 10
  const onlineScore = merchant.isOnline ? 10 : 0;

  // Price premium: lower premium = better. -5% to +5% range → 0-15 points
  const premium = merchant.avgPricePremium || 0;
  const premiumScore = Math.max(0, 15 - Math.abs(premium) * 3);

  // Recency/reliability: more sightings = better. Max 15 points
  const seenScore = Math.min((merchant.timesSeen || 1) / 100, 1) * 15;

  return Math.round((completionScore + orderScore + onlineScore + premiumScore + seenScore) * 10) / 10;
}

// === Update from Rate Data ===
export function updateMerchantsFromRates(rates: AggregatedRates): void {
  if (!rates?.rates) return;

  const upsert = db.prepare(`
    INSERT INTO merchant_scores (exchange, merchant_name, completion_rate, order_count, is_online, avg_price_premium, score, last_seen, times_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
    ON CONFLICT(exchange, merchant_name) DO UPDATE SET
      completion_rate = ?,
      order_count = ?,
      is_online = ?,
      avg_price_premium = (avg_price_premium * 0.7 + ? * 0.3),
      score = ?,
      last_seen = datetime('now'),
      times_seen = times_seen + 1,
      updated_at = datetime('now')
  `);

  const transaction = db.transaction(() => {
    for (const er of rates.rates) {
      const allOrders = [...(er.buyOrders || []), ...(er.sellOrders || [])];
      const merchantMap = new Map<string, P2POrder[]>();

      for (const order of allOrders) {
        const key = order.merchant.name;
        if (!merchantMap.has(key)) merchantMap.set(key, []);
        merchantMap.get(key)!.push(order);
      }

      for (const [name, orders] of merchantMap) {
        const merchant = orders[0].merchant;
        const avgPremium = er.spotPrice
          ? orders.reduce((sum, o) => sum + ((o.price - er.spotPrice!) / er.spotPrice!) * 100, 0) / orders.length
          : 0;
        const score = calculateScore({
          completionRate: merchant.completionRate,
          orderCount: merchant.orderCount,
          isOnline: merchant.isOnline,
          avgPricePremium: avgPremium,
        });

        upsert.run(
          er.exchange, name, merchant.completionRate, merchant.orderCount, merchant.isOnline ? 1 : 0, avgPremium, score,
          merchant.completionRate, merchant.orderCount, merchant.isOnline ? 1 : 0, avgPremium, score
        );
      }
    }
  });

  try { transaction(); } catch (e) { logger.error('MerchantScoring update error', { error: e instanceof Error ? e.message : String(e) }); }
}

// === Queries ===
export function getTopMerchants(exchange?: string, limit: number = 50): MerchantScore[] {
  if (exchange) {
    return db.prepare('SELECT * FROM merchant_scores WHERE exchange = ? ORDER BY score DESC LIMIT ?').all(exchange, limit) as MerchantScore[];
  }
  return db.prepare('SELECT * FROM merchant_scores ORDER BY score DESC LIMIT ?').all(limit) as MerchantScore[];
}

export function getMerchantScore(exchange: string, name: string): MerchantScore | null {
  return db.prepare('SELECT * FROM merchant_scores WHERE exchange = ? AND merchant_name = ?').get(exchange, name) as MerchantScore | null;
}

export function getMerchantStats(): { total: number; byExchange: Record<string, number>; avgScore: number } {
  const total = (db.prepare('SELECT COUNT(*) as c FROM merchant_scores').get() as { c: number } | undefined)?.c ?? 0;
  const byExchangeRows = db.prepare('SELECT exchange, COUNT(*) as c FROM merchant_scores GROUP BY exchange').all() as Array<{ exchange: string; c: number }>;
  const byExchange: Record<string, number> = {};
  for (const row of byExchangeRows) byExchange[row.exchange] = row.c;
  const avgScore = (db.prepare('SELECT AVG(score) as avg FROM merchant_scores').get() as { avg: number | null } | undefined)?.avg || 0;
  return { total, byExchange, avgScore: Math.round(avgScore * 10) / 10 };
}

// Cleanup old merchants not seen in 7 days
setInterval(() => {
  try {
    db.prepare("DELETE FROM merchant_scores WHERE last_seen < datetime('now', '-7 days')").run();
  } catch {}
}, 6 * 60 * 60 * 1000);

logger.info('Merchant scoring system initialized');
