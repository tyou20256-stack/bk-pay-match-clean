/**
 * @file orders.ts — Order management routes
 * @description Order CRUD, payment marking, cancellation, sell orders,
 *   admin order actions (verify, send-crypto, manual-complete),
 *   bank transfer verification, and crypto transaction history.
 */
import { Router } from 'express';
import orderManager from '../services/orderManager.js';
import { processCryptoSend, isWalletReady, getWalletBalance, getSendingAddress, checkAndAlertSweep, sweepToColdWallet } from '../services/walletService.js';
import bankVerifier from '../services/bankVerifier.js';
import { getHealthDashboard, autoRestUnhealthyAccounts, markTransferFailed } from '../services/freezeDetector.js';
import * as dbSvc from '../services/database.js';
import { ValidationError, AuthenticationError, NotFoundError } from '../errors.js';
import { safeError, TRON_ADDR_RE, VALID_PAY_METHODS, VALID_CRYPTOS } from './_shared.js';

const router = Router();

// === Order CRUD ===

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
  // Require orderToken for non-admin access to prevent enumeration
  const orderToken = (req.query.orderToken || req.headers['x-order-token']) as string | undefined;
  const adminToken = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  const isAdmin = adminToken && dbSvc.validateSession(String(adminToken), req.ip || '');
  if (!isAdmin) {
    const stored = (order as Record<string, unknown>).orderToken as string | undefined;
    if (stored && orderToken !== stored) {
      throw new AuthenticationError('Invalid order token');
    }
  }
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

// === Admin Order Actions ===

router.post('/orders/:id/verify', (req, res) => {
  const order = orderManager.adminVerifyPayment(req.params.id);
  if (!order) throw new NotFoundError('Order or invalid status transition');
  dbSvc.recordAuditLog({ userId: (req as unknown as Record<string, unknown>).userId as number, action: 'order_verify', targetType: 'order', targetId: req.params.id, ipAddress: req.ip || '' });
  res.json({ success: true, order });
});

router.post('/orders/:id/send-crypto', async (req, res) => {
  try {
    dbSvc.recordAuditLog({ userId: (req as unknown as Record<string, unknown>).userId as number, action: 'order_send_crypto', targetType: 'order', targetId: req.params.id, ipAddress: req.ip || '' });
    const result = await processCryptoSend(req.params.id);
    res.json({ success: result.success, txId: result.txId, error: result.error });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

router.post('/orders/:id/manual-complete', (req, res) => {
  const { txId } = req.body || {};
  const order = orderManager.adminManualComplete(req.params.id, txId);
  if (!order) throw new NotFoundError('Order or invalid status transition');
  dbSvc.recordAuditLog({ userId: (req as unknown as Record<string, unknown>).userId as number, action: 'order_manual_complete', targetType: 'order', targetId: req.params.id, details: txId ? `txId=${txId}` : undefined, ipAddress: req.ip || '' });
  res.json({ success: true, order });
});

// === Wallet Status ===

router.get('/wallet/status', async (_req, res) => {
  const ready = isWalletReady();
  const address = getSendingAddress();
  let balance = null;
  if (ready) {
    balance = await getWalletBalance();
  }
  res.json({ success: true, ready, address, balance });
});

// === Wallet Thresholds ===

router.get('/wallet/thresholds', (_req, res) => {
  const thresholds = dbSvc.getWalletThresholds();
  res.json({ success: true, thresholds });
});

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

router.post('/wallet/sweep', async (req, res) => {
  try {
    const { amount } = req.body || {};
    const result = await sweepToColdWallet(amount ? Number(amount) : undefined);
    res.json({ success: result.success, txId: result.txId, error: result.error });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

// === Crypto Transactions ===

router.get('/crypto-transactions', (_req, res) => {
  const txs = dbSvc.getCryptoTransactions();
  res.json({ success: true, transactions: txs });
});

router.get('/crypto-transactions/:orderId', (req, res) => {
  const txs = dbSvc.getCryptoTransactions(req.params.orderId);
  res.json({ success: true, transactions: txs });
});

// === Bank Transfer Verification ===

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

router.get('/bank-transfers', (req, res) => {
  const status = req.query.status as string | undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const transfers = dbSvc.getBankTransfers({ status, limit });
  res.json({ success: true, transfers });
});

router.get('/bank-transfers/status', (_req, res) => {
  res.json({ success: true, ...bankVerifier.getStatus() });
});

router.post('/bank-transfers/toggle', (req, res) => {
  const { enabled } = req.body;
  bankVerifier.setEnabled(!!enabled);
  res.json({ success: true, enabled: bankVerifier.isEnabled() });
});

router.post('/bank-transfers/match', (_req, res) => {
  const count = bankVerifier.processMatches();
  res.json({ success: true, matched: count });
});

// === Sell Order ===

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

// === Account Health / Freeze Detection ===

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

  const paymentInfo = order.paymentInfo;
  if (paymentInfo && typeof paymentInfo === 'object' && 'accountId' in paymentInfo) {
    markTransferFailed((paymentInfo as { accountId: number }).accountId);
  }

  orderManager.cancelOrder(req.params.id);
  res.json({ success: true, message: 'Order marked as transfer failed' });
});

// === Withdrawals ===
import { listWithdrawals, getWithdrawal, getWithdrawalByToken } from '../services/database.js';

router.get('/withdrawals', (_req, res) => {
  try {
    const withdrawals = listWithdrawals(200);
    res.json({ success: true, withdrawals });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

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

router.get('/withdrawals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ValidationError('invalid id');
    const w = getWithdrawal(id);
    if (!w) throw new NotFoundError('Withdrawal');
    res.json({ success: true, withdrawal: w });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Escrow Status (Public) ===

router.get('/escrow/status', async (_req, res) => {
  try {
    const { getSystemConfig } = await import('../services/database.js');
    const keySet = !!getSystemConfig('TRON_WALLET_PRIVATE_KEY');
    const addrSet = !!getSystemConfig('TRON_WALLET_ADDRESS');
    const envKey = !!process.env.TRON_WALLET_PRIVATE_KEY;
    res.json({ success: true, escrowEnabled: (keySet && addrSet) || envKey });
  } catch { res.json({ success: true, escrowEnabled: false }); }
});

export default router;
