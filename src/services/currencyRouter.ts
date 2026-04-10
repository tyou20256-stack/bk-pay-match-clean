/**
 * @file currencyRouter.ts — マルチ通貨ルーティング
 * @description JPY→BTC→USDT等の間接ルートを探索し、直接ルートと比較して
 *   最適な経路を提案する。クロスカレンシーアービトラージの検出にも利用。
 */
import { getCachedRates } from './aggregator.js';
import { AggregatedRates } from '../types.js';
import logger from './logger.js';

// === Types ===
export interface RouteStep {
  from: string;
  to: string;
  exchange: string;
  rate: number;
  effectiveRate: number; // After fees
  fees: number;
}

export interface Route {
  path: string[];
  steps: RouteStep[];
  exchanges: string[];
  inputAmount: number;
  outputAmount: number;
  effectiveRate: number;
  totalFees: number;
  savingsVsDirect: number;
  savingsPercent: number;
}

// Supported cryptos for routing
const CRYPTOS = ['USDT', 'BTC', 'ETH'];
const FEE_RATE = 0.001; // 0.1% assumed trading fee per hop

// === Route Finding ===
export function findAllRoutes(fromCurrency: string, toCurrency: string, amount: number): Route[] {
  const routes: Route[] = [];

  // Direct route
  const direct = findDirectRoute(fromCurrency, toCurrency, amount);
  if (direct) routes.push(direct);

  // Indirect routes via intermediary crypto
  for (const intermediate of CRYPTOS) {
    if (intermediate === fromCurrency || intermediate === toCurrency) continue;
    const indirect = findIndirectRoute(fromCurrency, intermediate, toCurrency, amount);
    if (indirect) routes.push(indirect);
  }

  // Sort by output amount descending (best first)
  routes.sort((a, b) => b.outputAmount - a.outputAmount);

  // Calculate savings vs direct
  if (routes.length > 0 && direct) {
    for (const route of routes) {
      route.savingsVsDirect = route.outputAmount - direct.outputAmount;
      route.savingsPercent = direct.outputAmount > 0
        ? Math.round((route.savingsVsDirect / direct.outputAmount) * 10000) / 100
        : 0;
    }
  }

  return routes;
}

function findDirectRoute(from: string, to: string, amount: number): Route | null {
  if (from === 'JPY') {
    const rates = getCachedRates(to) as AggregatedRates;
    if (!rates?.bestBuyExchange) return null;
    const bestRate = rates.bestBuyExchange.price;
    if (!bestRate || bestRate <= 0) return null;
    const fees = amount * FEE_RATE;
    const outputAmount = (amount - fees) / bestRate;
    return {
      path: [from, to],
      steps: [{
        from, to,
        exchange: rates.bestBuyExchange.exchange,
        rate: bestRate,
        effectiveRate: bestRate / (1 - FEE_RATE),
        fees,
      }],
      exchanges: [rates.bestBuyExchange.exchange],
      inputAmount: amount,
      outputAmount: Math.round(outputAmount * 100) / 100,
      effectiveRate: Math.round(bestRate * 100) / 100,
      totalFees: Math.round(fees),
      savingsVsDirect: 0,
      savingsPercent: 0,
    };
  }
  return null;
}

function findIndirectRoute(from: string, intermediate: string, to: string, amount: number): Route | null {
  // Step 1: from → intermediate (e.g., JPY → BTC)
  const step1Rates = getCachedRates(intermediate) as AggregatedRates;
  if (!step1Rates?.bestBuyExchange) return null;

  const step1Rate = step1Rates.bestBuyExchange.price;
  const step1Fees = amount * FEE_RATE;
  const intermediateAmount = (amount - step1Fees) / step1Rate;

  // Step 2: intermediate → to (e.g., BTC → USDT)
  // We need cross-rate data. Use spot prices as approximation.
  const toRates = getCachedRates(to) as AggregatedRates;
  const intermediateSpot = step1Rates.spotPrices?.[intermediate] || step1Rate;
  const toSpot = toRates?.spotPrices?.[to] || (toRates?.bestSellExchange?.price || 0);

  if (!toSpot || toSpot <= 0 || !intermediateSpot || intermediateSpot <= 0) return null;

  // Cross rate: how much `to` per `intermediate`
  const crossRate = intermediateSpot / toSpot;
  const step2Fees = intermediateAmount * crossRate * toSpot * FEE_RATE;
  const outputAmount = intermediateAmount * crossRate * (1 - FEE_RATE);

  const step2Exchange = toRates?.bestSellExchange?.exchange || step1Rates.bestBuyExchange.exchange;

  return {
    path: [from, intermediate, to],
    steps: [
      {
        from, to: intermediate,
        exchange: step1Rates.bestBuyExchange.exchange,
        rate: step1Rate,
        effectiveRate: step1Rate / (1 - FEE_RATE),
        fees: step1Fees,
      },
      {
        from: intermediate, to,
        exchange: step2Exchange,
        rate: crossRate,
        effectiveRate: crossRate / (1 - FEE_RATE),
        fees: Math.round(step2Fees),
      },
    ],
    exchanges: [step1Rates.bestBuyExchange.exchange, step2Exchange],
    inputAmount: amount,
    outputAmount: Math.round(outputAmount * 100) / 100,
    effectiveRate: outputAmount > 0 ? Math.round((amount / outputAmount) * 100) / 100 : 0,
    totalFees: Math.round(step1Fees + step2Fees),
    savingsVsDirect: 0,
    savingsPercent: 0,
  };
}

// === Best Route ===
export function findBestRoute(fromCurrency: string, toCurrency: string, amount: number): Route | null {
  const routes = findAllRoutes(fromCurrency, toCurrency, amount);
  return routes.length > 0 ? routes[0] : null;
}

// === Route Comparison ===
export function compareRoutes(amount: number, toCrypto: string = 'USDT'): {
  direct: Route | null;
  indirect: Route[];
  bestRoute: Route | null;
  recommendation: string;
} {
  const routes = findAllRoutes('JPY', toCrypto, amount);
  const direct = routes.find(r => r.path.length === 2) || null;
  const indirect = routes.filter(r => r.path.length > 2);
  const bestRoute = routes[0] || null;

  let recommendation = '直接ルートが最適です';
  if (bestRoute && direct && bestRoute.outputAmount > direct.outputAmount) {
    const saving = bestRoute.outputAmount - direct.outputAmount;
    recommendation = `${bestRoute.path.join('→')} ルートが最適: +${saving.toFixed(2)} ${toCrypto} (${bestRoute.savingsPercent}% 節約)`;
  }

  return { direct, indirect, bestRoute, recommendation };
}

logger.info('Multi-currency routing initialized');
