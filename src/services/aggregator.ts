import { recordSnapshot } from './priceHistory.js';
import { broadcast } from './websocket.js';
import logger from './logger.js';
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
import { KuCoinFetcher } from '../fetchers/kucoin';
import { GateFetcher } from '../fetchers/gate';
import { MEXCFetcher } from '../fetchers/mexc';
import { PaxfulFetcher } from '../fetchers/paxful';
import { NoonesFetcher } from '../fetchers/noones';
import { HodlHodlFetcher } from '../fetchers/hodlhodl';
import { BisqFetcher } from '../fetchers/bisq';
import { AgoraDeskFetcher } from '../fetchers/agoradesk';
import { PeachFetcher } from '../fetchers/peach';
import { RoboSatsFetcher } from '../fetchers/robosats';
import { getAllSpotPrices } from './spot';
import { processArbitrage } from './arbitrage';
import { CONFIG } from '../config';
import { ExchangeRates, AggregatedRates, ArbitrageOpp, FetcherInterface } from '../types';

// All available fetchers — enable/disable via CONFIG.enabledExchanges
const allFetchers: Record<string, FetcherInterface> = {
  'Bybit': new BybitFetcher(),
  'Binance': new BinanceFetcher(),
  'OKX': new OKXFetcher(),
  'KuCoin': new KuCoinFetcher(),
  'Gate.io': new GateFetcher(),
  'MEXC': new MEXCFetcher(),
  'Paxful': new PaxfulFetcher(),
  'Noones': new NoonesFetcher(),
  'HodlHodl': new HodlHodlFetcher(),
  'Bisq': new BisqFetcher(),
  'AgoraDesk': new AgoraDeskFetcher(),
  'Peach': new PeachFetcher(),
  'RoboSats': new RoboSatsFetcher(),
};

const enabledExchanges = (CONFIG as Record<string, unknown>).enabledExchanges as string[] || ['Bybit', 'Binance', 'OKX'];
const fetchers: FetcherInterface[] = enabledExchanges
  .map((name: string) => allFetchers[name])
  .filter(Boolean);

logger.info('Enabled exchanges', { exchanges: fetchers.map(f => f.name) });

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
        logger.info('Filtered out deviant orders', { exchange: fetcher.name, removedBuy, removedSell, maxDeviationPct: CONFIG.maxDeviationPct });
      }
      const bestBuy = filteredBuyOrders.length > 0 ? filteredBuyOrders.reduce((min, o) => o.price < min ? o.price : min, filteredBuyOrders[0].price) : null;
      const bestSell = filteredSellOrders.length > 0 ? filteredSellOrders.reduce((max, o) => o.price > max ? o.price : max, filteredSellOrders[0].price) : null;
      const spread = bestBuy && bestSell ? bestBuy - bestSell : null;
      const buyPremium = bestBuy && spotPrice ? ((bestBuy - spotPrice) / spotPrice) * 100 : null;
      const sellPremium = bestSell && spotPrice ? ((bestSell - spotPrice) / spotPrice) * 100 : null;
      return { exchange: fetcher.name, crypto, buyOrders: filteredBuyOrders, sellOrders: filteredSellOrders, bestBuy, bestSell, spread, spotPrice, buyPremium, sellPremium, lastUpdated: Date.now() };
    } catch (err: unknown) {
      return { exchange: fetcher.name, crypto, buyOrders: [], sellOrders: [], bestBuy: null, bestSell: null, spread: null, spotPrice, buyPremium: null, sellPremium: null, lastUpdated: Date.now(), error: err instanceof Error ? err.message : String(err) };
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

  // Record price history
  try { recordSnapshot(crypto, result); } catch(e) {}

  cachedRates.set(crypto, result);

  // Update merchant scores
  try { const { updateMerchantsFromRates } = await import('./merchantScoring.js'); updateMerchantsFromRates(result); } catch(e) {}

  // Check trading rules
  try { const { checkAllRules } = await import('./ruleEngine.js'); await checkAllRules(result); } catch(e) {}

  // Broadcast rates via WebSocket
  broadcast("rates", { crypto, ...result });
  return result;
}

export function getCachedRates(crypto?: string): AggregatedRates | Map<string, AggregatedRates> {
  if (crypto) return cachedRates.get(crypto) || { rates: [], bestBuyExchange: null, bestSellExchange: null, arbitrageOpportunities: [], spotPrices: {}, lastUpdated: 0 };
  return cachedRates;
}

export async function updateAllCryptos(): Promise<void> {
  logger.info('Updating rates', { cryptos: CONFIG.cryptos });
  const start = Date.now();
  // Parallelize per-crypto fetches. Previously this ran sequentially
  // (5-9s per cycle); with Promise.all each crypto's 6 exchange calls
  // still run in parallel within fetchAllRates, so total wall time is
  // bounded by the slowest single exchange (~2-3s).
  await Promise.all(
    CONFIG.cryptos.map((crypto) =>
      fetchAllRates(crypto).catch((e: unknown) =>
        logger.error('fetchAllRates failed', {
          crypto,
          error: e instanceof Error ? e.message : String(e),
        })
      )
    )
  );
  logger.info('Rates updated', { durationMs: Date.now() - start });
}
