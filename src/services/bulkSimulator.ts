/**
 * @file bulkSimulator.ts — 一括購入シミュレーター
 * @description 大口注文の最適分割シミュレーション。複数取引所/マーチャントに
 *   分散して最適な平均レートを算出する。
 */
import { getCachedRates } from './aggregator.js';
import { AggregatedRates, P2POrder } from '../types.js';
import logger from './logger.js';

// === Types ===
export interface SplitOrder {
  exchange: string;
  merchant: string;
  amount: number;       // JPY
  rate: number;
  cryptoAmount: number;
  completionRate: number;
  paymentMethods: string[];
}

export interface SimulationResult {
  totalAmountJpy: number;
  crypto: string;
  splits: SplitOrder[];
  totalCrypto: number;
  effectiveRate: number;
  singleBestRate: number;
  singleBestExchange: string;
  savings: number;       // JPY saved vs single order
  savingsPercent: number;
  orderCount: number;
}

// === Simulation ===
export function simulateBulkPurchase(
  totalAmountJpy: number,
  crypto: string = 'USDT',
  maxPerOrder?: number
): SimulationResult {
  const rates = getCachedRates(crypto.toUpperCase()) as AggregatedRates;
  if (!rates) {
    return emptyResult(totalAmountJpy, crypto);
  }

  // Collect all buy orders from all exchanges
  const allOrders: (P2POrder & { exchange: string })[] = [];
  for (const er of rates.rates) {
    for (const order of er.buyOrders || []) {
      allOrders.push({ ...order, exchange: er.exchange });
    }
  }

  // Sort by price ascending (cheapest first)
  allOrders.sort((a, b) => a.price - b.price);

  // Greedy fill
  const splits: SplitOrder[] = [];
  let remaining = totalAmountJpy;
  const perOrderLimit = maxPerOrder || Infinity;

  for (const order of allOrders) {
    if (remaining <= 0) break;

    const maxJpy = Math.min(
      order.maxLimit || Infinity,
      order.available * order.price,
      remaining,
      perOrderLimit
    );
    const minJpy = order.minLimit || 0;

    if (maxJpy < minJpy) continue;
    const fillAmount = Math.min(maxJpy, remaining);
    if (fillAmount < minJpy) continue;

    splits.push({
      exchange: order.exchange,
      merchant: order.merchant.name,
      amount: fillAmount,
      rate: order.price,
      cryptoAmount: fillAmount / order.price,
      completionRate: order.merchant.completionRate,
      paymentMethods: order.paymentMethods,
    });

    remaining -= fillAmount;
  }

  // Calculate totals
  const totalCrypto = splits.reduce((sum, s) => sum + s.cryptoAmount, 0);
  const effectiveRate = totalCrypto > 0 ? (totalAmountJpy - remaining) / totalCrypto : 0;

  // Compare with single best rate
  const singleBest = rates.bestBuyExchange;
  const singleBestRate = singleBest?.price || 0;
  const singleCrypto = singleBestRate > 0 ? totalAmountJpy / singleBestRate : 0;
  const savings = totalCrypto > singleCrypto ? (totalCrypto - singleCrypto) * effectiveRate : 0;

  return {
    totalAmountJpy,
    crypto,
    splits,
    totalCrypto: Math.round(totalCrypto * 100) / 100,
    effectiveRate: Math.round(effectiveRate * 100) / 100,
    singleBestRate,
    singleBestExchange: singleBest?.exchange || 'N/A',
    savings: Math.round(savings),
    savingsPercent: singleBestRate > 0 ? Math.round((1 - effectiveRate / singleBestRate) * 10000) / 100 : 0,
    orderCount: splits.length,
  };
}

// === Optimization: Find best split strategy ===
export function optimizeSplitting(totalAmountJpy: number, crypto: string = 'USDT'): {
  conservative: SimulationResult;  // Max per order = ¥100,000
  balanced: SimulationResult;      // Max per order = ¥300,000
  aggressive: SimulationResult;    // No limit
} {
  return {
    conservative: simulateBulkPurchase(totalAmountJpy, crypto, 100000),
    balanced: simulateBulkPurchase(totalAmountJpy, crypto, 300000),
    aggressive: simulateBulkPurchase(totalAmountJpy, crypto),
  };
}

function emptyResult(amount: number, crypto: string): SimulationResult {
  return {
    totalAmountJpy: amount, crypto, splits: [],
    totalCrypto: 0, effectiveRate: 0,
    singleBestRate: 0, singleBestExchange: 'N/A',
    savings: 0, savingsPercent: 0, orderCount: 0,
  };
}

logger.info('Bulk purchase simulator initialized');
