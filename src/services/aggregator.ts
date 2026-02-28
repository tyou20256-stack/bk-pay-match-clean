import { BybitFetcher } from '../fetchers/bybit';
import { BinanceFetcher } from '../fetchers/binance';
import { OKXFetcher } from '../fetchers/okx';
import { getAllSpotPrices } from './spot';
import { CONFIG } from '../config';
import { ExchangeRates, AggregatedRates, ArbitrageOpp, FetcherInterface } from '../types';

const fetchers: FetcherInterface[] = [
  new BybitFetcher(),
  new BinanceFetcher(),
  new OKXFetcher(),
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
      const bestBuy = buyOrders.length > 0 ? Math.min(...buyOrders.map(o => o.price)) : null;
      const bestSell = sellOrders.length > 0 ? Math.max(...sellOrders.map(o => o.price)) : null;
      const spread = bestBuy && bestSell ? bestBuy - bestSell : null;
      const buyPremium = bestBuy && spotPrice ? ((bestBuy - spotPrice) / spotPrice) * 100 : null;
      const sellPremium = bestSell && spotPrice ? ((bestSell - spotPrice) / spotPrice) * 100 : null;
      return {
        exchange: fetcher.name, crypto, buyOrders, sellOrders,
        bestBuy, bestSell, spread, spotPrice, buyPremium, sellPremium,
        lastUpdated: Date.now(),
      };
    } catch (err: any) {
      return {
        exchange: fetcher.name, crypto, buyOrders: [], sellOrders: [],
        bestBuy: null, bestSell: null, spread: null,
        spotPrice, buyPremium: null, sellPremium: null,
        lastUpdated: Date.now(), error: err.message,
      };
    }
  });

  const rates = await Promise.all(ratesPromises);

  // Find best across exchanges
  const validBuys = rates.filter(r => r.bestBuy !== null);
  const validSells = rates.filter(r => r.bestSell !== null);
  const bestBuyExchange = validBuys.length > 0
    ? validBuys.reduce((best, r) => r.bestBuy! < best.bestBuy! ? r : best)
    : null;
  const bestSellExchange = validSells.length > 0
    ? validSells.reduce((best, r) => r.bestSell! > best.bestSell! ? r : best)
    : null;

  // Find arbitrage
  const arbitrageOpportunities: ArbitrageOpp[] = [];
  for (const buyEx of validBuys) {
    for (const sellEx of validSells) {
      if (buyEx.exchange === sellEx.exchange) continue;
      const profit = sellEx.bestSell! - buyEx.bestBuy!;
      const profitPercent = (profit / buyEx.bestBuy!) * 100;
      if (profitPercent > CONFIG.arbitrageThreshold) {
        arbitrageOpportunities.push({
          buyExchange: buyEx.exchange, sellExchange: sellEx.exchange,
          buyPrice: buyEx.bestBuy!, sellPrice: sellEx.bestSell!,
          profitPerUnit: profit, profitPercent, crypto,
        });
      }
    }
  }
  arbitrageOpportunities.sort((a, b) => b.profitPercent - a.profitPercent);

  const result: AggregatedRates = {
    rates,
    bestBuyExchange: bestBuyExchange ? { exchange: bestBuyExchange.exchange, price: bestBuyExchange.bestBuy! } : null,
    bestSellExchange: bestSellExchange ? { exchange: bestSellExchange.exchange, price: bestSellExchange.bestSell! } : null,
    arbitrageOpportunities,
    spotPrices,
    lastUpdated: Date.now(),
  };

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
  for (const crypto of CONFIG.cryptos) {
    await fetchAllRates(crypto);
  }
  console.log(`[Aggregator] Updated in ${Date.now() - start}ms`);
}
