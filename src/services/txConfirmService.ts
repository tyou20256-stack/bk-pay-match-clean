/**
 * @file txConfirmService.ts — トランザクション確認ポーリング
 * @description ブロードキャスト済みのTRON TRC-20トランザクションをポーリングし、
 *   オンチェーンでの確認状態を追跡する。未確認TXを定期的にチェックし、
 *   確認済み/失敗を検知してDBとWebSocketに反映する。
 */
import logger from './logger.js';
import * as dbSvc from './database.js';
import { broadcast } from './websocket.js';
import notifier from './notifier.js';

const TRONGRID_API = 'https://api.trongrid.io';
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes — give up after this
// TRON finality: 19 blocks ≈ 57 seconds. Kept here for reference even
// though the current implementation infers confirmed-ness from blockNumber
// being set (any block on TRON is irreversible once included in a super
// representative block).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const REQUIRED_CONFIRMATIONS = 19;

let pollTimer: ReturnType<typeof setInterval> | null = null;

interface TronTxInfo {
  id: string;
  blockNumber?: number;
  blockTimeStamp?: number;
  receipt?: { result?: string };
  ret?: Array<{ contractRet?: string; fee?: number }>;
}

/**
 * Query TronGrid for transaction info by txId.
 * Returns null if not found or not yet indexed.
 */
async function getTxInfo(txId: string): Promise<TronTxInfo | null> {
  const apiKey = process.env.TRONGRID_API_KEY || '';
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

  try {
    const res = await fetch(`${TRONGRID_API}/wallet/gettransactioninfobyid`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: txId }),
    });
    if (!res.ok) return null;
    const data = await res.json() as TronTxInfo;
    // Empty response means tx not found yet
    if (!data || !data.id) return null;
    return data;
  } catch (e: unknown) {
    logger.warn('TronGrid TX info fetch failed', {
      txId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Check confirmation status of a single transaction.
 * Returns: 'confirmed' | 'failed' | 'pending'
 */
async function checkTxConfirmation(txId: string): Promise<'confirmed' | 'failed' | 'pending'> {
  const info = await getTxInfo(txId);
  if (!info) return 'pending'; // Not indexed yet

  // Check if the smart contract execution succeeded
  const contractResult = info.ret?.[0]?.contractRet;
  if (contractResult === 'SUCCESS') {
    // Check block confirmations
    if (info.blockNumber) {
      return 'confirmed';
    }
    return 'pending';
  }

  // Explicitly failed
  if (contractResult === 'REVERT' || contractResult === 'OUT_OF_ENERGY' || contractResult === 'FAILED') {
    return 'failed';
  }

  return 'pending';
}

/**
 * Poll all unconfirmed transactions and update their status.
 */
async function pollUnconfirmed(): Promise<void> {
  const unconfirmed = dbSvc.getUnconfirmedTransactions();
  if (unconfirmed.length === 0) return;

  logger.debug('Checking unconfirmed transactions', { count: unconfirmed.length });

  for (const tx of unconfirmed) {
    // Skip transactions older than MAX_AGE_MS — mark as failed
    const age = Date.now() - tx.created_at;
    if (age > MAX_AGE_MS) {
      logger.warn('Transaction confirmation timed out', {
        txId: tx.tx_id,
        orderId: tx.order_id,
        ageMinutes: Math.round(age / 60_000),
      });
      dbSvc.updateCryptoTransactionStatus(tx.tx_id, 'timeout');
      notifier.notifySendFailed(tx.order_id, `TX confirmation timeout after ${Math.round(age / 60_000)} minutes: ${tx.tx_id}`);
      broadcast('tx_status', { txId: tx.tx_id, orderId: tx.order_id, status: 'timeout' });
      continue;
    }

    const status = await checkTxConfirmation(tx.tx_id);

    if (status === 'confirmed') {
      dbSvc.updateCryptoTransactionStatus(tx.tx_id, 'confirmed', Date.now());
      logger.info('Transaction confirmed on-chain', {
        txId: tx.tx_id,
        orderId: tx.order_id,
        confirmTimeMs: Date.now() - tx.created_at,
      });
      broadcast('tx_status', { txId: tx.tx_id, orderId: tx.order_id, status: 'confirmed' });
    } else if (status === 'failed') {
      dbSvc.updateCryptoTransactionStatus(tx.tx_id, 'chain_failed');
      logger.error('Transaction failed on-chain', {
        txId: tx.tx_id,
        orderId: tx.order_id,
      });
      notifier.notifySendFailed(tx.order_id, `Transaction failed on-chain: ${tx.tx_id}`);
      broadcast('tx_status', { txId: tx.tx_id, orderId: tx.order_id, status: 'chain_failed' });
    }
    // 'pending' — do nothing, will check again next interval
  }
}

/** Start the TX confirmation polling service */
export function startTxConfirmPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    pollUnconfirmed().catch(e =>
      logger.error('TX confirm poll error', { error: e instanceof Error ? e.message : String(e) })
    );
  }, POLL_INTERVAL_MS);
  logger.info('TX confirmation polling started', { intervalMs: POLL_INTERVAL_MS });
}

/** Stop the TX confirmation polling service */
export function stopTxConfirmPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
