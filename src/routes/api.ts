/**
 * @file api.ts — APIルーター
 * @description 全APIエンドポイントを定義。レート取得（公開）、注文管理、
 *   口座管理、電子決済、ウォレット、設定（保護）のルートを含む。
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';

// Multer config for payment proof uploads
const proofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(process.cwd(), 'data', 'proofs')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `proof_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});
const uploadProof = multer({
  storage: proofStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    cb(null, allowed.includes(ext) && allowedMimes.includes(file.mimetype));
  },
});
import { getCachedRates, fetchAllRates } from '../services/aggregator';
import { getAllWindows } from '../services/arbitrage';
import { AggregatedRates } from '../types';
import logger from '../services/logger.js';
import { getRecentErrors, getErrorStats, resolveError, resolveAllErrors } from '../services/errorTracker.js';
import { CONFIG } from '../config';
import { AppError, ValidationError, AuthenticationError, NotFoundError } from '../errors.js';
import express from 'express';

// Rate limiters for P2P seller endpoints
const sellerAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, error: 'Too many login attempts. Try again later.' },
});
const sellerConfirmLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { success: false, error: 'Too many confirm requests. Please wait.' },
});

const router = Router();

// Sanitize error messages — never expose internal details to clients
function safeError(e: unknown, fallback = 'Internal server error'): string {
  // Structured errors are always safe to return
  if (e instanceof AppError) return e.message;
  // Only return known safe messages; log the real error
  const err = e instanceof Error ? e : null;
  if (err?.message) {
    logger.error('API error', { error: err.message });
  }
  // Allow specific user-facing error messages
  const safeMessages = [
    'Minimum amount is ¥500',
    '金額の上限は1,000万円です',
    '暗号通貨の数量を指定してください',
    '銀行情報（銀行名、口座番号、名義）は必須です',
    '売却レートを取得できませんでした',
    'exchange required',
    'username and password required',
    'role required',
    'newPassword required',
    'scope required',
    'totalAmountJpy required',
    'crypto required',
    'telegramId and referralCode required',
    'email and password required',
    'documentType and filePath required',
    'status must be approved or rejected',
    '有効な金額を指定してください',
    '日付形式が不正です (YYYY-MM-DD)',
    '既に紹介コードを登録済みです',
    '無効な紹介コードです',
    '自分のコードは使用できません',
    'Wallet not configured (TRON_WALLET_PRIVATE_KEY not set)',
    'Order not found',
    'Order not found or invalid status transition',
    '金額と入金日は必須です',
    'CSVデータが必要です',
  ];
  if (err?.message && safeMessages.includes(err.message)) return err.message;
  return fallback;
}

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
  const result: Record<string, { bestBuy: { exchange: string; price: number } | null; bestSell: { exchange: string; price: number } | null; spot: number }> = {};
  all.forEach((v, k) => { result[k] = { bestBuy: v.bestBuyExchange, bestSell: v.bestSellExchange, spot: v.spotPrices[k] }; });
  res.json({ success: true, data: result });
});

router.get('/spread', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, Array<{ exchange: string; spread: number | null; bestBuy: number | null; bestSell: number | null; buyPremium: number | null; sellPremium: number | null }>> = {};
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
  const { hours, from, to } = req.query as { hours?: string; from?: string; to?: string };
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

const TRON_ADDR_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

const VALID_PAY_METHODS = ['bank', 'paypay', 'linepay', 'aupay'];
const VALID_CRYPTOS = ['USDT', 'BTC', 'ETH'];

router.post('/orders', async (req, res) => {
  try {
    const { amount, payMethod, crypto, customerWalletAddress } = req.body;
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 500) return res.json({ success: false, error: 'Minimum amount is ¥500' });
    if (numAmount > 10_000_000) return res.json({ success: false, error: '金額の上限は1,000万円です' });
    const safePayMethod = VALID_PAY_METHODS.includes(payMethod) ? payMethod : 'bank';
    const safeCrypto = VALID_CRYPTOS.includes(crypto) ? crypto : 'USDT';
    if (!customerWalletAddress || !TRON_ADDR_RE.test(String(customerWalletAddress))) {
      throw new ValidationError('有効なTRONウォレットアドレスを入力してください (T で始まる34文字)');
    }
    const order = await orderManager.createOrder(numAmount, safePayMethod, safeCrypto, customerWalletAddress);
    res.json({ success: true, order });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

router.get('/orders/:id', (req, res) => {
  const order = orderManager.getOrder(req.params.id);
  if (!order) throw new NotFoundError('Order');
  res.json({ success: true, order });
});

router.post('/orders/:id/paid', (req, res) => {
  const { orderToken } = req.body || {};
  const existing = dbSvc.getOrder(req.params.id);
  if (existing && existing.orderToken && orderToken !== existing.orderToken) {
    throw new AuthenticationError('Invalid order token');
  }
  const order = orderManager.markPaid(req.params.id);
  if (!order) throw new NotFoundError('Order');
  res.json({ success: true, order });
});

router.post('/orders/:id/cancel', (req, res) => {
  const { orderToken } = req.body || {};
  const existing = dbSvc.getOrder(req.params.id);
  if (existing && existing.orderToken && orderToken !== existing.orderToken) {
    throw new AuthenticationError('Invalid order token');
  }
  const order = orderManager.cancelOrder(req.params.id);
  if (!order) throw new NotFoundError('Order');
  res.json({ success: true, order });
});

router.get('/orders', (req, res) => {
  res.json({ success: true, orders: orderManager.getAllOrders() });
});

// === Admin Order Actions (Phase A/B: Manual verify → crypto send → complete) ===
import { processCryptoSend, isWalletReady, getWalletBalance, getSendingAddress, checkAndAlertSweep, sweepToColdWallet } from '../services/walletService.js';

// Admin verifies bank deposit received
router.post('/orders/:id/verify', (req, res) => {
  const order = orderManager.adminVerifyPayment(req.params.id);
  if (!order) throw new NotFoundError('Order or invalid status transition');
  dbSvc.recordAuditLog({ userId: (req as unknown as Record<string, unknown>).userId as number, action: 'order_verify', targetType: 'order', targetId: req.params.id, ipAddress: req.ip || '' });
  res.json({ success: true, order });
});

// Admin triggers USDT send (auto via TronWeb)
router.post('/orders/:id/send-crypto', async (req, res) => {
  try {
    dbSvc.recordAuditLog({ userId: (req as unknown as Record<string, unknown>).userId as number, action: 'order_send_crypto', targetType: 'order', targetId: req.params.id, ipAddress: req.ip || '' });
    const result = await processCryptoSend(req.params.id);
    res.json({ success: result.success, txId: result.txId, error: result.error });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

// Admin manually completes order (when crypto sent outside system)
router.post('/orders/:id/manual-complete', (req, res) => {
  const { txId } = req.body || {};
  const order = orderManager.adminManualComplete(req.params.id, txId);
  if (!order) throw new NotFoundError('Order or invalid status transition');
  dbSvc.recordAuditLog({ userId: (req as unknown as Record<string, unknown>).userId as number, action: 'order_manual_complete', targetType: 'order', targetId: req.params.id, details: txId ? `txId=${txId}` : undefined, ipAddress: req.ip || '' });
  res.json({ success: true, order });
});

// Wallet status (sending wallet info)
router.get('/wallet/status', async (_req, res) => {
  const ready = isWalletReady();
  const address = getSendingAddress();
  let balance = null;
  if (ready) {
    balance = await getWalletBalance();
  }
  res.json({ success: true, ready, address, balance });
});

// === Wallet Thresholds (Hot/Cold wallet separation) ===

// Get wallet thresholds config
router.get('/wallet/thresholds', (_req, res) => {
  const thresholds = dbSvc.getWalletThresholds();
  res.json({ success: true, thresholds });
});

// Update wallet thresholds
router.post('/wallet/thresholds', (req, res) => {
  const allowedKeys = ['hot_wallet_max', 'cold_wallet_address', 'sweep_alert_threshold', 'min_hot_balance'];
  const body = req.body || {};
  let updated = 0;
  for (const [k, v] of Object.entries(body)) {
    if (!allowedKeys.includes(k)) continue;
    dbSvc.setWalletThreshold(k, String(v));
    updated++;
  }
  res.json({ success: true, updated, thresholds: dbSvc.getWalletThresholds() });
});

// Check current sweep status
router.get('/wallet/sweep-status', async (_req, res) => {
  try {
    const status = await checkAndAlertSweep();
    if (!status) {
      return res.json({ success: false, error: 'Wallet not configured or balance check failed' });
    }
    res.json({ success: true, ...status });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

// Manually trigger sweep to cold wallet
router.post('/wallet/sweep', async (req, res) => {
  try {
    const { amount } = req.body || {};
    const result = await sweepToColdWallet(amount ? Number(amount) : undefined);
    res.json({ success: result.success, txId: result.txId, error: result.error });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

// Crypto transaction history
router.get('/crypto-transactions', (_req, res) => {
  const txs = dbSvc.getCryptoTransactions();
  res.json({ success: true, transactions: txs });
});

router.get('/crypto-transactions/:orderId', (req, res) => {
  const txs = dbSvc.getCryptoTransactions(req.params.orderId);
  res.json({ success: true, transactions: txs });
});

// === Bank Transfer Verification (Phase C) ===
import bankVerifier from '../services/bankVerifier.js';

// Register a single bank transfer
router.post('/bank-transfers', (req, res) => {
  try {
    const { amount, transferDate, senderName, bankAccountId, reference } = req.body;
    if (!amount || !transferDate) return res.json({ success: false, error: '金額と入金日は必須です' });
    const result = bankVerifier.registerTransfer({
      amount: Number(amount),
      transferDate,
      senderName,
      bankAccountId: bankAccountId ? Number(bankAccountId) : undefined,
      reference,
    });
    res.json({ success: true, ...result });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

// Import bank statement CSV
router.post('/bank-transfers/import', (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string') return res.json({ success: false, error: 'CSVデータが必要です' });
    const result = bankVerifier.importCSV(csv);
    res.json({ success: true, ...result });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

// Get bank transfers list
router.get('/bank-transfers', (req, res) => {
  const status = req.query.status as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const transfers = dbSvc.getBankTransfers({ status, limit });
  res.json({ success: true, transfers });
});

// Bank verifier status & control
router.get('/bank-transfers/status', (_req, res) => {
  res.json({ success: true, ...bankVerifier.getStatus() });
});

router.post('/bank-transfers/toggle', (req, res) => {
  const { enabled } = req.body;
  bankVerifier.setEnabled(!!enabled);
  res.json({ success: true, enabled: bankVerifier.isEnabled() });
});

// Manual match trigger
router.post('/bank-transfers/match', (_req, res) => {
  const count = bankVerifier.processMatches();
  res.json({ success: true, matched: count });
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
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

router.post('/orders/:id/withdrawal-complete', (req, res) => {
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
  if (!exchange) throw new ValidationError('exchange required');
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
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
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
  const settings: Record<string, string> = {};
  keys.forEach(k => { settings[k] = dbSvc.getSetting(k); });
  res.json({ success: true, settings });
});
router.post('/settings', (req, res) => {
  const allowedKeys = ['minCompletion', 'orderTimeout', 'minAmount', 'maxAmount', 'onlineOnly', 'fallbackMode'];
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowedKeys.includes(k)) continue; // Skip unknown keys
    dbSvc.setSetting(k, String(v));
  }
  res.json({ success: true });
});

// Exchange credentials (save to DB)
router.post('/exchange-creds', (req, res) => {
  const { exchange, ...data } = req.body;
  if (!exchange) throw new ValidationError('exchange required');
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
      throw new ValidationError('Request body must be a non-empty array of accounts');
    }
    const count = dbSvc.bulkAddBankAccounts(accounts);
    res.json({ success: true, imported: count });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

// === Reports API ===
import { getDailyReport, getMonthlyReport, getSummaryReport } from '../services/reportService.js';

router.get('/reports/daily', (req, res) => {
  const date = req.query.date as string;
  if (!date) throw new ValidationError('date query parameter required (YYYY-MM-DD)');
  res.json({ success: true, report: getDailyReport(date) });
});

router.get('/reports/monthly', (req, res) => {
  const year = parseInt(req.query.year as string);
  const month = parseInt(req.query.month as string);
  if (!year || !month) throw new ValidationError('year and month query parameters required');
  res.json({ success: true, report: getMonthlyReport(year, month) });
});

router.get('/reports/summary', (_req, res) => {
  res.json({ success: true, report: getSummaryReport() });
});

// === Fee Settings API ===
router.get('/fees/settings', (_req, res) => {
  res.json({ success: true, data: dbSvc.getFeeSettings() });
});

router.post('/fees/settings', (req, res) => {
  dbSvc.updateFeeSettings(req.body);
  res.json({ success: true });
});

router.get('/fees/report', (req, res) => {
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
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

// Public: apply referral code
router.post('/customer/referral', (req, res) => {
  try {
    const { telegramId, referralCode } = req.body;
    if (!telegramId || !referralCode) return res.json({ success: false, error: 'telegramId and referralCode required' });
    const result = dbSvc.applyReferralCode(telegramId, referralCode);
    res.json(result);
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
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
import spreadOptimizer, { getSpreadConfig, updateSpreadConfig, get24hStats } from '../services/spreadOptimizer.js';

router.get('/spread/config', (_req, res) => {
  res.json({ success: true, data: getSpreadConfig() });
});

router.post('/spread/config', (req, res) => {
  const { crypto, ...data } = req.body;
  if (!crypto) throw new ValidationError('crypto required');
  updateSpreadConfig(crypto, data);
  res.json({ success: true });
});

router.get('/spread/stats', (_req, res) => {
  res.json({ success: true, data: get24hStats() });
});

router.get('/spread/recommendation', async (_req, res) => {
  try {
    const report = await spreadOptimizer.getSpreadReport();
    res.json({ success: true, data: report });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
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
  const { from, to, format } = req.query as { from?: string; to?: string; format?: string };
  const csv = exportOrders(from, to, (format || 'standard') as 'standard' | 'freee' | 'yayoi');
  sendCSV(res, csv, `orders_${from || 'all'}_${to || 'all'}.csv`);
});

router.get('/export/orders/freee', (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const csv = exportFreee(from, to);
  sendCSV(res, csv, `orders_freee_${from || 'all'}_${to || 'all'}.csv`);
});

router.get('/export/orders/yayoi', (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const csv = exportYayoi(from, to);
  sendCSV(res, csv, `orders_yayoi_${from || 'all'}_${to || 'all'}.csv`);
});

router.get('/export/accounts', (_req, res) => {
  const csv = exportAccounts();
  sendCSV(res, csv, 'bank_accounts.csv');
});

router.get('/export/fees', (req, res) => {
  const { from, to } = req.query as Record<string, string | undefined>;
  const csv = exportFeeReport(from, to);
  sendCSV(res, csv, `fee_report_${from || 'all'}_${to || 'all'}.csv`);
});

// === Profit Tracking API ===
import { getProfitSummary, getDailyProfit, getHourlyProfit, getMonthlyProfit, getProfitGoal, setProfitGoal, get7DayTrend } from '../services/profitTracker.js';

router.get('/profit/summary', (_req, res) => {
  const summary = getProfitSummary();
  const goal = getProfitGoal();
  res.json({ success: true, data: { ...summary, goal } });
});

router.get('/profit/daily', (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const hourly = getHourlyProfit(date);
  const daily = getDailyProfit(date);
  res.json({ success: true, data: { ...daily, hourly } });
});

router.get('/profit/monthly', (req, res) => {
  const now = new Date();
  const year = parseInt(req.query.year as string) || now.getFullYear();
  const month = parseInt(req.query.month as string) || (now.getMonth() + 1);
  res.json({ success: true, data: getMonthlyProfit(year, month) });
});

router.get('/profit/goal', (_req, res) => {
  res.json({ success: true, data: { amount: getProfitGoal() } });
});

router.post('/profit/goal', (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.json({ success: false, error: '有効な金額を指定してください' });
  setProfitGoal(amount);
  res.json({ success: true });
});

router.get('/profit/trend', (_req, res) => {
  res.json({ success: true, data: get7DayTrend() });
});

// === Account Health / Freeze Detection API ===
import { getHealthDashboard, autoRestUnhealthyAccounts, markTransferFailed } from '../services/freezeDetector.js';

router.get('/accounts/health', (_req, res) => {
  const dashboard = getHealthDashboard();
  res.json({ success: true, data: dashboard });
});

router.post('/accounts/health/check-all', (_req, res) => {
  const result = autoRestUnhealthyAccounts();
  res.json({ success: true, ...result });
});

router.post('/orders/:id/transfer-failed', (req, res) => {
  const order = orderManager.getOrder(req.params.id);
  if (!order) throw new NotFoundError('Order');

  // Find the account used for this order and mark transfer failed
  const paymentInfo = order.paymentInfo;
  if (paymentInfo && typeof paymentInfo === 'object' && 'accountId' in paymentInfo) {
    markTransferFailed((paymentInfo as { accountId: number }).accountId);
  }

  orderManager.cancelOrder(req.params.id);
  res.json({ success: true, message: 'Order marked as transfer failed' });
});

// === Puppeteer Trader Login/Screenshot/Test API ===
import fs from 'fs';

router.post('/trader/login/:exchange', async (req, res) => {
  const exchange = req.params.exchange as 'Bybit' | 'Binance';
  if (!['Bybit', 'Binance'].includes(exchange)) throw new ValidationError('Unsupported exchange');
  try {
    const { email, password, totpSecret } = req.body || {};
    const result = await trader.login(exchange, email, password, totpSecret);
    res.json({ success: result, message: result ? `${exchange} login successful` : `${exchange} login failed` });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

router.get('/trader/screenshot', (req, res) => {
  const screenshotPath = trader.getScreenshotPath();
  if (!screenshotPath) throw new NotFoundError('Screenshot');
  try {
    res.setHeader('Content-Type', 'image/png');
    res.send(fs.readFileSync(screenshotPath));
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

router.post('/trader/test-order', async (req, res) => {
  const { exchange, crypto, amount, payMethod } = req.body;
  if (!exchange || !amount) throw new ValidationError('exchange and amount required');
  logger.info('Test order (dry-run)', { exchange, crypto: crypto || 'USDT', amount, payMethod: payMethod || 'bank' });
  // Dry run - just check login status and return
  const status = trader.getStatus();
  const loginInfo = status.loginStatus?.[exchange as string];
  res.json({
    success: true,
    dryRun: true,
    exchange,
    crypto: crypto || 'USDT',
    amount,
    payMethod: payMethod || 'bank',
    loginStatus: loginInfo || { loggedIn: false },
    message: loginInfo?.loggedIn ? 'Ready to trade (dry-run, no order placed)' : `Not logged in to ${exchange}. Login first.`,
  });
});

// =====================================================================
// Phase 3-5: 新規APIエンドポイント
// =====================================================================

// === RBAC User Management ===
import { getAllAdminUsers, createAdminUserWithRole, updateUserRole, deleteAdminUser, resetUserPassword, getAllRoles, getSessionInfo } from '../services/rbac.js';

router.get('/admin/users', (req, res) => {
  try {
    res.json({ success: true, users: getAllAdminUsers() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/users', (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) throw new ValidationError('username and password required');
    const result = createAdminUserWithRole(username, password, role || 'viewer');
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true, id: result.id });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.put('/admin/users/:id/role', (req, res) => {
  try {
    const { role } = req.body;
    if (!role) throw new ValidationError('role required');
    const result = updateUserRole(parseInt(req.params.id), role);
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.delete('/admin/users/:id', (req, res) => {
  try {
    const result = deleteAdminUser(parseInt(req.params.id));
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/users/:id/reset-password', (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) throw new ValidationError('newPassword required');
    const result = resetUserPassword(parseInt(req.params.id), newPassword);
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/admin/roles', (_req, res) => {
  res.json({ success: true, roles: getAllRoles() });
});

router.get('/auth/me', (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ success: false, error: 'Not logged in' });
  const info = getSessionInfo(token);
  if (!info.valid) return res.json({ success: false, error: 'Invalid session' });
  res.json({ success: true, user: { userId: info.userId, username: info.username, role: info.role } });
});

// === Trading Limits ===
import { getAllLimits, setLimits, deleteLimits, getUsageSummary, checkLimit } from '../services/tradingLimits.js';

router.get('/limits', (_req, res) => {
  try {
    res.json({ success: true, limits: getAllLimits() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/limits', (req, res) => {
  try {
    const { scope, scopeId, per_transaction, daily_limit, weekly_limit, monthly_limit } = req.body;
    setLimits(scope || 'global', scopeId || '', { per_transaction, daily_limit, weekly_limit, monthly_limit });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.delete('/limits', (req, res) => {
  try {
    const { scope, scopeId } = req.body;
    if (!scope) throw new ValidationError('scope required');
    const deleted = deleteLimits(scope, scopeId || '');
    res.json({ success: true, deleted });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/limits/usage', (req, res) => {
  try {
    const { scope, scopeId } = req.query as Record<string, string | undefined>;
    res.json({ success: true, usage: getUsageSummary(scope || 'global', scopeId || '') });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/limits/check', (req, res) => {
  try {
    const { amount, userId, exchange } = req.body;
    const result = checkLimit(amount, userId, exchange);
    res.json({ success: true, ...result });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Trading Rules (Rule Engine) ===
import { getAllRules, getRule, createRule, updateRule, deleteRule, setRuleStatus, getRuleExecutions, testRule } from '../services/ruleEngine.js';

router.get('/rules', (_req, res) => {
  try {
    res.json({ success: true, rules: getAllRules() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/rules/:id', (req, res) => {
  try {
    const rule = getRule(parseInt(req.params.id));
    if (!rule) throw new NotFoundError('Rule');
    res.json({ success: true, rule });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/rules', (req, res) => {
  try {
    // Whitelist allowed fields to prevent mass assignment
    const { name, description, status, rate_conditions, exchange_conditions, time_conditions,
            liquidity_conditions, condition_logic, action_type, action_crypto, action_amount,
            action_exchange, action_pay_method, action_mode, max_per_execution, max_daily } = req.body;
    const id = createRule({
      name, description, status, rate_conditions, exchange_conditions, time_conditions,
      liquidity_conditions, condition_logic, action_type, action_crypto, action_amount,
      action_exchange, action_pay_method, action_mode, max_per_execution, max_daily,
      created_by: req.user?.userId,
    });
    res.json({ success: true, id });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.put('/rules/:id', (req, res) => {
  try {
    // Whitelist allowed fields to prevent mass assignment
    const { name, description, status, rate_conditions, exchange_conditions, time_conditions,
            liquidity_conditions, condition_logic, action_type, action_crypto, action_amount,
            action_exchange, action_pay_method, action_mode, max_per_execution, max_daily } = req.body;
    updateRule(parseInt(req.params.id), {
      name, description, status, rate_conditions, exchange_conditions, time_conditions,
      liquidity_conditions, condition_logic, action_type, action_crypto, action_amount,
      action_exchange, action_pay_method, action_mode, max_per_execution, max_daily,
    });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.delete('/rules/:id', (req, res) => {
  try {
    deleteRule(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/rules/:id/toggle', (req, res) => {
  try {
    const rule = getRule(parseInt(req.params.id));
    if (!rule) throw new NotFoundError('Rule');
    const newStatus = rule.status === 'active' ? 'paused' : 'active';
    setRuleStatus(parseInt(req.params.id), newStatus);
    res.json({ success: true, status: newStatus });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/rules/:id/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({ success: true, history: getRuleExecutions(parseInt(req.params.id), limit) });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/rules/test/:id', (req, res) => {
  try {
    const crypto = (req.body.crypto || 'USDT').toUpperCase();
    const rates = getCachedRates(crypto) as AggregatedRates;
    if (!rates) throw new NotFoundError('Rate data');
    const result = testRule(parseInt(req.params.id), rates);
    res.json({ success: true, result });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Merchant Scoring ===
import { getTopMerchants, getMerchantStats } from '../services/merchantScoring.js';

router.get('/merchants/scores', (req, res) => {
  try {
    const { exchange, limit } = req.query as Record<string, string | undefined>;
    const merchants = getTopMerchants(exchange, parseInt(limit || '') || 20);
    res.json({ success: true, merchants });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/merchants/stats', (_req, res) => {
  try {
    res.json({ success: true, stats: getMerchantStats() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Bulk Simulator ===
import { simulateBulkPurchase, optimizeSplitting } from '../services/bulkSimulator.js';

router.post('/simulator/bulk', (req, res) => {
  try {
    const { totalAmountJpy, crypto, maxPerOrder } = req.body;
    if (!totalAmountJpy) throw new ValidationError('totalAmountJpy required');
    const result = simulateBulkPurchase(totalAmountJpy, crypto || 'USDT', maxPerOrder);
    res.json({ success: true, simulation: result });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/simulator/optimize', (req, res) => {
  try {
    const { totalAmountJpy, crypto } = req.body;
    if (!totalAmountJpy) throw new ValidationError('totalAmountJpy required');
    const result = optimizeSplitting(totalAmountJpy, crypto || 'USDT');
    res.json({ success: true, strategies: result });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Currency Router ===
import { findAllRoutes, findBestRoute, compareRoutes } from '../services/currencyRouter.js';

// IMPORTANT: Specific routes MUST come before parameterized /:from/:to
router.get('/routes/best/:from/:to', (req, res) => {
  try {
    const amount = parseFloat(req.query.amount as string) || 100000;
    const route = findBestRoute(req.params.from.toUpperCase(), req.params.to.toUpperCase(), amount);
    res.json({ success: true, route });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/routes/compare/:from/:to', (req, res) => {
  try {
    const amount = parseFloat(req.query.amount as string) || 100000;
    const comparison = compareRoutes(amount, req.params.to.toUpperCase());
    res.json({ success: true, comparison });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/routes/:from/:to', (req, res) => {
  try {
    const amount = parseFloat(req.query.amount as string) || 100000;
    const routes = findAllRoutes(req.params.from.toUpperCase(), req.params.to.toUpperCase(), amount);
    res.json({ success: true, routes });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Rate Prediction ===
import { getPrediction, getOptimalBuyTime } from '../services/ratePrediction.js';

router.get('/prediction/:crypto', (req, res) => {
  try {
    const prediction = getPrediction(req.params.crypto.toUpperCase());
    res.json({ success: true, prediction });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/prediction/:crypto/optimal-time', (req, res) => {
  try {
    const optimal = getOptimalBuyTime(req.params.crypto.toUpperCase());
    res.json({ success: true, optimal });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Customer Accounts ===
import * as customerSvc from '../services/customerAccounts.js';

router.post('/customer/register', async (req, res) => {
  try {
    const { email, password, displayName, telegramId } = req.body;
    if (!email || !password) throw new ValidationError('email and password required');
    const result = customerSvc.registerCustomer({ email, password, displayName, telegramId });
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true, customerId: result.customerId });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/customer/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new ValidationError('email and password required');
    const result = customerSvc.authenticateCustomer(email, password);
    if (!result) throw new AuthenticationError('Invalid credentials');
    const IS_PRODUCTION = process.env.NODE_ENV === 'production';
    res.cookie('bkpay_customer_token', result.token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'strict', secure: IS_PRODUCTION });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/customer/logout', (req, res) => {
  const token = req.cookies?.bkpay_customer_token;
  if (token) customerSvc.deleteCustomerSession(token);
  res.clearCookie('bkpay_customer_token');
  res.json({ success: true });
});

router.get('/customer/profile', (req, res) => {
  try {
    const account = customerSvc.getCustomerAccount(req.customerId!);
    if (!account) throw new NotFoundError('Account');
    res.json({ success: true, profile: account });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/customer/balance', (req, res) => {
  try {
    const account = customerSvc.getCustomerAccount(req.customerId!);
    if (!account) throw new NotFoundError('Account');
    res.json({
      success: true,
      balance: {
        jpy: account.balance_jpy, usdt: account.balance_usdt,
        btc: account.balance_btc, eth: account.balance_eth,
      },
    });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/customer/transactions', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const txs = customerSvc.getTransactionHistory(req.customerId!, limit, offset);
    res.json({ success: true, transactions: txs });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/customer/kyc', (req, res) => {
  try {
    const { documentType, filePath } = req.body;
    if (!documentType || !filePath) throw new ValidationError('documentType and filePath required');
    const result = customerSvc.submitKYC(req.customerId!, documentType, filePath);
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true, submissionId: result.id });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// Admin: KYC management
router.get('/admin/kyc/pending', (_req, res) => {
  try {
    res.json({ success: true, submissions: customerSvc.getPendingKYC() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/kyc/:id/review', (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status || !['approved', 'rejected'].includes(status)) {
      throw new ValidationError('status must be approved or rejected');
    }
    const approved = status === 'approved';
    const reviewedBy = req.user?.userId || 0;
    customerSvc.reviewKYC(parseInt(req.params.id), approved, reviewedBy, notes);
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/admin/customer-accounts', (_req, res) => {
  try {
    res.json({ success: true, accounts: customerSvc.getAllCustomerAccounts() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/customer-accounts/:id/suspend', (req, res) => {
  try {
    customerSvc.suspendCustomer(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/customer-accounts/:id/activate', (req, res) => {
  try {
    customerSvc.activateCustomer(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === AI Chat Assistant ===
import chatService, { ChatMessage } from '../services/chatService.js';

const chatRateLimiter = (() => {
  const counts = new Map<string, { n: number; reset: number }>();
  return (ip: string): boolean => {
    const now = Date.now();
    const entry = counts.get(ip);
    if (!entry || now > entry.reset) {
      counts.set(ip, { n: 1, reset: now + 60_000 });
      return true;
    }
    if (entry.n >= 20) return false;
    entry.n++;
    return true;
  };
})();

router.post('/chat', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (!chatRateLimiter(ip)) {
    return res.json({ success: false, error: 'リクエストが多すぎます。少し待ってからお試しください。' });
  }
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.json({ success: false, error: 'message required' });
    }
    const safeHistory: ChatMessage[] = Array.isArray(history)
      ? history.slice(-10).filter(
          (m: ChatMessage) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
        )
      : [];
    const reply = await chatService.chat(message.slice(0, 2000), safeHistory);
    res.json({ success: true, reply });
  } catch (e: unknown) {
    logger.error('Chat error', { error: e instanceof Error ? e.message : String(e) });
    res.json({ success: false, error: 'AIアシスタントへの接続に失敗しました。' });
  }
});

// ═══════════════════════════════════════════════════════════════
// P2P セラー API
// ═══════════════════════════════════════════════════════════════
import p2pSellerService from '../services/p2pSellerService.js';

/** POST /api/p2p/sellers/register — セラー登録（公開） */
router.post('/p2p/sellers/register', async (req, res) => {
  try {
    const { name, email, password, paypayId, linepayId, aupayId, minAmount, maxAmount, payMethods } = req.body;
    const result = await p2pSellerService.registerSeller({
      name, email, password, paypayId, linepayId, aupayId,
      minAmount: minAmount ? Number(minAmount) : undefined,
      maxAmount: maxAmount ? Number(maxAmount) : undefined,
      payMethods: Array.isArray(payMethods) ? payMethods : undefined,
    });
    res.json(result);
  } catch (e: unknown) {
    res.json({ success: false, error: '登録処理に失敗しました' });
  }
});

/** GET /api/p2p/sellers — セラー一覧（admin） */
router.get('/p2p/sellers', (req, res) => {
  const sellers = dbSvc.listP2PSellers();
  res.json({ success: true, sellers });
});

/** PUT /api/p2p/sellers/:id — セラー情報・ステータス更新（admin） */
router.put('/p2p/sellers/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.json({ success: false, error: 'invalid id' });
  const { status, name, paypayId, linepayId, aupayId, minAmount, maxAmount, payMethods } = req.body;
  if (status) dbSvc.updateP2PSellerStatus(id, status);
  const updates: Partial<{ name: string; paypayId: string; linepayId: string; aupayId: string; minAmount: number; maxAmount: number; payMethods: string[] }> = {};
  if (name !== undefined) updates.name = name;
  if (paypayId !== undefined) updates.paypayId = paypayId;
  if (linepayId !== undefined) updates.linepayId = linepayId;
  if (aupayId !== undefined) updates.aupayId = aupayId;
  if (minAmount !== undefined) updates.minAmount = Number(minAmount);
  if (maxAmount !== undefined) updates.maxAmount = Number(maxAmount);
  if (payMethods !== undefined) updates.payMethods = payMethods;
  if (Object.keys(updates).length > 0) dbSvc.updateP2PSeller(id, updates);
  res.json({ success: true });
});

/** POST /api/p2p/sellers/:id/credit — 残高付与（admin） */
router.post('/p2p/sellers/:id/credit', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.json({ success: false, error: 'invalid id' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.json({ success: false, error: 'amount が不正です' });
  p2pSellerService.creditBalance(id, amount);
  res.json({ success: true, credited: amount });
});

/** GET /api/p2p/orders/:id — 注文詳細（セラー確認ページ用・トークン認証） */
router.get('/p2p/orders/:id', (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.json({ success: false, error: 'token required' });
  const seller = p2pSellerService.getSellerByToken(token);
  if (!seller) return res.json({ success: false, error: '無効なトークンです' });
  const order = dbSvc.getOrder(req.params.id);
  if (!order) return res.json({ success: false, error: '注文が見つかりません' });
  if (order.sellerId !== seller.id) return res.json({ success: false, error: 'この注文はあなたの担当ではありません' });
  const pi = (order.paymentInfo || {}) as Record<string, unknown>;
  res.json({
    success: true,
    order: {
      id: order.id,
      status: order.status,
      amount: order.amount,
      crypto: order.crypto,
      cryptoAmount: order.cryptoAmount,
      payMethod: order.payMethod,
      payId: pi.payId || '',
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
    },
    seller: { name: seller.name },
  });
});

/** POST /api/p2p/orders/:id/confirm — 入金確認（セラー確認ページ用・トークン認証） */
router.post('/p2p/orders/:id/confirm', sellerConfirmLimiter, async (req, res) => {
  const token = (req.query.token || req.body.token) as string;
  if (!token) return res.json({ success: false, error: 'token required' });
  try {
    const result = await p2pSellerService.confirmPayment(req.params.id, token);
    res.json(result);
  } catch (e: unknown) {
    logger.error('P2P confirmPayment error', { error: e instanceof Error ? e.message : String(e) });
    res.json({ success: false, error: '確認処理に失敗しました' });
  }
});

/** POST /api/p2p/sellers/login — セラーログイン（公開） */
router.post('/p2p/sellers/login', sellerAuthLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ success: false, error: 'メール・パスワードが必要です' });
  }
  const result = p2pSellerService.loginSeller(email, password);
  res.json(result);
});

/** GET /api/p2p/sellers/me — セラー自身の情報（token 認証） */
router.get('/p2p/sellers/me', (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.json({ success: false, error: 'トークンが必要です' });
  const seller = p2pSellerService.getSellerByToken(token);
  if (!seller) return res.json({ success: false, error: '無効なトークンです' });
  res.json({ success: true, seller });
});

/** GET /api/p2p/sellers/me/orders — セラーの注文履歴（token 認証） */
router.get('/p2p/sellers/me/orders', (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.json({ success: false, error: 'トークンが必要です' });
  const seller = p2pSellerService.getSellerByToken(token);
  if (!seller) return res.json({ success: false, error: '無効なトークンです' });
  const orders = p2pSellerService.getSellerOrders(seller.id);
  res.json({ success: true, orders });
});

// ═══════════════════════════════════════════════════════════════
// 出金管理 API
// ═══════════════════════════════════════════════════════════════
import { listWithdrawals, getWithdrawal, getWithdrawalByToken } from '../services/database.js';

/** GET /api/withdrawals — 出金一覧（admin） */
router.get('/withdrawals', (_req, res) => {
  try {
    const withdrawals = listWithdrawals(200);
    res.json({ success: true, withdrawals });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/withdrawals/by-token/:token — 公開ステータス（認証不要） */
router.get('/withdrawals/by-token/:token', (req, res) => {
  try {
    const w = getWithdrawalByToken(req.params.token);
    if (!w) throw new NotFoundError('Withdrawal');
    res.json({
      success: true,
      withdrawal: {
        id: w.id,
        amount: w.amount,
        payMethod: w.payMethod,
        status: w.status,
        createdAt: w.createdAt,
        expiresAt: w.expiresAt,
        completedAt: w.completedAt,
      },
    });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/withdrawals/:id — 出金詳細（admin） */
router.get('/withdrawals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ValidationError('invalid id');
    const w = getWithdrawal(id);
    if (!w) throw new NotFoundError('Withdrawal');
    res.json({ success: true, withdrawal: w });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// ═══════════════════════════════════════════════════════════════
//  Auto-Trade API (admin)
// ═══════════════════════════════════════════════════════════════
import { getStatus as getAutoTradeStatus, startPolling, stopPolling } from '../services/autoTradeService.js';
import { getAutoTradeConfig, setAutoTradeConfig, listExchangeOrders } from '../services/database.js';

/** GET /api/auto-trade/config — 自動取引設定取得 */
router.get('/auto-trade/config', (_req, res) => {
  try {
    res.json({ success: true, config: getAutoTradeConfig() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/auto-trade/config — 自動取引設定更新 */
router.post('/auto-trade/config', (req, res) => {
  try {
    const allowed = ['enabled','preferred_channel','preferred_exchange','max_amount','min_amount','auto_confirm_payment','polling_interval_ms'];
    const updates = req.body;
    if (!updates || typeof updates !== 'object') return res.json({ success: false, error: 'body required' });
    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k) && typeof v === 'string') {
        setAutoTradeConfig(k, v);
      }
    }
    // Restart polling if interval changed or enabled/disabled
    const config = getAutoTradeConfig();
    if (config.enabled === 'true') {
      startPolling();
    } else {
      stopPolling();
    }
    res.json({ success: true, config: getAutoTradeConfig() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/auto-trade/orders — 取引所注文一覧 */
router.get('/auto-trade/orders', (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    res.json({ success: true, orders: listExchangeOrders(limit) });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/auto-trade/status — 接続状態 */
router.get('/auto-trade/status', (_req, res) => {
  try {
    res.json({ success: true, ...getAutoTradeStatus() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// ═══════════════════════════════════════════════════════════════
//  Audit Log API (admin)
// ═══════════════════════════════════════════════════════════════

/** GET /api/admin/audit-log — 監査ログ一覧 */
router.get('/admin/audit-log', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const entries = dbSvc.getAuditLog({ userId, action, limit, offset });
    res.json({ success: true, entries, limit, offset });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// ═══════════════════════════════════════════════════════════════
//  Cost Config API (admin) — コスト設定・マージン管理
// ═══════════════════════════════════════════════════════════════

/** GET /api/cost-config — コスト設定取得 */
router.get('/cost-config', (_req, res) => {
  try {
    const config = dbSvc.getCostConfig();
    res.json({ success: true, data: config });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/cost-config — コスト設定更新 */
router.post('/cost-config', (req, res) => {
  try {
    const allowed = ['tron_gas_jpy', 'bank_transfer_fee_jpy', 'exchange_fee_rate', 'min_margin_jpy', 'min_margin_rate', 'auto_adjust_fee'];
    const updates: Record<string, number> = {};
    for (const [k, v] of Object.entries(req.body)) {
      if (!allowed.includes(k)) continue;
      const num = Number(v);
      if (!isNaN(num)) updates[k] = num;
    }
    dbSvc.updateCostConfig(updates);
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/cost-config/estimate — 指定金額のコスト見積 */
router.get('/cost-config/estimate', (req, res) => {
  try {
    const amount = Math.max(Number(req.query.amount) || 10000, 1);
    const direction = (req.query.direction === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell';
    const estimate = dbSvc.estimateOrderCost(amount, direction);
    res.json({ success: true, data: estimate });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/cost-config/transactions — 注文別コスト一覧 */
router.get('/cost-config/transactions', (req, res) => {
  try {
    const orderId = typeof req.query.orderId === 'string' ? req.query.orderId : undefined;
    if (orderId) {
      const costs = dbSvc.getTransactionCosts(orderId);
      const total = dbSvc.getTotalTransactionCost(orderId);
      res.json({ success: true, data: { costs, total } });
    } else {
      res.json({ success: false, error: 'orderId required' });
    }
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// ===================== Error Tracking =====================

/** GET /api/errors — エラー一覧 */
router.get('/errors', (_req, res) => {
  try {
    const includeResolved = _req.query.includeResolved === 'true';
    const limit = Math.min(Number(_req.query.limit) || 50, 200);
    const errors = getRecentErrors(limit, includeResolved);
    res.json({ success: true, data: errors });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/errors/stats — エラー統計 */
router.get('/errors/stats', (_req, res) => {
  try {
    const stats = getErrorStats();
    res.json({ success: true, data: stats });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/errors/:id/resolve — エラーを解決済みにする */
router.post('/errors/:id/resolve', (req, res) => {
  try {
    resolveError(Number(req.params.id));
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/errors/resolve-all — 全エラーを解決済みにする */
router.post('/errors/resolve-all', (_req, res) => {
  try {
    resolveAllErrors();
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// ==========================================
// TruPay Integration Endpoints
// ==========================================
import { testConnection, getWithdrawalSummary, isEnabled as isTruPayEnabled } from '../services/trupayClient.js';
import { registerBuyer, removeBuyer, getPendingBuyers } from '../services/trupayMatcher.js';
import { manualConfirm, adminConfirm } from '../services/trupayVerifier.js';
import { pollWithdrawals } from '../services/trupayPoller.js';
import {
  getTruPayWithdrawals, getTruPayMatches, getTruPayStats,
  getTruPayMatch, getTruPayWithdrawalById,
  updateTruPayMatchStatus,
} from '../services/database.js';

/** GET /api/trupay/status — TruPay接続ステータス */
router.get('/trupay/status', async (_req, res) => {
  try {
    const enabled = isTruPayEnabled();
    if (!enabled) return res.json({ success: true, enabled: false });
    const conn = await testConnection();
    const summary = conn.connected ? await getWithdrawalSummary() : null;
    const stats = getTruPayStats();
    res.json({ success: true, enabled, connected: conn.connected, summary, stats, error: conn.error });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/trupay/withdrawals — TruPay出金一覧 */
router.get('/trupay/withdrawals', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const data = getTruPayWithdrawals(status, limit, offset);
    res.json({ success: true, data });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/trupay/matches — TruPayマッチング一覧 */
router.get('/trupay/matches', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const data = getTruPayMatches(status, limit, offset);
    res.json({ success: true, data });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/trupay/matches/:id — マッチ単件取得 */
router.get('/trupay/matches/:id', (req, res) => {
  try {
    const match = getTruPayMatch(Number(req.params.id));
    if (!match) throw new NotFoundError('Match');
    res.json({ success: true, data: match });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/trupay/stats — TruPay統計 */
router.get('/trupay/stats', (_req, res) => {
  try {
    const stats = getTruPayStats();
    res.json({ success: true, data: stats });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/trupay/buyers — 待機中の購入者一覧 */
router.get('/trupay/buyers', (_req, res) => {
  try {
    res.json({ success: true, data: getPendingBuyers() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/trupay/buyers — 購入者登録（マッチングキューに追加） */
router.post('/trupay/buyers', (req, res) => {
  try {
    const { buyerId, walletAddress, minAmountJpy, maxAmountJpy } = req.body;
    if (!buyerId || !walletAddress) throw new ValidationError('buyerId and walletAddress required');
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(walletAddress)) {
      throw new ValidationError('Invalid TRON wallet address');
    }
    registerBuyer({
      id: buyerId,
      walletAddress,
      minAmountJpy: minAmountJpy || 0,
      maxAmountJpy: maxAmountJpy || 100_000_000,
      registeredAt: Date.now(),
    });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** DELETE /api/trupay/buyers/:id — 購入者削除 */
router.delete('/trupay/buyers/:id', (req, res) => {
  try {
    const removed = removeBuyer(req.params.id);
    res.json({ success: true, removed });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/trupay/matches/:id/confirm — 手動着金確認（参照番号付き） */
router.post('/trupay/matches/:id/confirm', async (req, res) => {
  try {
    const { referenceNumber } = req.body;
    if (!referenceNumber) throw new ValidationError('referenceNumber required');
    const result = await manualConfirm(Number(req.params.id), referenceNumber);
    res.json(result);
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/trupay/matches/:id/admin-confirm — 管理者による強制着金確認 */
router.post('/trupay/matches/:id/admin-confirm', async (req, res) => {
  try {
    const result = await adminConfirm(Number(req.params.id));
    res.json(result);
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/trupay/poll — 手動ポーリング実行 */
router.post('/trupay/poll', async (_req, res) => {
  try {
    await pollWithdrawals();
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// ==========================================
// Public Buyer P2P Endpoints (no admin auth)
// ==========================================

/** POST /api/p2p-buy/register — 購入者登録（公開） */
router.post('/p2p-buy/register', (req, res) => {
  try {
    const { walletAddress, minAmountJpy, maxAmountJpy, refCode } = req.body;
    if (!walletAddress) throw new ValidationError('walletAddress required');
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(walletAddress)) {
      throw new ValidationError('Invalid TRON wallet address');
    }
    const refPart = refCode && /^PM[A-F0-9]{8}$/i.test(refCode) ? `_ref_${refCode}` : '';
    const buyerId = `web${refPart}_${crypto.randomBytes(12).toString('hex')}`;
    const hmacSecret = process.env.BK_ENC_KEY || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('BK_ENC_KEY required in production'); })() : 'fallback-dev-only');
    const buyerToken = crypto.createHmac('sha256', hmacSecret).update(buyerId).digest('hex').slice(0, 32);
    registerBuyer({
      id: buyerId,
      walletAddress,
      minAmountJpy: minAmountJpy || 0,
      maxAmountJpy: maxAmountJpy || 100_000_000,
      registeredAt: Date.now(),
    });
    res.json({ success: true, buyerId, buyerToken });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/p2p-buy/match/:buyerId — 購入者のマッチ状況確認（公開） */
router.get('/p2p-buy/match/:buyerId', (req, res) => {
  try {
    const buyerId = req.params.buyerId;
    // Search matches for this buyer
    const matches = getTruPayMatches(undefined, 10, 0).filter(m => m.buyer_id === buyerId);
    if (matches.length === 0) {
      // Check if still in queue
      const buyers = getPendingBuyers();
      const inQueue = buyers.some(b => b.id === buyerId);
      return res.json({ success: true, status: inQueue ? 'waiting' : 'not_found', match: null });
    }
    const match = matches[0];

    // If matched, include bank info from withdrawal
    let bankInfo = null;
    if (['waiting_transfer', 'buyer_paid', 'needs_review', 'transfer_confirmed'].includes(match.status)) {
      const withdrawal = getTruPayWithdrawalById(match.withdrawal_id);
      if (withdrawal) {
        bankInfo = {
          bankName: withdrawal.bank_name,
          branchName: withdrawal.branch_name,
          accountNumber: withdrawal.account_number,
          accountName: withdrawal.account_name,
          amountJpy: match.amount_jpy,
          withdrawalId: withdrawal.trupay_id,
          transactionId: withdrawal.transaction_id,
        };
      }
    }

    res.json({
      success: true,
      status: match.status,
      match: {
        id: match.id,
        amountJpy: match.amount_jpy,
        amountUsdt: match.amount_usdt,
        rate: match.rate_jpy_usdt,
        status: match.status,
        timeoutAt: match.timeout_at,
        txHash: match.usdt_tx_hash,
        createdAt: match.created_at,
      },
      bankInfo,
    });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/p2p-buy/paid/:matchId — 振込完了報告（スクショ必須・AI解析） */
router.post('/p2p-buy/paid/:matchId', uploadProof.single('proof'), async (req: Request, res: Response) => {
  try {
    const matchId = Number(req.params.matchId);
    const { referenceNumber, buyerId, buyerToken } = req.body;
    // Verify buyer token (HMAC signature of buyerId)
    const expectedToken = crypto.createHmac('sha256', process.env.BK_ENC_KEY || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('BK_ENC_KEY required in production'); })() : 'fallback-dev-only')).update(buyerId || '').digest('hex').slice(0, 32);
    if (!buyerId || !buyerToken || buyerToken.length !== expectedToken.length ||
        !crypto.timingSafeEqual(Buffer.from(buyerToken), Buffer.from(expectedToken))) {
      return res.json({ success: false, error: 'Unauthorized' });
    }
    const match = getTruPayMatch(matchId);
    if (!match) return res.json({ success: false, error: 'Match not found' });
    if (match.buyer_id !== buyerId) return res.json({ success: false, error: 'Unauthorized' });

    // Screenshot is required
    if (!req.file) {
      return res.json({ success: false, error: '振込明細のスクリーンショットは必須です' });
    }

    const ref = referenceNumber || '';
    const proofFile = req.file.filename;

    // Save proof + reference
    const extra: Record<string, unknown> = { proof_image: proofFile };
    if (ref) extra.reference_number = ref;
    updateTruPayMatchStatus(matchId, 'buyer_paid', extra);

    logger.info('Buyer reported payment with proof', { matchId, ref: ref || 'none', proof: proofFile });

    // AI analysis (async — don't block response)
    const withdrawal = getTruPayWithdrawalById(match.withdrawal_id);
    if (withdrawal) {
      const { analyzeProof } = await import('../services/proofAnalyzer.js');
      const { notifyProofReview } = await import('../services/notifier.js');

      analyzeProof(proofFile, {
        bankName: withdrawal.bank_name,
        branchName: withdrawal.branch_name,
        accountNumber: withdrawal.account_number,
        accountName: withdrawal.account_name,
        amountJpy: withdrawal.amount_jpy,
      }).then(analysis => {
        // Save score
        // Always require manual review — score is informational only
        updateTruPayMatchStatus(matchId, 'needs_review', {
          proof_score: analysis.score,
          proof_analysis: JSON.stringify({
            extracted: analysis.extractedData,
            matches: analysis.matchDetails,
            confidence: analysis.confidence,
            reason: analysis.reason,
          }),
        });

        // Always send to Telegram for manual approval regardless of score
        notifyProofReview(matchId, match.amount_jpy, analysis, proofFile);
        logger.info('Proof submitted for manual review', { matchId, score: analysis.score, reason: analysis.reason });
      }).catch(async e => {
        logger.error('Proof analysis failed', { matchId, error: e instanceof Error ? e.message : String(e) });
        // On analysis failure, still needs manual review
        const { notifyProofReview: notify } = await import('../services/notifier.js');
        notify(matchId, match.amount_jpy, {
          score: 0, extractedData: {}, matchDetails: { bankNameMatch: false, accountNumberMatch: false, accountNameMatch: false, amountMatch: false },
          confidence: 'low', reason: 'AI analysis failed', rawAnalysis: '',
        }, proofFile);
      });
    }

    res.json({ success: true, proofUploaded: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** DELETE /api/p2p-buy/cancel/:buyerId — 購入キャンセル（公開） */
router.delete('/p2p-buy/cancel/:buyerId', (req, res) => {
  try {
    const removed = removeBuyer(req.params.buyerId);
    res.json({ success: true, removed });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/p2p-buy/chat — 購入者向けAIサポートチャット（公開） */
router.post('/p2p-buy/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== 'string' || message.length > 1000) {
      return res.json({ success: false, error: 'Invalid message' });
    }
    const { buyerChat } = await import('../services/buyerChatService.js');
    const reply = await buyerChat(message, Array.isArray(history) ? history : []);
    res.json({ success: true, reply });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/p2p-buy/referral/generate — Generate referral code */
router.post('/p2p-buy/referral/generate', async (req, res) => {
  try {
    const { referrerId, type, parentCode } = req.body;
    if (!referrerId) return res.json({ success: false, error: 'referrerId required' });
    const { createReferralCode } = await import('../services/database.js');
    const code = createReferralCode(referrerId, type || 'web', parentCode);
    res.json({ success: true, code, shareUrl: `${process.env.BASE_URL || 'https://bkpay.app'}/buy-usdt.html?ref=${code}` });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/p2p-buy/track — Conversion funnel tracking */
router.post('/p2p-buy/track', async (req, res) => {
  const { event, data, ref } = req.body;
  if (event && typeof event === 'string') {
    logger.info('Funnel event', { event, data, ref });
    try {
      const { insertFunnelEvent } = await import('../services/database.js');
      insertFunnelEvent(event, JSON.stringify(data || {}), ref || '', req.ip || '', req.get('user-agent') || '');
    } catch { /* non-critical */ }
  }
  res.json({ success: true });
});

/** GET /api/p2p-buy/analytics — Funnel analytics (admin only) */
router.get('/p2p-buy/analytics', async (req, res) => {
  // Admin auth check inline (authRequired is in index.ts scope)
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthenticationError();
  const { validateSession } = await import('../services/database.js');
  if (!validateSession(token, req.ip || '')) throw new AuthenticationError();
  try {
    const db = (await import('../services/database.js')).default;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const events = db.prepare("SELECT event, COUNT(*) as count FROM funnel_events WHERE created_at > ? GROUP BY event ORDER BY count DESC").all(oneDayAgo);
    const total = db.prepare("SELECT COUNT(*) as count FROM funnel_events WHERE created_at > ?").get(oneDayAgo) as { count: number };
    // A/B test results aggregation
    const abResults = db.prepare(`
      SELECT
        json_extract(data, '$.variant') as variant,
        COUNT(*) as views,
        SUM(CASE WHEN event = 'submit' THEN 1 ELSE 0 END) as conversions
      FROM funnel_events
      WHERE event IN ('ab_variant', 'submit') AND created_at > ?
      GROUP BY json_extract(data, '$.variant')
    `).all(oneDayAgo) as Array<{ variant: string; views: number; conversions: number }>;

    // GROWTH-2: UTM source breakdown
    const utmSources = db.prepare(`
      SELECT json_extract(data, '$.utm_source') as source, COUNT(*) as count
      FROM funnel_events
      WHERE created_at > ? AND json_extract(data, '$.utm_source') IS NOT NULL
      GROUP BY source ORDER BY count DESC
    `).all(oneDayAgo) as Array<{ source: string; count: number }>;

    // GROWTH-3: Referral leaderboard
    let referralLeaders: unknown[] = [];
    try {
      referralLeaders = db.prepare(`
        SELECT referrer_code, total_referrals, total_volume_jpy, total_reward_usdt
        FROM referrals WHERE status = 'active' AND total_referrals > 0
        ORDER BY total_volume_jpy DESC LIMIT 10
      `).all();
    } catch { /* referrals table may not exist yet */ }

    res.json({ success: true, period: '24h', events, total: total.count, abTest: abResults, utmSources, referralLeaders });
  } catch (e: unknown) { res.json({ success: false, error: e instanceof Error ? e.message : String(e) }); }
});

/** GET /api/p2p-buy/referral/:code — Get referral stats */
router.get('/p2p-buy/referral/:code', async (req, res) => {
  try {
    const { getP2pReferralStats } = await import('../services/database.js');
    const stats = getP2pReferralStats(req.params.code);
    res.json({ success: true, ...stats });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Admin Wallet Config API ===

/** GET /api/admin/wallet-config — Get wallet config status (admin only) */
router.get('/admin/wallet-config', async (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthenticationError();
  const { validateSession, getSystemConfigMeta } = await import('../services/database.js');
  if (!validateSession(token, req.ip || '')) throw new AuthenticationError();
  try {
    const tronKey = getSystemConfigMeta('TRON_WALLET_PRIVATE_KEY');
    const tronAddr = getSystemConfigMeta('TRON_WALLET_ADDRESS');
    res.json({
      success: true,
      wallet: {
        privateKeySet: !!tronKey?.exists,
        addressSet: !!tronAddr?.exists,
        escrowEnabled: !!tronKey?.exists && !!tronAddr?.exists,
        lastUpdated: tronKey?.updatedAt || tronAddr?.updatedAt || null,
      }
    });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/admin/wallet-config — Set wallet config (admin only) */
router.post('/admin/wallet-config', async (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthenticationError();
  const { validateSession, setSystemConfig, getSystemConfig } = await import('../services/database.js');
  if (!validateSession(token, req.ip || '')) throw new AuthenticationError();
  try {
    const { privateKey, walletAddress } = req.body;
    if (privateKey) {
      // Validate private key format (64 hex chars)
      if (!/^[a-fA-F0-9]{64}$/.test(privateKey)) throw new ValidationError('Private key must be 64 hex characters');
      setSystemConfig('TRON_WALLET_PRIVATE_KEY', privateKey, true); // encrypted
      logger.info('TRON wallet private key updated via admin UI');
    }
    if (walletAddress) {
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(walletAddress)) throw new ValidationError('Invalid TRON wallet address');
      setSystemConfig('TRON_WALLET_ADDRESS', walletAddress, false);
      logger.info('TRON wallet address updated via admin UI', { address: walletAddress });
    }
    // Check if escrow is now enabled
    const keySet = !!getSystemConfig('TRON_WALLET_PRIVATE_KEY');
    const addrSet = !!getSystemConfig('TRON_WALLET_ADDRESS');
    res.json({ success: true, escrowEnabled: keySet && addrSet });
  } catch (e: unknown) {
    if (e instanceof AppError) throw e;
    res.json({ success: false, error: safeError(e) });
  }
});

/** DELETE /api/admin/wallet-config — Remove wallet config (admin only) */
router.delete('/admin/wallet-config', async (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthenticationError();
  const { validateSession, deleteSystemConfig } = await import('../services/database.js');
  if (!validateSession(token, req.ip || '')) throw new AuthenticationError();
  try {
    deleteSystemConfig('TRON_WALLET_PRIVATE_KEY');
    deleteSystemConfig('TRON_WALLET_ADDRESS');
    logger.info('TRON wallet config removed via admin UI');
    res.json({ success: true, escrowEnabled: false });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/escrow/status — Public: check if escrow is available */
router.get('/escrow/status', async (_req, res) => {
  try {
    const { getSystemConfig } = await import('../services/database.js');
    const keySet = !!getSystemConfig('TRON_WALLET_PRIVATE_KEY');
    const addrSet = !!getSystemConfig('TRON_WALLET_ADDRESS');
    const envKey = !!process.env.TRON_WALLET_PRIVATE_KEY;
    res.json({ success: true, escrowEnabled: (keySet && addrSet) || envKey });
  } catch { res.json({ success: true, escrowEnabled: false }); }
});

// === PayPay Conversion API ===

/** POST /api/paypay/convert — Request conversion */
router.post('/paypay/convert', async (req, res) => {
  try {
    const { amount, type, paypayId } = req.body;
    if (!amount || !type || !paypayId) throw new ValidationError('amount, type, and paypayId are required');
    const validTypes = ['lite_to_money', 'money_to_lite', 'money_to_usdt', 'lite_to_usdt', 'usdt_to_money', 'usdt_to_lite'];
    if (!validTypes.includes(type)) throw new ValidationError('type must be one of: ' + validTypes.join(', '));
    if (amount < 1000 || amount > 5000000) throw new ValidationError('amount must be between ¥1,000 and ¥5,000,000');
    const toUsdt = type === 'money_to_usdt' || type === 'lite_to_usdt';
    if (toUsdt && !req.body.walletAddress) throw new ValidationError('walletAddress required for USDT conversion');
    if (toUsdt && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(req.body.walletAddress)) throw new ValidationError('Invalid TRON wallet address');
    const { insertPayPayConversion } = await import('../services/database.js');
    const feeRates: Record<string, number> = { lite_to_money: 0.05, money_to_lite: 0.02, money_to_usdt: 0.03, lite_to_usdt: 0.07, usdt_to_money: 0.03, usdt_to_lite: 0.02 };
    const feeRate = feeRates[type] || 0.05;
    const requesterId = `pp_${crypto.randomBytes(8).toString('hex')}`;
    const conversionId = insertPayPayConversion({ requesterId, requesterType: type, amount, feeRate, requesterPaypayId: paypayId });
    res.json({ success: true, conversionId, requesterId, feeRate, feeAmount: Math.round(amount * feeRate), payoutAmount: amount - Math.round(amount * feeRate) });
  } catch (e: unknown) { if (e instanceof AppError) throw e; res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/paypay/provide — Register as provider */
router.post('/paypay/provide', async (req, res) => {
  try {
    const { paypayId, type, minAmount, maxAmount, feeRate } = req.body;
    if (!paypayId) throw new ValidationError('paypayId is required');
    const { insertPayPayProvider } = await import('../services/database.js');
    const providerId = `ppp_${crypto.randomBytes(8).toString('hex')}`;
    insertPayPayProvider({ providerId, providerType: type || 'money', paypayId, minAmount: minAmount || 1000, maxAmount: maxAmount || 500000, feeRate: feeRate || 0.05 });
    res.json({ success: true, providerId });
  } catch (e: unknown) { if (e instanceof AppError) throw e; res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/paypay/status/:requesterId — Check status */
router.get('/paypay/status/:requesterId', async (req, res) => {
  try {
    const { getPayPayConversionByRequesterId } = await import('../services/database.js');
    const conv = getPayPayConversionByRequesterId(req.params.requesterId);
    if (!conv) return res.json({ success: true, status: 'none' });
    res.json({ success: true, conversion: conv });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/paypay/confirm/:conversionId — Confirm payment sent */
router.post('/paypay/confirm/:conversionId', uploadProof.single('proof'), async (req, res) => {
  try {
    const id = parseInt(req.params.conversionId);
    const { role } = req.body;
    if (!role || !['requester', 'provider'].includes(role)) throw new ValidationError('role must be requester or provider');
    const { getPayPayConversion, updatePayPayConversionStatus } = await import('../services/database.js');
    const conv = getPayPayConversion(id);
    if (!conv) throw new NotFoundError('Conversion');
    const proofField = role === 'requester' ? 'requester_proof' : 'provider_proof';
    updatePayPayConversionStatus(id, role === 'requester' ? 'requester_sent' : 'provider_sent', { [proofField]: req.file?.filename || '' });
    const updated = getPayPayConversion(id);
    if (updated && updated.requester_proof && updated.provider_proof) {
      updatePayPayConversionStatus(id, 'completed', { completed_at: Date.now() });
      try { const { notifyPayPayCompleted } = await import('../services/notifier.js'); notifyPayPayCompleted(id, Number(updated.amount)); } catch { /* */ }
    }
    res.json({ success: true, status: updated?.status });
  } catch (e: unknown) { if (e instanceof AppError) throw e; res.json({ success: false, error: safeError(e) }); }
});

// Structured error handler
router.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
  }
  logger.error('Unhandled route error', { error: err.message });
  res.status(500).json({ success: false, error: 'Internal server error' });
});
