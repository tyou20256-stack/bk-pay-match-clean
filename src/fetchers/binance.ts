/**
 * @file binance.ts — Binance P2P APIフェッチャー
 * @description BinanceのC2C APIからJPY建ての売買オーダーを取得。
 *   注意: 日本IPからブロックされることがある。
 *   レスポンスがgzip圧縮される場合がある。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import logger from '../services/logger.js';
import { CONFIG } from '../config';

export class BinanceFetcher implements FetcherInterface {
  name = 'Binance';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    try {
      const res = await axios.post(
        'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
        {
          fiat: CONFIG.fiat, page: 1, rows: CONFIG.maxOrdersPerExchange,
          tradeType: side === 'buy' ? 'BUY' : 'SELL',
          asset: crypto, payTypes: [], publisherType: null,
        },
        {
          headers: { 'Content-Type': 'application/json', 'User-Agent': CONFIG.userAgent },
          timeout: CONFIG.requestTimeout,
        }
      );
      const items = res.data?.data || [];
      return items.map((item: Record<string, unknown>) => {
        const adv = (item.adv || {}) as Record<string, unknown>;
        const ad = (item.advertiser || {}) as Record<string, unknown>;
        return {
          exchange: this.name, side, crypto, fiat: CONFIG.fiat,
          price: parseFloat(String(adv.price || '0')),
          available: parseFloat(String(adv.surplusAmount || '0')),
          minLimit: parseFloat(String(adv.minSingleTransAmount || '0')),
          maxLimit: parseFloat(String(adv.maxSingleTransAmount || '0')),
          merchant: {
            name: String(ad.nickName || 'Unknown'),
            completionRate: parseFloat(String(ad.monthFinishRate || '0')) * 100,
            orderCount: (ad.monthOrderCount as number) || 0,
            isOnline: ad.userOnlineStatus === 'online',
          },
          paymentMethods: ((adv.tradeMethods || []) as Record<string, unknown>[]).map((m) => String(m.tradeMethodName || m.identifier)),
          fetchedAt: Date.now(),
        };
      });
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'Binance', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
