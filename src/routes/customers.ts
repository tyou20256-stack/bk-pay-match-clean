/**
 * @file customers.ts — Customer accounts, referrals, AI chat
 * @description Customer registration/login/logout, profile, balance, transactions,
 *   KYC submission, referral stats, and AI chat assistant.
 */
import { Router } from 'express';
import * as dbSvc from '../services/database.js';
import * as customerSvc from '../services/customerAccounts.js';
import chatService, { ChatMessage } from '../services/chatService.js';
import { ValidationError, AuthenticationError, NotFoundError } from '../errors.js';
import logger from '../services/logger.js';
import { safeError } from './_shared.js';

const router = Router();

// === Customer Stats & Referral (public) ===

router.get('/customer/:telegramId/stats', (req, res) => {
  try {
    const stats = dbSvc.getCustomerStats(req.params.telegramId);
    res.json({ success: true, data: stats });
  } catch (e: unknown) {
    res.json({ success: false, error: safeError(e) });
  }
});

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

// === Customer Account ===

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
    res.json({ success: true, token: result.token });
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

// === AI Chat Assistant ===

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

export default router;
