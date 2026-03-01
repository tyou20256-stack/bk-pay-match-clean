/**
 * @file okx.ts — OKX P2P APIフェッチャー
 * @description OKXのC2C APIからJPY建ての売買オーダーを取得。
 *   GETメソッド（他の取引所はPOST）。sideの解釈が他と逆な場合あり。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';

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
      return items.slice(0, CONFIG.maxOrdersPerExchange).map((item: any) => ({
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(item.price || '0'),
        available: parseFloat(item.availableAmount || item.quoteMaxAmountPerOrder || '0'),
        minLimit: parseFloat(item.quoteMinAmountPerOrder || '0'),
        maxLimit: parseFloat(item.quoteMaxAmountPerOrder || '0'),
        merchant: {
          name: item.nickName || 'Unknown',
          completionRate: parseFloat(item.completedRate || '0') * 100,
          orderCount: parseInt(item.completedOrderQuantity || '0'),
          isOnline: true,
        },
        paymentMethods: (item.paymentMethods || []).map((p: any) => typeof p === 'string' ? p : (p.paymentMethod || '')),
        fetchedAt: Date.now(),
      }));
    } catch (err: any) {
      console.error(`[OKX] ${side} ${crypto}: ${err.message}`);
      return [];
    }
  }
}
