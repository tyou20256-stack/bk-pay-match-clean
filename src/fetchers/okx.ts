/**
 * @file okx.ts — OKX P2P APIフェッチャー
 * @description OKXのC2C APIからJPY建ての売買オーダーを取得。
 *   GETメソッド（他の取引所はPOST）。sideの解釈が他と逆な場合あり。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class OKXFetcher implements FetcherInterface {
  name = 'OKX';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    try {
      const res = await axios.get(
        'https://www.okx.com/v3/c2c/tradingOrders/books',
        {
          params: {
            quoteCurrency: CONFIG.fiat.toLowerCase(),
            baseCurrency: crypto.toLowerCase(),
            side, paymentMethod: 'all', userType: 'all',
          },
          headers: { 'User-Agent': CONFIG.userAgent },
          timeout: CONFIG.requestTimeout,
        }
      );
      let items = res.data?.data?.[side] || res.data?.data || [];
      if (!Array.isArray(items)) items = [];
      return items.slice(0, CONFIG.maxOrdersPerExchange).map((item: Record<string, unknown>) => ({
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(String(item.price || '0')),
        available: parseFloat(String(item.availableAmount || item.quoteMaxAmountPerOrder || '0')),
        minLimit: parseFloat(String(item.quoteMinAmountPerOrder || '0')),
        maxLimit: parseFloat(String(item.quoteMaxAmountPerOrder || '0')),
        merchant: {
          name: String(item.nickName || 'Unknown'),
          completionRate: parseFloat(String(item.completedRate || '0')) * 100,
          orderCount: parseInt(String(item.completedOrderQuantity || '0')),
          isOnline: true,
        },
        paymentMethods: ((item.paymentMethods || []) as unknown[]).map((p) => typeof p === 'string' ? p : String((p as Record<string, unknown>).paymentMethod || '')),
        fetchedAt: Date.now(),
      }));
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'OKX', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
