/**
 * @file bisq.ts — Bisq 分散型取引所フェッチャー
 * @description BisqのAPIからJPY建てのP2Pオファーを取得。
 *   完全分散型(Tor経由)のため、公開APIは限定的。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class BisqFetcher implements FetcherInterface {
  name = 'Bisq';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    if (crypto !== 'BTC') return []; // Bisq is primarily BTC
    try {
      const direction = side === 'buy' ? 'SELL' : 'BUY'; // Reversed perspective
      const res = await axios.get(`https://bisq.markets/api/offers`, {
        params: {
          market: `btc_${CONFIG.fiat.toLowerCase()}`,
          direction,
        },
        headers: { 'User-Agent': CONFIG.userAgent },
        timeout: CONFIG.requestTimeout,
      });
      const items = (res.data?.[`btc_${CONFIG.fiat.toLowerCase()}`] || res.data || []).slice(0, CONFIG.maxOrdersPerExchange);
      return items.map((item: Record<string, unknown>) => ({
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(String(item.price || '0')),
        available: parseFloat(String(item.amount || '0')) / 100000000,
        minLimit: parseFloat(String(item.min_amount || '0')) / 100000000,
        maxLimit: parseFloat(String(item.amount || '0')) / 100000000,
        merchant: {
          name: typeof item.offer_id === 'string' ? item.offer_id.slice(0, 8) : 'Anonymous',
          completionRate: 95,
          orderCount: 0,
          isOnline: true,
        },
        paymentMethods: [String(item.payment_method || 'Bisq Escrow')],
        fetchedAt: Date.now(),
      }));
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'Bisq', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
