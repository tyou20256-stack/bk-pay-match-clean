"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSpreadConfig = getSpreadConfig;
exports.updateSpreadConfig = updateSpreadConfig;
exports.recordOrder = recordOrder;
exports.getOptimalSpread = getOptimalSpread;
exports.getSpreadReport = getSpreadReport;
exports.get24hStats = get24hStats;
/**
 * @file spreadOptimizer.ts — AI自動スプレッド最適化
 * @description 需要・競合・時間帯に基づき、最適なBuy/Sellスプレッドを算出。
 */
const database_js_1 = __importDefault(require("./database.js"));
// === Schema ===
database_js_1.default.exec(`
  CREATE TABLE IF NOT EXISTS spread_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hour INTEGER,
    day_of_week INTEGER,
    crypto TEXT,
    order_count INTEGER DEFAULT 0,
    total_volume REAL DEFAULT 0,
    avg_spread REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(hour, day_of_week, crypto)
  );

  CREATE TABLE IF NOT EXISTS spread_config (
    crypto TEXT PRIMARY KEY,
    buy_markup REAL DEFAULT 0.015,
    sell_discount REAL DEFAULT 0.015,
    auto_adjust INTEGER DEFAULT 1,
    min_markup REAL DEFAULT 0.005,
    max_markup REAL DEFAULT 0.03,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);
// Seed defaults
for (const crypto of ['USDT', 'BTC', 'ETH']) {
    database_js_1.default.prepare(`INSERT OR IGNORE INTO spread_config (crypto) VALUES (?)`).run(crypto);
}
// === Config CRUD ===
function getSpreadConfig(crypto) {
    const query = crypto
        ? database_js_1.default.prepare('SELECT * FROM spread_config WHERE crypto = ?').all(crypto)
        : database_js_1.default.prepare('SELECT * FROM spread_config').all();
    return query.map(r => ({
        crypto: r.crypto,
        buyMarkup: r.buy_markup,
        sellDiscount: r.sell_discount,
        autoAdjust: !!r.auto_adjust,
        minMarkup: r.min_markup,
        maxMarkup: r.max_markup,
    }));
}
function updateSpreadConfig(crypto, data) {
    const fields = [];
    const vals = [];
    if (data.buyMarkup !== undefined) {
        fields.push('buy_markup = ?');
        vals.push(data.buyMarkup);
    }
    if (data.sellDiscount !== undefined) {
        fields.push('sell_discount = ?');
        vals.push(data.sellDiscount);
    }
    if (data.autoAdjust !== undefined) {
        fields.push('auto_adjust = ?');
        vals.push(data.autoAdjust ? 1 : 0);
    }
    if (data.minMarkup !== undefined) {
        fields.push('min_markup = ?');
        vals.push(data.minMarkup);
    }
    if (data.maxMarkup !== undefined) {
        fields.push('max_markup = ?');
        vals.push(data.maxMarkup);
    }
    if (fields.length === 0)
        return;
    fields.push("updated_at = datetime('now')");
    vals.push(crypto);
    database_js_1.default.prepare(`UPDATE spread_config SET ${fields.join(', ')} WHERE crypto = ?`).run(...vals);
}
// === Order Recording ===
function recordOrder(crypto, amountJpy, hour) {
    const now = new Date();
    const jstHour = hour ?? ((now.getUTCHours() + 9) % 24);
    const dow = now.getDay();
    database_js_1.default.prepare(`
    INSERT INTO spread_stats (hour, day_of_week, crypto, order_count, total_volume, updated_at)
    VALUES (?, ?, ?, 1, ?, datetime('now'))
    ON CONFLICT(hour, day_of_week, crypto) DO UPDATE SET
      order_count = order_count + 1,
      total_volume = total_volume + ?,
      updated_at = datetime('now')
  `).run(jstHour, dow, crypto.toUpperCase(), amountJpy, amountJpy);
}
// === Demand Analysis ===
function getHourlyStats(crypto) {
    const rows = database_js_1.default.prepare(`
    SELECT hour, 
      CAST(AVG(order_count) AS REAL) as avg_orders,
      CAST(AVG(total_volume) AS REAL) as avg_volume
    FROM spread_stats WHERE crypto = ?
    GROUP BY hour ORDER BY hour
  `).all(crypto);
    return rows.map(r => ({ hour: r.hour, avgOrders: r.avg_orders || 0, avgVolume: r.avg_volume || 0 }));
}
function getDemandMultiplier(crypto) {
    const now = new Date();
    const jstHour = (now.getUTCHours() + 9) % 24;
    const stats = getHourlyStats(crypto);
    if (stats.length === 0)
        return 1.0;
    const currentHourStat = stats.find(s => s.hour === jstHour);
    const overallAvg = stats.reduce((s, r) => s + r.avgOrders, 0) / stats.length;
    if (!currentHourStat || overallAvg === 0)
        return 1.0;
    const ratio = currentHourStat.avgOrders / overallAvg;
    return Math.max(0.5, Math.min(2.0, ratio));
}
// === Time-of-day Adjustment ===
function getTimeAdjustment() {
    const now = new Date();
    const jstHour = (now.getUTCHours() + 9) % 24;
    if (jstHour >= 23 || jstHour < 7)
        return 0.003; // +0.3% late night
    if ((jstHour >= 11 && jstHour <= 14) || (jstHour >= 19 && jstHour <= 22))
        return 0.001; // +0.1% peak
    return 0;
}
// === Competitor Analysis ===
async function getCompetitorOffset(crypto, _side) {
    try {
        const res = await fetch(`http://localhost:3003/api/rates/${crypto}`);
        const data = await res.json();
        if (!data.success || !data.data?.rates)
            return 0;
        const prices = [];
        for (const ex of data.data.rates) {
            const orders = _side === 'buy' ? ex.buyOrders : ex.sellOrders;
            if (orders) {
                for (const o of orders) {
                    if (o.price > 0)
                        prices.push(Number(o.price));
                }
            }
        }
        if (prices.length === 0)
            return 0;
        return -0.001; // Stay 0.1% below cheapest
    }
    catch {
        return 0;
    }
}
// === Main: Get Optimal Spread ===
async function getOptimalSpread(crypto, side) {
    const configs = getSpreadConfig(crypto);
    const config = configs[0] || { crypto, buyMarkup: 0.015, sellDiscount: 0.015, autoAdjust: true, minMarkup: 0.005, maxMarkup: 0.03 };
    const baseRate = side === 'buy' ? config.buyMarkup : config.sellDiscount;
    const reasons = [];
    if (!config.autoAdjust) {
        return { crypto, side, baseRate, demandAdjustment: 0, timeAdjustment: 0, competitorAdjustment: 0, finalSpread: baseRate, reason: ['Auto-adjust disabled'] };
    }
    const demandMult = getDemandMultiplier(crypto);
    let demandAdj = 0;
    if (demandMult > 1.3) {
        demandAdj = 0.002;
        reasons.push(`High demand (${demandMult.toFixed(2)}x) +0.2%`);
    }
    else if (demandMult < 0.7) {
        demandAdj = -0.002;
        reasons.push(`Low demand (${demandMult.toFixed(2)}x) -0.2%`);
    }
    else {
        reasons.push(`Normal demand (${demandMult.toFixed(2)}x)`);
    }
    const timeAdj = getTimeAdjustment();
    if (timeAdj > 0) {
        const jstHour = (new Date().getUTCHours() + 9) % 24;
        reasons.push(`Time (JST ${jstHour}:00) +${(timeAdj * 100).toFixed(1)}%`);
    }
    const compAdj = await getCompetitorOffset(crypto, side);
    if (compAdj !== 0)
        reasons.push(`Competitor undercut ${(compAdj * 100).toFixed(1)}%`);
    let finalSpread = baseRate + demandAdj + timeAdj + compAdj;
    finalSpread = Math.max(config.minMarkup, Math.min(config.maxMarkup, finalSpread));
    reasons.push(`Final: ${(finalSpread * 100).toFixed(2)}% [${(config.minMarkup * 100).toFixed(1)}%-${(config.maxMarkup * 100).toFixed(1)}%]`);
    return { crypto, side, baseRate, demandAdjustment: demandAdj, timeAdjustment: timeAdj, competitorAdjustment: compAdj, finalSpread, reason: reasons };
}
// === Report ===
async function getSpreadReport() {
    const configs = getSpreadConfig();
    const recommendations = [];
    const hourlyStats = [];
    for (const c of configs) {
        const buy = await getOptimalSpread(c.crypto, 'buy');
        const sell = await getOptimalSpread(c.crypto, 'sell');
        recommendations.push({ crypto: c.crypto, buy, sell });
        hourlyStats.push({ crypto: c.crypto, stats: getHourlyStats(c.crypto) });
    }
    return { configs, recommendations, hourlyStats };
}
function get24hStats() {
    const rows = database_js_1.default.prepare(`
    SELECT crypto, hour, order_count, total_volume 
    FROM spread_stats 
    WHERE updated_at >= datetime('now', '-24 hours')
    ORDER BY crypto, hour
  `).all();
    return rows.map(r => ({ crypto: r.crypto, hour: r.hour, orderCount: r.order_count, totalVolume: r.total_volume }));
}
exports.default = { getOptimalSpread, recordOrder, getSpreadReport, getSpreadConfig, updateSpreadConfig, get24hStats };
