"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @file api.ts — APIルーター
 * @description 全APIエンドポイントを定義。レート取得（公開）、注文管理、
 *   口座管理、電子決済、ウォレット、設定（保護）のルートを含む。
 */
const express_1 = require("express");
const aggregator_1 = require("../services/aggregator");
const arbitrage_1 = require("../services/arbitrage");
const config_1 = require("../config");
const router = (0, express_1.Router)();
router.get('/rates', (_req, res) => {
    const all = (0, aggregator_1.getCachedRates)();
    const result = {};
    all.forEach((v, k) => { result[k] = v; });
    res.json({ success: true, data: result });
});
router.get('/rates/:crypto', (req, res) => {
    const crypto = req.params.crypto.toUpperCase();
    const data = (0, aggregator_1.getCachedRates)(crypto);
    res.json({ success: true, data });
});
router.get('/best', (_req, res) => {
    const all = (0, aggregator_1.getCachedRates)();
    const result = {};
    all.forEach((v, k) => { result[k] = { bestBuy: v.bestBuyExchange, bestSell: v.bestSellExchange, spot: v.spotPrices[k] }; });
    res.json({ success: true, data: result });
});
router.get('/spread', (_req, res) => {
    const all = (0, aggregator_1.getCachedRates)();
    const result = {};
    all.forEach((v, k) => { result[k] = v.rates.map(r => ({ exchange: r.exchange, spread: r.spread, bestBuy: r.bestBuy, bestSell: r.bestSell, buyPremium: r.buyPremium, sellPremium: r.sellPremium })); });
    res.json({ success: true, data: result });
});
router.get('/arbitrage', (_req, res) => {
    const windows = (0, arbitrage_1.getAllWindows)();
    res.json({ success: true, data: windows });
});
router.post('/refresh', async (_req, res) => {
    const crypto = (_req.body?.crypto || 'USDT').toUpperCase();
    const data = await (0, aggregator_1.fetchAllRates)(crypto);
    res.json({ success: true, data });
});
router.get('/status', (_req, res) => {
    const all = (0, aggregator_1.getCachedRates)();
    res.json({
        success: true, uptime: process.uptime(),
        exchanges: fetchers(), cryptos: config_1.CONFIG.cryptos,
        updateInterval: config_1.CONFIG.updateIntervalMs,
        cachedCryptos: Array.from(all.keys()),
        lastUpdated: Array.from(all.values()).map(v => ({ crypto: v.rates[0]?.crypto, time: new Date(v.lastUpdated).toISOString() })),
    });
});
function fetchers() { return ['Bybit', 'Binance', 'OKX', 'HTX']; }
// === Price History API ===
const priceHistory_js_1 = require("../services/priceHistory.js");
router.get("/history/:crypto", (req, res) => {
    const crypto = req.params.crypto.toUpperCase();
    const { hours, from, to } = req.query;
    let data;
    if (from && to) {
        data = (0, priceHistory_js_1.getHistoryByRange)(crypto, Number(from), Number(to));
    }
    else {
        data = (0, priceHistory_js_1.getHistory)(crypto, Number(hours) || 24);
    }
    res.json({ success: true, data });
});
exports.default = router;
// === Order Management API ===
const orderManager_js_1 = __importDefault(require("../services/orderManager.js"));
router.post('/orders', async (req, res) => {
    try {
        const { amount, payMethod, crypto } = req.body;
        if (!amount || amount < 500)
            return res.json({ success: false, error: 'Minimum amount is ¥500' });
        const order = await orderManager_js_1.default.createOrder(amount, payMethod || 'bank', crypto || 'USDT');
        res.json({ success: true, order });
    }
    catch (e) {
        res.json({ success: false, error: e.message });
    }
});
router.get('/orders/:id', (req, res) => {
    const order = orderManager_js_1.default.getOrder(req.params.id);
    if (!order)
        return res.json({ success: false, error: 'Order not found' });
    res.json({ success: true, order });
});
router.post('/orders/:id/paid', (req, res) => {
    const order = orderManager_js_1.default.markPaid(req.params.id);
    if (!order)
        return res.json({ success: false, error: 'Order not found' });
    res.json({ success: true, order });
});
router.post('/orders/:id/cancel', (req, res) => {
    const order = orderManager_js_1.default.cancelOrder(req.params.id);
    if (!order)
        return res.json({ success: false, error: 'Order not found' });
    res.json({ success: true, order });
});
router.get('/orders', (req, res) => {
    res.json({ success: true, orders: orderManager_js_1.default.getAllOrders() });
});
// === Sell Order API ===
router.post('/orders/sell', async (req, res) => {
    try {
        const { cryptoAmount, crypto, customerBankInfo } = req.body;
        if (!cryptoAmount || cryptoAmount <= 0)
            return res.json({ success: false, error: '暗号通貨の数量を指定してください' });
        if (!customerBankInfo?.bankName || !customerBankInfo?.accountNumber || !customerBankInfo?.accountHolder) {
            return res.json({ success: false, error: '銀行情報（銀行名、口座番号、名義）は必須です' });
        }
        const order = await orderManager_js_1.default.createSellOrder({
            cryptoAmount: Number(cryptoAmount),
            crypto: (crypto || 'USDT').toUpperCase(),
            customerBankInfo,
        });
        res.json({ success: true, order });
    }
    catch (e) {
        res.json({ success: false, error: e.message });
    }
});
router.post('/orders/:id/withdrawal-complete', (req, res) => {
    // Auth check
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    if (!token || !dbSvc.validateSession(token)) {
        return res.status(401).json({ success: false, error: '認証が必要です' });
    }
    const order = orderManager_js_1.default.markWithdrawalComplete(req.params.id);
    if (!order)
        return res.json({ success: false, error: '注文が見つかりません' });
    res.json({ success: true, order });
});
// === Puppeteer Trader Config ===
const puppeteerTrader_js_1 = __importDefault(require("../services/puppeteerTrader.js"));
router.get('/trader/status', (req, res) => {
    res.json({ success: true, status: puppeteerTrader_js_1.default.getStatus() });
});
router.post('/trader/credentials', (req, res) => {
    const { exchange, email, password, apiKey, apiSecret, totpSecret } = req.body;
    if (!exchange)
        return res.json({ success: false, error: 'exchange required' });
    puppeteerTrader_js_1.default.setCredentials({ exchange, email, password, apiKey, apiSecret, totpSecret });
    res.json({ success: true, message: `Credentials set for ${exchange}` });
});
// === DB-backed APIs ===
const dbSvc = __importStar(require("../services/database.js"));
// Bank Accounts
router.get('/accounts', (req, res) => {
    res.json({ success: true, accounts: dbSvc.getBankAccounts() });
});
router.post('/accounts', (req, res) => {
    try {
        const id = dbSvc.addBankAccount(req.body);
        res.json({ success: true, id });
    }
    catch (e) {
        res.json({ success: false, error: e.message });
    }
});
router.put('/accounts/:id', (req, res) => {
    dbSvc.updateBankAccount(parseInt(req.params.id), req.body);
    res.json({ success: true });
});
router.delete('/accounts/:id', (req, res) => {
    dbSvc.deleteBankAccount(parseInt(req.params.id));
    res.json({ success: true });
});
// E-Pay
router.get('/epay', (req, res) => {
    res.json({ success: true, configs: dbSvc.getAllEpayConfig() });
});
router.post('/epay/:type', (req, res) => {
    dbSvc.saveEpayConfig(req.params.type, req.body);
    res.json({ success: true });
});
// Wallet
router.get('/wallet', (req, res) => {
    res.json({ success: true, wallet: dbSvc.getWalletConfig() });
});
router.post('/wallet', (req, res) => {
    dbSvc.saveWalletConfig(req.body.address, req.body.label || '');
    res.json({ success: true });
});
// Settings
router.get('/settings', (req, res) => {
    const keys = ['minCompletion', 'orderTimeout', 'minAmount', 'maxAmount', 'onlineOnly', 'fallbackMode'];
    const settings = {};
    keys.forEach(k => { settings[k] = dbSvc.getSetting(k); });
    res.json({ success: true, settings });
});
router.post('/settings', (req, res) => {
    for (const [k, v] of Object.entries(req.body)) {
        dbSvc.setSetting(k, String(v));
    }
    res.json({ success: true });
});
// Exchange credentials (save to DB)
router.post('/exchange-creds', (req, res) => {
    const { exchange, ...data } = req.body;
    if (!exchange)
        return res.json({ success: false, error: 'exchange required' });
    dbSvc.saveExchangeCreds(exchange, data);
    res.json({ success: true, message: `${exchange} credentials saved` });
});
router.get('/exchange-creds', (req, res) => {
    const exchanges = ['Bybit', 'OKX'];
    const creds = exchanges.map(ex => dbSvc.getExchangeCreds(ex)).filter(Boolean);
    res.json({ success: true, credentials: creds });
});
// === Bulk Import API ===
router.post('/accounts/bulk', (req, res) => {
    try {
        const accounts = req.body;
        if (!Array.isArray(accounts) || accounts.length === 0) {
            return res.json({ success: false, error: 'Request body must be a non-empty array of accounts' });
        }
        const count = dbSvc.bulkAddBankAccounts(accounts);
        res.json({ success: true, imported: count });
    }
    catch (e) {
        res.json({ success: false, error: e.message });
    }
});
// === Reports API ===
const reportService_js_1 = require("../services/reportService.js");
router.get('/reports/daily', (req, res) => {
    const date = req.query.date;
    if (!date)
        return res.json({ success: false, error: 'date query parameter required (YYYY-MM-DD)' });
    res.json({ success: true, report: (0, reportService_js_1.getDailyReport)(date) });
});
router.get('/reports/monthly', (req, res) => {
    const year = parseInt(req.query.year);
    const month = parseInt(req.query.month);
    if (!year || !month)
        return res.json({ success: false, error: 'year and month query parameters required' });
    res.json({ success: true, report: (0, reportService_js_1.getMonthlyReport)(year, month) });
});
router.get('/reports/summary', (_req, res) => {
    res.json({ success: true, report: (0, reportService_js_1.getSummaryReport)() });
});
// === Customer & Referral API ===
// Public: customer stats
router.get('/customer/:telegramId/stats', (req, res) => {
    try {
        const stats = dbSvc.getCustomerStats(req.params.telegramId);
        res.json({ success: true, data: stats });
    }
    catch (e) {
        res.json({ success: false, error: e.message });
    }
});
// Public: apply referral code
router.post('/customer/referral', (req, res) => {
    try {
        const { telegramId, referralCode } = req.body;
        if (!telegramId || !referralCode)
            return res.json({ success: false, error: 'telegramId and referralCode required' });
        const result = dbSvc.applyReferralCode(telegramId, referralCode);
        res.json(result);
    }
    catch (e) {
        res.json({ success: false, error: e.message });
    }
});
// Admin: all referral rewards
router.get('/admin/referrals', (req, res) => {
    res.json({ success: true, data: dbSvc.getAllReferralRewards() });
});
// Admin: all customers
router.get('/admin/customers', (req, res) => {
    res.json({ success: true, data: dbSvc.getAllCustomers() });
});
