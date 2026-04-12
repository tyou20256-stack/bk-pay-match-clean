/**
 * @file accounts.ts — Bank accounts, e-pay config, exchange credentials, wallet config, settings
 * @description CRUD for bank accounts, e-pay configuration, exchange credential management,
 *   wallet display config, and system settings.
 */
import { Router } from 'express';
import * as dbSvc from '../services/database.js';
import trader from '../services/puppeteerTrader.js';
import fs from 'fs';
import { ValidationError } from '../errors.js';
import { safeError } from './_shared.js';

const router = Router();

// === Bank Accounts ===

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

// === Bulk Import ===

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

// === E-Pay ===

router.get('/epay', (req, res) => {
  res.json({ success: true, configs: dbSvc.getAllEpayConfig() });
});

router.post('/epay/:type', (req, res) => {
  dbSvc.saveEpayConfig(req.params.type, req.body);
  res.json({ success: true });
});

// === Wallet (display config) ===

router.get('/wallet', (req, res) => {
  res.json({ success: true, wallet: dbSvc.getWalletConfig() });
});

router.post('/wallet', (req, res) => {
  dbSvc.saveWalletConfig(req.body.address, req.body.label || '');
  res.json({ success: true });
});

// === Settings ===

router.get('/settings', (req, res) => {
  const keys = ['minCompletion', 'orderTimeout', 'minAmount', 'maxAmount', 'onlineOnly', 'fallbackMode'];
  const settings: Record<string, string> = {};
  keys.forEach(k => { settings[k] = dbSvc.getSetting(k); });
  res.json({ success: true, settings });
});

router.post('/settings', (req, res) => {
  const allowedKeys = ['minCompletion', 'orderTimeout', 'minAmount', 'maxAmount', 'onlineOnly', 'fallbackMode'];
  for (const [k, v] of Object.entries(req.body)) {
    if (!allowedKeys.includes(k)) continue;
    dbSvc.setSetting(k, String(v));
  }
  res.json({ success: true });
});

// === Exchange Credentials ===

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

// === Puppeteer Trader ===

router.get('/trader/status', (req, res) => {
  res.json({ success: true, status: trader.getStatus() });
});

router.post('/trader/credentials', (req, res) => {
  const { exchange, email, password, apiKey, apiSecret, totpSecret } = req.body;
  if (!exchange) throw new ValidationError('exchange required');
  trader.setCredentials({ exchange, email, password, apiKey, apiSecret, totpSecret });
  res.json({ success: true, message: `Credentials set for ${exchange}` });
});

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
  if (!screenshotPath) throw new Error('Screenshot not found');
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
  const logger = (await import('../services/logger.js')).default;
  logger.info('Test order (dry-run)', { exchange, crypto: crypto || 'USDT', amount, payMethod: payMethod || 'bank' });
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

export default router;
