/**
 * @file arbitrage.ts — アービトラージ検出・追跡
 * @description 取引所間の価格差を監視し、利益機会を検出。
 *   開始/終了タイムスタンプ、持続時間、推定利益額を追跡。
 *   閾値(CONFIG.arbitrageThreshold %)以上の利益率で機会を記録。
 */
import { AggregatedRates } from '../types';
export interface ArbitrageWindow {
    id: string;
    crypto: string;
    buyExchange: string;
    sellExchange: string;
    buyPrice: number;
    sellPrice: number;
    profitPercent: number;
    profitPerUnit: number;
    maxVolume: number;
    maxProfitJPY: number;
    buyMinLimit: number;
    buyMaxLimit: number;
    sellMinLimit: number;
    sellMaxLimit: number;
    openedAt: number;
    lastSeenAt: number;
    closedAt: number | null;
    peakProfit: number;
    peakTime: number;
    durationMs: number;
    isActive: boolean;
    snapshots: {
        time: number;
        buyPrice: number;
        sellPrice: number;
        profit: number;
    }[];
}
export declare function processArbitrage(rates: AggregatedRates, crypto: string): void;
export declare function getActiveWindows(): ArbitrageWindow[];
export declare function getClosedWindows(limit?: number): ArbitrageWindow[];
export declare function getAllWindows(): {
    active: ArbitrageWindow[];
    history: ArbitrageWindow[];
};
