/**
 * @file paxful.ts — Paxful P2P APIフェッチャー
 * @description PaxfulのAPIからJPY建ての売買オーダーを取得。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class PaxfulFetcher implements FetcherInterface {
  name = 'Paxful';

  async fetchOrders(_crypto: string, _side: 'buy' | 'sell'): Promise<P2POrder[]> {
    // Paxful was suspended and relaunched with a different API — this fetcher is disabled
    logger.warn('Exchange API is currently unavailable (suspended/relaunched)', { exchange: 'Paxful' });
    return [];
  }
}
