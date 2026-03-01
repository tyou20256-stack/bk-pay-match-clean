import * as dbSvc from './database.js';

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

  // Fallback accounts when Router is unavailable
  const fallbacks = [
    { id: 'fb1', bankName: 'みずほ銀行', branchName: '渋谷支店', accountType: '普通', accountNumber: '3058271', accountHolder: 'タナカ タロウ' },
    { id: 'fb2', bankName: '三井住友銀行', branchName: '新橋支店', accountType: '普通', accountNumber: '7742190', accountHolder: 'サトウ ユウキ' },
    { id: 'fb3', bankName: '楽天銀行', branchName: '第一営業支店', accountType: '普通', accountNumber: '4491823', accountHolder: 'ヤマモト ケンジ' },
    { id: 'fb4', bankName: '住信SBIネット銀行', branchName: '法人第一支店', accountType: '普通', accountNumber: '2287654', accountHolder: 'スズキ アヤカ' },
  ];
  const acc = fallbacks[Math.floor(Math.random() * fallbacks.length)];
  return { success: true, account: acc };
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
      // Simulate merchant's bank info (in prod: scraped from exchange after order creation)
      const mBanks = [
        { bankName: 'みずほ銀行', branchName: '渋谷支店', accountType: '普通', accountNumber: '3058271', accountHolder: 'タナカ タロウ' },
        { bankName: '三井住友銀行', branchName: '新橋支店', accountType: '普通', accountNumber: '7742190', accountHolder: 'サトウ ユウキ' },
        { bankName: '楽天銀行', branchName: '第一営業支店', accountType: '普通', accountNumber: '4491823', accountHolder: 'ヤマモト ケンジ' },
      ];
      const mb = mBanks[Math.floor(Math.random() * mBanks.length)];
      order.paymentInfo = { type: 'bank', ...mb, amount };
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

  dbSvc.saveOrder(order);
  return order;
}

// Mark order as paid
export function markPaid(orderId: string): Order | null {
  const order = orders.get(orderId) || dbSvc.getOrder(orderId);
  if (!order) return null;
  order.status = 'confirming';
  order.paidAt = Date.now();
  dbSvc.updateOrderStatus(orderId, 'confirming', { paidAt: order.paidAt });
  
  // Simulate confirmation (in prod: check bank API / TronGrid)
  setTimeout(() => {
    const o = orders.get(orderId);
    if (o && o.status === 'confirming') {
      o.status = 'completed';
      o.completedAt = Date.now();
      dbSvc.updateOrderStatus(orderId, 'completed', { completedAt: o.completedAt });
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
    }
  });
}, 10000);

export default { createOrder, markPaid, cancelOrder, getOrder, getAllOrders };
