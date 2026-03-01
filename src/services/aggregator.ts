/**
 * @file aggregator.ts — レート集約エンジン
 * @description 全取引所のP2Pレートを30秒間隔で取得・集約する中核モジュール。
 *   スポットレートからの乖離率フィルター（±maxDeviationPct%超を除外）、
 *   アービトラージ検出、キャッシュ管理を行う。
 *   データフロー: Fetchers → 乖離率フィルター → 集約 → キャッシュ → API
 */
import { BybitFetcher } from '../fetchers/bybit';
import { BinanceFetcher } from '../fetchers/binance';
import { OKXFetcher } from '../fetchers/okx';
// import { HTXFetcher } from '../fetchers/htx'; // Disabled: currency=11 is RUB not JPY
import { getAllSpotPrices } from './spot';
import { processArbitrage } from './arbitrage';
import { CONFIG } from '../config';
import { ExchangeRates, AggregatedRates, ArbitrageOpp, FetcherInterface } from '../types';

const fetchers: FetcherInterface[] = [
  new BybitFetcher(),
  new BinanceFetcher(),
  new OKXFetcher(),
  // new HTXFetcher(), // Disabled: no JPY market on HTX
];

let cachedRates: Map<string, AggregatedRates> = new Map();

export async function fetchAllRates(crypto: string): Promise<AggregatedRates> {
  const spotPrices = await getAllSpotPrices([crypto], CONFIG.fiat);
  const spotPrice = spotPrices[crypto] || null;

  const ratesPromises = fetchers.map(async (fetcher): Promise<ExchangeRates> => {
    try {
      const [buyOrders, sellOrders] = await Promise.all([
        fetcher.fetchOrders(crypto, 'buy'),
        fetcher.fetchOrders(crypto, 'sell'),
      ]);
      // Filter out orders with excessive deviation from spot price
      const maxDev = CONFIG.maxDeviationPct / 100;
      const filteredBuyOrders = spotPrice ? buyOrders.filter(o => Math.abs(o.price - spotPrice) / spotPrice <= maxDev) : buyOrders;
      const filteredSellOrders = spotPrice ? sellOrders.filter(o => Math.abs(o.price - spotPrice) / spotPrice <= maxDev) : sellOrders;
      const removedBuy = buyOrders.length - filteredBuyOrders.length;
      const removedSell = sellOrders.length - filteredSellOrders.length;
      if (removedBuy + removedSell > 0) {
        console.log(`[${fetcher.name}] Filtered out ${removedBuy} buy + ${removedSell} sell orders (>${CONFIG.maxDeviationPct}% deviation)`);
      }
      const bestBuy = filteredBuyOrders.length > 0 ? Math.min(...filteredBuyOrders.map(o => o.price)) : null;
      const bestSell = filteredSellOrders.length > 0 ? Math.max(...filteredSellOrders.map(o => o.price)) : null;
      const spread = bestBuy && bestSell ? bestBuy - bestSell : null;
      const buyPremium = bestBuy && spotPrice ? ((bestBuy - spotPrice) / spotPrice) * 100 : null;
      const sellPremium = bestSell && spotPrice ? ((bestSell - spotPrice) / spotPrice) * 100 : null;
      return { exchange: fetcher.name, crypto, buyOrders: filteredBuyOrders, sellOrders: filteredSellOrders, bestBuy, bestSell, spread, spotPrice, buyPremium, sellPremium, lastUpdated: Date.now() };
    } catch (err: any) {
      return { exchange: fetcher.name, crypto, buyOrders: [], sellOrders: [], bestBuy: null, bestSell: null, spread: null, spotPrice, buyPremium: null, sellPremium: null, lastUpdated: Date.now(), error: err.message };
    }
  });

  const rates = await Promise.all(ratesPromises);
  const validBuys = rates.filter(r => r.bestBuy !== null);
  const validSells = rates.filter(r => r.bestSell !== null);
  const bestBuyExchange = validBuys.length > 0 ? validBuys.reduce((best, r) => r.bestBuy! < best.bestBuy! ? r : best) : null;
  const bestSellExchange = validSells.length > 0 ? validSells.reduce((best, r) => r.bestSell! > best.bestSell! ? r : best) : null;

  const arbitrageOpportunities: ArbitrageOpp[] = [];
  for (const buyEx of validBuys) {
    for (const sellEx of validSells) {
      if (buyEx.exchange === sellEx.exchange) continue;
      const profit = sellEx.bestSell! - buyEx.bestBuy!;
      const profitPercent = (profit / buyEx.bestBuy!) * 100;
      if (profitPercent > CONFIG.arbitrageThreshold) {
        arbitrageOpportunities.push({ buyExchange: buyEx.exchange, sellExchange: sellEx.exchange, buyPrice: buyEx.bestBuy!, sellPrice: sellEx.bestSell!, profitPerUnit: profit, profitPercent, crypto });
      }
    }
  }
  arbitrageOpportunities.sort((a, b) => b.profitPercent - a.profitPercent);

  const result: AggregatedRates = {
    rates, bestBuyExchange: bestBuyExchange ? { exchange: bestBuyExchange.exchange, price: bestBuyExchange.bestBuy! } : null,
    bestSellExchange: bestSellExchange ? { exchange: bestSellExchange.exchange, price: bestSellExchange.bestSell! } : null,
    arbitrageOpportunities, spotPrices, lastUpdated: Date.now(),
  };

  // Track arbitrage windows
  processArbitrage(result, crypto);

  cachedRates.set(crypto, result);
  return result;
}

export function getCachedRates(crypto?: string): AggregatedRates | Map<string, AggregatedRates> {
  if (crypto) return cachedRates.get(crypto) || { rates: [], bestBuyExchange: null, bestSellExchange: null, arbitrageOpportunities: [], spotPrices: {}, lastUpdated: 0 };
  return cachedRates;
}

export async function updateAllCryptos(): Promise<void> {
  console.log(`[Aggregator] Updating rates for ${CONFIG.cryptos.join(', ')}...`);
  const start = Date.now();
  for (const crypto of CONFIG.cryptos) { await fetchAllRates(crypto); }
  console.log(`[Aggregator] Updated in ${Date.now() - start}ms`);
}
