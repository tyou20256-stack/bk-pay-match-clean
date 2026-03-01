/**
 * @file api.ts — APIルーター
 * @description 全APIエンドポイントを定義。レート取得（公開）、注文管理、
 *   口座管理、電子決済、ウォレット、設定（保護）のルートを含む。
 */
import { Router, Request, Response } from 'express';
import { getCachedRates, fetchAllRates } from '../services/aggregator';
import { getAllWindows } from '../services/arbitrage';
import { AggregatedRates } from '../types';
import { CONFIG } from '../config';

const router = Router();

router.get('/rates', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, AggregatedRates> = {};
  all.forEach((v, k) => { result[k] = v; });
  res.json({ success: true, data: result });
});

router.get('/rates/:crypto', (req: Request, res: Response) => {
  const crypto = req.params.crypto.toUpperCase();
  const data = getCachedRates(crypto) as AggregatedRates;
  res.json({ success: true, data });
});

router.get('/best', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, any> = {};
  all.forEach((v, k) => { result[k] = { bestBuy: v.bestBuyExchange, bestSell: v.bestSellExchange, spot: v.spotPrices[k] }; });
  res.json({ success: true, data: result });
});

router.get('/spread', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, any> = {};
  all.forEach((v, k) => { result[k] = v.rates.map(r => ({ exchange: r.exchange, spread: r.spread, bestBuy: r.bestBuy, bestSell: r.bestSell, buyPremium: r.buyPremium, sellPremium: r.sellPremium })); });
  res.json({ success: true, data: result });
});

router.get('/arbitrage', (_req: Request, res: Response) => {
  const windows = getAllWindows();
  res.json({ success: true, data: windows });
});

router.post('/refresh', async (_req: Request, res: Response) => {
  const crypto = (_req.body?.crypto || 'USDT').toUpperCase();
  const data = await fetchAllRates(crypto);
  res.json({ success: true, data });
});

router.get('/status', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  res.json({
    success: true, uptime: process.uptime(),
    exchanges: fetchers(), cryptos: CONFIG.cryptos,
    updateInterval: CONFIG.updateIntervalMs,
    cachedCryptos: Array.from(all.keys()),
    lastUpdated: Array.from(all.values()).map(v => ({ crypto: v.rates[0]?.crypto, time: new Date(v.lastUpdated).toISOString() })),
  });
});

function fetchers() { return ['Bybit', 'Binance', 'OKX', 'HTX']; }


// === Price History API ===
import { getHistory, getHistoryByRange } from "../services/priceHistory.js";

router.get("/history/:crypto", (req: Request, res: Response) => {
  const crypto = req.params.crypto.toUpperCase();
  const { hours, from, to } = req.query as any;
  let data;
  if (from && to) {
    data = getHistoryByRange(crypto, Number(from), Number(to));
  } else {
    data = getHistory(crypto, Number(hours) || 24);
  }
  res.json({ success: true, data });
});
export default router;

// === Order Management API ===
import orderManager from '../services/orderManager.js';

router.post('/orders', async (req, res) => {
  try {
    const { amount, payMethod, crypto } = req.body;
    if (!amount || amount < 500) return res.json({ success: false, error: 'Minimum amount is ¥500' });
    const order = await orderManager.createOrder(amount, payMethod || 'bank', crypto || 'USDT');
    res.json({ success: true, order });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

router.get('/orders/:id', (req, res) => {
  const order = orderManager.getOrder(req.params.id);
  if (!order) return res.json({ success: false, error: 'Order not found' });
  res.json({ success: true, order });
});

router.post('/orders/:id/paid', (req, res) => {
  const order = orderManager.markPaid(req.params.id);
  if (!order) return res.json({ success: false, error: 'Order not found' });
  res.json({ success: true, order });
});

router.post('/orders/:id/cancel', (req, res) => {
  const order = orderManager.cancelOrder(req.params.id);
  if (!order) return res.json({ success: false, error: 'Order not found' });
  res.json({ success: true, order });
});

router.get('/orders', (req, res) => {
  res.json({ success: true, orders: orderManager.getAllOrders() });
});



// === Sell Order API ===
router.post('/orders/sell', async (req, res) => {
  try {
    const { cryptoAmount, crypto, customerBankInfo } = req.body;
    if (!cryptoAmount || cryptoAmount <= 0) return res.json({ success: false, error: '暗号通貨の数量を指定してください' });
    if (!customerBankInfo?.bankName || !customerBankInfo?.accountNumber || !customerBankInfo?.accountHolder) {
      return res.json({ success: false, error: '銀行情報（銀行名、口座番号、名義）は必須です' });
    }
    const order = await orderManager.createSellOrder({
      cryptoAmount: Number(cryptoAmount),
      crypto: (crypto || 'USDT').toUpperCase(),
      customerBankInfo,
    });
    res.json({ success: true, order });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

router.post('/orders/:id/withdrawal-complete', (req, res) => {
  // Auth check
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token || !dbSvc.validateSession(token)) {
    return res.status(401).json({ success: false, error: '認証が必要です' });
  }
  const order = orderManager.markWithdrawalComplete(req.params.id);
  if (!order) return res.json({ success: false, error: '注文が見つかりません' });
  res.json({ success: true, order });
});

// === Puppeteer Trader Config ===
import trader from '../services/puppeteerTrader.js';

router.get('/trader/status', (req, res) => {
  res.json({ success: true, status: trader.getStatus() });
});

router.post('/trader/credentials', (req, res) => {
  const { exchange, email, password, apiKey, apiSecret, totpSecret } = req.body;
  if (!exchange) return res.json({ success: false, error: 'exchange required' });
  trader.setCredentials({ exchange, email, password, apiKey, apiSecret, totpSecret });
  res.json({ success: true, message: `Credentials set for ${exchange}` });
});

// === DB-backed APIs ===
import * as dbSvc from '../services/database.js';

// Bank Accounts
router.get('/accounts', (req, res) => {
  res.json({ success: true, accounts: dbSvc.getBankAccounts() });
});
router.post('/accounts', (req, res) => {
  try {
    const id = dbSvc.addBankAccount(req.body);
    res.json({ success: true, id });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
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
  const settings: any = {};
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
  if (!exchange) return res.json({ success: false, error: 'exchange required' });
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
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// === Reports API ===
import { getDailyReport, getMonthlyReport, getSummaryReport } from '../services/reportService.js';

router.get('/reports/daily', (req, res) => {
  const date = req.query.date as string;
  if (!date) return res.json({ success: false, error: 'date query parameter required (YYYY-MM-DD)' });
  res.json({ success: true, report: getDailyReport(date) });
});

router.get('/reports/monthly', (req, res) => {
  const year = parseInt(req.query.year as string);
  const month = parseInt(req.query.month as string);
  if (!year || !month) return res.json({ success: false, error: 'year and month query parameters required' });
  res.json({ success: true, report: getMonthlyReport(year, month) });
});

router.get('/reports/summary', (_req, res) => {
  res.json({ success: true, report: getSummaryReport() });
});

// === Fee Settings API ===
router.get('/fees/settings', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token || !dbSvc.validateSession(token)) return res.status(401).json({ success: false, error: '認証が必要です' });
  res.json({ success: true, data: dbSvc.getFeeSettings() });
});

router.post('/fees/settings', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token || !dbSvc.validateSession(token)) return res.status(401).json({ success: false, error: '認証が必要です' });
  dbSvc.updateFeeSettings(req.body);
  res.json({ success: true });
});

router.get('/fees/report', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
  if (!token || !dbSvc.validateSession(token)) return res.status(401).json({ success: false, error: '認証が必要です' });
  const from = (req.query.from as string) || new Date().toISOString().slice(0, 10);
  const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
  res.json({ success: true, data: dbSvc.getFeeReport(from, to) });
});

// Public: get fee rate for preview (no auth)
router.get('/fees/rate', (req, res) => {
  const rank = (req.query.rank as string) || 'bronze';
  const rate = dbSvc.getFeeRateForRank(rank);
  res.json({ success: true, rate });
});

// === Customer & Referral API ===

// Public: customer stats
router.get('/customer/:telegramId/stats', (req, res) => {
  try {
    const stats = dbSvc.getCustomerStats(req.params.telegramId);
    res.json({ success: true, data: stats });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Public: apply referral code
router.post('/customer/referral', (req, res) => {
  try {
    const { telegramId, referralCode } = req.body;
    if (!telegramId || !referralCode) return res.json({ success: false, error: 'telegramId and referralCode required' });
    const result = dbSvc.applyReferralCode(telegramId, referralCode);
    res.json(result);
  } catch (e: any) {
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

// === Spread Optimizer API ===
import spreadOptimizer, { getSpreadConfig, updateSpreadConfig, get24hStats, getOptimalSpread } from '../services/spreadOptimizer.js';

router.get('/spread/config', (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token || !dbSvc.validateSession(token)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  res.json({ success: true, data: getSpreadConfig() });
});

router.post('/spread/config', (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token || !dbSvc.validateSession(token)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { crypto, ...data } = req.body;
  if (!crypto) return res.json({ success: false, error: 'crypto required' });
  updateSpreadConfig(crypto, data);
  res.json({ success: true });
});

router.get('/spread/stats', (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token || !dbSvc.validateSession(token)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  res.json({ success: true, data: get24hStats() });
});

router.get('/spread/recommendation', async (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token || !dbSvc.validateSession(token)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    const report = await spreadOptimizer.getSpreadReport();
    res.json({ success: true, data: report });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// === CSV Export API ===
import { exportOrders, exportFreee, exportYayoi, exportAccounts, exportFeeReport } from '../services/csvExporter.js';

function sendCSV(res: Response, csv: string, filename: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
}

router.get('/export/orders', (req, res) => {
  const { from, to, format } = req.query as any;
  const csv = exportOrders(from, to, format || 'standard');
  sendCSV(res, csv, `orders_${from || 'all'}_${to || 'all'}.csv`);
});

router.get('/export/orders/freee', (req, res) => {
  const { from, to } = req.query as any;
  const csv = exportFreee(from, to);
  sendCSV(res, csv, `orders_freee_${from || 'all'}_${to || 'all'}.csv`);
});

router.get('/export/orders/yayoi', (req, res) => {
  const { from, to } = req.query as any;
  const csv = exportYayoi(from, to);
  sendCSV(res, csv, `orders_yayoi_${from || 'all'}_${to || 'all'}.csv`);
});

router.get('/export/accounts', (_req, res) => {
  const csv = exportAccounts();
  sendCSV(res, csv, 'bank_accounts.csv');
});

router.get('/export/fees', (req, res) => {
  const { from, to } = req.query as any;
  const csv = exportFeeReport(from, to);
  sendCSV(res, csv, `fee_report_${from || 'all'}_${to || 'all'}.csv`);
});

// === Account Health / Freeze Detection API ===
import { getHealthDashboard, autoRestUnhealthyAccounts, markTransferFailed } from '../services/freezeDetector.js';

router.get('/accounts/health', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token || req.cookies?.bkpay_token;
  if (!token || !dbSvc.validateSession(token)) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const dashboard = getHealthDashboard();
  res.json({ success: true, data: dashboard });
});

router.post('/accounts/health/check-all', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token || req.cookies?.bkpay_token;
  if (!token || !dbSvc.validateSession(token)) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const result = autoRestUnhealthyAccounts();
  res.json({ success: true, ...result });
});

router.post('/orders/:id/transfer-failed', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token || req.cookies?.bkpay_token;
  if (!token || !dbSvc.validateSession(token)) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  const order = orderManager.getOrder(req.params.id);
  if (!order) return res.json({ success: false, error: 'Order not found' });

  // Find the account used for this order and mark transfer failed
  const paymentInfo = order.paymentInfo;
  if ((paymentInfo as any)?.accountId) {
    markTransferFailed((paymentInfo as any).accountId);
  }

  orderManager.cancelOrder(req.params.id);
  res.json({ success: true, message: 'Order marked as transfer failed' });
});
