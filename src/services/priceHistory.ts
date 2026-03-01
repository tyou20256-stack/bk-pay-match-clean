/**
 * @file priceHistory.ts — 価格履歴の記録・取得
 */
import db from './database.js';
import { AggregatedRates } from '../types';

db.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    timestamp INTEGER NOT NULL,
    crypto TEXT NOT NULL,
    exchange TEXT NOT NULL,
    best_buy REAL,
    best_sell REAL,
    spot REAL,
    spread REAL
  );
  CREATE INDEX IF NOT EXISTS idx_ph_crypto_ts ON price_history (crypto, timestamp);
`);

const insertStmt = db.prepare(
  `INSERT INTO price_history (timestamp, crypto, exchange, best_buy, best_sell, spot, spread) VALUES (?, ?, ?, ?, ?, ?, ?)`
);

const insertMany = db.transaction((rows: any[]) => {
  for (const r of rows) {
    insertStmt.run(r.timestamp, r.crypto, r.exchange, r.bestBuy, r.bestSell, r.spot, r.spread);
  }
});

export function recordSnapshot(crypto: string, aggregated: AggregatedRates): void {
  const now = Date.now();
  const rows = aggregated.rates.map(r => ({
    timestamp: now,
    crypto,
    exchange: r.exchange,
    bestBuy: r.bestBuy,
    bestSell: r.bestSell,
    spot: r.spotPrice,
    spread: r.spread,
  }));
  if (rows.length > 0) {
    insertMany(rows);
  }
}

export function getHistory(crypto: string, hours: number = 24): any[] {
  const since = Date.now() - hours * 60 * 60 * 1000;
  return db.prepare(
    `SELECT timestamp, exchange, best_buy as bestBuy, best_sell as bestSell, spot, spread FROM price_history WHERE crypto = ? AND timestamp >= ? ORDER BY timestamp ASC`
  ).all(crypto, since) as any[];
}

export function getHistoryByRange(crypto: string, from: number, to: number): any[] {
  return db.prepare(
    `SELECT timestamp, exchange, best_buy as bestBuy, best_sell as bestSell, spot, spread FROM price_history WHERE crypto = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`
  ).all(crypto, from, to) as any[];
}

// Cleanup old data (keep 30 days)
setInterval(() => {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM price_history WHERE timestamp < ?').run(cutoff);
}, 6 * 60 * 60 * 1000);
