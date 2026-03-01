interface TradeResult {
    success: boolean;
    orderId?: string;
    error?: string;
}
declare class P2PTrader {
    private browser;
    private pages;
    private loggedIn;
    private lastActivity;
    private running;
    init(): Promise<void>;
    private getPage;
    private saveCookies;
    private loadCookies;
    private takeErrorScreenshot;
    login(exchange: 'Bybit' | 'Binance', email?: string, password?: string, totpSecret?: string): Promise<boolean>;
    private loginBybit;
    private loginBinance;
    createBuyOrder(exchange: string, cryptoSymbol: string, amount: number, payMethod: string): Promise<TradeResult>;
    private createBybitBuyOrder;
    private createBinanceBuyOrder;
    confirmPayment(exchange: string, orderId: string): Promise<boolean>;
    checkOrderStatus(exchange: string, orderId: string): Promise<string>;
    releaseCrypto(exchange: string, orderId: string): Promise<boolean>;
    private extractOrderId;
    private generateTOTP;
    getStatus(): {
        browserReady: boolean;
        configuredExchanges: string[];
        supported: string[];
        loginStatus: Record<string, any>;
    };
    getScreenshotPath(): string | null;
    close(): Promise<void>;
}
export declare const trader: P2PTrader;
export default trader;
