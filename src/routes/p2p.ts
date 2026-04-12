/**
 * @file p2p.ts — P2P Seller endpoints
 * @description Seller registration, login, order management, payment confirmation,
 *   balance management, and withdrawal handling.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import p2pSellerService from '../services/p2pSellerService.js';
import * as dbSvc from '../services/database.js';

const router = Router();

// Rate limiters for P2P seller endpoints
const sellerAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, error: 'Too many login attempts. Try again later.' },
});
const sellerConfirmLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { success: false, error: 'Too many confirm requests. Please wait.' },
});

/** POST /api/p2p/sellers/register */
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

/** GET /api/p2p/sellers */
router.get('/p2p/sellers', (req, res) => {
  const sellers = dbSvc.listP2PSellers();
  res.json({ success: true, sellers });
});

/** PUT /api/p2p/sellers/:id */
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

/** POST /api/p2p/sellers/:id/credit */
router.post('/p2p/sellers/:id/credit', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.json({ success: false, error: 'invalid id' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.json({ success: false, error: 'amount が不正です' });
  p2pSellerService.creditBalance(id, amount);
  res.json({ success: true, credited: amount });
});

/** GET /api/p2p/orders/:id */
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

/** POST /api/p2p/orders/:id/confirm */
router.post('/p2p/orders/:id/confirm', sellerConfirmLimiter, async (req, res) => {
  const token = (req.query.token || req.body.token) as string;
  if (!token) return res.json({ success: false, error: 'token required' });
  try {
    const result = await p2pSellerService.confirmPayment(req.params.id, token);
    res.json(result);
  } catch (e: unknown) {
    const logger = (await import('../services/logger.js')).default;
    logger.error('P2P confirmPayment error', { error: e instanceof Error ? e.message : String(e) });
    res.json({ success: false, error: '確認処理に失敗しました' });
  }
});

/** POST /api/p2p/sellers/login */
router.post('/p2p/sellers/login', sellerAuthLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ success: false, error: 'メール・パスワードが必要です' });
  }
  const result = p2pSellerService.loginSeller(email, password);
  res.json(result);
});

/** GET /api/p2p/sellers/me */
router.get('/p2p/sellers/me', (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.json({ success: false, error: 'トークンが必要です' });
  const seller = p2pSellerService.getSellerByToken(token);
  if (!seller) return res.json({ success: false, error: '無効なトークンです' });
  res.json({ success: true, seller });
});

/** GET /api/p2p/sellers/me/orders */
router.get('/p2p/sellers/me/orders', (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.json({ success: false, error: 'トークンが必要です' });
  const seller = p2pSellerService.getSellerByToken(token);
  if (!seller) return res.json({ success: false, error: '無効なトークンです' });
  const orders = p2pSellerService.getSellerOrders(seller.id);
  res.json({ success: true, orders });
});

export default router;
