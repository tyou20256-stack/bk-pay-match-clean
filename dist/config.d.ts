/**
 * @file config.ts — システム設定
 * @description P2Pアグリゲーターの全体設定を管理。ポート、更新間隔、対象通貨、
 *   フィルター閾値などを定義。変更はサーバー再起動で反映。
 */
export declare const CONFIG: {
    port: number;
    updateIntervalMs: number;
    cryptos: readonly ["USDT", "BTC", "ETH"];
    fiat: string;
    maxOrdersPerExchange: number;
    userAgent: string;
    requestTimeout: number;
    arbitrageThreshold: number;
    maxDeviationPct: number;
};
