/**
 * @file paypay.ts — PayPay conversion endpoints
 * @description PayPay Lite/Money/USDT conversion, provider registration,
 *   status checking, and payment confirmation with proof upload.
 */
import { Router } from 'express';
import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { AppError, ValidationError, NotFoundError } from '../errors.js';
import { safeError } from './_shared.js';

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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    cb(null, allowed.includes(ext) && allowedMimes.includes(file.mimetype));
  },
});

const router = Router();

/** POST /api/paypay/convert */
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

/** POST /api/paypay/provide */
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

/** GET /api/paypay/status/:requesterId */
router.get('/paypay/status/:requesterId', async (req, res) => {
  try {
    const { getPayPayConversionByRequesterId } = await import('../services/database.js');
    const conv = getPayPayConversionByRequesterId(req.params.requesterId);
    if (!conv) return res.json({ success: true, status: 'none' });
    res.json({ success: true, conversion: conv });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/paypay/confirm/:conversionId */
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

export default router;
