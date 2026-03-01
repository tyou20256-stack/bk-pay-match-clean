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
import notifier from './notifier.js';
import * as dbSvc from './database.js';
import { getFeeRateForRank } from './database.js';
import { broadcast } from './websocket.js';
import { getOptimalSpread, recordOrder as recordSpreadOrder } from './spreadOptimizer.js';
import { recordProfit } from './profitTracker.js';
import { getCachedRates } from './aggregator.js';

// Order Manager - Handles both Auto-Match (Puppeteer) and Self-Merchant (Account Router) modes

interface Order {
  id: string;
  mode: 'auto' | 'self';
  status: 'matching' | 'pending_payment' | 'paid' | 'confirming' | 'completed' | 'cancelled' | 'expired';
  amount: number;          // JPY amount
  crypto: string;          // USDT, BTC, ETH
  cryptoAmount: number;    // calculated crypto amount
  rate: number;            // matched rate
  payMethod: string;       // bank, paypay, linepay, aupay
  exchange?: string;       // matched exchange name
  merchantName?: string;
  merchantCompletionRate?: number;
  paymentInfo: PaymentInfo | null;
  createdAt: number;
  expiresAt: number;       // 15min timer
  paidAt?: number;
  completedAt?: number;
}

interface PaymentInfo {
  type: 'bank' | 'paypay' | 'linepay' | 'aupay';
  // Bank
  bankName?: string;
  branchName?: string;
  accountType?: string;
  accountNumber?: string;
  accountHolder?: string;
  // Electronic
  payId?: string;
  qrUrl?: string;
  // Common
  amount: number;
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
async function getAccountFromRouter(amount: number, payMethod: string): Promise<AccountRouterResponse> {
  try {
    const res = await fetch('http://localhost:3002/api/route', {
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
async function tryAutoMatch(amount: number, payMethod: string, crypto: string): Promise<{ matched: boolean; order?: any }> {
  try {
    const res = await fetch(`http://localhost:3003/api/rates/${crypto}`);
    const data = await res.json() as any;
    if (!data.success) return { matched: false };

    const payMap: Record<string, string[]> = {
      bank: ['銀行振込', 'Bank Transfer', 'Bank'],
      paypay: ['PayPay'],
      linepay: ['LINE Pay'],
      aupay: ['au PAY']
    };
    const keys = payMap[payMethod] || [];

    let candidates: any[] = [];
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
export async function createOrder(amount: number, payMethod: string, crypto: string = 'USDT'): Promise<Order> {
  const id = generateId();
  const now = Date.now();

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

    // For auto mode, payment info comes from exchange (simulated for now)
    // In production: Puppeteer creates order on exchange and retrieves merchant's payment info
    if (payMethod === 'bank') {
      // Auto mode: payment info comes from exchange via Puppeteer (not yet active)
      // For now, use DB account as placeholder
      const autoAcc = dbSvc.getRoutableAccount(amount);
      if (autoAcc) {
        order.paymentInfo = { type: 'bank', bankName: autoAcc.bank_name, branchName: autoAcc.branch_name, accountType: autoAcc.account_type, accountNumber: autoAcc.account_number, accountHolder: autoAcc.account_holder, amount };
      } else {
        order.paymentInfo = { type: 'bank', bankName: '（口座未登録）', branchName: '-', accountType: '-', accountNumber: '-', accountHolder: '-', amount };
      }
    } else {
      const payIds: Record<string, string> = { paypay: 'tanaka-t-2891', linepay: 'sato_yuki_88', aupay: 'yamamoto-k' };
      order.paymentInfo = { type: payMethod as any, payId: payIds[payMethod] || 'merchant-id', amount };
    }
  } else {
    // Fallback to self-merchant mode
    order.mode = 'self';
    order.status = 'pending_payment';

    // Get rate from aggregator
    try {
      const res = await fetch(`http://localhost:3003/api/rates/${crypto}`);
      const data = await res.json() as any;
      if (data.success) {
        let best: any = null;
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
      // Self-merchant electronic payment
      const selfPay: Record<string, { payId: string; qrUrl?: string }> = {
        paypay: { payId: 'bkstock-pay', qrUrl: '/img/paypay-qr.png' },
        linepay: { payId: 'bkstock-line', qrUrl: '/img/linepay-qr.png' },
        aupay: { payId: 'bkstock-aupay', qrUrl: '/img/aupay-qr.png' },
      };
      const sp = selfPay[payMethod] || { payId: 'bkstock' };
      order.paymentInfo = { type: payMethod as any, payId: sp.payId, qrUrl: sp.qrUrl, amount };
    }

    order.exchange = 'BK Pay（自社決済）';
    order.merchantName = 'BK Stock';
    order.merchantCompletionRate = 100;
  }

  // Fee calculation
  const feeRate = getFeeRateForRank('bronze'); // default rank; no telegram context here
  (order as any).feeRate = feeRate;
  (order as any).feeJpy = Math.round(order.amount * feeRate);
  (order as any).feeCrypto = 0;
  // Adjust crypto amount: customer pays full amount but receives crypto for (amount - fee)
  if (order.rate > 0) {
    order.cryptoAmount = parseFloat(((order.amount - (order as any).feeJpy) / order.rate).toFixed(4));
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

  dbSvc.saveOrder(order);
  notifier.notifyNewOrder(order);
  broadcast('order', { id: order.id, status: order.status, amount: order.amount, crypto: order.crypto });
  return order;
}

// Mark order as paid
export function markPaid(orderId: string): Order | null {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  order.status = 'confirming';
  order.paidAt = Date.now();
  dbSvc.updateOrderStatus(orderId, 'confirming', { paidAt: order.paidAt });
  notifier.notifyPaid(order);
  broadcast('order', { id: order.id, status: order.status, amount: order.amount });
  
  // Simulate confirmation (in prod: check bank API / TronGrid)
  setTimeout(() => {
    const o = orders.get(orderId);
    if (o && o.status === 'confirming') {
      o.status = 'completed';
      o.completedAt = Date.now();
      dbSvc.updateOrderStatus(orderId, 'completed', { completedAt: o.completedAt });
      // Record profit
      try {
        const rates = getCachedRates(o.crypto) as any;
        const marketRate = rates?.spotPrices?.[o.crypto] || o.rate;
        recordProfit(o, marketRate);
      } catch {}
      notifier.notifyCompleted(o);
      broadcast('order', { id: o.id, status: o.status, amount: o.amount });
    }
  }, 5000); // Auto-confirm after 5s for demo

  return order;
}

// Cancel order
export function cancelOrder(orderId: string): Order | null {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  order.status = 'cancelled';
  dbSvc.updateOrderStatus(orderId, 'cancelled');
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
}): Promise<any> {
  const id = generateId().replace('ORD', 'SELL');
  const now = Date.now();

  // Fetch current sell rate from aggregator
  let sellRate = 0;
  try {
    const res = await fetch(`http://localhost:3003/api/rates/${params.crypto}`);
    const data = await res.json() as any;
    if (data.success && data.data) {
      const allSell: any[] = [];
      for (const ex of data.data.rates) {
        for (const o of (ex.sellOrders || [])) allSell.push(o);
      }
      allSell.sort((a: any, b: any) => Number(b.price) - Number(a.price));
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
  const wallet = dbSvc.getWalletConfig() as any;

  // Fee calculation for sell
  const sellFeeRate = getFeeRateForRank('bronze');
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

  const order = {
    id,
    direction: 'sell',
    status: 'awaiting_deposit',
    cryptoAmount: params.cryptoAmount,
    crypto: params.crypto,
    rate: sellRate,
    jpyAmount: jpyAmountAfterFee,
    jpyGross: jpyAmount,
    feeRate: sellFeeRate,
    feeCrypto,
    feeJpy: Math.round(jpyAmount - jpyAmountAfterFee),
    customerBankInfo: params.customerBankInfo,
    depositAddress: wallet?.address || '（ウォレット未設定）',
    depositNetwork: wallet?.network || 'TRC-20',
    createdAt: now,
    expiresAt: now + 30 * 60 * 1000,
  };

  orders.set(id, order as any);
  notifier.notifyNewOrder({ ...order, amount: jpyAmount, payMethod: 'crypto', mode: 'sell', exchange: 'BK Pay（売却）' } as any);
  broadcast('order', { id, status: 'awaiting_deposit', amount: jpyAmount, crypto: params.crypto, direction: 'sell' });

  return order;
}

// Mark sell order deposit received
export function markDepositReceived(orderId: string): any {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  dbSvc.updateOrderStatus(orderId, 'deposit_received');
  if (order) order.status = 'deposit_received';
  broadcast('order', { id: orderId, status: 'deposit_received' });
  return order;
}

// Mark sell order withdrawal complete
export function markWithdrawalComplete(orderId: string): any {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  dbSvc.updateOrderStatus(orderId, 'completed', { completedAt: Date.now() });
  if (order) { order.status = 'completed'; order.completedAt = Date.now(); }
  // Record profit
  try {
    const rates = getCachedRates(order.crypto) as any;
    const marketRate = rates?.spotPrices?.[order.crypto] || order.rate;
    recordProfit(order, marketRate);
  } catch {}
  notifier.notifyCompleted({ ...order, status: 'completed', completedAt: Date.now() });
  broadcast('order', { id: orderId, status: 'completed' });
  return order;
}

export default { createOrder, createSellOrder, markPaid, markDepositReceived, markWithdrawalComplete, cancelOrder, getOrder, getAllOrders };
