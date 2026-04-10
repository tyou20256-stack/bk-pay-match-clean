/**
 * @file trupayMatcher.ts — TruPayマッチングエンジン
 * @description キューに入ったTruPay出金と、USDT購入希望者をマッチングする。
 *   マッチング成立時に購入者に振込先情報を通知し、60分のタイムアウトを設定。
 *
 *   購入者は2つのソースから取得:
 *   1. 既存のorders テーブル（direction='buy', status='pending_payment', pay_method='bank'）
 *   2. trupay_matches テーブルに手動登録された購入者（管理画面/API経由）
 */
import { getCachedRates } from './aggregator.js';
import {
  getQueuedTruPayWithdrawals,
  updateTruPayWithdrawalStatus,
  insertTruPayMatch,
  getTruPayMatchByWithdrawalId,
  TruPayWithdrawalRow,
  dbInsertPendingBuyer,
  dbGetActivePendingBuyers,
  dbDeletePendingBuyer,
  dbExpireOldPendingBuyers,
} from './database.js';
import db from './database.js';
import { broadcast } from './websocket.js';
import { isEnabled } from './trupayClient.js';
import { notifyTruPayMatchCreated, notifyTruPayNewWithdrawal } from './notifier.js';
import logger from './logger.js';
import { AggregatedRates } from '../types.js';

// Lazy import to avoid circular dependency
let _notifyBuyerMatchCreated: ((buyerId: string, data: {
  matchId: number; amountJpy: number; amountUsdt: number; rate: number;
  bankName: string; branchName: string; accountNumber: string; accountName: string; timeoutAt: number;
}) => void) | null = null;

async function getBuyerNotifier() {
  if (!_notifyBuyerMatchCreated) {
    try {
      const telegramBot = await import('./telegramBot.js');
      _notifyBuyerMatchCreated = telegramBot.notifyBuyerMatchCreated;
    } catch { /* Telegram bot not available */ }
  }
  return _notifyBuyerMatchCreated;
}

const MATCH_INTERVAL_MS = 30_000; // 30秒
const TIMEOUT_MINUTES = 30;

let matchTimer: ReturnType<typeof setInterval> | null = null;

// In-memory queue of pending buyers (registered via API)
interface PendingBuyer {
  id: string;
  walletAddress: string;
  minAmountJpy: number;
  maxAmountJpy: number;
  registeredAt: number;
}

const pendingBuyers: Map<string, PendingBuyer> = new Map();

/**
 * 購入者を待機キューに追加（API経由）
 */
export function registerBuyer(buyer: PendingBuyer): void {
  pendingBuyers.set(buyer.id, buyer);
  dbInsertPendingBuyer(buyer);
  logger.info('TruPay buyer registered', { buyerId: buyer.id, min: buyer.minAmountJpy, max: buyer.maxAmountJpy });
  broadcast('trupay', { event: 'buyer_registered', buyerId: buyer.id });
  // 即座にマッチング試行
  runMatching();
}

/**
 * 購入者を待機キューから削除
 */
export function removeBuyer(buyerId: string): boolean {
  const deleted = pendingBuyers.delete(buyerId);
  dbDeletePendingBuyer(buyerId);
  if (deleted) broadcast('trupay', { event: 'buyer_removed', buyerId });
  return deleted;
}

/**
 * 待機中の購入者一覧
 */
export function getPendingBuyers(): PendingBuyer[] {
  return Array.from(pendingBuyers.values());
}

/**
 * 現在のUSDTレート（最良買値）を取得
 */
function getCurrentUsdtRate(): number | null {
  const rates = getCachedRates('USDT') as AggregatedRates;
  // bestBuyExchange = 最安の購入レート
  if (rates.bestBuyExchange?.price) return rates.bestBuyExchange.price;
  // fallback: 全レートの中央値
  const buyPrices = rates.rates
    .map(r => r.bestBuy)
    .filter((p): p is number => p !== null && p > 0);
  if (buyPrices.length === 0) return null;
  buyPrices.sort((a, b) => a - b);
  return buyPrices[Math.floor(buyPrices.length / 2)];
}

/**
 * DB → in-memory復元（起動時）
 */
function loadBuyersFromDb(): void {
  const rows = dbGetActivePendingBuyers();
  for (const r of rows) {
    pendingBuyers.set(r.id, {
      id: r.id,
      walletAddress: r.wallet_address,
      minAmountJpy: r.min_amount_jpy,
      maxAmountJpy: r.max_amount_jpy,
      registeredAt: r.registered_at,
    });
  }
  if (rows.length > 0) logger.info('TruPay matcher: loaded pending buyers from DB', { count: rows.length });
}

let matchingInProgress = false;

/**
 * マッチング実行（1回分）
 */
async function runMatching(): Promise<void> {
  if (!isEnabled()) return;
  if (matchingInProgress) return;
  matchingInProgress = true;
  try {
    const queued = getQueuedTruPayWithdrawals();
    if (queued.length === 0) return;

    const rate = getCurrentUsdtRate();
    if (!rate) {
      logger.warn('TruPay matcher: no USDT rate available');
      return;
    }

    for (const withdrawal of queued) {
      // 既にマッチ済みならスキップ
      const existingMatch = getTruPayMatchByWithdrawalId(withdrawal.id);
      if (existingMatch) continue;

      // 購入者を探す
      const buyer = findBuyerForWithdrawal(withdrawal);

      if (!buyer) {
        // マッチ相手なし → Telegram通知（初回のみ）
        notifyTruPayNewWithdrawal(withdrawal);
        continue;
      }

      // CAS: only match if still queued
      const claimed = db.prepare("UPDATE trupay_withdrawals SET status = 'matched', matched_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(Date.now(), Date.now(), withdrawal.id);
      if (claimed.changes === 0) continue; // already matched

      // マッチング成立
      const amountUsdt = parseFloat((withdrawal.amount_jpy / rate).toFixed(6));
      const timeoutAt = Date.now() + TIMEOUT_MINUTES * 60 * 1000;

      const matchId = insertTruPayMatch({
        withdrawal_id: withdrawal.id,
        buyer_id: buyer.id,
        buyer_wallet: buyer.walletAddress,
        rate_jpy_usdt: rate,
        amount_jpy: withdrawal.amount_jpy,
        amount_usdt: amountUsdt,
        timeout_at: timeoutAt,
      });

      // 購入者を待機キューから削除
      pendingBuyers.delete(buyer.id);
      dbDeletePendingBuyer(buyer.id);

      // Track referral conversion if buyer came from referral
      try {
        const { recordReferralConversion } = await import('./database.js');
        // Buyer ID format: web_ref_PMXXXXXXXX_xxxxx or includes ref code
        const refMatch = buyer.id.match(/ref_([A-Z0-9]+)/);
        if (refMatch) {
          recordReferralConversion(refMatch[1], buyer.id, matchId, withdrawal.amount_jpy);
          logger.info('Referral conversion recorded', { code: refMatch[1], matchId, amountJpy: withdrawal.amount_jpy });
        }
      } catch (e) { logger.debug('Referral tracking skipped', { error: e instanceof Error ? e.message : String(e) }); }

      logger.info('TruPay match created', {
        matchId,
        withdrawalId: withdrawal.id,
        buyerId: buyer.id,
        amountJpy: withdrawal.amount_jpy,
        amountUsdt,
        rate,
      });

      // スタッフ通知
      const matchData = {
        matchId,
        withdrawalId: withdrawal.trupay_id,
        transactionId: withdrawal.transaction_id,
        buyerId: buyer.id,
        amountJpy: withdrawal.amount_jpy,
        amountUsdt,
        rate,
        bankName: withdrawal.bank_name,
        branchName: withdrawal.branch_name,
        accountNumber: withdrawal.account_number,
        accountName: withdrawal.account_name,
        timeoutAt,
      };
      notifyTruPayMatchCreated(matchData);

      // 購入者に振込先を通知（Telegram）
      const notifyBuyer = await getBuyerNotifier();
      if (notifyBuyer) {
        try { notifyBuyer(buyer.id, matchData); } catch { /* ignore */ }
      }

      broadcast('trupay', {
        event: 'match_created',
        matchId,
        withdrawalId: withdrawal.id,
        buyerId: buyer.id,
        amountJpy: withdrawal.amount_jpy,
        amountUsdt,
      });
    }
  } catch (e) {
    logger.error('TruPay matching failed', { error: e instanceof Error ? e.message : String(e) });
  } finally {
    matchingInProgress = false;
  }
}

/**
 * 購入者を検索（金額範囲でマッチ）
 */
function findBuyerForWithdrawal(withdrawal: TruPayWithdrawalRow): PendingBuyer | null {
  for (const buyer of pendingBuyers.values()) {
    if (withdrawal.amount_jpy >= buyer.minAmountJpy && withdrawal.amount_jpy <= buyer.maxAmountJpy) {
      return buyer;
    }
  }
  return null;
}

/**
 * Periodic consistency check: sync in-memory pendingBuyers with DB.
 * Removes stale entries from memory and restores missing entries from DB.
 */
function syncBuyersWithDb(): void {
  const dbBuyers = dbGetActivePendingBuyers();
  const dbIds = new Set(dbBuyers.map(b => b.id));

  // Remove from memory if not in DB
  for (const [id] of pendingBuyers) {
    if (!dbIds.has(id)) {
      pendingBuyers.delete(id);
      logger.debug('Removed stale buyer from memory', { buyerId: id });
    }
  }

  // Add to memory if in DB but not in memory
  for (const r of dbBuyers) {
    if (!pendingBuyers.has(r.id)) {
      pendingBuyers.set(r.id, {
        id: r.id,
        walletAddress: r.wallet_address,
        minAmountJpy: r.min_amount_jpy,
        maxAmountJpy: r.max_amount_jpy,
        registeredAt: r.registered_at,
      });
      logger.debug('Restored buyer to memory from DB', { buyerId: r.id });
    }
  }
}

let syncTimer: ReturnType<typeof setInterval> | null = null;

export function startTruPayMatcher(): void {
  if (!isEnabled()) {
    logger.info('TruPay matcher disabled');
    return;
  }

  loadBuyersFromDb();
  matchTimer = setInterval(runMatching, MATCH_INTERVAL_MS);
  // Periodic DB sync every 5 minutes
  syncTimer = setInterval(syncBuyersWithDb, 5 * 60 * 1000);
  logger.info('TruPay matcher started', { intervalMs: MATCH_INTERVAL_MS });
}

export function stopTruPayMatcher(): void {
  if (matchTimer) {
    clearInterval(matchTimer);
    matchTimer = null;
  }
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  logger.info('TruPay matcher stopped');
}
