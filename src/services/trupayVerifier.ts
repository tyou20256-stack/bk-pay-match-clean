/**
 * @file trupayVerifier.ts — TruPay着金確認 + USDT送金サービス
 * @description マッチング中の出金について:
 *   方式A: TruPayポーリングで new_status=32（completed）を検知 → USDT送金
 *   方式B: 購入者が参照番号を入力 → POST /scrapper/match → USDT送金
 *   タイムアウト: 60分超過でマッチ解除 → 出金をキューに戻す
 */
import { getWithdrawal, confirmMatch, isEnabled } from './trupayClient.js';
import db from './database.js';
import {
  getActiveTruPayMatches,
  getTruPayMatch,
  updateTruPayMatchStatus,
  getTruPayWithdrawalById,
  updateTruPayWithdrawalStatus,
  TruPayMatchRow,
  TruPayWithdrawalRow,
  recordAuditLog,
} from './database.js';
import { sendUSDT } from './walletService.js';
import { broadcast } from './websocket.js';
import { notifyTruPayTransferConfirmed, notifyTruPayUsdtSent, notifyTruPayTimeout, notifyTruPaySendFailed } from './notifier.js';
import logger from './logger.js';

// Lazy import to avoid circular dependency
let _notifyBuyerUsdtSent: ((buyerId: string, matchId: number, amountUsdt: number, txHash: string) => void) | null = null;
async function getBuyerUsdtNotifier() {
  if (!_notifyBuyerUsdtSent) {
    try {
      const telegramBot = await import('./telegramBot.js');
      _notifyBuyerUsdtSent = telegramBot.notifyBuyerUsdtSent;
    } catch { /* ignore */ }
  }
  return _notifyBuyerUsdtSent;
}

const VERIFY_INTERVAL_MS = 60_000; // 1分
let verifyTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 着金確認ポーリング（方式A）
 */
async function checkCompletedWithdrawals(): Promise<void> {
  if (!isEnabled()) return;

  try {
    const activeMatches = getActiveTruPayMatches();

    for (const match of activeMatches) {
      // タイムアウトチェック
      if (match.timeout_at < Date.now()) {
        await handleTimeout(match);
        continue;
      }

      // waiting_transfer / buyer_paid / needs_review のみ着金確認
      if (!['waiting_transfer', 'buyer_paid', 'needs_review'].includes(match.status)) continue;

      // DBから対応するwithdrawalを取得（withdrawal_idは内部ID）
      // trupay_idを使ってTruPay APIで確認
      const withdrawal = getWithdrawalById(match.withdrawal_id);
      if (!withdrawal) {
        logger.warn('TruPay verifier: withdrawal not found', { matchId: match.id, withdrawalId: match.withdrawal_id });
        continue;
      }

      try {
        const trupayData = await getWithdrawal(withdrawal.trupay_id);

        if (trupayData.new_status === 32) {
          // completed → 着金確認 → USDT送金
          logger.info('TruPay withdrawal completed (auto-detect)', { trupayId: withdrawal.trupay_id, matchId: match.id });
          await handleTransferConfirmed(match, withdrawal);
        }
      } catch (e) {
        logger.error('TruPay verify check failed', {
          matchId: match.id,
          trupayId: withdrawal.trupay_id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } catch (e) {
    logger.error('TruPay verifier cycle failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

function getWithdrawalById(id: number): TruPayWithdrawalRow | undefined {
  return getTruPayWithdrawalById(id);
}

/**
 * 着金確認処理（自動 or 手動マッチング後に呼ばれる）
 */
async function handleTransferConfirmed(match: TruPayMatchRow, withdrawal: TruPayWithdrawalRow): Promise<void> {
  updateTruPayMatchStatus(match.id, 'transfer_confirmed');
  updateTruPayWithdrawalStatus(withdrawal.id, 'verifying', { trupay_status: 32 });

  notifyTruPayTransferConfirmed(match, withdrawal);
  broadcast('trupay', { event: 'transfer_confirmed', matchId: match.id });

  // USDT送金実行
  await sendUsdtForMatch(match, withdrawal);
}

/**
 * USDT送金実行
 */
async function sendUsdtForMatch(match: TruPayMatchRow, withdrawal: TruPayWithdrawalRow): Promise<void> {
  // Atomic claim — prevent double send
  const claimed = db.prepare("UPDATE trupay_matches SET status = 'sending_usdt', updated_at = ? WHERE id = ? AND status = 'transfer_confirmed'").run(Date.now(), match.id);
  if (claimed.changes === 0) {
    logger.warn('TruPay USDT send: match already claimed or not in transfer_confirmed', { matchId: match.id, currentStatus: match.status });
    return;
  }

  // TRON address validation
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(match.buyer_wallet)) {
    logger.error('TruPay USDT send: invalid wallet address', { matchId: match.id, wallet: match.buyer_wallet });
    updateTruPayMatchStatus(match.id, 'error', { usdt_tx_hash: 'INVALID_ADDRESS' });
    notifyTruPaySendFailed(match.id, 'Invalid TRON wallet address');
    return;
  }

  logger.info('TruPay USDT send starting', {
    matchId: match.id,
    amount: match.amount_usdt,
    wallet: match.buyer_wallet,
  });

  // Retry up to 3 times
  let result = { success: false, txId: '', error: 'No attempts made' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await sendUSDT(match.buyer_wallet, match.amount_usdt);
    if (res.success) {
      result = { success: true, txId: res.txId || '', error: '' };
      break;
    }
    result = { success: false, txId: '', error: res.error || 'Unknown error' };
    if (res.error?.includes('TRANSACTION_ALREADY_IN_BLOCK') || res.error?.includes('DUP_TRANSACTION_ERROR')) break;
    if (attempt < 3) {
      logger.warn('TruPay USDT send retry', { attempt, matchId: match.id, error: res.error });
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  if (result.success) {
    updateTruPayMatchStatus(match.id, 'usdt_sent', { usdt_tx_hash: result.txId });
    updateTruPayWithdrawalStatus(withdrawal.id, 'completed', { completed_at: Date.now() });

    updateTruPayMatchStatus(match.id, 'completed');

    notifyTruPayUsdtSent(match, result.txId);
    broadcast('trupay', { event: 'usdt_sent', matchId: match.id, txHash: result.txId });

    // 購入者にTelegram通知
    const notifyBuyer = await getBuyerUsdtNotifier();
    if (notifyBuyer) {
      try { notifyBuyer(match.buyer_id, match.id, match.amount_usdt, result.txId); } catch { /* ignore */ }
    }

    recordAuditLog({
      action: 'trupay_usdt_sent',
      targetType: 'trupay_match',
      targetId: String(match.id),
      details: JSON.stringify({
        amount_usdt: match.amount_usdt,
        buyer_wallet: match.buyer_wallet,
        tx_hash: result.txId,
        amount_jpy: match.amount_jpy,
      }),
    });

    logger.info('TruPay USDT sent successfully', {
      matchId: match.id,
      txHash: result.txId,
      amount: match.amount_usdt,
    });
  } else {
    updateTruPayMatchStatus(match.id, 'error');
    notifyTruPaySendFailed(match.id, result.error);

    recordAuditLog({
      action: 'trupay_usdt_send_failed',
      targetType: 'trupay_match',
      targetId: String(match.id),
      details: JSON.stringify({ error: result.error, amount_usdt: match.amount_usdt }),
    });

    logger.error('TruPay USDT send failed', { matchId: match.id, error: result.error });
  }
}

/**
 * タイムアウト処理
 */
async function handleTimeout(match: TruPayMatchRow): Promise<void> {
  updateTruPayMatchStatus(match.id, 'timeout');

  // 出金をキューに戻す
  updateTruPayWithdrawalStatus(match.withdrawal_id, 'queued');

  notifyTruPayTimeout(match);
  broadcast('trupay', { event: 'timeout', matchId: match.id });

  logger.info('TruPay match timeout', { matchId: match.id, withdrawalId: match.withdrawal_id });
}

/**
 * 手動着金確認（方式B: 購入者が参照番号を入力）
 */
export async function manualConfirm(matchId: number, referenceNumber: string): Promise<{ success: boolean; error?: string }> {
  const match = getTruPayMatch(matchId);
  if (!match) return { success: false, error: 'Match not found' };
  if (match.status !== 'waiting_transfer') return { success: false, error: `Invalid status: ${match.status}` };

  const withdrawal = getWithdrawalById(match.withdrawal_id);
  if (!withdrawal) return { success: false, error: 'Withdrawal not found' };

  // TruPay scrapper/match API呼び出し
  try {
    const res = await confirmMatch({
      id: withdrawal.trupay_id,
      reference_number: referenceNumber,
      notes: `P2P match ID: ${matchId}`,
    });

    if (res.success) {
      updateTruPayMatchStatus(matchId, 'transfer_confirmed', { reference_number: referenceNumber });
      await handleTransferConfirmed(match, withdrawal);
      return { success: true };
    }
    return { success: false, error: 'TruPay scrapper/match returned failure' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 管理者による手動着金確認（TruPay APIを叩かずに直接確認）
 */
export async function adminConfirm(matchId: number): Promise<{ success: boolean; error?: string }> {
  const match = getTruPayMatch(matchId);
  if (!match) return { success: false, error: 'Match not found' };
  if (match.status !== 'waiting_transfer') return { success: false, error: `Invalid status: ${match.status}` };

  const withdrawal = getWithdrawalById(match.withdrawal_id);
  if (!withdrawal) return { success: false, error: 'Withdrawal not found' };

  await handleTransferConfirmed(match, withdrawal);
  return { success: true };
}

export function startTruPayVerifier(): void {
  if (!isEnabled()) {
    logger.info('TruPay verifier disabled');
    return;
  }

  verifyTimer = setInterval(checkCompletedWithdrawals, VERIFY_INTERVAL_MS);
  logger.info('TruPay verifier started', { intervalMs: VERIFY_INTERVAL_MS });
}

export function stopTruPayVerifier(): void {
  if (verifyTimer) {
    clearInterval(verifyTimer);
    verifyTimer = null;
    logger.info('TruPay verifier stopped');
  }
}
