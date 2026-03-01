import { AggregatedRates } from '../types';
export declare function fetchAllRates(crypto: string): Promise<AggregatedRates>;
export declare function getCachedRates(crypto?: string): AggregatedRates | Map<string, AggregatedRates>;
export declare function updateAllCryptos(): Promise<void>;
