/**
 * @file kucoin.ts — KuCoin P2P APIフェッチャー
 * @description KuCoinのP2P APIからJPY建ての売買オーダーを取得。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class KuCoinFetcher implements FetcherInterface {
  name = 'KuCoin';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    try {
      const res = await axios.post(
        'https://www.kucoin.com/_api/otc/ad/list',
        {
          currency: crypto,
          side: side === 'buy' ? 'BUY' : 'SELL',
          legal: CONFIG.fiat,
          page: 1,
          pageSize: CONFIG.maxOrdersPerExchange,
        },
        { headers: { 'Content-Type': 'application/json', 'User-Agent': CONFIG.userAgent }, timeout: CONFIG.requestTimeout }
      );
      const items = res.data?.items || res.data?.data?.items || [];
      return items.map((item: Record<string, unknown>) => ({
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(String(item.price || item.floatPrice || '0')),
        available: parseFloat(String(item.currencyBalanceQuantity || item.limitAmount || '0')),
        minLimit: parseFloat(String(item.limitMinQuote || item.minOrderLimit || '0')),
        maxLimit: parseFloat(String(item.limitMaxQuote || item.maxOrderLimit || '0')),
        merchant: {
          name: String(item.nickName || item.merchantName || 'Unknown'),
          completionRate: parseFloat(String(item.completedRate || item.finishRatio || '0')) * ((item.completedRate as number) > 1 ? 1 : 100),
          orderCount: parseInt(String(item.orderNum || item.tradeCount || '0')),
          isOnline: item.status === 'ONLINE' || item.isOnline === true,
        },
        paymentMethods: ((item.payTypeCodes || item.tradeMethods || []) as unknown[]).map((p) => typeof p === 'string' ? p : String((p as Record<string, unknown>).payType || (p as Record<string, unknown>).identifier || String(p))),
        fetchedAt: Date.now(),
      }));
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'KuCoin', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
