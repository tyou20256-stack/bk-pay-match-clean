"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDailyReport = getDailyReport;
exports.getMonthlyReport = getMonthlyReport;
exports.getSummaryReport = getSummaryReport;
/**
 * @file reportService.ts — 売上レポートサービス
 */
const database_js_1 = __importDefault(require("./database.js"));
function getDailyReport(date) {
    const startMs = new Date(date + 'T00:00:00+09:00').getTime();
    const endMs = startMs + 24 * 60 * 60 * 1000;
    const rows = database_js_1.default.prepare('SELECT * FROM orders WHERE created_at >= ? AND created_at < ?').all(startMs, endMs);
    const completed = rows.filter(r => r.status === 'completed');
    const totalJpy = completed.reduce((s, r) => s + (r.amount || 0), 0);
    const totalUsdt = completed.reduce((s, r) => s + (r.crypto_amount || 0), 0);
    const avgRate = completed.length > 0
        ? completed.reduce((s, r) => s + (r.rate || 0), 0) / completed.length
        : 0;
    const byMethod = {};
    for (const r of completed) {
        const m = r.pay_method || 'unknown';
        if (!byMethod[m])
            byMethod[m] = { orders: 0, jpyVolume: 0, usdtVolume: 0 };
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
function getMonthlyReport(year, month) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        days.push(getDailyReport(dateStr));
    }
    return { year, month, days };
}
function getSummaryReport() {
    const result = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        result.push(getDailyReport(dateStr));
    }
    return result;
}
