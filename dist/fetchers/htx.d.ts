import { P2POrder, FetcherInterface } from '../types';
export declare class HTXFetcher implements FetcherInterface {
    name: string;
    fetchOrders(crypto: string, side: 'buy' | 'sell'): Promise<P2POrder[]>;
}
