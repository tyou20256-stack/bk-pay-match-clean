/**
 * @file types.ts — 型定義
 * @description P2Pオーダー、取引所レート、アービトラージ機会などの
 *   TypeScriptインターフェースを定義。全モジュールから参照される。
 */
export interface P2POrder {
  exchange: string;
  side: 'buy' | 'sell';
  crypto: string;
  fiat: string;
  price: number;
  available: number;
  minLimit: number;
  maxLimit: number;
  merchant: {
    name: string;
    completionRate: number;
    orderCount: number;
    isOnline: boolean;
  };
  paymentMethods: string[];
  fetchedAt: number;
}

export interface ExchangeRates {
  exchange: string;
  crypto: string;
  buyOrders: P2POrder[];
  sellOrders: P2POrder[];
  bestBuy: number | null;
  bestSell: number | null;
  spread: number | null;
  spotPrice: number | null;
  buyPremium: number | null;
  sellPremium: number | null;
  lastUpdated: number;
  error?: string;
}

export interface AggregatedRates {
  rates: ExchangeRates[];
  bestBuyExchange: { exchange: string; price: number } | null;
  bestSellExchange: { exchange: string; price: number } | null;
  arbitrageOpportunities: ArbitrageOpp[];
  spotPrices: Record<string, number>;
  lastUpdated: number;
}

export interface ArbitrageOpp {
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  profitPerUnit: number;
  profitPercent: number;
  crypto: string;
}

export interface FetcherInterface {
  name: string;
  fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]>;
}
