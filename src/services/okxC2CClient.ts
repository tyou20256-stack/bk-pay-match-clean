/**
 * @file okxC2CClient.ts — OKX C2C REST API クライアント
 * @description OKX公式C2C APIを使用してP2P注文の作成・確認・キャンセルを行う。
 *   HMAC-SHA256署名による認証。マーチャント承認が必要なエンドポイントあり。
 *   未承認の場合はエラーを返し、呼び出し元がPuppeteerフォールバックを判断する。
 */
import crypto from 'crypto';
import { getExchangeCredsDecrypted } from './database.js';
import logger from './logger.js';

const BASE_URL = 'https://www.okx.com';

interface OKXCreds {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

function getCreds(): OKXCreds | null {
  const raw = getExchangeCredsDecrypted('OKX');
  if (!raw || !raw.apiKey || !raw.apiSecret || !raw.passphrase) return null;
  return { apiKey: raw.apiKey, apiSecret: raw.apiSecret, passphrase: raw.passphrase };
}

function sign(timestamp: string, method: string, path: string, body: string, secret: string): string {
  const prehash = timestamp + method.toUpperCase() + path + body;
  return crypto.createHmac('sha256', secret).update(prehash).digest('base64');
}

interface OKXApiResponse {
  code: string;
  msg?: string;
  message?: string;
  data?: unknown;
}

async function request(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<OKXApiResponse> {
  const creds = getCreds();
  if (!creds) throw new Error('OKX credentials not configured');

  const timestamp = new Date().toISOString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const signature = sign(timestamp, method, path, bodyStr, creds.apiSecret);

  const headers: Record<string, string> = {
    'OK-ACCESS-KEY': creds.apiKey,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': creds.passphrase,
    'Content-Type': 'application/json',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const url = BASE_URL + path;
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : bodyStr,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OKX API HTTP ${res.status}: ${text.substring(0, 200)}`);
    }
    const data = await res.json() as OKXApiResponse;
    return data;
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('OKX API request timeout (15s)');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * C2C 広告一覧取得（公開API、認証不要だが署名付きで呼び出し）
 */
export async function getC2CAds(params: {
  side: 'buy' | 'sell';
  baseCurrency: string;
  quoteCurrency: string;
  paymentMethod?: string;
}): Promise<Record<string, unknown>[]> {
  const queryParams = new URLSearchParams({
    quoteCurrency: params.quoteCurrency,
    baseCurrency: params.baseCurrency,
    side: params.side,
    paymentMethod: params.paymentMethod || 'all',
    userType: 'all',
  });
  const path = `/api/v5/c2c/tradingOrders/books?${queryParams.toString()}`;
  try {
    const data = await request('GET', path);
    if (data?.code === '0' && data?.data) {
      const d = data.data as Record<string, unknown>;
      return Array.isArray(data.data) ? data.data as Record<string, unknown>[] : ((d[params.side] || []) as Record<string, unknown>[]);
    }
    return [];
  } catch (e: unknown) {
    logger.error('OKX C2C getAds error', { error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/**
 * C2C 注文作成
 * 注意: マーチャント承認が必要。未承認だとエラーコードが返る。
 */
export async function placeC2COrder(params: {
  side: 'buy' | 'sell';
  baseCurrency: string;
  quoteCurrency: string;
  quoteAmount: string;
  paymentMethod?: string;
  adId?: string;
}): Promise<{ success: boolean; orderId?: string; paymentInfo?: Record<string, unknown> | null; error?: string }> {
  try {
    const body: Record<string, unknown> = {
      side: params.side,
      baseCurrency: params.baseCurrency,
      quoteCurrency: params.quoteCurrency,
      quoteAmount: params.quoteAmount,
    };
    if (params.paymentMethod) body.paymentMethod = params.paymentMethod;
    if (params.adId) body.adId = params.adId;

    const data = await request('POST', '/api/v5/c2c/tradingOrders/place-order', body);

    if (data?.code === '0' && data?.data) {
      const order = (Array.isArray(data.data) ? data.data[0] : data.data) as Record<string, unknown>;
      return {
        success: true,
        orderId: (order.orderId || order.id) as string | undefined,
        paymentInfo: (order.paymentInfo || order.sellerPaymentInfo || null) as Record<string, unknown> | null,
      };
    }
    return { success: false, error: data?.msg || data?.message || `OKX error code: ${data?.code}` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('OKX C2C placeOrder error', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * C2C 注文ステータス確認
 */
type C2COrderStatus = 'pending' | 'paid' | 'released' | 'completed' | 'cancelled' | 'unknown';

export async function getC2COrderStatus(orderId: string): Promise<{
  status: C2COrderStatus;
  paymentInfo?: Record<string, unknown> | null;
  raw?: Record<string, unknown>;
}> {
  try {
    const data = await request('GET', `/api/v5/c2c/tradingOrders/get-order?orderId=${encodeURIComponent(orderId)}`);

    if (data?.code === '0' && data?.data) {
      const order = (Array.isArray(data.data) ? data.data[0] : data.data) as Record<string, unknown>;
      const statusMap: Record<string, C2COrderStatus> = {
        '0': 'pending',
        '1': 'paid',
        '2': 'released',
        '3': 'completed',
        '4': 'cancelled',
        '5': 'cancelled',
        pending: 'pending',
        paid: 'paid',
        released: 'released',
        completed: 'completed',
        cancelled: 'cancelled',
      };
      const status: C2COrderStatus = statusMap[String(order.status || order.state || '')] || 'unknown';
      return {
        status,
        paymentInfo: (order.paymentInfo || order.sellerPaymentInfo || null) as Record<string, unknown> | null,
        raw: order,
      };
    }
    return { status: 'unknown' };
  } catch (e: unknown) {
    logger.error('OKX C2C getOrderStatus error', { error: e instanceof Error ? e.message : String(e) });
    return { status: 'unknown' };
  }
}

/**
 * C2C 支払い確認報告
 */
export async function confirmC2CPayment(orderId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await request('POST', '/api/v5/c2c/tradingOrders/confirm-payment', { orderId });

    if (data?.code === '0') return { success: true };
    return { success: false, error: data?.msg || data?.message || `OKX error code: ${data?.code}` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('OKX C2C confirmPayment error', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * C2C 注文キャンセル
 */
export async function cancelC2COrder(orderId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await request('POST', '/api/v5/c2c/tradingOrders/cancel-order', { orderId });

    if (data?.code === '0') return { success: true };
    return { success: false, error: data?.msg || data?.message || `OKX error code: ${data?.code}` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('OKX C2C cancelOrder error', { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * OKX C2C APIが利用可能か確認（認証情報の有無）
 */
export function isAvailable(): boolean {
  return getCreds() !== null;
}
