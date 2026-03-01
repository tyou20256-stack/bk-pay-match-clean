export declare function getSpotPrice(crypto: string, fiat: string): Promise<number | null>;
export declare function getAllSpotPrices(cryptos: readonly string[], fiat: string): Promise<Record<string, number>>;
