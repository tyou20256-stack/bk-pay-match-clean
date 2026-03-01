import { P2POrder, FetcherInterface } from '../types';
export declare class BybitFetcher implements FetcherInterface {
    name: string;
    fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]>;
}
