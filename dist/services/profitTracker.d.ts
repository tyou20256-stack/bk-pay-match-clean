export interface ProfitRecord {
    orderId: string;
    direction: 'buy' | 'sell';
    crypto: string;
    customerAmount: number;
    marketRate: number;
    customerRate: number;
    spreadProfit: number;
    feeProfit: number;
    totalProfit: number;
    timestamp: string;
}
export declare function recordProfit(order: any, marketRate?: number): void;
export declare function getDailyProfit(date: string): {
    totalProfit: any;
    spreadProfit: any;
    feeProfit: any;
    orderCount: any;
    avgProfitPerOrder: number;
};
export declare function getMonthlyProfit(year: number, month: number): any[];
export declare function getProfitSummary(): {
    today: any;
    thisWeek: any;
    thisMonth: any;
    allTime: any;
    byCrypto: any[];
};
export declare function getHourlyProfit(date: string): any[];
export declare function getProfitGoal(): number;
export declare function setProfitGoal(amount: number): void;
export declare function get7DayTrend(): any[];
