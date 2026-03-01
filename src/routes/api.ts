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
