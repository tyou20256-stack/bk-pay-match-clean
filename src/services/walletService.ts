/**
 * @file walletService.ts — USDT送金サービス
 * @description TronWeb を使用して USDT (TRC-20) を顧客ウォレットに送金する。
 *   秘密鍵は環境変数 TRON_WALLET_PRIVATE_KEY から取得。
 *   送金履歴は SQLite に記録し、トランザクション追跡を行う。
 */
import * as dbSvc from './database.js';
import { recordAuditLog } from './database.js';
import notifier from './notifier.js';
import { broadcast } from './websocket.js';
import logger from './logger.js';
import { CircuitBreaker } from './circuitBreaker.js';

// Circuit breaker for TronWeb API calls (TronGrid)
export const tronCircuitBreaker = new CircuitBreaker({
  name: 'TronWeb',
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMax: 1,
});

const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // TRC-20 USDT
const TRONGRID_API = 'https://api.trongrid.io';

// Lazy-load TronWeb to avoid crash if not installed or key not set
// TronWeb has no @types — use structural type
interface TronWebInstance {
  defaultAddress: { base58: string };
  isAddress(address: string): boolean;
  contract(): { at(address: string): Promise<{ methods: Record<string, (...args: unknown[]) => { send(opts: Record<string, unknown>): Promise<unknown>; call(): Promise<unknown> } > }> };
  trx: { getBalance(address: string): Promise<number> };
}

// Simple blacklist cache: address → { blacklisted, expiresAt }
// TTL 5 minutes per Blockchain Security Auditor recommendation
const blacklistCache = new Map<string, { blacklisted: boolean; expiresAt: number }>();
const BLACKLIST_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Check if an address is on the Tether USDT TRC-20 blacklist.
 * Queries the USDT contract's `isBlackListed(address)` method.
 * Results cached for 5 minutes.
 * Returns true if blacklisted (REJECT), false if clean, or false on error (fail-open).
 * We log errors but do not block on them — better to occasionally let a send through
 * than to halt the entire service if TronGrid is flaky.
 */
export async function isAddressBlacklisted(address: string): Promise<boolean> {
  const now = Date.now();
  const cached = blacklistCache.get(address);
  if (cached && cached.expiresAt > now) {
    return cached.blacklisted;
  }

  const tronWeb = getTronWeb();
  if (!tronWeb) return false; // fail-open when wallet not configured

  try {
    return await tronCircuitBreaker.execute(async () => {
      const contract = await tronWeb.contract().at(USDT_CONTRACT);
      const result = await contract.methods.isBlackListed(address).call();
      // Tron returns booleans as-is or wrapped; normalize
      const blacklisted = Boolean(result && (result === true || (result as unknown as { _isTrue?: boolean })._isTrue === true));
      blacklistCache.set(address, { blacklisted, expiresAt: now + BLACKLIST_CACHE_TTL_MS });
      if (blacklisted) {
        logger.warn('Blacklisted address detected', { address });
      }
      return blacklisted;
    });
  } catch (e: unknown) {
    logger.error('Blacklist check failed (fail-open)', { address, error: e instanceof Error ? e.message : String(e) });
    return false; // fail-open on RPC errors
  }
}

let tronWebInstance: TronWebInstance | null = null;

function getTronWeb(): TronWebInstance | null {
  if (tronWebInstance) return tronWebInstance;

  // Check env first, then DB (admin UI setting)
  let privateKey = process.env.TRON_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    try {
      // Lazy require to avoid circular dependency with database.ts
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSystemConfig } = require('./database.js');
      privateKey = getSystemConfig('TRON_WALLET_PRIVATE_KEY');
    } catch { /* DB not ready yet */ }
  }
  if (!privateKey) {
    logger.warn('TRON_WALLET_PRIVATE_KEY not set — sending disabled');
    return null;
  }

  try {
    // Dynamic import workaround for CommonJS compat (tronweb has both
    // ESM `default` and CJS root exports depending on bundler).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TronWeb = require('tronweb').default || require('tronweb');
    const instance: TronWebInstance = new TronWeb({
      fullHost: TRONGRID_API,
      headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY || '' },
      privateKey,
    });
    tronWebInstance = instance;
    logger.info('TronWeb initialized', { address: instance.defaultAddress?.base58 || 'unknown' });
    return tronWebInstance;
  } catch (e: unknown) {
    logger.error('TronWeb init failed', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export interface SendResult {
  success: boolean;
  txId?: string;
  error?: string;
}

/**
 * Send USDT (TRC-20) to a customer address
 */
export async function sendUSDT(toAddress: string, amount: number): Promise<SendResult> {
  const tronWeb = getTronWeb();
  if (!tronWeb) {
    return { success: false, error: 'Wallet not configured (TRON_WALLET_PRIVATE_KEY not set)' };
  }

  // Validate address
  if (!tronWeb.isAddress(toAddress)) {
    return { success: false, error: `Invalid TRON address: ${toAddress}` };
  }

  // Tether USDT blacklist pre-check (2026 Blockchain Security Auditor recommendation)
  // Prevents sending to an address frozen by Tether, which would permanently lock the USDT
  // while the JPY side of the trade has already settled.
  if (await isAddressBlacklisted(toAddress)) {
    logger.error('Send blocked: recipient on Tether USDT blacklist', { toAddress, amount });
    return { success: false, error: 'Recipient address is on the Tether USDT blacklist and cannot receive USDT' };
  }

  // Amount validation
  const MAX_SINGLE_SEND_USDT = 50000; // Hard limit: 50,000 USDT per transaction
  if (amount <= 0) {
    return { success: false, error: `Invalid amount: ${amount}` };
  }
  if (amount > MAX_SINGLE_SEND_USDT) {
    return { success: false, error: `Amount ${amount} exceeds max single send limit (${MAX_SINGLE_SEND_USDT} USDT)` };
  }
  // Use integer arithmetic to avoid floating-point precision issues
  // USDT has 6 decimals
  const amountStr = amount.toFixed(6);
  const [whole, frac] = amountStr.split('.');
  const amountSun = parseInt(whole, 10) * 1e6 + parseInt(frac, 10);
  if (amountSun <= 0) {
    return { success: false, error: `Invalid amount after conversion: ${amount}` };
  }

  try {
    return await tronCircuitBreaker.execute(async () => {
      // Get USDT contract instance
      const contract = await tronWeb.contract().at(USDT_CONTRACT);

      // Execute transfer
      // feeLimit tightened from 100 TRX → 20 TRX (Blockchain Security Auditor rec).
      // USDT transfers typically need ~13 TRX for first-time recipients and ~6.5 TRX for repeats
      // at 2026 energy prices. 20 TRX gives a ~50% buffer for energy price spikes without
      // exposing us to the "runaway fee_limit" failure mode documented in the audit.
      const tx = await contract.methods.transfer(toAddress, amountSun).send({
        feeLimit: 20_000_000, // 20 TRX max fee (was 100)
        shouldPollResponse: false,
      });

      const txObj = tx as string | { txid?: string; transaction?: { txID?: string } } | null;
      const txId = typeof txObj === 'string' ? txObj : txObj?.txid || txObj?.transaction?.txID || '';

      logger.info('USDT sent', { amount, toAddress, txId });

      return { success: true, txId } as SendResult;
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : 'Transfer failed';
    logger.error('Send failed', { error: errMsg });
    return { success: false, error: errMsg };
  }
}

/**
 * Enqueue a USDT send via BullMQ and synchronously wait for the result.
 *
 * This wraps the sync `sendUSDT` path when the queue flag is off, or
 * enqueues a BullMQ job and awaits its completion (via
 * `job.waitUntilFinished`) when the flag is on. Either way, the caller
 * gets back a `{ success, txId, error }` shape identical to `sendUSDT`,
 * so existing retry loops and DB recording logic (e.g. in
 * `processCryptoSend` and `trupayVerifier.sendUsdtForMatch`) keep working
 * unchanged.
 *
 * Why sync-wait on the queue? The order/TruPay flows immediately record
 * the txId in SQLite on success and then transition to the next state.
 * Returning `{ queued: true }` without a txId would require a full async
 * refactor of the order state machine, which is a Phase 2 project.
 * Waiting keeps the migration incremental: Phase 1b runs the worker
 * in-process with no observable latency difference; Phase 1c (signer
 * container) adds a Redis round-trip (~5-50 ms on localhost).
 *
 * @param opts.idempotencyKey — used as the BullMQ jobId. If a previous
 *   send with the same key is still in the queue, BullMQ returns the
 *   existing job instead of creating a duplicate. Critical for
 *   at-least-once delivery from the order flow to prevent double-sends.
 * @param opts.timeoutMs — hard timeout to wait for the job. Defaults to
 *   60s. On timeout, returns `{ success: false, error: 'queue timeout' }`
 *   without cancelling the job (it may still complete eventually — the
 *   caller's retry logic and the DB-backed order state prevent double
 *   processing).
 */
export async function enqueueOrSendUSDT(
  toAddress: string,
  amount: number,
  opts: { orderId?: string; idempotencyKey?: string; timeoutMs?: number } = {}
): Promise<SendResult> {
  // Lazy import to avoid pulling bullmq/ioredis into code paths where
  // the queue is disabled (e.g. unit tests that don't need Redis).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const queues = require('../queues/index.js') as typeof import('../queues/index.js');

  if (!queues.isJobQueueEnabled()) {
    // Legacy synchronous path — unchanged behavior.
    return sendUSDT(toAddress, amount);
  }

  const queue = queues.getUsdtSendQueue();
  if (!queue) {
    logger.warn('Queue enabled but getUsdtSendQueue returned null, falling back to sync');
    return sendUSDT(toAddress, amount);
  }

  const timeoutMs = opts.timeoutMs ?? 60_000;
  try {
    const jobId = opts.idempotencyKey || `${toAddress}-${amount}-${Date.now()}`;
    const job = await queue.add(
      'send',
      { toAddress, amount, orderId: opts.orderId, idempotencyKey: opts.idempotencyKey },
      { jobId }
    );
    logger.info('USDT send enqueued, awaiting result', { jobId: job.id, toAddress, amount, orderId: opts.orderId });

    // Wait for the worker (either in-process or in the signer container)
    // to finish. `waitUntilFinished` needs a QueueEvents listener — get
    // the one already started by startQueueEventMonitoring() at boot.
    const queueEvents = queues.getUsdtSendQueueEvents();
    if (!queueEvents) {
      logger.warn('QueueEvents not available, falling back to sync sendUSDT');
      return sendUSDT(toAddress, amount);
    }

    const result = await Promise.race([
      job.waitUntilFinished(queueEvents),
      new Promise<SendResult>((_, reject) =>
        setTimeout(() => reject(new Error('queue timeout')), timeoutMs)
      ),
    ]);

    logger.info('USDT send queue result', { jobId: job.id, success: result.success });
    return result as SendResult;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : 'Enqueue failed';
    logger.error('USDT send via queue failed, falling back to sync', { error: errMsg, orderId: opts.orderId });
    // Fall back to sync on queue errors so orders don't silently stall.
    // The atomic `claimOrderForSending` upstream already prevents double
    // processing, so falling back is safe even if the job was already
    // picked up by a worker — one of the two will fail with `DUP_TX`.
    return sendUSDT(toAddress, amount);
  }
}

/**
 * Get wallet TRX balance (for fee estimation)
 */
export async function getWalletBalance(): Promise<{ trx: number; usdt: number } | null> {
  const tronWeb = getTronWeb();
  if (!tronWeb) return null;

  try {
    return await tronCircuitBreaker.execute(async () => {
      const address = tronWeb!.defaultAddress.base58;

      // TRX balance
      const trxBalance = await tronWeb!.trx.getBalance(address);
      const trx = trxBalance / 1e6;

      // USDT balance
      const contract = await tronWeb!.contract().at(USDT_CONTRACT);
      const usdtBalance = await contract.methods.balanceOf(address).call();
      const usdt = Number(usdtBalance) / 1e6;

      return { trx, usdt };
    });
  } catch (e: unknown) {
    logger.error('Balance check failed', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Check if wallet is configured and ready
 */
export function isWalletReady(): boolean {
  if (process.env.TRON_WALLET_PRIVATE_KEY) return true;
  try {
    // Lazy require to avoid circular dependency with database.ts
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSystemConfig } = require('./database.js');
    return !!getSystemConfig('TRON_WALLET_PRIVATE_KEY');
  } catch { return false; }
}

/**
 * Get the sending wallet address
 */
export function getSendingAddress(): string | null {
  const tronWeb = getTronWeb();
  return tronWeb?.defaultAddress?.base58 || null;
}

// === Hot/Cold Wallet Sweep ===

export interface SweepStatus {
  shouldSweep: boolean;
  currentBalance: number;
  excessAmount: number;
  coldAddress: string;
  sweepAlertThreshold: number;
  hotWalletMax: number;
  minHotBalance: number;
}

/**
 * Check hot wallet balance against thresholds and alert if sweep is needed.
 * Returns sweep suggestion with current status.
 */
export async function checkAndAlertSweep(): Promise<SweepStatus | null> {
  const balance = await getWalletBalance();
  if (!balance) return null;

  const thresholds = dbSvc.getWalletThresholds();
  const sweepAlertThreshold = parseFloat(thresholds.sweep_alert_threshold || '8000');
  const hotWalletMax = parseFloat(thresholds.hot_wallet_max || '10000');
  const minHotBalance = parseFloat(thresholds.min_hot_balance || '500');
  const coldAddress = thresholds.cold_wallet_address || '';

  const currentBalance = balance.usdt;
  const shouldSweep = currentBalance > sweepAlertThreshold;
  const excessAmount = shouldSweep ? currentBalance - minHotBalance : 0;

  if (shouldSweep) {
    logger.warn('SWEEP ALERT: Hot wallet balance exceeds threshold', { currentBalance, sweepAlertThreshold, excessAmount });
    // Notify via Telegram
    notifier.notifySweepAlert(currentBalance, sweepAlertThreshold, excessAmount, coldAddress);
  }

  return { shouldSweep, currentBalance, excessAmount, coldAddress, sweepAlertThreshold, hotWalletMax, minHotBalance };
}

/**
 * Sweep excess USDT from hot wallet to cold wallet.
 * Validates cold wallet address and transfers the specified amount.
 */
export async function sweepToColdWallet(amount?: number): Promise<SendResult> {
  const thresholds = dbSvc.getWalletThresholds();
  const coldAddress = thresholds.cold_wallet_address || '';

  if (!coldAddress) {
    return { success: false, error: 'Cold wallet address not configured' };
  }

  // Validate TRON address format
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(coldAddress)) {
    return { success: false, error: `Invalid cold wallet TRON address: ${coldAddress}` };
  }

  const balance = await getWalletBalance();
  if (!balance) {
    return { success: false, error: 'Cannot check wallet balance' };
  }

  const minHotBalance = parseFloat(thresholds.min_hot_balance || '500');
  const maxSweepable = balance.usdt - minHotBalance;

  if (maxSweepable <= 0) {
    return { success: false, error: `Balance ${balance.usdt.toFixed(2)} USDT is at or below min_hot_balance (${minHotBalance} USDT)` };
  }

  const sweepAmount = amount ? Math.min(amount, maxSweepable) : maxSweepable;

  if (sweepAmount <= 0) {
    return { success: false, error: 'Sweep amount must be positive' };
  }

  logger.info('Sweeping to cold wallet', { sweepAmount, coldAddress });

  const result = await sendUSDT(coldAddress, sweepAmount);

  if (result.success) {
    logger.info('Sweep completed', { sweepAmount, coldAddress, txId: result.txId });
    notifier.notifySweepCompleted(sweepAmount, coldAddress, result.txId || '');
  } else {
    logger.error('Sweep failed', { error: result.error });
  }

  return result;
}

/**
 * Process crypto sending for a verified order
 * Called after admin confirms payment received.
 * Uses a lock set to prevent double-send from concurrent calls.
 */
const sendingLock = new Set<string>();

/** Returns number of currently in-flight sends */
export function getInflightSendCount(): number {
  return sendingLock.size;
}

/** Wait for all in-flight sends to complete (for graceful shutdown) */
export function waitForInflightSends(timeoutMs = 30_000): Promise<void> {
  if (sendingLock.size === 0) return Promise.resolve();
  logger.info('Waiting for in-flight crypto sends to complete', { count: sendingLock.size });
  return new Promise((resolve) => {
    const start = Date.now();
    const check = setInterval(() => {
      if (sendingLock.size === 0 || Date.now() - start > timeoutMs) {
        clearInterval(check);
        if (sendingLock.size > 0) {
          logger.warn('Shutdown timeout: in-flight sends still pending', { count: sendingLock.size });
        } else {
          logger.info('All in-flight crypto sends completed');
        }
        resolve();
      }
    }, 500);
  });
}

export async function processCryptoSend(orderId: string): Promise<SendResult> {
  // Prevent double-send via concurrent calls
  if (sendingLock.has(orderId)) {
    return { success: false, error: 'Send already in progress for this order' };
  }
  sendingLock.add(orderId);

  try {
    return await _doProcessCryptoSend(orderId);
  } finally {
    sendingLock.delete(orderId);
  }
}

async function _doProcessCryptoSend(orderId: string): Promise<SendResult> {
  const order = dbSvc.getOrder(orderId);
  if (!order) return { success: false, error: 'Order not found' };

  const customerAddr = order.customerWalletAddress;
  if (!customerAddr) {
    return { success: false, error: 'Customer wallet address not set' };
  }

  // Validate TRON address format before sending
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(customerAddr)) {
    return { success: false, error: 'Invalid TRON address format' };
  }

  // Pre-send wallet balance check (skip if wallet not configured)
  const walletBal = await getWalletBalance();
  if (walletBal !== null && walletBal.usdt < order.cryptoAmount) {
    return {
      success: false,
      error: `ウォレット残高不足: ${walletBal.usdt.toFixed(2)} USDT < ${order.cryptoAmount} USDT`,
    };
  }

  // Atomically claim the order: only succeeds if status is still 'payment_verified'.
  // This prevents double-send even across multiple server instances or concurrent requests.
  const claimed = dbSvc.claimOrderForSending(orderId);
  if (!claimed) {
    const current = dbSvc.getOrder(orderId);
    return { success: false, error: `Cannot claim order — current status: ${current?.status ?? 'unknown'}` };
  }

  broadcast('order', { id: orderId, status: 'sending_crypto' });

  // Audit: crypto send initiated
  recordAuditLog({
    action: 'crypto_send_initiated',
    targetType: 'order',
    targetId: orderId,
    details: JSON.stringify({ crypto: order.crypto, amount: order.cryptoAmount, toAddress: customerAddr }),
  });

  // Send USDT with retry (3 attempts, exponential backoff).
  // Routes through enqueueOrSendUSDT so that when ENABLE_JOB_QUEUE=true
  // the send runs in a worker (in-process or signer container) — the
  // idempotencyKey is the orderId, so retrying the same order never
  // produces two on-chain transactions.
  let result: SendResult = { success: false, error: 'No attempts made' };
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await enqueueOrSendUSDT(customerAddr, order.cryptoAmount, {
      orderId,
      idempotencyKey: `order-${orderId}`,
    });
    if (result.success) {
      break;
    }
    // If error contains txId hint (transaction was broadcast but status unknown), don't retry
    if (result.error?.includes('TRANSACTION_ALREADY_IN_BLOCK') || result.error?.includes('DUP_TRANSACTION_ERROR')) {
      logger.warn('Transaction may already be broadcast, stopping retry', { orderId });
      break;
    }
    if (attempt < 3) {
      logger.warn('Retrying send', { attempt, maxAttempts: 3, orderId, error: result.error });
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }

  if (result.success) {
    // Record transaction
    dbSvc.recordCryptoTransaction(orderId, {
      txId: result.txId!,
      crypto: order.crypto,
      amount: order.cryptoAmount,
      toAddress: customerAddr,
      status: 'sent',
    });

    // Record TRON gas cost for this order
    try {
      const costConfig = dbSvc.getCostConfig();
      dbSvc.recordTransactionCost(orderId, 'tron_gas', costConfig.tron_gas_jpy, 'TRON TRC-20 transfer gas fee');
    } catch (e) {
      logger.warn('Failed to record gas cost', { orderId, error: e instanceof Error ? e.message : String(e) });
    }

    // Complete order
    const completedAt = Date.now();
    dbSvc.updateOrderStatus(orderId, 'completed', { completedAt, txId: result.txId });
    broadcast('order', { id: orderId, status: 'completed', txId: result.txId });

    // Notify
    notifier.notifyCompleted({ ...order, status: 'completed', completedAt, txId: result.txId });

    logger.info('Order completed', { orderId, txId: result.txId });

    // Audit: crypto send succeeded
    recordAuditLog({
      action: 'crypto_send_success',
      targetType: 'order',
      targetId: orderId,
      details: JSON.stringify({ txId: result.txId, crypto: order.crypto, amount: order.cryptoAmount, toAddress: customerAddr }),
    });

    // Non-blocking: check if hot wallet needs sweeping after send
    checkAndAlertSweep().catch(e =>
      logger.error('Sweep check failed (non-blocking)', { error: e.message || String(e) })
    );

    return result;
  } else {
    // Revert to payment_verified so admin can retry
    dbSvc.updateOrderStatus(orderId, 'payment_verified');
    broadcast('order', { id: orderId, status: 'payment_verified', error: result.error });

    // Audit: crypto send failed
    recordAuditLog({
      action: 'crypto_send_failed',
      targetType: 'order',
      targetId: orderId,
      details: JSON.stringify({ error: result.error, crypto: order.crypto, amount: order.cryptoAmount, toAddress: customerAddr }),
    });

    notifier.notifySendFailed(orderId, result.error || 'Unknown error');
    return result;
  }
}

// === Auto-sweep cron (runs every 5 minutes) ===
let autoSweepTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoSweep(): void {
  if (autoSweepTimer) return;
  const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  autoSweepTimer = setInterval(async () => {
    try {
      const status = await checkAndAlertSweep();
      if (!status || !status.shouldSweep) return;
      // Auto-sweep if balance exceeds hot_wallet_max (not just alert threshold)
      if (status.currentBalance > status.hotWalletMax && status.coldAddress) {
        logger.info('Auto-sweep triggered', { currentBalance: status.currentBalance, hotWalletMax: status.hotWalletMax });
        await sweepToColdWallet();
      }
    } catch (e: unknown) {
      logger.error('Auto-sweep check failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }, INTERVAL_MS);
  logger.info('Auto-sweep started', { intervalMin: 5 });
}

export function stopAutoSweep(): void {
  if (autoSweepTimer) { clearInterval(autoSweepTimer); autoSweepTimer = null; }
}

export default { sendUSDT, getWalletBalance, isWalletReady, getSendingAddress, processCryptoSend, checkAndAlertSweep, sweepToColdWallet, startAutoSweep, stopAutoSweep };
