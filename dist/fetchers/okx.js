"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OKXFetcher = void 0;
/**
 * @file okx.ts — OKX P2P APIフェッチャー
 * @description OKXのC2C APIからJPY建ての売買オーダーを取得。
 *   GETメソッド（他の取引所はPOST）。sideの解釈が他と逆な場合あり。
 */
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
class OKXFetcher {
    name = 'OKX';
    async fetchOrders(crypto, side) {
        try {
            const res = await axios_1.default.get('https://www.okx.com/v3/c2c/tradingOrders/books', {
                params: {
                    quoteCurrency: config_1.CONFIG.fiat.toLowerCase(),
                    baseCurrency: crypto.toLowerCase(),
                    side, paymentMethod: 'all', userType: 'all',
                },
                headers: { 'User-Agent': config_1.CONFIG.userAgent },
                timeout: config_1.CONFIG.requestTimeout,
            });
            let items = res.data?.data?.[side] || res.data?.data || [];
            if (!Array.isArray(items))
                items = [];
            return items.slice(0, config_1.CONFIG.maxOrdersPerExchange).map((item) => ({
                exchange: this.name, side, crypto, fiat: config_1.CONFIG.fiat,
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
                paymentMethods: (item.paymentMethods || []).map((p) => typeof p === 'string' ? p : (p.paymentMethod || '')),
                fetchedAt: Date.now(),
            }));
        }
        catch (err) {
            console.error(`[OKX] ${side} ${crypto}: ${err.message}`);
            return [];
        }
    }
}
exports.OKXFetcher = OKXFetcher;
