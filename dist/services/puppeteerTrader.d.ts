/**
 * @file puppeteerTrader.ts — Puppeteer自動取引フレームワーク
 * @description ヘッドレスブラウザで取引所にログインし、P2P注文を自動作成する。
 *   現在はフレームワークのみ実装済み。実際の取引実行には認証情報の設定が必要。
 *   対応取引所: Bybit, OKX
 *
 *   背景: 4取引所ともP2P注文作成の公開APIが存在しないため、
 *   ブラウザ自動化（Puppeteer）が唯一の自動化手段。
 * @status 未稼働（フレームワークのみ）
 */
interface ExchangeCredentials {
    exchange: string;
    email?: string;
    password?: string;
    apiKey?: string;
    apiSecret?: string;
    totpSecret?: string;
}
interface TradeResult {
    success: boolean;
    orderId?: string;
    paymentInfo?: {
        bankName?: string;
        branchName?: string;
        accountNumber?: string;
        accountHolder?: string;
        payId?: string;
        qrImageUrl?: string;
    };
    error?: string;
}
declare class PuppeteerTrader {
    private browser;
    private credentials;
    private isReady;
    init(): Promise<void>;
    setCredentials(creds: ExchangeCredentials): void;
    createBybitOrder(adId: string, amount: number, payMethod: string): Promise<TradeResult>;
    createOKXOrder(adId: string, amount: number, payMethod: string): Promise<TradeResult>;
    getStatus(): {
        browserReady: boolean;
        configuredExchanges: string[];
        supported: string[];
    };
    shutdown(): Promise<void>;
}
export declare const trader: PuppeteerTrader;
export default trader;
