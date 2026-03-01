export interface SpreadConfig {
    crypto: string;
    buyMarkup: number;
    sellDiscount: number;
    autoAdjust: boolean;
    minMarkup: number;
    maxMarkup: number;
}
interface SpreadRecommendation {
    crypto: string;
    side: 'buy' | 'sell';
    baseRate: number;
    demandAdjustment: number;
    timeAdjustment: number;
    competitorAdjustment: number;
    finalSpread: number;
    reason: string[];
}
export declare function getSpreadConfig(crypto?: string): SpreadConfig[];
export declare function updateSpreadConfig(crypto: string, data: Partial<SpreadConfig>): void;
export declare function recordOrder(crypto: string, amountJpy: number, hour?: number): void;
export declare function getOptimalSpread(crypto: string, side: 'buy' | 'sell'): Promise<SpreadRecommendation>;
export declare function getSpreadReport(): Promise<any>;
export declare function get24hStats(): any[];
declare const _default: {
    getOptimalSpread: typeof getOptimalSpread;
    recordOrder: typeof recordOrder;
    getSpreadReport: typeof getSpreadReport;
    getSpreadConfig: typeof getSpreadConfig;
    updateSpreadConfig: typeof updateSpreadConfig;
    get24hStats: typeof get24hStats;
};
export default _default;
