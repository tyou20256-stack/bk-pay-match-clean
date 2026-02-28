import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
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
      return items.map((item: any) => {
        const adv = item.adv || {};
        const ad = item.advertiser || {};
        return {
          exchange: this.name, side, crypto, fiat: CONFIG.fiat,
          price: parseFloat(adv.price || '0'),
          available: parseFloat(adv.surplusAmount || '0'),
          minLimit: parseFloat(adv.minSingleTransAmount || '0'),
          maxLimit: parseFloat(adv.maxSingleTransAmount || '0'),
          merchant: {
            name: ad.nickName || 'Unknown',
            completionRate: parseFloat(ad.monthFinishRate || '0') * 100,
            orderCount: ad.monthOrderCount || 0,
            isOnline: ad.userOnlineStatus === 'online',
          },
          paymentMethods: (adv.tradeMethods || []).map((m: any) => m.tradeMethodName || m.identifier),
          fetchedAt: Date.now(),
        };
      });
    } catch (err: any) {
      console.error(`[Binance] ${side} ${crypto}: ${err.message}`);
      return [];
    }
  }
}
