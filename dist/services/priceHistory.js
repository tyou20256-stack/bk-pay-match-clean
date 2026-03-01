"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordSnapshot = recordSnapshot;
exports.getHistory = getHistory;
exports.getHistoryByRange = getHistoryByRange;
/**
 * @file priceHistory.ts — 価格履歴の記録・取得
 */
const database_js_1 = __importDefault(require("./database.js"));
database_js_1.default.exec(`
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
const insertStmt = database_js_1.default.prepare(`INSERT INTO price_history (timestamp, crypto, exchange, best_buy, best_sell, spot, spread) VALUES (?, ?, ?, ?, ?, ?, ?)`);
const insertMany = database_js_1.default.transaction((rows) => {
    for (const r of rows) {
        insertStmt.run(r.timestamp, r.crypto, r.exchange, r.bestBuy, r.bestSell, r.spot, r.spread);
    }
});
function recordSnapshot(crypto, aggregated) {
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
function getHistory(crypto, hours = 24) {
    const since = Date.now() - hours * 60 * 60 * 1000;
    return database_js_1.default.prepare(`SELECT timestamp, exchange, best_buy as bestBuy, best_sell as bestSell, spot, spread FROM price_history WHERE crypto = ? AND timestamp >= ? ORDER BY timestamp ASC`).all(crypto, since);
}
function getHistoryByRange(crypto, from, to) {
    return database_js_1.default.prepare(`SELECT timestamp, exchange, best_buy as bestBuy, best_sell as bestSell, spot, spread FROM price_history WHERE crypto = ? AND timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`).all(crypto, from, to);
}
// Cleanup old data (keep 30 days)
setInterval(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    database_js_1.default.prepare('DELETE FROM price_history WHERE timestamp < ?').run(cutoff);
}, 6 * 60 * 60 * 1000);
