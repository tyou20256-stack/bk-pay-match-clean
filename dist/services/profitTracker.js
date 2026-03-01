"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordProfit = recordProfit;
exports.getDailyProfit = getDailyProfit;
exports.getMonthlyProfit = getMonthlyProfit;
exports.getProfitSummary = getProfitSummary;
exports.getHourlyProfit = getHourlyProfit;
exports.getProfitGoal = getProfitGoal;
exports.setProfitGoal = setProfitGoal;
exports.get7DayTrend = get7DayTrend;
/**
 * @file profitTracker.ts — 損益トラッキング
 * @description 注文完了時の利益を記録・集計するサービス。
 */
const database_js_1 = __importDefault(require("./database.js"));
const database_js_2 = require("./database.js");
// === Schema ===
database_js_1.default.exec(`
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
function recordProfit(order, marketRate) {
    const direction = order.direction || 'buy';
    const crypto = order.crypto || 'USDT';
    const customerJpy = order.amount || 0;
    const customerRate = order.rate || 0;
    const mRate = marketRate || customerRate;
    const cryptoAmount = order.cryptoAmount || 0;
    let spreadProfit = 0;
    if (direction === 'buy') {
        spreadProfit = (customerRate - mRate) * cryptoAmount;
    }
    else {
        spreadProfit = (mRate - customerRate) * cryptoAmount;
    }
    const feeProfit = order.feeJpy || 0;
    const totalProfit = spreadProfit + feeProfit;
    try {
        database_js_1.default.prepare(`INSERT OR REPLACE INTO profit_records (order_id, direction, crypto, customer_jpy, market_rate, customer_rate, spread_profit, fee_profit, total_profit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(order.id, direction, crypto, customerJpy, mRate, customerRate, Math.round(spreadProfit), Math.round(feeProfit), Math.round(totalProfit));
    }
    catch (e) {
        console.error('[ProfitTracker] Failed to record:', e.message);
    }
}
function getDailyProfit(date) {
    const row = database_js_1.default.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) = ?
  `).get(date);
    return {
        totalProfit: row.totalProfit,
        spreadProfit: row.spreadProfit,
        feeProfit: row.feeProfit,
        orderCount: row.orderCount,
        avgProfitPerOrder: row.orderCount > 0 ? Math.round(row.totalProfit / row.orderCount) : 0,
    };
}
function getMonthlyProfit(year, month) {
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    return database_js_1.default.prepare(`
    SELECT date(created_at) as date,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records
    WHERE strftime('%Y-%m', created_at) = ?
    GROUP BY date(created_at)
    ORDER BY date(created_at)
  `).all(monthStr);
}
function getProfitSummary() {
    const today = new Date().toISOString().slice(0, 10);
    const todayData = getDailyProfit(today);
    const weekRow = database_js_1.default.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) >= date('now', '-7 days')
  `).get();
    const monthRow = database_js_1.default.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get();
    const allRow = database_js_1.default.prepare(`
    SELECT COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records
  `).get();
    const byCrypto = database_js_1.default.prepare(`
    SELECT crypto,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) = date('now')
    GROUP BY crypto
  `).all();
    const mkSummary = (r) => ({
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
function getHourlyProfit(date) {
    const rows = database_js_1.default.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COALESCE(SUM(spread_profit),0) as spreadProfit,
           COALESCE(SUM(fee_profit),0) as feeProfit,
           COUNT(*) as orderCount
    FROM profit_records WHERE date(created_at) = ?
    GROUP BY hour ORDER BY hour
  `).all(date);
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
function getProfitGoal() {
    const val = (0, database_js_2.getSetting)('profitGoalDaily', '50000');
    return parseInt(val) || 50000;
}
function setProfitGoal(amount) {
    (0, database_js_2.setSetting)('profitGoalDaily', String(amount));
}
function get7DayTrend() {
    return database_js_1.default.prepare(`
    SELECT date(created_at) as date,
           COALESCE(SUM(total_profit),0) as totalProfit,
           COUNT(*) as orderCount
    FROM profit_records
    WHERE date(created_at) >= date('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY date(created_at)
  `).all();
}
