import { Router, Request, Response } from 'express';
import { getCachedRates, fetchAllRates } from '../services/aggregator';
import { AggregatedRates } from '../types';
import { CONFIG } from '../config';

const router = Router();

router.get('/rates', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, AggregatedRates> = {};
  all.forEach((v, k) => { result[k] = v; });
  res.json({ success: true, data: result });
});

router.get('/rates/:crypto', (req: Request, res: Response) => {
  const crypto = req.params.crypto.toUpperCase();
  const data = getCachedRates(crypto) as AggregatedRates;
  res.json({ success: true, data });
});

router.get('/best', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, any> = {};
  all.forEach((v, k) => {
    result[k] = { bestBuy: v.bestBuyExchange, bestSell: v.bestSellExchange, spot: v.spotPrices[k] };
  });
  res.json({ success: true, data: result });
});

router.get('/spread', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const result: Record<string, any> = {};
  all.forEach((v, k) => {
    result[k] = v.rates.map(r => ({
      exchange: r.exchange, spread: r.spread, bestBuy: r.bestBuy, bestSell: r.bestSell,
      buyPremium: r.buyPremium, sellPremium: r.sellPremium,
    }));
  });
  res.json({ success: true, data: result });
});

router.get('/arbitrage', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  const opps: any[] = [];
  all.forEach((v) => { opps.push(...v.arbitrageOpportunities); });
  opps.sort((a, b) => b.profitPercent - a.profitPercent);
  res.json({ success: true, data: opps });
});

router.post('/refresh', async (_req: Request, res: Response) => {
  const crypto = (_req.body?.crypto || 'USDT').toUpperCase();
  const data = await fetchAllRates(crypto);
  res.json({ success: true, data });
});

router.get('/status', (_req: Request, res: Response) => {
  const all = getCachedRates() as Map<string, AggregatedRates>;
  res.json({
    success: true,
    uptime: process.uptime(),
    exchanges: ['Bybit', 'Binance', 'OKX'],
    cryptos: CONFIG.cryptos,
    updateInterval: CONFIG.updateIntervalMs,
    cachedCryptos: Array.from(all.keys()),
    lastUpdated: Array.from(all.values()).map(v => ({ crypto: v.rates[0]?.crypto, time: new Date(v.lastUpdated).toISOString() })),
  });
});

export default router;
