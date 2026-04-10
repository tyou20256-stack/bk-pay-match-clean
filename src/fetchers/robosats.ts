/**
 * @file robosats.ts — RoboSats P2Pフェッチャー
 * @description RoboSatsのAPIからJPY建てのP2Pオファーを取得。
 *   Lightning Network上の分散型P2P取引所。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class RoboSatsFetcher implements FetcherInterface {
  name = 'RoboSats';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    if (crypto !== 'BTC') return []; // RoboSats is BTC/Lightning only
    try {
      const type = side === 'buy' ? 1 : 0; // 1=buy, 0=sell in RoboSats
      const res = await axios.get('https://unsafe.robosats.com/api/book/', {
        params: {
          currency: 0, // 0 for all, specific for JPY
          type,
        },
        headers: { 'User-Agent': CONFIG.userAgent },
        timeout: CONFIG.requestTimeout,
      });
      // RoboSats currency field is a numeric ID (e.g., 28 for JPY), not a string
      // Map known currency IDs: https://github.com/RoboSats/robosats/blob/main/frontend/src/utils/currency.ts
      const JPY_CURRENCY_ID = 28;
      const items = ((res.data || []) as Record<string, unknown>[])
        .filter((item) => {
          return item.currency === JPY_CURRENCY_ID || item.currency === CONFIG.fiat || String(item.currency).toUpperCase() === 'JPY';
        })
        .slice(0, CONFIG.maxOrdersPerExchange);
      return items.map((item) => ({
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(String(item.price || '0')),
        available: parseFloat(String(item.satoshis_now || item.amount || '0')) / 100000000,
        minLimit: parseFloat(String(item.min_amount || '0')),
        maxLimit: parseFloat(String(item.max_amount || '0')),
        merchant: {
          name: `Robot-${String(item.maker_hash_id || 'unknown').slice(0, 8)}`,
          completionRate: 90,
          orderCount: parseInt(String(item.maker_trades || '0')),
          isOnline: item.is_active !== false,
        },
        paymentMethods: String(item.payment_method || 'Lightning').split(', '),
        fetchedAt: Date.now(),
      }));
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'RoboSats', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
