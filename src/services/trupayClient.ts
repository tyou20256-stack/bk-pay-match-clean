/**
 * @file trupayClient.ts — TruPay API クライアント
 * @description TruPay決済バックエンドとの通信を管理。
 *   出金一覧取得、単件取得、着金確認（scrapper/match）、サマリーを提供。
 *   JWT自動リフレッシュ（ログインAPI経由 + 12時間ごと更新）を含む。
 */
import logger from './logger.js';

const TRUPAY_BASE_URL = process.env.TRUPAY_BASE_URL || 'https://api.trupay.vip/api/v1';
const TRUPAY_EMAIL = process.env.TRUPAY_EMAIL || '';
const TRUPAY_PASSWORD = process.env.TRUPAY_PASSWORD || '';

// === Token Management ===

let currentToken = process.env.TRUPAY_JWT || '';
let tokenExpiresAt = 0; // Unix ms
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let tokenRefreshPromise: Promise<string> | null = null;

/**
 * ログインAPIでJWTを取得/更新
 */
async function loginAndGetToken(): Promise<string> {
  if (!TRUPAY_EMAIL || !TRUPAY_PASSWORD) {
    if (currentToken) return currentToken; // fallback to static JWT
    throw new Error('TRUPAY_EMAIL and TRUPAY_PASSWORD not configured');
  }

  logger.info('TruPay: refreshing JWT token');

  const res = await fetch(`${TRUPAY_BASE_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TRUPAY_EMAIL, password: TRUPAY_PASSWORD }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TruPay login failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json() as {
    success: boolean;
    data?: {
      token?: {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
    };
  };

  if (!data.success || !data.data?.token?.access_token) {
    throw new Error('TruPay login: unexpected response');
  }

  const { access_token, expires_in } = data.data.token;
  currentToken = access_token;
  // Refresh 1 hour before expiry
  tokenExpiresAt = Date.now() + (expires_in - 3600) * 1000;

  logger.info('TruPay: JWT token refreshed', { expiresIn: expires_in, nextRefreshMs: tokenExpiresAt - Date.now() });
  return currentToken;
}

/**
 * 有効なトークンを取得（期限切れなら自動更新）
 */
async function getValidToken(): Promise<string> {
  if (currentToken && tokenExpiresAt > Date.now()) {
    return currentToken;
  }
  // Mutex: reuse in-flight refresh
  if (tokenRefreshPromise) return tokenRefreshPromise;
  tokenRefreshPromise = loginAndGetToken().finally(() => { tokenRefreshPromise = null; });
  return tokenRefreshPromise;
}

/**
 * トークン自動リフレッシュ開始（12時間ごと）
 */
export function startTokenRefresh(): void {
  if (refreshTimer) return;

  // 初回: 即座にトークン取得
  loginAndGetToken().catch(e =>
    logger.error('TruPay initial token refresh failed', { error: e instanceof Error ? e.message : String(e) })
  );

  // 12時間ごとにリフレッシュ
  const REFRESH_INTERVAL = 12 * 60 * 60 * 1000;
  refreshTimer = setInterval(() => {
    loginAndGetToken().catch(e =>
      logger.error('TruPay token refresh failed', { error: e instanceof Error ? e.message : String(e) })
    );
  }, REFRESH_INTERVAL);

  logger.info('TruPay token auto-refresh started', { intervalHours: 12 });
}

export function stopTokenRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// === Types ===

export interface TruPayWithdrawal {
  id: number;
  user_id?: number;
  system_transaction_id: string;
  transaction_id: string;
  amount: number;
  status: string;
  new_status: number;
  bank_name: string;
  branch_name: string;
  branch_code: string;
  account_type: string;
  account_number: string;
  account_name: string;
  is_overseas?: number;
  currency?: string;
  platform_name?: string;
  created_at: string;
  date_completed: string | null;
  callback_received: number;
  merchant?: {
    id: number;
    user_id: number;
    merchant_num: string;
    name: string | null;
    email: string;
  };
}

const REQUIRED_MERCHANT_EMAIL = 'pay@sloten.io';

export interface TruPayPaginatedResponse {
  data: {
    current_page: number;
    total: number;
    data: TruPayWithdrawal[];
  };
}

export interface TruPaySummary {
  withdrawal_all: number;
  withdrawal_today: number;
  withdrawal_month: number;
}

export interface TruPayMatchRequest {
  id: number;
  reference_number: string;
  notes?: string;
}

// === HTTP helpers ===

async function trupayFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getValidToken();

  const url = `${TRUPAY_BASE_URL}${path}`;
  let res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // 401 → トークン期限切れ → 再ログインしてリトライ
  if (res.status === 401) {
    logger.warn('TruPay: 401 received, refreshing token');
    tokenExpiresAt = 0; // force refresh
    const newToken = await getValidToken();

    res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${newToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error('TruPay API error', { status: res.status, path, body: body.slice(0, 500) });
    throw new Error(`TruPay API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

// === API Methods ===

/**
 * 承認済み出金一覧取得（new_status=31）
 * 国内銀行振込のみにフィルタリング
 */
export async function getApprovedWithdrawals(page = 1, perPage = 50): Promise<TruPayWithdrawal[]> {
  const data = await trupayFetch<TruPayPaginatedResponse>(
    `/withdrawals?new_status=31&per_page=${perPage}&page=${page}`
  );

  // Safety filter: 国内銀行振込のみ + Merchant確認
  return data.data.data.filter(w =>
    (w.is_overseas === undefined || w.is_overseas === 0) &&
    (w.currency === undefined || w.currency === 'JPY') &&
    w.bank_name &&
    w.account_number &&
    // Merchant filter: pay@sloten.io のみ（設定されている場合）
    (!REQUIRED_MERCHANT_EMAIL || !w.merchant || w.merchant.email === REQUIRED_MERCHANT_EMAIL)
  );
}

/**
 * 出金単件取得
 */
export async function getWithdrawal(id: number): Promise<TruPayWithdrawal> {
  const data = await trupayFetch<{ data: TruPayWithdrawal }>(`/withdrawal/${id}`);
  return data.data;
}

/**
 * 完了済み出金確認（new_status=32）
 */
export async function getCompletedWithdrawals(page = 1, perPage = 50): Promise<TruPayWithdrawal[]> {
  const data = await trupayFetch<TruPayPaginatedResponse>(
    `/withdrawals?new_status=32&per_page=${perPage}&page=${page}`
  );
  return data.data.data;
}

/**
 * トランザクションID検索
 */
export async function searchByTransactionId(transactionId: string): Promise<TruPayWithdrawal[]> {
  const data = await trupayFetch<TruPayPaginatedResponse>(
    `/withdrawals?transaction_id=${encodeURIComponent(transactionId)}`
  );
  return data.data.data;
}

/**
 * 着金確認（手動マッチング）— POST /scrapper/match
 */
export async function confirmMatch(req: TruPayMatchRequest): Promise<{ success: boolean }> {
  const data = await trupayFetch<{ success?: boolean; data?: unknown }>(
    '/scrapper/match',
    {
      method: 'POST',
      body: JSON.stringify({
        id: req.id,
        reference_number: req.reference_number,
        notes: req.notes || 'P2P match confirmed',
      }),
    }
  );
  return { success: !!data.success || !!data.data };
}

/**
 * サマリー取得（モニタリング用）
 */
export async function getWithdrawalSummary(): Promise<TruPaySummary | null> {
  try {
    const data = await trupayFetch<{ data: TruPaySummary[] }>('/withdrawal/summary/all');
    return data.data?.[0] || null;
  } catch (e) {
    logger.error('TruPay summary fetch failed', { error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * TruPay接続テスト
 */
export async function testConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    await getWithdrawalSummary();
    return { connected: true };
  } catch (e) {
    return { connected: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * TruPayが有効化されているか
 */
export function isEnabled(): boolean {
  return process.env.ENABLE_TRUPAY === 'true' && !!(TRUPAY_EMAIL || currentToken);
}
