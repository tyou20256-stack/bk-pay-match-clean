/**
 * @file api-security.test.ts — 統合テスト: APIセキュリティ、入力バリデーション、ヘッダー検証
 * @description サーバーが起動している状態で実行する。TEST_URL環境変数でベースURLを指定可能。
 * @run TEST_URL=http://localhost:3003 npx vitest run tests/api-security.test.ts
 */
import { describe, it, expect } from 'vitest';

const BASE = process.env.TEST_URL || 'http://localhost:3003';

async function fetchJson(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, opts);
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}

// =====================================================================
// API Security
// =====================================================================
describe('APIセキュリティ', () => {
  it('認証なしで /metrics を拒否する', async () => {
    const { status } = await fetchJson('/metrics');
    expect(status).toBe(401);
  });

  it('認証なしで /api/trupay/status を拒否する', async () => {
    const { status, data } = await fetchJson('/api/trupay/status');
    expect(data?.error).toBe('Unauthorized');
  });

  it('認証なしで /api/orders を拒否する', async () => {
    const { data } = await fetchJson('/api/orders');
    expect(data?.error).toBe('Unauthorized');
  });

  it('/health が最小限の情報を返す', async () => {
    const { data } = await fetchJson('/health');
    expect(data?.status).toBe('ok');
    expect(data?.version).toBeTruthy();
    expect(data?.checks).toBeUndefined();
  });
});

// =====================================================================
// API Input Validation
// =====================================================================
describe('API入力バリデーション', () => {
  it('無効なウォレットアドレスを拒否する', async () => {
    const { data } = await fetchJson('/api/p2p-buy/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: 'invalid' }),
    });
    expect(data?.success).toBe(false);
    expect(data?.error).toMatch(/invalid/i);
  });

  it('空の登録リクエストを拒否する', async () => {
    const { data } = await fetchJson('/api/p2p-buy/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(data?.success).toBe(false);
  });

  it('過大なチャットメッセージを拒否する', async () => {
    const { data } = await fetchJson('/api/p2p-buy/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'A'.repeat(1001) }),
    });
    expect(data?.success).toBe(false);
  });

  it('buyerIdなしのpaid報告を拒否する', async () => {
    const { data } = await fetchJson('/api/p2p-buy/paid/999', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(data?.success).toBe(false);
  });

  it('不正なbuyerTokenのpaid報告を拒否する', async () => {
    const { data } = await fetchJson('/api/p2p-buy/paid/999', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerId: 'web_test', buyerToken: 'wrong' }),
    });
    expect(data?.success).toBe(false);
    expect(data?.error).toMatch(/unauthorized/i);
  });
});

// =====================================================================
// API Public Endpoints
// =====================================================================
describe('APIパブリックエンドポイント', () => {
  it('USDTレートを取得する', async () => {
    const { data } = await fetchJson('/api/rates/USDT');
    expect(data?.success).toBe(true);
    expect(data?.data?.rates).toBeTruthy();
    expect(Array.isArray(data.data.rates)).toBe(true);
  });

  it('有効な登録でbuyerTokenを返す', async () => {
    const { data } = await fetchJson('/api/p2p-buy/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: 'TLZHxKYnnJEwjFmaMje7KmsDKQpfhTL663', maxAmountJpy: 10000 }),
    });
    expect(data?.success).toBe(true);
    expect(data?.buyerId).toBeTruthy();
    expect(data?.buyerToken).toBeTruthy();
    expect(data.buyerId).toMatch(/^web_/);

    // Cleanup: cancel the test registration
    await fetchJson(`/api/p2p-buy/cancel/${data.buyerId}`, { method: 'DELETE' });
  });

  it('トラッキングイベントを受け入れる', async () => {
    const { data } = await fetchJson('/api/p2p-buy/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'test', data: {} }),
    });
    expect(data?.success).toBe(true);
  });
});

// =====================================================================
// Static Pages
// =====================================================================
describe('静的ページ', () => {
  it('全パブリックページが200を返す', async () => {
    const pages = ['/', '/buy-usdt.html', '/guide.html', '/terms.html', '/privacy.html', '/lp/usdt-buy.html', '/referral.html'];
    for (const page of pages) {
      const res = await fetch(`${BASE}${page}`);
      expect(res.status, `${page} should return 200`).toBe(200);
    }
  });

  it('存在しないページで404を返す', async () => {
    const res = await fetch(`${BASE}/nonexistent.html`);
    expect(res.status).toBe(404);
  });

  it('.envへのアクセスをブロックする', async () => {
    const res = await fetch(`${BASE}/.env`);
    expect(res.status).toBe(404);
  });
});

// =====================================================================
// Security Headers
// =====================================================================
describe('セキュリティヘッダー', () => {
  it('CSPにnonceが含まれる', async () => {
    const res = await fetch(`${BASE}/`);
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toMatch(/nonce-/);
    expect(
      !csp.includes("'unsafe-inline'") || !csp.includes("script-src 'self' 'unsafe-inline'")
    ).toBe(true);
  });

  it('セキュリティヘッダーが設定されている', async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('permissions-policy')).toMatch(/payment=\(\)/);
  });
});
