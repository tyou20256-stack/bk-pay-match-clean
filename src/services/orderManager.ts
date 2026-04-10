/**
 * @file orderManager.ts — 注文管理
 * @description BK Payの注文ライフサイクルを管理する中核モジュール。
 *   注文作成時に3取引所のP2Pレートを検索し、条件に合うマーチャントを
 *   自動マッチング（AUTO MODE）。マッチ失敗時はAccount RouterまたはDB口座から
 *   自社口座を割当（SELF MODE）。15分のタイムアウトで自動キャンセル。
 * 
 *   マッチング条件:
 *   - 支払方法が一致
 *   - minLimit <= amount <= maxLimit
 *   - completionRate >= 90%
 *   - isOnline === true
 */
import nodeCrypto from 'crypto';
import notifier from './notifier.js';
import * as dbSvc from './database.js';
import logger from './logger.js';
import { getFeeRateForRank, getMerchantApiKeyById } from './database.js';
import { broadcast } from './websocket.js';
import { getOptimalSpread, recordOrder as recordSpreadOrder } from './spreadOptimizer.js';
import { recordProfit } from './profitTracker.js';
import { getCachedRates } from './aggregator.js';
import { notifyOrderCompleted, notifyWithdrawalEvent } from './merchantApiService.js';
import { findMatchingSeller, findSellerForUsdtSupply, lockBalance, releaseBalance } from './p2pSellerService.js';
import { executeAutoTrade, forwardPaymentConfirmation } from './autoTradeService.js';

// Order Manager - Handles both Auto-Match (Puppeteer) and Self-Merchant (Account Router) modes

interface Order {
  [key: string]: unknown;
  id: string;
  mode: string;
  status: string;
  amount: number;          // JPY amount
  crypto: string;          // USDT, BTC, ETH
  cryptoAmount: number;    // calculated crypto amount
  rate: number;            // matched rate
  payMethod: string;       // bank, paypay, linepay, aupay
  exchange?: string | null;       // matched exchange name
  merchantName?: string | null;
  merchantCompletionRate?: number | null;
  paymentInfo: PaymentInfo | Record<string, unknown> | null;
  createdAt: number;
  expiresAt: number;       // 15min timer
  paidAt?: number | null;
  completedAt?: number | null;
  // Extended fields set during order lifecycle
  feeRate?: number;
  feeJpy?: number;
  feeCrypto?: number;
  customerWalletAddress?: string | null;
  sellerId?: number | null;
  withdrawalId?: number | null;
  exchangeOrderId?: string | number;
  verifiedAt?: number | null;
  txId?: string | null;
  // Sell order fields
  direction?: string;
  customerWallet?: string;
  customerBankInfo?: Record<string, unknown>;
  jpyAmount?: number;
  jpyGross?: number;
  depositAddress?: string;
  depositNetwork?: string;
  webhookUrl?: string | null;
  merchantApiKeyId?: number | null;
  orderToken?: string | null;
}

interface PaymentInfo {
  type: string;
  // Bank
  bankName?: string;
  branchName?: string;
  accountType?: string;
  accountNumber?: string;
  accountHolder?: string;
  // Electronic
  payId?: string;
  qrUrl?: string;
  // Seller info
  sellerName?: string;
  // Account tracking
  accountId?: number;
  // Common
  amount: number;
  [key: string]: unknown;
}

interface P2PMatchCandidate {
  exchange: string;
  price: number;
  merchant: {
    name: string;
    completionRate: number;
    isOnline: boolean;
  };
  paymentMethods: string[];
  minLimit: number;
  maxLimit: number;
}

interface RatesApiResponse {
  success: boolean;
  data?: {
    rates: Array<{
      buyOrders: P2PMatchCandidate[];
      sellOrders?: P2PMatchCandidate[];
    }>;
  };
}

interface AccountRouterResponse {
  success: boolean;
  account?: {
    id: string;
    bankName: string;
    branchName: string;
    accountType: string;
    accountNumber: string;
    accountHolder: string;
  };
  error?: string;
}

const orders = new Map<string, Order>();

function generateId(): string {
  return 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
}

// Get optimal account from Account Router
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

async function getAccountFromRouter(amount: number, payMethod: string): Promise<AccountRouterResponse> {
  try {
    const res = await fetchWithTimeout('http://localhost:3002/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, method: payMethod })
    });
    if (res.ok) {
      return await res.json() as AccountRouterResponse;
    }
  } catch (e) {
    // Account Router not available, use fallback
  }

  // Fallback: use DB accounts directly
  const dbAcc = dbSvc.getRoutableAccount(amount);
  if (dbAcc) {
    return { success: true, account: {
      id: String(dbAcc.id),
      bankName: dbAcc.bank_name,
      branchName: dbAcc.branch_name,
      accountType: dbAcc.account_type,
      accountNumber: dbAcc.account_number,
      accountHolder: dbAcc.account_holder
    }};
  }
  return { success: false, error: 'No available accounts' };
}

// Try auto-match via P2P exchanges
async function tryAutoMatch(amount: number, payMethod: string, crypto: string): Promise<{ matched: boolean; order?: P2PMatchCandidate }> {
  try {
    const res = await fetchWithTimeout(`http://localhost:3003/api/rates/${crypto}`);
    const data = await res.json() as { success: boolean; data?: { rates: Array<{ buyOrders: P2PMatchCandidate[] }> } };
    if (!data.success || !data.data) return { matched: false };

    const payMap: Record<string, string[]> = {
      bank: ['銀行振込', 'Bank Transfer', 'Bank'],
      paypay: ['PayPay'],
      linepay: ['LINE Pay'],
      aupay: ['au PAY']
    };
    const keys = payMap[payMethod] || [];

    let candidates: P2PMatchCandidate[] = [];
    for (const ex of data.data.rates) {
      for (const o of ex.buyOrders) {
        if (o.minLimit <= amount && (o.maxLimit === 0 || o.maxLimit >= amount)
          && o.merchant.completionRate >= 90
          && o.merchant.isOnline
          && o.paymentMethods.some((p: string) => keys.some(k => p.includes(k)))) {
          candidates.push(o);
        }
      }
    }

    if (candidates.length === 0) return { matched: false };

    candidates.sort((a, b) => a.price - b.price);
    return { matched: true, order: candidates[0] };
  } catch (e) {
    return { matched: false };
  }
}

// Create a new order
export async function createOrder(amount: number, payMethod: string, crypto: string = 'USDT', customerWalletAddress?: string): Promise<Order> {
  const id = generateId();
  const now = Date.now();
  const orderToken = nodeCrypto.randomBytes(16).toString('hex');

  const order: Order = {
    id,
    mode: 'auto',
    status: 'matching',
    amount,
    crypto,
    cryptoAmount: 0,
    rate: 0,
    payMethod,
    paymentInfo: null,
    createdAt: now,
    expiresAt: now + 15 * 60 * 1000, // 15 minutes
    orderToken,
  };

  orders.set(id, order);
  // Will save to DB after matching

  // Try auto-match first
  const match = await tryAutoMatch(amount, payMethod, crypto);

  if (match.matched && match.order) {
    // Auto-match success
    order.mode = 'auto';
    order.status = 'pending_payment';
    order.exchange = match.order.exchange;
    order.merchantName = match.order.merchant.name;
    order.merchantCompletionRate = match.order.merchant.completionRate;
    order.rate = match.order.price;
    order.cryptoAmount = parseFloat((amount / match.order.price).toFixed(4));

    // ── 自動取引: 取引所に実注文を作成 ──────────────────────
    const autoTradeConfig = dbSvc.getAutoTradeConfig();
    let autoTradeSuccess = false;
    if (autoTradeConfig.enabled === 'true' && amount >= Number(autoTradeConfig.min_amount || 5000) && amount <= Number(autoTradeConfig.max_amount || 1000000)) {
      try {
        const tradeResult = await executeAutoTrade({
          orderId: order.id,
          exchange: match.order.exchange,
          crypto,
          amount,
          payMethod,
        });
        if (tradeResult.success && tradeResult.paymentInfo) {
          // 取引所セラーの実際の振込先を設定
          if (tradeResult.paymentInfo.bankName || tradeResult.paymentInfo.accountNumber) {
            order.paymentInfo = { type: 'bank', ...tradeResult.paymentInfo, amount };
          } else {
            order.paymentInfo = { type: payMethod, ...tradeResult.paymentInfo, amount };
          }
          order.exchangeOrderId = tradeResult.exchangeOrderId;
          autoTradeSuccess = true;
        }
      } catch (e: unknown) {
        logger.error('Auto-trade error', { error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Fallback: 自動取引失敗時は既存のDB口座/P2Pセラーを使用
    if (!autoTradeSuccess) {
      if (payMethod === 'bank') {
        const autoAcc = dbSvc.getRoutableAccount(amount);
        if (autoAcc) {
          order.paymentInfo = { type: 'bank', bankName: autoAcc.bank_name, branchName: autoAcc.branch_name, accountType: autoAcc.account_type, accountNumber: autoAcc.account_number, accountHolder: autoAcc.account_holder, amount };
        } else {
          order.paymentInfo = { type: 'bank', bankName: '（口座未登録）', branchName: '-', accountType: '-', accountNumber: '-', accountHolder: '-', amount };
        }
      } else {
        // Try P2P seller matching first
        const p2pSeller = findMatchingSeller(amount, payMethod, order.cryptoAmount);
        if (p2pSeller) {
          const payIdMap: Record<string, string | null> = {
            paypay: p2pSeller.paypayId,
            linepay: p2pSeller.linepayId,
            aupay: p2pSeller.aupayId,
          };
          const payId = payIdMap[payMethod] || '';
          order.paymentInfo = { type: payMethod, payId, amount, sellerName: p2pSeller.name };
          order.sellerId = p2pSeller.id;
          lockBalance(p2pSeller.id, order.cryptoAmount);
        } else {
          // Fallback: use admin-configured epay account
          const epay = dbSvc.getEpayConfig(payMethod);
          const payId = epay?.pay_id || 'bkstock-pay';
          order.paymentInfo = { type: payMethod, payId, amount };
        }
      }
    }
  } else {
    // Fallback to self-merchant mode
    order.mode = 'self';
    order.status = 'pending_payment';

    // Get rate from aggregator
    try {
      const res = await fetchWithTimeout(`http://localhost:3003/api/rates/${crypto}`);
      const data = await res.json() as RatesApiResponse;
      if (data.success && data.data) {
        let best: P2PMatchCandidate | null = null;
        for (const ex of data.data.rates) {
          for (const o of ex.buyOrders) {
            if (!best || o.price < best.price) best = o;
          }
        }
        if (best) {
          order.rate = best.price;
          order.cryptoAmount = parseFloat((amount / best.price).toFixed(4));
        }
      }
    } catch (e) {}

    // Get account from router
    if (payMethod === 'bank') {
      const routerRes = await getAccountFromRouter(amount, payMethod);
      if (routerRes.success && routerRes.account) {
        const acc = routerRes.account;
        order.paymentInfo = {
          type: 'bank',
          bankName: acc.bankName,
          branchName: acc.branchName,
          accountType: acc.accountType,
          accountNumber: acc.accountNumber,
          accountHolder: acc.accountHolder,
          amount
        };
      }
    } else {
      // Try P2P seller first (self-mode fallback for paypay/linepay/aupay)
      const p2pSellerSelf = findMatchingSeller(amount, payMethod, order.cryptoAmount);
      if (p2pSellerSelf) {
        const payIdMapSelf: Record<string, string | null> = {
          paypay: p2pSellerSelf.paypayId,
          linepay: p2pSellerSelf.linepayId,
          aupay: p2pSellerSelf.aupayId,
        };
        const payId = payIdMapSelf[payMethod] || '';
        order.paymentInfo = { type: payMethod, payId, amount, sellerName: p2pSellerSelf.name };
        order.sellerId = p2pSellerSelf.id;
        lockBalance(p2pSellerSelf.id, order.cryptoAmount);
      } else {
        // Final fallback: admin-configured epay account
        const epay = dbSvc.getEpayConfig(payMethod);
        const selfPay: Record<string, { payId: string; qrUrl?: string }> = {
          paypay: { payId: 'bkstock-pay', qrUrl: '/img/paypay-qr.png' },
          linepay: { payId: 'bkstock-line', qrUrl: '/img/linepay-qr.png' },
          aupay: { payId: 'bkstock-aupay', qrUrl: '/img/aupay-qr.png' },
        };
        const payId = epay?.pay_id || selfPay[payMethod]?.payId || 'bkstock';
        const qrUrl = selfPay[payMethod]?.qrUrl;
        order.paymentInfo = { type: payMethod, payId, qrUrl, amount };
      }
    }

    order.exchange = 'BK Pay（自社決済）';
    order.merchantName = 'BK Stock';
    order.merchantCompletionRate = 100;
  }

  // Fee calculation with margin safety
  let feeRate = getFeeRateForRank('bronze'); // default rank; no telegram context here
  const costEstimate = dbSvc.estimateOrderCost(amount, 'buy');
  const costConfig = dbSvc.getCostConfig();
  // マージン安全: 手数料がコストを下回る場合は自動引き上げ
  if (costConfig.auto_adjust_fee && feeRate < costEstimate.minFeeRate) {
    feeRate = costEstimate.minFeeRate;
    logger.info('Fee auto-adjusted to cover costs', {
      orderId: order.id,
      originalRate: getFeeRateForRank('bronze'),
      adjustedRate: feeRate,
      estimatedCost: costEstimate.estimatedCost,
      minFeeJpy: costEstimate.minFeeJpy,
    });
  }
  order.feeRate = feeRate;
  order.feeJpy = Math.round(order.amount * feeRate);
  order.feeCrypto = 0;
  order.estimatedCost = costEstimate.estimatedCost;
  order.estimatedMargin = order.feeJpy - costEstimate.estimatedCost;
  // Adjust crypto amount: customer pays full amount but receives crypto for (amount - fee)
  if (order.rate > 0) {
    order.cryptoAmount = parseFloat(((order.amount - order.feeJpy) / order.rate).toFixed(4));
  }

  // Apply spread optimization
  try {
    const spread = await getOptimalSpread(crypto, 'buy');
    if (order.rate > 0 && spread.finalSpread > 0) {
      order.rate = Math.round(order.rate * (1 + spread.finalSpread) * 10) / 10;
      order.cryptoAmount = parseFloat((amount / order.rate).toFixed(4));
    }
    recordSpreadOrder(crypto, amount);
  } catch (e) { /* spread optimizer not critical */ }

  // ── 出金三角マッチング（最優先）───────────────────────────────
  // 同額 pending の出金リクエストがあればAの口座情報をバイヤーBに表示し、
  // セラーCのUSDTをロックして三角マッチングを成立させる
  if (order.cryptoAmount > 0) {
    const pendingWd = dbSvc.findPendingWithdrawalByAmount(amount, payMethod);
    if (pendingWd) {
      // A の口座情報を paymentInfo にセット
      if (payMethod === 'bank') {
        order.paymentInfo = {
          type: 'bank',
          bankName: pendingWd.bankName || '',
          branchName: pendingWd.branchName || '',
          accountType: pendingWd.accountType || '普通',
          accountNumber: pendingWd.accountNumber || '',
          accountHolder: pendingWd.accountHolder || '',
          amount,
        };
      } else {
        order.paymentInfo = { type: payMethod, payId: pendingWd.paypayId || '', amount };
      }

      // C (セラー) を payMethod無関係で選択
      const supplier = findSellerForUsdtSupply(order.cryptoAmount);
      if (supplier) {
        lockBalance(supplier.id, order.cryptoAmount);
        order.sellerId = supplier.id;
        order.withdrawalId = pendingWd.id;
        dbSvc.updateWithdrawalStatus(pendingWd.id, 'matched', {
          matchedOrderId: order.id,
          matchedSellerId: supplier.id,
        });
        order.mode = 'auto';
        order.status = 'pending_payment';
      }
    }
  }

  // Store customer wallet address for crypto delivery
  if (customerWalletAddress) {
    order.customerWalletAddress = customerWalletAddress;
  }

  dbSvc.saveOrder(order);
  // Persist P2P seller association if matched
  if (order.sellerId) {
    dbSvc.saveOrderSellerId(order.id, order.sellerId);
  }
  // Persist withdrawal link if matched
  if (order.withdrawalId) {
    dbSvc.saveOrderWithdrawalId(order.id, order.withdrawalId);
  }
  notifier.notifyNewOrder(order);
  broadcast('order', { id: order.id, status: order.status, amount: order.amount, crypto: order.crypto });
  return order;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  matching: ['pending_payment', 'cancelled', 'expired'],
  pending_payment: ['confirming', 'cancelled', 'expired'],
  confirming: ['payment_verified', 'completed', 'cancelled'],
  payment_verified: ['sending_crypto', 'completed', 'cancelled'],
  sending_crypto: ['completed', 'payment_verified', 'cancelled'],
  paid: ['confirming', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
  expired: [],
  // Sell order states
  awaiting_deposit: ['deposit_received', 'cancelled', 'expired'],
  deposit_received: ['completed', 'cancelled'],
};

function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// Mark order as paid (customer reports payment sent)
export function markPaid(orderId: string): Order | null {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  if (!canTransition(order.status, 'confirming')) return null;
  order.status = 'confirming';
  order.paidAt = Date.now();
  dbSvc.updateOrderStatus(orderId, 'confirming', { paidAt: order.paidAt });
  notifier.notifyPaid(order);
  broadcast('order', { id: order.id, status: order.status, amount: order.amount });
  // P2P セラーへ Telegram 通知（telegram_chat_id 設定済みの場合）
  if (order.sellerId) {
    const sellerRow = dbSvc.getP2PSeller(order.sellerId);
    if (sellerRow?.telegram_chat_id) {
      const base = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3003}`;
      const confirmUrl = `${base}/seller-confirm.html?orderId=${orderId}&token=${sellerRow.confirm_token}`;
      notifier.notifySellerPaid(sellerRow.telegram_chat_id, { ...order, confirmUrl });
    }
  }
  // 出金三角マッチング: バイヤーBが振込完了 → 外部システムに webhook 通知
  if (order.withdrawalId) {
    const w = dbSvc.getWithdrawal(order.withdrawalId);
    if (w?.webhookUrl) {
      const keyRow = w.merchantApiKeyId ? getMerchantApiKeyById(w.merchantApiKeyId) : null;
      notifyWithdrawalEvent(w, keyRow?.webhook_secret || null, 'withdrawal.payment_sent', { orderId }).catch(() => {});
    }
  }
  // 自動取引: 取引所に支払い完了を報告
  if (order.exchangeOrderId) {
    const config = dbSvc.getAutoTradeConfig();
    if (config.auto_confirm_payment === 'true') {
      forwardPaymentConfirmation(orderId).catch(e =>
        logger.error('Payment confirmation forward failed', { error: e.message })
      );
    }
  }
  // No auto-confirm — admin must manually verify payment via adminVerifyPayment()
  return order;
}

// Admin verifies bank deposit was received
export function adminVerifyPayment(orderId: string): Order | null {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  if (!canTransition(order.status, 'payment_verified')) return null;
  order.status = 'payment_verified';
  order.verifiedAt = Date.now();
  dbSvc.updateOrderStatus(orderId, 'payment_verified', { verifiedAt: order.verifiedAt });
  notifier.notifyPaymentVerified(order);
  broadcast('order', { id: order.id, status: order.status, amount: order.amount });
  return order;
}

// Admin manually completes order (when crypto was sent outside system)
export function adminManualComplete(orderId: string, txId?: string): Order | null {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  // Allow from confirming, payment_verified, or sending_crypto
  if (!canTransition(order.status, 'completed')) return null;
  order.status = 'completed';
  order.completedAt = Date.now();
  if (txId) order.txId = txId;
  dbSvc.updateOrderStatus(orderId, 'completed', { completedAt: order.completedAt, txId });
  // Record profit
  try {
    const rates = getCachedRates(order.crypto) as { spotPrices?: Record<string, number> } | undefined;
    const marketRate = rates?.spotPrices?.[order.crypto] || order.rate;
    recordProfit(order, marketRate);
  } catch {}
  notifier.notifyCompleted(order);
  broadcast('order', { id: order.id, status: order.status, amount: order.amount });
  // Webhook通知（外部APIで作成された注文の場合）
  const freshOrder = dbSvc.getOrder(orderId);
  if (freshOrder?.webhookUrl) {
    const keyRow = freshOrder.merchantApiKeyId
      ? getMerchantApiKeyById(freshOrder.merchantApiKeyId)
      : null;
    notifyOrderCompleted(freshOrder, keyRow?.webhook_secret || null).catch(() => {});
  }
  return order;
}

// Cancel order
export function cancelOrder(orderId: string): Order | null {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  if (!canTransition(order.status, 'cancelled')) return null;
  order.status = 'cancelled';
  dbSvc.updateOrderStatus(orderId, 'cancelled');
  // Release P2P seller locked balance if applicable
  if (order.sellerId && order.cryptoAmount > 0) {
    releaseBalance(order.sellerId, order.cryptoAmount);
  }
  // 出金三角マッチング: 注文キャンセル時に出金リクエストを pending に戻す
  if (order.withdrawalId) {
    const w = dbSvc.getWithdrawal(order.withdrawalId);
    if (w && w.status === 'matched') {
      dbSvc.updateWithdrawalStatus(w.id, 'pending');
    }
  }
  notifier.notifyCancelled(order);
  broadcast('order', { id: order.id, status: order.status, amount: order.amount });
  return order;
}

// Get order
export function getOrder(orderId: string): Order | null {
  return orders.get(orderId) || dbSvc.getOrder(orderId);
}

// Get all orders
export function getAllOrders(): Order[] {
  return dbSvc.getAllOrders();
}

// Cleanup expired orders
setInterval(() => {
  const now = Date.now();
  orders.forEach((order, id) => {
    if (order.status === 'pending_payment' && now > order.expiresAt) {
      order.status = 'expired';
      dbSvc.updateOrderStatus(id, 'expired');
      // Release P2P seller locked balance if applicable
      if (order.sellerId && order.cryptoAmount > 0) {
        releaseBalance(order.sellerId, order.cryptoAmount);
      }
      notifier.notifyExpired(order);
      broadcast('order', { id: order.id, status: order.status, amount: order.amount });
    }
  });
}, 10000);



// === SELL Flow ===
export async function createSellOrder(params: {
  cryptoAmount: number;
  crypto: string;
  customerBankInfo: { bankName: string; branchName: string; accountNumber: string; accountHolder: string };
}): Promise<Order> {
  const id = generateId().replace('ORD', 'SELL');
  const now = Date.now();

  // Fetch current sell rate from aggregator
  let sellRate = 0;
  try {
    const res = await fetchWithTimeout(`http://localhost:3003/api/rates/${params.crypto}`);
    const data = await res.json() as RatesApiResponse;
    if (data.success && data.data) {
      const allSell: P2PMatchCandidate[] = [];
      for (const ex of data.data.rates) {
        for (const o of (ex.sellOrders || [])) allSell.push(o);
      }
      allSell.sort((a, b) => Number(b.price) - Number(a.price));
      if (allSell.length > 0) sellRate = Number(allSell[0].price);
    }
  } catch {}

  if (sellRate === 0) throw new Error('売却レートを取得できませんでした');

  // Apply sell spread
  try {
    const sellSpread = await getOptimalSpread(params.crypto, 'sell');
    if (sellSpread.finalSpread > 0) {
      sellRate = Math.round(sellRate * (1 - sellSpread.finalSpread) * 10) / 10;
    }
  } catch (e) { /* spread optimizer not critical */ }

  const jpyAmount = Math.floor(params.cryptoAmount * sellRate); // gross before fee
  const wallet = dbSvc.getWalletConfig();

  // Fee calculation for sell with margin safety
  let sellFeeRate = getFeeRateForRank('bronze');
  const sellCostEstimate = dbSvc.estimateOrderCost(jpyAmount, 'sell');
  const sellCostConfig = dbSvc.getCostConfig();
  if (sellCostConfig.auto_adjust_fee && sellFeeRate < sellCostEstimate.minFeeRate) {
    sellFeeRate = sellCostEstimate.minFeeRate;
    logger.info('Sell fee auto-adjusted to cover costs', {
      orderId: id,
      originalRate: getFeeRateForRank('bronze'),
      adjustedRate: sellFeeRate,
      estimatedCost: sellCostEstimate.estimatedCost,
      minFeeJpy: sellCostEstimate.minFeeJpy,
    });
  }
  const feeCrypto = parseFloat((params.cryptoAmount * sellFeeRate).toFixed(6));
  const effectiveCrypto = params.cryptoAmount - feeCrypto;
  const jpyAmountAfterFee = Math.floor(effectiveCrypto * sellRate);

  dbSvc.createSellOrder({
    id,
    cryptoAmount: params.cryptoAmount,
    crypto: params.crypto,
    rate: sellRate,
    jpyAmount,
    customerBankInfo: params.customerBankInfo,
    expiresAt: now + 30 * 60 * 1000, // 30 minutes for sell
  });

  const order: Order = {
    id,
    mode: 'self',
    direction: 'sell',
    status: 'awaiting_deposit',
    amount: jpyAmountAfterFee,
    cryptoAmount: params.cryptoAmount,
    crypto: params.crypto,
    rate: sellRate,
    payMethod: 'crypto',
    paymentInfo: null,
    jpyAmount: jpyAmountAfterFee,
    jpyGross: jpyAmount,
    feeRate: sellFeeRate,
    feeCrypto,
    feeJpy: Math.round(jpyAmount - jpyAmountAfterFee),
    estimatedCost: sellCostEstimate.estimatedCost,
    estimatedMargin: Math.round(jpyAmount - jpyAmountAfterFee) - sellCostEstimate.estimatedCost,
    customerBankInfo: params.customerBankInfo,
    depositAddress: wallet?.address || '（ウォレット未設定）',
    depositNetwork: wallet?.network || 'TRC-20',
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000,
  };

  orders.set(id, order);
  notifier.notifyNewOrder({ ...order, amount: jpyAmount, payMethod: 'crypto', mode: 'sell', exchange: 'BK Pay（売却）' } as Order);
  broadcast('order', { id, status: 'awaiting_deposit', amount: jpyAmount, crypto: params.crypto, direction: 'sell' });

  return order;
}

// Mark sell order deposit received
export function markDepositReceived(orderId: string): Order | null {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  if (!canTransition(order.status, 'deposit_received')) return null;
  dbSvc.updateOrderStatus(orderId, 'deposit_received');
  if (order) order.status = 'deposit_received';
  broadcast('order', { id: orderId, status: 'deposit_received' });
  return order;
}

// Mark sell order withdrawal complete
export function markWithdrawalComplete(orderId: string): Order | null {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  if (!canTransition(order.status, 'completed')) return null;
  dbSvc.updateOrderStatus(orderId, 'completed', { completedAt: Date.now() });
  if (order) { order.status = 'completed'; order.completedAt = Date.now(); }
  // Record profit
  try {
    const rates = getCachedRates(order.crypto) as { spotPrices?: Record<string, number> } | undefined;
    const marketRate = rates?.spotPrices?.[order.crypto] || order.rate;
    recordProfit(order, marketRate);
  } catch {}
  notifier.notifyCompleted({ ...order, status: 'completed', completedAt: Date.now() });
  broadcast('order', { id: orderId, status: 'completed' });
  return order;
}

export default { createOrder, createSellOrder, markPaid, markDepositReceived, markWithdrawalComplete, cancelOrder, getOrder, getAllOrders, adminVerifyPayment, adminManualComplete };
