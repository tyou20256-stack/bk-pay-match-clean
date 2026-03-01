import { AggregatedRates } from '../types';
export declare function recordSnapshot(crypto: string, aggregated: AggregatedRates): void;
export declare function getHistory(crypto: string, hours?: number): any[];
export declare function getHistoryByRange(crypto: string, from: number, to: number): any[];
