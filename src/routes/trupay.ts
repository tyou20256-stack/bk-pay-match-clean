/**
 * @file trupay.ts — TruPay integration endpoints
 * @description TruPay status, withdrawal management, buyer queue, matching, confirmation, polling.
 */
import { Router } from 'express';
import { testConnection, getWithdrawalSummary, isEnabled as isTruPayEnabled } from '../services/trupayClient.js';
import { registerBuyer, removeBuyer, getPendingBuyers } from '../services/trupayMatcher.js';
import { manualConfirm, adminConfirm } from '../services/trupayVerifier.js';
import { pollWithdrawals } from '../services/trupayPoller.js';
import {
  getTruPayWithdrawals, getTruPayMatches, getTruPayStats,
  getTruPayMatch,
} from '../services/database.js';
import { ValidationError, NotFoundError } from '../errors.js';
import { safeError } from './_shared.js';

const router = Router();

/** GET /api/trupay/status */
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

/** GET /api/trupay/withdrawals */
router.get('/trupay/withdrawals', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const data = getTruPayWithdrawals(status, limit, offset);
    res.json({ success: true, data });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/trupay/matches */
router.get('/trupay/matches', (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const data = getTruPayMatches(status, limit, offset);
    res.json({ success: true, data });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/trupay/matches/:id */
router.get('/trupay/matches/:id', (req, res) => {
  try {
    const match = getTruPayMatch(Number(req.params.id));
    if (!match) throw new NotFoundError('Match');
    res.json({ success: true, data: match });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/trupay/stats */
router.get('/trupay/stats', (_req, res) => {
  try {
    const stats = getTruPayStats();
    res.json({ success: true, data: stats });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** GET /api/trupay/buyers */
router.get('/trupay/buyers', (_req, res) => {
  try {
    res.json({ success: true, data: getPendingBuyers() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/trupay/buyers */
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

/** DELETE /api/trupay/buyers/:id */
router.delete('/trupay/buyers/:id', (req, res) => {
  try {
    const removed = removeBuyer(req.params.id);
    res.json({ success: true, removed });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/trupay/matches/:id/confirm */
router.post('/trupay/matches/:id/confirm', async (req, res) => {
  try {
    const { referenceNumber } = req.body;
    if (!referenceNumber) throw new ValidationError('referenceNumber required');
    const result = await manualConfirm(Number(req.params.id), referenceNumber);
    res.json(result);
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/trupay/matches/:id/admin-confirm */
router.post('/trupay/matches/:id/admin-confirm', async (req, res) => {
  try {
    const result = await adminConfirm(Number(req.params.id));
    res.json(result);
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/trupay/poll */
router.post('/trupay/poll', async (_req, res) => {
  try {
    await pollWithdrawals();
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

export default router;
