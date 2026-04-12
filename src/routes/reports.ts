/**
 * @file reports.ts — Analytics, fee reports, profit tracking, spread stats, CSV export,
 *   rate prediction, currency routing, bulk simulator, merchant scoring
 * @description All reporting, analytics, and data export endpoints.
 */
import { Router } from 'express';
import { getCachedRates, fetchAllRates } from '../services/aggregator.js';
import { getAllWindows } from '../services/arbitrage.js';
import { AggregatedRates } from '../types.js';
import { getHistory, getHistoryByRange } from '../services/priceHistory.js';
import { getDailyReport, getMonthlyReport, getSummaryReport } from '../services/reportService.js';
import * as dbSvc from '../services/database.js';
import { getProfitSummary, getDailyProfit, getHourlyProfit, getMonthlyProfit, getProfitGoal, setProfitGoal, get7DayTrend } from '../services/profitTracker.js';
import spreadOptimizer, { getSpreadConfig, updateSpreadConfig, get24hStats } from '../services/spreadOptimizer.js';
import { exportOrders, exportFreee, exportYayoi, exportAccounts, exportFeeReport } from '../services/csvExporter.js';
import { findAllRoutes, findBestRoute, compareRoutes } from '../services/currencyRouter.js';
import { getPrediction, getOptimalBuyTime } from '../services/ratePrediction.js';
import { getTopMerchants, getMerchantStats } from '../services/merchantScoring.js';
import { simulateBulkPurchase, optimizeSplitting } from '../services/bulkSimulator.js';
import { CONFIG } from '../config.js';
import { ValidationError } from '../errors.js';
import { safeError, sendCSV } from './_shared.js';

const router = Router();

// === Rates ===

router.get('/rates', (_req, res) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, AggregatedRates> = {};
  all.forEach((v, k) => { result[k] = v; });
  res.json({ success: true, data: result });
});

router.get('/rates/:crypto', (req, res) => {
  const crypto = req.params.crypto.toUpperCase();
  const data = getCachedRates(crypto) as AggregatedRates;
  res.json({ success: true, data });
});

router.get('/best', (_req, res) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, { bestBuy: { exchange: string; price: number } | null; bestSell: { exchange: string; price: number } | null; spot: number }> = {};
  all.forEach((v, k) => { result[k] = { bestBuy: v.bestBuyExchange, bestSell: v.bestSellExchange, spot: v.spotPrices[k] }; });
  res.json({ success: true, data: result });
});

router.get('/spread', (_req, res) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, Array<{ exchange: string; spread: number | null; bestBuy: number | null; bestSell: number | null; buyPremium: number | null; sellPremium: number | null }>> = {};
  all.forEach((v, k) => { result[k] = v.rates.map(r => ({ exchange: r.exchange, spread: r.spread, bestBuy: r.bestBuy, bestSell: r.bestSell, buyPremium: r.buyPremium, sellPremium: r.sellPremium })); });
  res.json({ success: true, data: result });
});

router.get('/arbitrage', (_req, res) => {
  const windows = getAllWindows();
  res.json({ success: true, data: windows });
});

// Rate refresh (throttled)
let lastRefreshAt = 0;
const REFRESH_MIN_INTERVAL_MS = 15_000;

router.post('/refresh', async (_req, res) => {
  const crypto = (_req.body?.crypto || 'USDT').toUpperCase();
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_MIN_INTERVAL_MS) {
    const cached = getCachedRates(crypto);
    return res.json({ success: true, data: cached, throttled: true });
  }
  lastRefreshAt = now;
  const data = await fetchAllRates(crypto);
  res.json({ success: true, data });
});

function fetchers() { return ['Bybit', 'Binance', 'OKX', 'HTX']; }

router.get('/status', (_req, res) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  res.json({
    success: true, uptime: process.uptime(),
    exchanges: fetchers(), cryptos: CONFIG.cryptos,
    updateInterval: CONFIG.updateIntervalMs,
    cachedCryptos: Array.from(all.keys()),
    lastUpdated: Array.from(all.values()).map(v => ({ crypto: v.rates[0]?.crypto, time: new Date(v.lastUpdated).toISOString() })),
  });
});

// === Price History ===

router.get('/history/:crypto', (req, res) => {
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

// === Reports ===

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

// === Fee Settings ===

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

router.get('/fees/rate', (req, res) => {
  const rank = (req.query.rank as string) || 'bronze';
  const rate = dbSvc.getFeeRateForRank(rank);
  res.json({ success: true, rate });
});

// === Spread Optimizer ===

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

// === CSV Export ===

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

// === Profit Tracking ===

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

// === Currency Router ===
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

// === Merchant Scoring ===

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

// === Cost Config ===

router.get('/cost-config', (_req, res) => {
  try {
    const config = dbSvc.getCostConfig();
    res.json({ success: true, data: config });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

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

router.get('/cost-config/estimate', (req, res) => {
  try {
    const amount = Math.max(Number(req.query.amount) || 10000, 1);
    const direction = (req.query.direction === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell';
    const estimate = dbSvc.estimateOrderCost(amount, direction);
    res.json({ success: true, data: estimate });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

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

export default router;
