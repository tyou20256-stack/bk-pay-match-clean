/**
 * @file autoTradeService.ts — P2P自動取引オーケストレーター
 * @description OKX C2C API / Puppeteer を使い分けて取引所上のP2P注文を自動作成。
 *   注文ステータスポーリングにより、USDT解放を検知し顧客へ自動送金する。
 *
 *   フロー:
 *   1. executeAutoTrade() — 取引所に注文を自動作成
 *   2. forwardPaymentConfirmation() — 支払い報告を取引所に転送
 *   3. startPolling() — 取引所注文のステータスを定期監視
 */
import * as okxClient from './okxC2CClient.js';
import trader from './puppeteerTrader.js';
import * as dbSvc from './database.js';
import { processCryptoSend } from './walletService.js';
import { broadcast } from './websocket.js';
import logger from './logger.js';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false; // guard against concurrent poll executions

// ── サーキットブレーカー ────────────────────────────────────
const circuitBreaker = {
  consecutiveFailures: 0,
  maxConsecutiveFailures: 5,
  dailyTotalJpy: 0,
  dailyLimitJpy: 10_000_000, // 1000万円/日 ハードリミット
  lastResetDate: new Date().toDateString(),
  tripped: false,
};

function checkCircuitBreaker(amountJpy: number): string | null {
  // Reset daily counter at midnight
  const today = new Date().toDateString();
  if (today !== circuitBreaker.lastResetDate) {
    circuitBreaker.dailyTotalJpy = 0;
    circuitBreaker.lastResetDate = today;
    circuitBreaker.tripped = false;
    circuitBreaker.consecutiveFailures = 0;
  }

  if (circuitBreaker.tripped) {
    return `Circuit breaker tripped: ${circuitBreaker.consecutiveFailures} consecutive failures. Restart polling or wait for daily reset.`;
  }
  if (circuitBreaker.dailyTotalJpy + amountJpy > circuitBreaker.dailyLimitJpy) {
    return `Daily trade limit reached: ¥${circuitBreaker.dailyTotalJpy.toLocaleString()} / ¥${circuitBreaker.dailyLimitJpy.toLocaleString()}`;
  }
  return null;
}

function recordCircuitBreakerSuccess(amountJpy: number): void {
  circuitBreaker.consecutiveFailures = 0;
  circuitBreaker.dailyTotalJpy += amountJpy;
}

function recordCircuitBreakerFailure(): void {
  circuitBreaker.consecutiveFailures++;
  if (circuitBreaker.consecutiveFailures >= circuitBreaker.maxConsecutiveFailures) {
    circuitBreaker.tripped = true;
    logger.error('CIRCUIT BREAKER TRIPPED', { consecutiveFailures: circuitBreaker.consecutiveFailures });
    broadcast('autoTrade', { status: 'circuit_breaker_tripped', failures: circuitBreaker.consecutiveFailures });
  }
}

// ── 自動注文作成 ─────────────────────────────────────────

export async function executeAutoTrade(params: {
  orderId: string;
  exchange: string;
  crypto: string;
  amount: number;
  payMethod: string;
}): Promise<{
  success: boolean;
  exchangeOrderId?: string;
  paymentInfo?: Record<string, unknown> | null;
  error?: string;
}> {
  try {
    const config = dbSvc.getAutoTradeConfig();
    if (config.enabled !== 'true') return { success: false, error: 'Auto-trade disabled' };

    const maxAmount = Math.min(Number(config.max_amount) || 1000000, circuitBreaker.dailyLimitJpy);
    const minAmount = Number(config.min_amount) || 5000;
    if (params.amount > maxAmount || params.amount < minAmount) {
      return { success: false, error: `Amount ${params.amount} outside range ${minAmount}-${maxAmount}` };
    }

    // Circuit breaker check
    const cbError = checkCircuitBreaker(params.amount);
    if (cbError) {
      return { success: false, error: cbError };
    }

    const preferredChannel = config.preferred_channel || 'api';
    const preferredExchange = config.preferred_exchange || 'OKX';

    // Record the attempt in DB
    const exOrderId = dbSvc.createExchangeOrder({
      orderId: params.orderId,
      exchange: params.exchange,
      channel: preferredChannel,
      amountJpy: params.amount,
      cryptoAmount: 0,
      rate: 0,
    });

    // Try preferred channel first, then fallback
    let actualChannel = preferredChannel;
    let result = await tryChannel(preferredChannel, params, preferredExchange);

    if (!result.success && preferredChannel === 'api') {
      logger.info('API failed, falling back to puppeteer');
      result = await tryChannel('puppeteer', params, params.exchange);
      if (result.success) actualChannel = 'puppeteer';
    } else if (!result.success && preferredChannel === 'puppeteer') {
      logger.info('Puppeteer failed, trying OKX API');
      if (okxClient.isAvailable()) {
        result = await tryChannel('api', params, 'OKX');
        if (result.success) actualChannel = 'api';
      }
    }

    if (result.success) {
      recordCircuitBreakerSuccess(params.amount);
      dbSvc.updateExchangeOrder(exOrderId, {
        status: 'placed',
        channel: actualChannel,
        exchange_order_id: result.exchangeOrderId || null,
        seller_bank_info: result.paymentInfo || null,
      });
      logger.info('Order placed', { orderId: params.orderId, channel: actualChannel, exchangeOrderId: result.exchangeOrderId });
      broadcast('autoTrade', { orderId: params.orderId, status: 'placed', exchangeOrderId: result.exchangeOrderId });
    } else {
      recordCircuitBreakerFailure();
      dbSvc.updateExchangeOrder(exOrderId, {
        status: 'failed',
        error_message: result.error || 'Unknown error',
      });
      logger.error('Order failed', { orderId: params.orderId, error: result.error });
    }

    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('executeAutoTrade error', { orderId: params.orderId, error: msg });
    return { success: false, error: msg };
  }
}

async function tryChannel(
  channel: string,
  params: { orderId: string; exchange: string; crypto: string; amount: number; payMethod: string },
  targetExchange: string,
): Promise<{ success: boolean; exchangeOrderId?: string; paymentInfo?: Record<string, unknown> | null; error?: string }> {
  if (channel === 'api') {
    if (!okxClient.isAvailable()) return { success: false, error: 'OKX API credentials not configured' };
    logger.info('Trying OKX C2C API', { amount: params.amount });
    const result = await okxClient.placeC2COrder({
      side: 'buy',
      baseCurrency: params.crypto,
      quoteCurrency: 'JPY',
      quoteAmount: String(params.amount),
      paymentMethod: params.payMethod === 'bank' ? '銀行振込' : params.payMethod,
    });
    return result;
  }

  if (channel === 'puppeteer') {
    if (!['Bybit', 'Binance'].includes(targetExchange)) {
      return { success: false, error: `Puppeteer not supported for ${targetExchange}` };
    }
    logger.info('Trying Puppeteer', { exchange: targetExchange, amount: params.amount });
    const result = await trader.createBuyOrder(targetExchange, params.crypto, params.amount, params.payMethod);
    return {
      success: result.success,
      exchangeOrderId: result.orderId,
      paymentInfo: result.paymentInfo || null,
      error: result.error,
    };
  }

  return { success: false, error: `Unknown channel: ${channel}` };
}

// ── 支払い確認転送 ────────────────────────────────────────

export async function forwardPaymentConfirmation(orderId: string): Promise<boolean> {
  const exOrder = dbSvc.getExchangeOrder(orderId);
  if (!exOrder || !exOrder.exchange_order_id) {
    logger.warn('No exchange order found', { orderId });
    return false;
  }

  logger.info('Forwarding payment confirmation', { orderId, exchange: exOrder.exchange, exchangeOrderId: exOrder.exchange_order_id });

  try {
    if (exOrder.channel === 'api') {
      const result = await okxClient.confirmC2CPayment(exOrder.exchange_order_id);
      if (result.success) {
        dbSvc.updateExchangeOrder(exOrder.id, { status: 'paid' });
        broadcast('autoTrade', { orderId, status: 'paid' });
        return true;
      }
      logger.error('OKX confirmPayment failed', { error: result.error });
      return false;
    }

    if (exOrder.channel === 'puppeteer') {
      const ok = await trader.confirmPayment(exOrder.exchange, exOrder.exchange_order_id);
      if (ok) {
        dbSvc.updateExchangeOrder(exOrder.id, { status: 'paid' });
        broadcast('autoTrade', { orderId, status: 'paid' });
      }
      return ok;
    }

    return false;
  } catch (e: unknown) {
    logger.error('forwardPayment error', { orderId, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

// ── ステータスポーリング ──────────────────────────────────

export function startPolling(): void {
  const config = dbSvc.getAutoTradeConfig();
  const interval = Number(config.polling_interval_ms) || 15000;

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollActiveOrders, interval);
  logger.info('Polling started', { intervalMs: interval });
}

export function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('Polling stopped');
  }
}

async function pollActiveOrders(): Promise<void> {
  if (polling) return; // prevent concurrent poll executions
  polling = true;
  try {
    await _doPoll();
  } finally {
    polling = false;
  }
}

async function _doPoll(): Promise<void> {
  const activeOrders = dbSvc.listActiveExchangeOrders();
  if (activeOrders.length === 0) return;

  logger.info('Polling active exchange orders', { count: activeOrders.length });

  for (const exOrder of activeOrders) {
    if (!exOrder.exchange_order_id) continue;

    try {
      let status: string;

      if (exOrder.channel === 'api') {
        const result = await okxClient.getC2COrderStatus(exOrder.exchange_order_id);
        status = result.status;
      } else if (exOrder.channel === 'puppeteer') {
        status = await trader.checkOrderStatus(exOrder.exchange, exOrder.exchange_order_id);
      } else {
        continue;
      }

      logger.info('exchange order status', { orderId: exOrder.order_id, status });

      if (status === 'released' || status === 'completed') {
        await handleOrderCompleted(exOrder);
      } else if (status === 'cancelled') {
        dbSvc.updateExchangeOrder(exOrder.id, { status: 'cancelled' });
        broadcast('autoTrade', { orderId: exOrder.order_id, status: 'cancelled' });
      } else if (status === 'paid' && exOrder.status !== 'paid') {
        dbSvc.updateExchangeOrder(exOrder.id, { status: 'paid' });
      }
    } catch (e: unknown) {
      logger.error('Poll error', { orderId: exOrder.order_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

async function handleOrderCompleted(exOrder: dbSvc.ExchangeOrderData): Promise<void> {
  logger.info('Exchange order completed, sending crypto to customer', { orderId: exOrder.order_id });

  try {
    // Step 1: Transition order to payment_verified (required by processCryptoSend)
    // The order is currently in 'confirming' status (set by markPaid).
    // processCryptoSend requires 'payment_verified' to proceed.
    const order = dbSvc.getOrder(exOrder.order_id);
    if (!order) {
      logger.error('Order not found', { orderId: exOrder.order_id });
      dbSvc.updateExchangeOrder(exOrder.id, { status: 'failed', error_message: 'Order not found' });
      return;
    }

    if (order.status === 'confirming') {
      dbSvc.updateOrderStatus(exOrder.order_id, 'payment_verified', { verifiedAt: Date.now() });
      broadcast('order', { id: exOrder.order_id, status: 'payment_verified' });
      logger.info('order status updated to payment_verified', { orderId: exOrder.order_id });
    } else if (order.status !== 'payment_verified' && order.status !== 'sending_crypto') {
      logger.warn('unexpected order status', { orderId: exOrder.order_id, status: order.status });
      dbSvc.updateExchangeOrder(exOrder.id, { error_message: `Unexpected order status: ${order.status}` });
      return;
    }

    // Step 2: processCryptoSend handles: payment_verified → sending_crypto → completed
    // It also records the transaction, notifies, and broadcasts internally.
    const sendResult = await processCryptoSend(exOrder.order_id);

    if (sendResult.success) {
      dbSvc.updateExchangeOrder(exOrder.id, { status: 'completed', completed_at: Date.now() });
      logger.info('order fully completed', { orderId: exOrder.order_id, txId: sendResult.txId });
      broadcast('autoTrade', { orderId: exOrder.order_id, status: 'completed', txId: sendResult.txId });
    } else {
      logger.error('Crypto send failed', { orderId: exOrder.order_id, error: sendResult.error });
      dbSvc.updateExchangeOrder(exOrder.id, { status: 'released', error_message: `Crypto send failed: ${sendResult.error}` });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('handleOrderCompleted error', { orderId: exOrder.order_id, error: msg });
    dbSvc.updateExchangeOrder(exOrder.id as number, { error_message: msg });
  }
}

// ── ステータス取得 ────────────────────────────────────────

export function getStatus(): {
  enabled: boolean;
  polling: boolean;
  config: Record<string, string>;
  puppeteerStatus: Record<string, unknown>;
  okxAvailable: boolean;
  circuitBreaker: { tripped: boolean; consecutiveFailures: number; dailyTotalJpy: number; dailyLimitJpy: number };
} {
  const config = dbSvc.getAutoTradeConfig();
  return {
    enabled: config.enabled === 'true',
    polling: pollTimer !== null,
    config,
    puppeteerStatus: trader.getStatus(),
    okxAvailable: okxClient.isAvailable(),
    circuitBreaker: {
      tripped: circuitBreaker.tripped,
      consecutiveFailures: circuitBreaker.consecutiveFailures,
      dailyTotalJpy: circuitBreaker.dailyTotalJpy,
      dailyLimitJpy: circuitBreaker.dailyLimitJpy,
    },
  };
}
