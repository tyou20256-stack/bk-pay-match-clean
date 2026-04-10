/**
 * @file htx.ts — HTX P2P APIフェッチャー（無効化済み）
 * @description currency=11がJPYではなくRUB（ロシアルーブル）であることが判明。
 *   全通貨ID(1-30)をスキャンし、JPY市場が存在しないことを確認。
 *   aggregator.tsでimportをコメントアウトして無効化。
 * @deprecated JPY非対応のため使用不可
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

// HTX coinId mapping
const COIN_IDS: Record<string, number> = { USDT: 2, BTC: 1, ETH: 3 };
// HTX currency: 11 = JPY
const CURRENCY_ID = 11;

const PAY_METHODS: Record<number, string> = {
  1: '銀行振込', 2: 'Alipay', 3: 'WeChat', 29: 'LINE Pay',
  36: 'PayPay', 169: 'Cash', 170: 'au PAY',
};

export class HTXFetcher implements FetcherInterface {
  name = 'HTX';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    const coinId = COIN_IDS[crypto];
    if (!coinId) return [];
    try {
      const res = await axios.get(
        'https://www.htx.com/-/x/otc/v1/data/trade-market',
        {
          params: {
            coinId, currency: CURRENCY_ID,
            tradeType: side, currPage: 1,
            payMethod: 0, acceptOrder: 0,
            blockType: 'general', online: 1,
            range: 0, onlyTradable: false,
          },
          headers: { 'User-Agent': CONFIG.userAgent },
          timeout: CONFIG.requestTimeout,
        }
      );
      const items = res.data?.data || [];
      return items.slice(0, CONFIG.maxOrdersPerExchange).map((item: Record<string, unknown>) => ({
        exchange: this.name, side, crypto, fiat: CONFIG.fiat,
        price: parseFloat(String(item.price || '0')),
        available: parseFloat(String(item.tradeCount || '0')),
        minLimit: parseFloat(String(item.minTradeLimit || '0')),
        maxLimit: parseFloat(String(item.maxTradeLimit || '0')),
        merchant: {
          name: String(item.userName || 'Unknown'),
          completionRate: parseFloat(String(item.orderCompleteRate || '0')),
          orderCount: (item.tradeMonthTimes as number) || 0,
          isOnline: item.isOnline === true,
        },
        paymentMethods: ((item.payMethods || []) as Record<string, unknown>[]).map((p) => PAY_METHODS[p.payMethodId as number] || String(p.name || String(p.payMethodId))),
        fetchedAt: Date.now(),
      }));
    } catch (err: unknown) {
      logger.error('Fetch orders failed', { exchange: 'HTX', side, crypto, error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}
