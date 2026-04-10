/**
 * @file mexc.ts — MEXC P2P APIフェッチャー
 * @description MEXCのP2P APIからJPY建ての売買オーダーを取得。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class MEXCFetcher implements FetcherInterface {
  name = 'MEXC';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    try {
      const res = await axios.post(
        'https://otc.mexc.com/api/otc/ad/list',
        {
          coinName: crypto,
          fiatName: CONFIG.fiat,
          tradeType: side === 'buy' ? 'BUY' : 'SELL',
          currentPage: 1,
          pageSize: CONFIG.maxOrdersPerExchange,
        },
        { headers: { 'Content-Type': 'application/json', 'User-Agent': CONFIG.userAgent }, timeout: CONFIG.requestTimeout }
      );
      const items = res.data?.data?.list || res.data?.data || [];
      return items.map((item: Record<string, unknown>) => ({
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(String(item.price || item.unitPrice || '0')),
        available: parseFloat(String(item.availableAmount || item.quantity || '0')),
        minLimit: parseFloat(String(item.minAmount || item.minLimit || '0')),
        maxLimit: parseFloat(String(item.maxAmount || item.maxLimit || '0')),
        merchant: {
          name: String(item.nickName || item.merchantName || 'Unknown'),
          completionRate: parseFloat(String(item.completionRate || item.finishRate || '0')) * (parseFloat(String(item.completionRate || '0')) <= 1 ? 100 : 1),
          orderCount: parseInt(String(item.orderCount || item.tradeCount || '0')),
          isOnline: item.isOnline !== false,
        },
        paymentMethods: ((item.payMethods || item.payTypes || []) as unknown[]).map((p) => typeof p === 'string' ? p : String((p as Record<string, unknown>).name || (p as Record<string, unknown>).payMethod || String(p))),
        fetchedAt: Date.now(),
      }));
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'MEXC', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
