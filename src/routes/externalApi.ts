/**
 * @file externalApi.ts — 外部マーチャント向け API v1
 * @description 外部決済チャンネルが bk-pay-match に接続するための REST API。
 *   APIキー認証（X-API-Key ヘッダー）で保護。
 *
 *   POST /api/v1/orders        — 買い注文作成（振込先銀行口座を返す）
 *   GET  /api/v1/orders/:id    — 注文ステータス確認
 *   GET  /api/v1/balance       — ウォレット残高確認
 *   GET  /api/v1/keys          — APIキー一覧（admin セッション必須）
 *   POST /api/v1/keys          — APIキー発行（admin セッション必須）
 *   DELETE /api/v1/keys/:id    — APIキー失効（admin セッション必須）
 *   POST /api/v1/withdrawals              — 出金リクエスト作成
 *   GET  /api/v1/withdrawals/:id          — 出金ステータス確認
 *   POST /api/v1/withdrawals/:id/confirm  — JPY受取確認→USDT送金
 *   POST /api/v1/withdrawals/:id/cancel   — 出金キャンセル
 */
import { Router, Request, Response, NextFunction } from 'express';
import { verifyApiKey, generateApiKey, listKeys, revokeKey, MerchantApiKey } from '../services/merchantApiService.js';
import { saveOrderWithMerchantKey } from '../services/database.js';
import orderManager from '../services/orderManager.js';
import logger from '../services/logger.js';
import walletService from '../services/walletService.js';
import { validateSession } from '../services/database.js';
import withdrawalService from '../services/withdrawalService.js';

interface MerchantRequest extends Request {
  merchantKey?: MerchantApiKey;
}

const router = Router();

// ── レート制限（APIキー単位: 60 req/min）─────────────────────────
const keyRateLimiter = (() => {
  const counts = new Map<number, { n: number; reset: number }>();
  return (keyId: number): boolean => {
    const now = Date.now();
    const entry = counts.get(keyId);
    if (!entry || now > entry.reset) {
      counts.set(keyId, { n: 1, reset: now + 60_000 });
      return true;
    }
    if (entry.n >= 60) return false;
    entry.n++;
    return true;
  };
})();

// ── APIキー認証ミドルウェア ────────────────────────────────────
function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const rawKey = (req.headers['x-api-key'] as string) || '';
  if (!rawKey) {
    res.status(401).json({ success: false, error: 'X-API-Key header required' });
    return;
  }
  const key = verifyApiKey(rawKey);
  if (!key) {
    res.status(401).json({ success: false, error: 'Invalid or revoked API key' });
    return;
  }
  if (!keyRateLimiter(key.id)) {
    res.status(429).json({ success: false, error: 'Rate limit exceeded (60 req/min)' });
    return;
  }
  (req as MerchantRequest).merchantKey = key;
  next();
}

// ── Admin セッション認証ミドルウェア（APIキー管理用）──────────────
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token || !validateSession(token, req.ip)) {
    res.status(401).json({ success: false, error: 'Admin session required' });
    return;
  }
  next();
}

// ═══════════════════════════════════════════════════════════════
//  APIキー管理（管理者のみ）
// ═══════════════════════════════════════════════════════════════

/** GET /api/v1/keys — APIキー一覧 */
router.get('/keys', adminAuth, (_req, res) => {
  res.json({ success: true, keys: listKeys() });
});

/** POST /api/v1/keys — APIキー発行 */
router.post('/keys', adminAuth, (req, res) => {
  const { name, webhookUrl } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.json({ success: false, error: 'name required' });
  }
  if (webhookUrl && typeof webhookUrl !== 'string') {
    return res.json({ success: false, error: 'invalid webhookUrl' });
  }
  const generated = generateApiKey(name.trim(), webhookUrl?.trim());
  res.json({
    success: true,
    key: generated.rawKey,   // ⚠️ この1回だけ表示。以降は取得不可
    keyPrefix: generated.keyPrefix,
    id: generated.id,
    message: 'このキーは一度だけ表示されます。必ず保存してください。',
  });
});

/** DELETE /api/v1/keys/:id — APIキー失効 */
router.delete('/keys/:id', adminAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.json({ success: false, error: 'invalid id' });
  const ok = revokeKey(id);
  res.json({ success: ok, error: ok ? undefined : 'Key not found' });
});

// ═══════════════════════════════════════════════════════════════
//  外部マーチャント向けエンドポイント（APIキー認証）
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/v1/orders — 買い注文作成
 * Body: { amount, crypto?, customerWalletAddress, webhookUrl? }
 * Returns: { orderId, bankAccount, cryptoAmount, rate, expiresAt }
 */
router.post('/orders', apiKeyAuth, async (req, res) => {
  try {
    const { amount, crypto = 'USDT', customerWalletAddress, webhookUrl } = req.body;
    const merchantKey = (req as MerchantRequest).merchantKey!;

    // Validate
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 500 || numAmount > 10_000_000) {
      return res.json({ success: false, error: 'amount は 500〜10,000,000 の整数で指定してください' });
    }
    if (!['USDT', 'BTC', 'ETH'].includes(crypto)) {
      return res.json({ success: false, error: 'crypto は USDT / BTC / ETH のいずれかです' });
    }
    if (!customerWalletAddress || typeof customerWalletAddress !== 'string') {
      return res.json({ success: false, error: 'customerWalletAddress (TRONアドレス) が必要です' });
    }
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(customerWalletAddress)) {
      return res.json({ success: false, error: 'customerWalletAddress のフォーマットが不正です' });
    }

    // Use merchant webhook_url if not overridden per-order
    const effectiveWebhookUrl: string | undefined =
      (typeof webhookUrl === 'string' && webhookUrl.startsWith('http')) ? webhookUrl
      : merchantKey.webhookUrl || undefined;

    // Create order via existing orderManager
    const order = await orderManager.createOrder(
      Math.round(numAmount),
      'bank',
      crypto,
      customerWalletAddress
    );

    // Attach merchant key and webhook URL to order
    saveOrderWithMerchantKey(order, merchantKey.id, effectiveWebhookUrl);

    // Build response
    const pi = (order.paymentInfo || {}) as Record<string, unknown>;
    res.json({
      success: true,
      orderId: order.id,
      status: order.status,
      bankAccount: {
        bankName: pi.bankName || '',
        branchName: pi.branchName || '',
        accountType: pi.accountType || '普通',
        accountNumber: pi.accountNumber || '',
        accountHolder: pi.accountHolder || '',
        amount: order.amount,
      },
      cryptoAmount: order.cryptoAmount,
      rate: order.rate,
      crypto: order.crypto,
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
    });
  } catch (e: unknown) {
    logger.error('createOrder error', { error: e instanceof Error ? e.message : String(e) });
    res.json({ success: false, error: '注文作成に失敗しました' });
  }
});

/**
 * GET /api/v1/orders/:id — 注文ステータス確認
 */
router.get('/orders/:id', apiKeyAuth, (req, res) => {
  try {
    const order = orderManager.getOrder(req.params.id);
    if (!order) return res.json({ success: false, error: 'Order not found' });

    // Ownership check: only allow access to orders created by this API key
    const merchantKey = (req as MerchantRequest).merchantKey!;
    if (order.merchantApiKeyId && order.merchantApiKeyId !== merchantKey.id) {
      return res.json({ success: false, error: 'Order not found' });
    }

    const pi = (order.paymentInfo || {}) as Record<string, unknown>;
    res.json({
      success: true,
      orderId: order.id,
      status: order.status,
      amount: order.amount,
      crypto: order.crypto,
      cryptoAmount: order.cryptoAmount,
      rate: order.rate,
      txId: order.txId || null,
      customerWalletAddress: order.customerWalletAddress || null,
      bankAccount: {
        bankName: pi.bankName || '',
        branchName: pi.branchName || '',
        accountType: pi.accountType || '普通',
        accountNumber: pi.accountNumber || '',
        accountHolder: pi.accountHolder || '',
        amount: order.amount,
      },
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      completedAt: order.completedAt || null,
    });
  } catch (e: unknown) {
    logger.error('getOrder error', { error: e instanceof Error ? e.message : String(e) });
    res.json({ success: false, error: '注文の取得に失敗しました' });
  }
});

/**
 * GET /api/v1/balance — ウォレット残高
 */
router.get('/balance', apiKeyAuth, async (_req, res) => {
  try {
    const balance = await walletService.getWalletBalance();
    if (!balance) return res.json({ success: false, error: 'ウォレット未設定' });
    res.json({ success: true, usdt: balance.usdt, trx: balance.trx });
  } catch (e: unknown) {
    res.json({ success: false, error: '残高取得に失敗しました' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  出金（三角マッチング）エンドポイント（APIキー認証）
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/v1/withdrawals — 出金リクエスト作成
 * Body: { externalRef?, amount, payMethod, bankName?, branchName?, accountNumber?, accountHolder?, paypayId?, webhookUrl? }
 */
router.post('/withdrawals', apiKeyAuth, async (req, res) => {
  try {
    const merchantKey = (req as MerchantRequest).merchantKey!;
    const { externalRef, amount, payMethod = 'bank', bankName, branchName, accountType,
            accountNumber, accountHolder, paypayId, webhookUrl } = req.body;

    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount < 500 || numAmount > 10_000_000) {
      return res.json({ success: false, error: 'amount は 500〜10,000,000 で指定してください' });
    }
    if (!['bank', 'paypay'].includes(payMethod)) {
      return res.json({ success: false, error: 'payMethod は bank または paypay です' });
    }

    const effectiveWebhookUrl = (typeof webhookUrl === 'string' && webhookUrl.startsWith('http'))
      ? webhookUrl : merchantKey.webhookUrl || undefined;

    const result = await withdrawalService.createWithdrawal({
      merchantApiKeyId: merchantKey.id,
      externalRef,
      amount: Math.round(numAmount),
      payMethod,
      bankName, branchName, accountType, accountNumber, accountHolder,
      paypayId,
      webhookUrl: effectiveWebhookUrl,
    });

    if (!result.success) return res.json(result);

    const w = result.withdrawal!;
    const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.json({
      success: true,
      withdrawalId: w.id,
      trackingToken: w.trackingToken,
      statusPageUrl: `${base}/withdrawal.html?token=${w.trackingToken}`,
      status: w.status,
      expiresAt: w.expiresAt,
    });
  } catch (e: unknown) {
    logger.error('createWithdrawal error', { error: e instanceof Error ? e.message : String(e) });
    res.json({ success: false, error: '出金リクエスト作成に失敗しました' });
  }
});

/**
 * GET /api/v1/withdrawals/:id — 出金ステータス確認
 */
router.get('/withdrawals/:id', apiKeyAuth, (req, res) => {
  try {
    const merchantKey = (req as MerchantRequest).merchantKey!;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.json({ success: false, error: 'invalid id' });

    const w = withdrawalService.getWithdrawalForMerchant(id, merchantKey.id);
    if (!w) return res.json({ success: false, error: 'Withdrawal not found' });

    res.json({
      success: true,
      withdrawal: {
        id: w.id,
        externalRef: w.externalRef,
        trackingToken: w.trackingToken,
        amount: w.amount,
        payMethod: w.payMethod,
        status: w.status,
        matchedOrderId: w.matchedOrderId,
        createdAt: w.createdAt,
        expiresAt: w.expiresAt,
        completedAt: w.completedAt,
      },
    });
  } catch (e: unknown) {
    logger.error('getWithdrawal error', { error: e instanceof Error ? e.message : String(e) });
    res.json({ success: false, error: '出金情報の取得に失敗しました' });
  }
});

/**
 * POST /api/v1/withdrawals/:id/confirm — JPY受取確認→USDT送金→完了
 */
router.post('/withdrawals/:id/confirm', apiKeyAuth, async (req, res) => {
  try {
    const merchantKey = (req as MerchantRequest).merchantKey!;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.json({ success: false, error: 'invalid id' });

    const result = await withdrawalService.confirmWithdrawalPayment(id, merchantKey.id);
    res.json(result);
  } catch (e: unknown) {
    logger.error('confirmWithdrawal error', { error: e instanceof Error ? e.message : String(e) });
    res.json({ success: false, error: '出金確認処理に失敗しました' });
  }
});

/**
 * POST /api/v1/withdrawals/:id/cancel — 出金キャンセル
 */
router.post('/withdrawals/:id/cancel', apiKeyAuth, async (req, res) => {
  try {
    const merchantKey = (req as MerchantRequest).merchantKey!;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.json({ success: false, error: 'invalid id' });

    const result = await withdrawalService.cancelWithdrawal(id, merchantKey.id);
    res.json(result);
  } catch (e: unknown) {
    logger.error('cancelWithdrawal error', { error: e instanceof Error ? e.message : String(e) });
    res.json({ success: false, error: 'キャンセル処理に失敗しました' });
  }
});

export default router;
