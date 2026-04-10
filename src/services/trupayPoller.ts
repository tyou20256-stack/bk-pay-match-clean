/**
 * @file trupayPoller.ts — TruPayポーリングワーカー
 * @description 1分間隔でTruPay APIから承認済み出金（new_status=31）を取得し、
 *   未登録のものをDBキューに追加する。
 */
import { getApprovedWithdrawals, getWithdrawal, isEnabled } from './trupayClient.js';
import { insertTruPayWithdrawal, getTruPayWithdrawalByTruPayId, getQueuedTruPayWithdrawals, updateTruPayWithdrawalStatus, expireOldQueuedWithdrawals, dbExpireOldPendingBuyers } from './database.js';
import { broadcast } from './websocket.js';
import logger from './logger.js';

const POLL_INTERVAL_MS = 60_000; // 1分
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function pollWithdrawals(): Promise<void> {
  if (!isEnabled()) return;

  try {
    const withdrawals = await getApprovedWithdrawals();
    let newCount = 0;

    for (const w of withdrawals) {
      const exists = getTruPayWithdrawalByTruPayId(w.id);
      if (exists) continue;

      const inserted = insertTruPayWithdrawal({
        trupay_id: w.id,
        system_transaction_id: w.system_transaction_id,
        transaction_id: w.transaction_id,
        amount_jpy: w.amount,
        bank_name: w.bank_name,
        branch_name: w.branch_name || '',
        account_number: w.account_number,
        account_name: w.account_name,
        account_type: w.account_type || 'savings',
      });

      if (inserted > 0) {
        newCount++;
        logger.info('TruPay withdrawal queued', {
          trupay_id: w.id,
          amount: w.amount,
          bank: w.bank_name,
        });
      }
    }

    if (newCount > 0) {
      broadcast('trupay', { event: 'new_withdrawals', count: newCount });
      logger.info('TruPay poll: new withdrawals queued', { count: newCount, total: withdrawals.length });
    }

    // Expire old queued withdrawals (>48h)
    const expired = expireOldQueuedWithdrawals();
    if (expired > 0) {
      logger.info('TruPay: expired old queued withdrawals', { count: expired });
    }

    // Expire old pending buyers (>24h)
    const expiredBuyers = dbExpireOldPendingBuyers();
    if (expiredBuyers > 0) {
      logger.info('TruPay: expired old pending buyers', { count: expiredBuyers });
    }

    // Re-validate queued withdrawals against TruPay status
    // Check up to 10 per cycle to avoid rate limiting
    await revalidateQueuedWithdrawals();
  } catch (e) {
    logger.error('TruPay poll failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * キュー内のqueuedをTruPay APIで再検証
 * approved(31)以外 → 該当ステータスに更新
 */
const REVALIDATE_BATCH = 10; // 1サイクルあたり最大チェック数
let revalidateOffset = 0;

async function revalidateQueuedWithdrawals(): Promise<void> {
  try {
    const queued = getQueuedTruPayWithdrawals();
    if (queued.length === 0) { revalidateOffset = 0; return; }

    // ラウンドロビンで少しずつ確認
    const batch = queued.slice(revalidateOffset, revalidateOffset + REVALIDATE_BATCH);
    revalidateOffset = (revalidateOffset + REVALIDATE_BATCH >= queued.length) ? 0 : revalidateOffset + REVALIDATE_BATCH;

    let removedCount = 0;
    for (const w of batch) {
      try {
        const trupayData = await getWithdrawal(w.trupay_id);

        if (trupayData.new_status !== 31) {
          // approved以外 → ステータス更新
          const statusMap: Record<number, string> = {
            32: 'completed_external', // TruPay側で完了（別ルートで処理された）
            33: 'declined',           // 却下
            34: 'cancelled',          // キャンセル
          };
          const newStatus = statusMap[trupayData.new_status] || 'removed';
          updateTruPayWithdrawalStatus(w.id, newStatus, { trupay_status: trupayData.new_status });
          removedCount++;
          logger.info('TruPay queued withdrawal invalidated', {
            id: w.id,
            trupay_id: w.trupay_id,
            oldStatus: 'queued',
            newStatus,
            trupayStatus: trupayData.new_status,
          });
        }
      } catch (e) {
        // API error for single item — skip, will retry next cycle
      }
    }

    if (removedCount > 0) {
      logger.info('TruPay: revalidated queued withdrawals', { checked: batch.length, removed: removedCount });
    }
  } catch (e) {
    logger.error('TruPay revalidation failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

export function startTruPayPoller(): void {
  if (!isEnabled()) {
    logger.info('TruPay poller disabled (ENABLE_TRUPAY != true or TRUPAY_JWT not set)');
    return;
  }

  // Initial poll
  pollWithdrawals();

  pollTimer = setInterval(pollWithdrawals, POLL_INTERVAL_MS);
  logger.info('TruPay poller started', { intervalMs: POLL_INTERVAL_MS });
}

export function stopTruPayPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('TruPay poller stopped');
  }
}

export { pollWithdrawals };
