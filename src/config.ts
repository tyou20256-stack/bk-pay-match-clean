/**
 * @file config.ts — システム設定
 * @description P2Pアグリゲーターの全体設定を管理。ポート、更新間隔、対象通貨、
 *   フィルター閾値などを定義。変更はサーバー再起動で反映。
 */
export const CONFIG = {
  port: 3003,
  updateIntervalMs: 30000,
  cryptos: ['USDT', 'BTC', 'ETH'] as const,
  fiat: 'JPY',
  maxOrdersPerExchange: 15,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  requestTimeout: 10000,
  arbitrageThreshold: 0.5, // % profit to flag
  maxDeviationPct: 15, // スポットレートからの最大乖離率（%）。超えたオーダーは除外
};
