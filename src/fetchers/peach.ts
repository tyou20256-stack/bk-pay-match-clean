/**
 * @file peach.ts — Peach Bitcoin P2Pフェッチャー
 * @description Peach BitcoinのAPIからJPY建てのP2Pオファーを取得。
 *   モバイルファーストのBTC P2P取引所。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class PeachFetcher implements FetcherInterface {
  name = 'Peach';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    if (crypto !== 'BTC') return []; // Peach is BTC-only
    try {
      const type = side === 'buy' ? 'ask' : 'bid';
      const res = await axios.get('https://api.peachbitcoin.com/v1/market/prices', {
        headers: { 'User-Agent': CONFIG.userAgent },
        timeout: CONFIG.requestTimeout,
      });
      // Peach provides market data rather than individual offers
      const jpyData = res.data?.[CONFIG.fiat] || res.data?.data?.[CONFIG.fiat];
      if (!jpyData) return [];
      const price = type === 'ask' ? jpyData.ask || jpyData.price : jpyData.bid || jpyData.price;
      if (!price) return [];
      // Peach provides aggregate market data, not individual P2P offers
      // Data is indicative only — available amount and limits are estimated
      return [{
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(price),
        available: 0, // Unknown — Peach doesn't expose individual order sizes
        minLimit: 0,
        maxLimit: 0,
        merchant: {
          name: 'Peach Market (aggregate)',
          completionRate: 0,
          orderCount: 0,
          isOnline: true,
        },
        paymentMethods: ['Peach P2P'],
        fetchedAt: Date.now(),
      }];
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'Peach', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
