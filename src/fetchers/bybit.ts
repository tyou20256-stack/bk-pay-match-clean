/**
 * @file bybit.ts — Bybit P2P APIフェッチャー
 * @description Bybitの P2P OTC APIからJPY建ての売買オーダーを取得。
 *   POSTリクエストで買い/売りオーダーを取得し、統一フォーマットに変換。
 *   支払方法コード: 1=銀行振込, 2=PayPay, 22=LINE Pay
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';

const PAYMENT_NAMES: Record<string, string> = {
  '14': '銀行振込', '78': 'PayPay', '410': 'LINE Pay',
  '46': 'Wise', '68': 'Alipay', '45': 'WeChat Pay', '48': 'Revolut',
};

export class BybitFetcher implements FetcherInterface {
  name = 'Bybit';

  async fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]> {
    try {
      const res = await axios.post(
        'https://api2.bybit.com/fiat/otc/item/online',
        {
          tokenId: crypto, currencyId: CONFIG.fiat,
          side: side === 'buy' ? '1' : '0',
          size: String(CONFIG.maxOrdersPerExchange), page: '1', paymentMethod: [],
        },
        { headers: { 'Content-Type': 'application/json', 'User-Agent': CONFIG.userAgent }, timeout: CONFIG.requestTimeout }
      );
      const items = res.data?.result?.items || [];
      return items.map((item: any) => {
        // recentExecuteRate comes as 0-100 (e.g. 9800 = 98%, or 0.98 = 98%)
        let compRate = parseFloat(item.recentExecuteRate || '0');
        // If value > 100, it's in basis points (e.g. 9800 = 98%)
        if (compRate > 100) compRate = compRate / 100;
        // If value <= 1, it's a ratio (e.g. 0.98 = 98%)
        else if (compRate <= 1) compRate = compRate * 100;
        // Otherwise it's already a percentage

        return {
          exchange: this.name, side, crypto, fiat: CONFIG.fiat,
          price: parseFloat(item.price),
          available: parseFloat(item.quantity),
          minLimit: parseFloat(item.minAmount),
          maxLimit: parseFloat(item.maxAmount),
          merchant: {
            name: item.nickName || 'Unknown',
            completionRate: compRate,
            orderCount: parseInt(item.recentOrderNum || '0'),
            isOnline: item.isOnline === 1,
          },
          paymentMethods: (item.payments || []).map((p: any) => {
            const id = p.paymentName || String(p);
            return PAYMENT_NAMES[id] || id;
          }),
          fetchedAt: Date.now(),
        };
      });
    } catch (err: any) {
      console.error(`[Bybit] ${side} ${crypto}: ${err.message}`);
      return [];
    }
  }
}
