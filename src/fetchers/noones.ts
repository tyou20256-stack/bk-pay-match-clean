/**
 * @file noones.ts — Noones P2P APIフェッチャー
 * @description NoonesのAPIからJPY建ての売買オーダーを取得。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class NoonesFetcher implements FetcherInterface {
  name = 'Noones';

  async fetchOrders(_crypto: string, _side: 'buy' | 'sell'): Promise<P2POrder[]> {
    // Noones uses GraphQL API, not the REST endpoint originally assumed — this fetcher is disabled
    logger.warn('REST API endpoint is not available (uses GraphQL)', { exchange: 'Noones' });
    return [];
  }
}
