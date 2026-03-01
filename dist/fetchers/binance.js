"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceFetcher = void 0;
/**
 * @file binance.ts — Binance P2P APIフェッチャー
 * @description BinanceのC2C APIからJPY建ての売買オーダーを取得。
 *   注意: 日本IPからブロックされることがある。
 *   レスポンスがgzip圧縮される場合がある。
 */
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
class BinanceFetcher {
    name = 'Binance';
    async fetchOrders(crypto, side) {
        try {
            const res = await axios_1.default.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
                fiat: config_1.CONFIG.fiat, page: 1, rows: config_1.CONFIG.maxOrdersPerExchange,
                tradeType: side === 'buy' ? 'BUY' : 'SELL',
                asset: crypto, payTypes: [], publisherType: null,
            }, {
                headers: { 'Content-Type': 'application/json', 'User-Agent': config_1.CONFIG.userAgent },
                timeout: config_1.CONFIG.requestTimeout,
            });
            const items = res.data?.data || [];
            return items.map((item) => {
                const adv = item.adv || {};
                const ad = item.advertiser || {};
                return {
                    exchange: this.name, side, crypto, fiat: config_1.CONFIG.fiat,
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
                    paymentMethods: (adv.tradeMethods || []).map((m) => m.tradeMethodName || m.identifier),
                    fetchedAt: Date.now(),
                };
            });
        }
        catch (err) {
            console.error(`[Binance] ${side} ${crypto}: ${err.message}`);
            return [];
        }
    }
}
exports.BinanceFetcher = BinanceFetcher;
