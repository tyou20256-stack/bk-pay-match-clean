/**
 * @file gate.ts — Gate.io P2P APIフェッチャー
 * @description Gate.ioのC2C APIからJPY建ての売買オーダーを取得。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class GateFetcher implements FetcherInterface {
  name = 'Gate.io';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    try {
      const res = await axios.get('https://www.gate.io/apiw/v1/c2c/ads', {
        params: {
          fiat: CONFIG.fiat,
          crypto: crypto,
          side: side,
          page: 1,
          limit: CONFIG.maxOrdersPerExchange,
        },
        headers: { 'User-Agent': CONFIG.userAgent },
        timeout: CONFIG.requestTimeout,
      });
      const items = res.data?.data?.list || res.data?.data || [];
      return items.map((item: Record<string, unknown>) => ({
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(String(item.price || '0')),
        available: parseFloat(String(item.amount || item.availableAmount || '0')),
        minLimit: parseFloat(String(item.minAmount || item.minTradeAmount || '0')),
        maxLimit: parseFloat(String(item.maxAmount || item.maxTradeAmount || '0')),
        merchant: {
          name: String(item.merchantName || item.nickName || 'Unknown'),
          completionRate: parseFloat(String(item.completionRate || item.finishRate || '0')) * 100,
          orderCount: parseInt(String(item.tradeCount || item.orderCount || '0')),
          isOnline: item.isOnline !== false,
        },
        paymentMethods: ((item.payMethods || item.payTypes || []) as unknown[]).map((p) => typeof p === 'string' ? p : String((p as Record<string, unknown>).name || (p as Record<string, unknown>).payType || String(p))),
        fetchedAt: Date.now(),
      }));
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'Gate.io', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
