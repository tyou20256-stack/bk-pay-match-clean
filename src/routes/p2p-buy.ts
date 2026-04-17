/**
 * @file p2p-buy.ts — Public buyer P2P endpoints (no admin auth)
 * @description Buyer registration, match tracking, payment reporting with proof upload,
 *   cancellation, AI chat support, referral system, funnel analytics.
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import FileType from 'file-type';
import { registerBuyer, removeBuyer, getPendingBuyers } from '../services/trupayMatcher.js';
import {
  getTruPayMatches, getTruPayMatch, getTruPayWithdrawalById,
  updateTruPayMatchStatus,
} from '../services/database.js';
import { ValidationError, AuthenticationError } from '../errors.js';
import logger from '../services/logger.js';
import { safeError } from './_shared.js';

// L-R4: Centralized HMAC secret + token generation — single source of truth
function getBuyerHmacSecret(): string {
  const key = process.env.BK_ENC_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new Error('BK_ENC_KEY required in production');
    return 'fallback-dev-only';
  }
  return key;
}
function generateBuyerToken(buyerId: string): string {
  return crypto.createHmac('sha256', getBuyerHmacSecret()).update(buyerId).digest('hex').slice(0, 32);
}

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

// M4: Allowed MIME types for proof uploads — validated via magic bytes
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heif']);

/**
 * M4: Validate uploaded file's actual content (magic bytes) matches claimed extension.
 * Rejects polyglot files and extension spoofing.
 * Returns null if valid, error string if invalid.
 */
async function validateUploadMagicBytes(filePath: string, claimedExt: string): Promise<string | null> {
  try {
    const buffer = await fs.promises.readFile(filePath);
    const detected = await FileType.fromBuffer(buffer);
    if (!detected) {
      return 'Unable to detect file type from content — file may be corrupted';
    }
    if (!ALLOWED_IMAGE_MIMES.has(detected.mime)) {
      return `File content is ${detected.mime}, not an allowed image type`;
    }
    // Check that detected extension roughly matches claimed extension
    const claimed = claimedExt.toLowerCase().replace('.', '');
    const detectedExt = detected.ext;
    // Allow jpeg/jpg mismatch and heif/heic mismatch
    const extMap: Record<string, string[]> = {
      jpg: ['jpg', 'jpeg'], jpeg: ['jpg', 'jpeg'],
      heic: ['heic', 'heif'], heif: ['heic', 'heif'],
      png: ['png'], webp: ['webp'],
    };
    const allowedExts = extMap[claimed] || [claimed];
    if (!allowedExts.includes(detectedExt)) {
      return `File extension .${claimed} does not match detected content type .${detectedExt}`;
    }
    return null;
  } catch (e) {
    logger.warn('Magic byte validation error', { error: e instanceof Error ? e.message : String(e) });
    return 'File validation failed';
  }
}

/** POST /api/p2p-buy/register */
router.post('/p2p-buy/register', (req, res) => {
  try {
    const { walletAddress, minAmountJpy, maxAmountJpy, refCode } = req.body;
    if (!walletAddress) throw new ValidationError('walletAddress required');
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(walletAddress)) {
      throw new ValidationError('Invalid TRON wallet address');
    }
    const refPart = refCode && /^PM[A-F0-9]{8}$/i.test(refCode) ? `_ref_${refCode}` : '';
    const buyerId = `web${refPart}_${crypto.randomBytes(12).toString('hex')}`;
    const buyerToken = generateBuyerToken(buyerId);
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

/** GET /api/p2p-buy/match/:buyerId */
router.get('/p2p-buy/match/:buyerId', (req, res) => {
  try {
    const buyerId = req.params.buyerId;
    const matches = getTruPayMatches(undefined, 10, 0).filter(m => m.buyer_id === buyerId);
    if (matches.length === 0) {
      const buyers = getPendingBuyers();
      const inQueue = buyers.some(b => b.id === buyerId);
      return res.json({ success: true, status: inQueue ? 'waiting' : 'not_found', match: null });
    }
    const match = matches[0];

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

    let proofReview: {
      score: number;
      reason: string;
      confidence: string;
      mismatches: string[];
    } | null = null;
    const matchExtra = match as unknown as { proof_analysis?: string; proof_score?: number };
    if (match.status === 'needs_review' && matchExtra.proof_analysis) {
      try {
        const parsed = JSON.parse(matchExtra.proof_analysis);
        const matchDetails = parsed.matches || {};
        const mismatches: string[] = [];
        if (matchDetails.bankNameMatch === false) mismatches.push('bank_name');
        if (matchDetails.accountNumberMatch === false) mismatches.push('account_number');
        if (matchDetails.accountNameMatch === false) mismatches.push('account_name');
        if (matchDetails.amountMatch === false) mismatches.push('amount');
        proofReview = {
          score: matchExtra.proof_score ?? 0,
          reason: parsed.reason || '',
          confidence: parsed.confidence || 'low',
          mismatches,
        };
      } catch { /* unparseable analysis */ }
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
      proofReview,
    });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/p2p-buy/paid/:matchId */
router.post('/p2p-buy/paid/:matchId', uploadProof.single('proof'), async (req: Request, res: Response) => {
  try {
    const matchId = Number(req.params.matchId);
    const { referenceNumber, buyerId, buyerToken } = req.body;
    const expectedToken = generateBuyerToken(buyerId || '');
    if (!buyerId || !buyerToken || buyerToken.length !== expectedToken.length ||
        !crypto.timingSafeEqual(Buffer.from(buyerToken), Buffer.from(expectedToken))) {
      return res.json({ success: false, error: 'Unauthorized' });
    }
    const match = getTruPayMatch(matchId);
    if (!match) return res.json({ success: false, error: 'Match not found' });
    if (match.buyer_id !== buyerId) return res.json({ success: false, error: 'Unauthorized' });

    if (!req.file) {
      return res.json({ success: false, error: '振込明細のスクリーンショットは必須です' });
    }

    // M4: Validate magic bytes match claimed extension — reject polyglot files
    const magicError = await validateUploadMagicBytes(req.file.path, path.extname(req.file.originalname));
    if (magicError) {
      // Delete the rejected file
      try { fs.unlinkSync(req.file.path); } catch { /* best effort */ }
      return res.json({ success: false, error: magicError });
    }

    const ref = referenceNumber || '';
    const proofFile = req.file.filename;

    const extra: Record<string, unknown> = { proof_image: proofFile };
    if (ref) extra.reference_number = ref;
    updateTruPayMatchStatus(matchId, 'buyer_paid', extra);

    logger.info('Buyer reported payment with proof', { matchId, ref: ref || 'none', proof: proofFile });

    // AI analysis (async)
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
        updateTruPayMatchStatus(matchId, 'needs_review', {
          proof_score: analysis.score,
          proof_analysis: JSON.stringify({
            extracted: analysis.extractedData,
            matches: analysis.matchDetails,
            confidence: analysis.confidence,
            reason: analysis.reason,
          }),
        });

        notifyProofReview(matchId, match.amount_jpy, analysis, proofFile);
        logger.info('Proof submitted for manual review', { matchId, score: analysis.score, reason: analysis.reason });
      }).catch(async e => {
        logger.error('Proof analysis failed', { matchId, error: e instanceof Error ? e.message : String(e) });
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

/** DELETE /api/p2p-buy/cancel/:buyerId */
router.delete('/p2p-buy/cancel/:buyerId', (req, res) => {
  try {
    const { buyerToken } = req.query as { buyerToken?: string };
    const buyerId = req.params.buyerId;
    if (!buyerToken || typeof buyerToken !== 'string') {
      return res.status(401).json({ success: false, error: 'buyerToken required' });
    }
    const expectedToken = generateBuyerToken(buyerId);
    if (
      buyerToken.length !== expectedToken.length ||
      !crypto.timingSafeEqual(Buffer.from(buyerToken), Buffer.from(expectedToken))
    ) {
      return res.status(403).json({ success: false, error: 'Invalid buyerToken' });
    }
    const removed = removeBuyer(buyerId);
    res.json({ success: true, removed });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/p2p-buy/chat */
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

/** POST /api/p2p-buy/referral/generate */
router.post('/p2p-buy/referral/generate', async (req, res) => {
  try {
    const { referrerId, type, parentCode } = req.body;
    if (!referrerId) return res.json({ success: false, error: 'referrerId required' });
    const { createReferralCode } = await import('../services/database.js');
    const code = createReferralCode(referrerId, type || 'web', parentCode);
    res.json({ success: true, code, shareUrl: `${process.env.BASE_URL || 'https://bkpay.app'}/buy-usdt.html?ref=${code}` });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

/** POST /api/p2p-buy/track */
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

/** GET /api/p2p-buy/analytics */
router.get('/p2p-buy/analytics', async (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthenticationError();
  const { validateSession } = await import('../services/database.js');
  if (!validateSession(token, req.ip || '')) throw new AuthenticationError();
  try {
    const db = (await import('../services/database.js')).default;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const events = db.prepare("SELECT event, COUNT(*) as count FROM funnel_events WHERE created_at > ? GROUP BY event ORDER BY count DESC").all(oneDayAgo);
    const total = db.prepare("SELECT COUNT(*) as count FROM funnel_events WHERE created_at > ?").get(oneDayAgo) as { count: number };
    const abResults = db.prepare(`
      SELECT
        json_extract(data, '$.variant') as variant,
        COUNT(*) as views,
        SUM(CASE WHEN event = 'submit' THEN 1 ELSE 0 END) as conversions
      FROM funnel_events
      WHERE event IN ('ab_variant', 'submit') AND created_at > ?
      GROUP BY json_extract(data, '$.variant')
    `).all(oneDayAgo) as Array<{ variant: string; views: number; conversions: number }>;

    const utmSources = db.prepare(`
      SELECT json_extract(data, '$.utm_source') as source, COUNT(*) as count
      FROM funnel_events
      WHERE created_at > ? AND json_extract(data, '$.utm_source') IS NOT NULL
      GROUP BY source ORDER BY count DESC
    `).all(oneDayAgo) as Array<{ source: string; count: number }>;

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

/** GET /api/p2p-buy/referral/:code */
router.get('/p2p-buy/referral/:code', async (req, res) => {
  try {
    const { getP2pReferralStats } = await import('../services/database.js');
    const stats = getP2pReferralStats(req.params.code);
    res.json({ success: true, ...stats });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

export default router;
