"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSpotPrice = getSpotPrice;
exports.getAllSpotPrices = getAllSpotPrices;
/**
 * @file spot.ts — スポットレート取得
 * @description CoinGecko APIから暗号通貨のスポット（市場基準）レートを取得。
 *   乖離率フィルターとボリューム閾値計算の基準値として使用。
 *   無料枠制限(月10,000回)あり。エラー時は前回の値をキャッシュして返却。
 */
const ccxt_1 = __importDefault(require("ccxt"));
const exchange = new ccxt_1.default.binance({ enableRateLimit: true });
let usdtJpyCache = null;
async function getUsdtJpy() {
    // Use cache if less than 60s old
    if (usdtJpyCache && Date.now() - usdtJpyCache.time < 60000)
        return usdtJpyCache.price;
    try {
        // Binance doesn't have USDT/JPY, use USD/JPY approximation via BTC
        // BTC/JPY and BTC/USDT to derive USDT/JPY
        const [btcUsdt, btcJpy] = await Promise.all([
            exchange.fetchTicker('BTC/USDT'),
            exchange.fetchTicker('BTC/JPY').catch(() => null),
        ]);
        if (btcUsdt?.last && btcJpy?.last) {
            const rate = btcJpy.last / btcUsdt.last;
            usdtJpyCache = { price: rate, time: Date.now() };
            return rate;
        }
        // Fallback: hardcode approximate rate
        return 149.5;
    }
    catch {
        return usdtJpyCache?.price || 149.5;
    }
}
async function getSpotPrice(crypto, fiat) {
    try {
        if (crypto === 'USDT') {
            return await getUsdtJpy();
        }
        // For BTC, ETH: get /USDT price * USDT/JPY
        const ticker = await exchange.fetchTicker(`${crypto}/USDT`);
        const usdtJpy = await getUsdtJpy();
        if (ticker?.last && usdtJpy) {
            return ticker.last * usdtJpy;
        }
        return null;
    }
    catch (err) {
        console.error(`[Spot] ${crypto}/${fiat}: ${err.message}`);
        return null;
    }
}
async function getAllSpotPrices(cryptos, fiat) {
    const prices = {};
    for (const crypto of cryptos) {
        const price = await getSpotPrice(crypto, fiat);
        if (price)
            prices[crypto] = price;
    }
    return prices;
}
