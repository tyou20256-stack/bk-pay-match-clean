/**
 * @file agoradesk.ts — AgoraDesk P2P APIフェッチャー
 * @description AgoraDeskのAPIからJPY建ての売買オーダーを取得。
 *   LocalBitcoins後継の分散型P2P取引所。
 */
import axios from 'axios';
import { P2POrder, FetcherInterface } from '../types';
import { CONFIG } from '../config';
import logger from '../services/logger.js';

export class AgoraDeskFetcher implements FetcherInterface {
  name = 'AgoraDesk';

  async fetchOrders(_crypto: string, _side: 'buy' | 'sell'): Promise<P2POrder[]> {
    // AgoraDesk shut down in November 2023 — this fetcher is disabled
    logger.warn('Exchange is no longer operational (shut down Nov 2023)', { exchange: 'AgoraDesk' });
    return [];
  }
}
