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
  // 有効な取引所一覧（aggregator.tsで参照）
  enabledExchanges: [
    'Bybit', 'Binance', 'OKX',                    // Tier S: 主要取引所（稼働中）
    // 以下は2026-03時点で非稼働・API変更のため無効化:
    // 'KuCoin',     // 404エラー
    // 'Gate.io',    // 403エラー
    // 'MEXC',       // 404エラー
    // 'Paxful',     // サービス停止
    // 'Noones',     // GraphQLのみ（REST非対応）
    // 'HodlHodl',   // 422エラー
    // 'Bisq',       // DNS解決失敗
    // 'AgoraDesk',  // 2023年閉鎖
    // 'Peach',      // タイムアウト
    // 'RoboSats',   // タイムアウト
  ] as string[],
};
