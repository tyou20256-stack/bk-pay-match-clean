import ccxt from 'ccxt';

const exchange = new ccxt.binance({ enableRateLimit: true });

let usdtJpyCache: { price: number; time: number } | null = null;

async function getUsdtJpy(): Promise<number | null> {
  // Use cache if less than 60s old
  if (usdtJpyCache && Date.now() - usdtJpyCache.time < 60000) return usdtJpyCache.price;
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
  } catch {
    return usdtJpyCache?.price || 149.5;
  }
}

export async function getSpotPrice(crypto: string, fiat: string): Promise<number | null> {
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
  } catch (err: any) {
    console.error(`[Spot] ${crypto}/${fiat}: ${err.message}`);
    return null;
  }
}

export async function getAllSpotPrices(cryptos: readonly string[], fiat: string): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  for (const crypto of cryptos) {
    const price = await getSpotPrice(crypto, fiat);
    if (price) prices[crypto] = price;
  }
  return prices;
}
