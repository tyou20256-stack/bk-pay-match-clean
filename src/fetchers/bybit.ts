import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';

export class BybitFetcher implements FetcherInterface {
  name = 'Bybit';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    try {
      const res = await axios.post(
        'https://api2.bybit.com/fiat/otc/item/online',
        {
          tokenId: crypto,
          currencyId: CONFIG.fiat,
          side: side === 'buy' ? '1' : '0',
          size: String(CONFIG.maxOrdersPerExchange),
          page: '1',
          paymentMethod: [],
        },
        {
          headers: { 'Content-Type': 'application/json', 'User-Agent': CONFIG.userAgent },
          timeout: CONFIG.requestTimeout,
        }
      );
      const items = res.data?.result?.items || [];
      return items.map((item: any) => ({
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(item.price),
        available: parseFloat(item.quantity),
        minLimit: parseFloat(item.minAmount),
        maxLimit: parseFloat(item.maxAmount),
        merchant: {
          name: item.nickName || 'Unknown',
          completionRate: parseFloat(item.recentExecuteRate || '0') * 100,
          orderCount: parseInt(item.recentOrderNum || '0'),
          isOnline: item.isOnline === 1,
        },
        paymentMethods: (item.payments || []).map((p: any) => p.paymentName || String(p)),
        fetchedAt: Date.now(),
      }));
    } catch (err: any) {
      console.error(`[Bybit] ${side} ${crypto}: ${err.message}`);
      return [];
    }
  }
}
