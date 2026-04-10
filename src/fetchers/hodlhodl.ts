/**
 * @file hodlhodl.ts — HodlHodl P2P APIフェッチャー
 * @description HodlHodlのAPIからJPY建ての売買オーダーを取得。
 *   分散型P2P取引所（BTC中心）。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class HodlHodlFetcher implements FetcherInterface {
  name = 'HodlHodl';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    if (crypto !== 'BTC') return []; // HodlHodl is BTC-only
    try {
      const res = await axios.get('https://hodlhodl.com/api/v1/offers', {
        params: {
          filters: JSON.stringify({
            side: side === 'buy' ? 'sell' : 'buy', // Reversed: we buy from sellers
            currency_code: CONFIG.fiat,
            include_global: true,
          }),
          pagination: JSON.stringify({ limit: CONFIG.maxOrdersPerExchange }),
        },
        headers: { 'User-Agent': CONFIG.userAgent },
        timeout: CONFIG.requestTimeout,
      });
      const items = res.data?.offers || [];
      return items.map((item: Record<string, unknown>) => {
        const trader = (item.trader || {}) as Record<string, unknown>;
        return {
          exchange: this.name, side, crypto, fiat: CONFIG.fiat,
          price: parseFloat(String(item.price || '0')),
          available: parseFloat(String(item.max_amount_available || item.max_amount || '0')) / parseFloat(String(item.price || '1')),
          minLimit: parseFloat(String(item.min_amount || '0')),
          maxLimit: parseFloat(String(item.max_amount || '0')),
          merchant: {
            name: String(trader.login || 'Unknown'),
            completionRate: parseFloat(String(trader.trades_completed_percent || '0')),
            orderCount: parseInt(String(trader.trades_count || '0')),
            isOnline: trader.online_status === 'online',
          },
          paymentMethods: ((item.payment_methods || []) as Record<string, unknown>[]).map((p) => String(p.name || p.type || String(p))),
          fetchedAt: Date.now(),
        };
      });
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'HodlHodl', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
