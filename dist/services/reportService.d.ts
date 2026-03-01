export interface DailyReport {
    date: string;
    totalOrders: number;
    completedOrders: number;
    totalJpyVolume: number;
    totalUsdtVolume: number;
    avgRate: number;
    byMethod: Record<string, {
        orders: number;
        jpyVolume: number;
        usdtVolume: number;
    }>;
}
export declare function getDailyReport(date: string): DailyReport;
export declare function getMonthlyReport(year: number, month: number): {
    year: number;
    month: number;
    days: DailyReport[];
};
export declare function getSummaryReport(): DailyReport[];
