/**
 * @file api.test.ts — APIエンドポイントのテスト
 * @description 全APIの正常系・異常系テスト
 * @run npx vitest run
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://localhost:3003';
let authCookie = '';

// ヘルパー: 認証Cookie取得
async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'bkpay2026' })
  });
  const data = await res.json() as any;
  return data.token;
}

beforeAll(async () => {
  authCookie = await login();
});

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authCookie}` };
}

// ==================== 認証 ====================
describe('認証API', () => {
  it('正しい認証情報でログイン成功', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'bkpay2026' })
    });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.token).toBeTruthy();
  });

  it('間違ったパスワードでログイン失敗', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' })
    });
    const data = await res.json() as any;
    expect(data.success).toBe(false);
  });

  it('セッション確認（保護APIにアクセス可能）', async () => {
    const res = await fetch(`${BASE}/api/settings`, {
      headers: { 'Authorization': `Bearer ${authCookie}` }
    });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
  });

  it('セッション確認（無効なトークン）', async () => {
    const res = await fetch(`${BASE}/api/auth/check`, {
      headers: { 'Authorization': 'Bearer invalid-token' }
    });
    const data = await res.json() as any;
    expect(data.success).toBe(false);
  });
});

// ==================== レートAPI ====================
describe('レートAPI（公開）', () => {
  it('GET /api/rates — 全レート取得', async () => {
    const res = await fetch(`${BASE}/api/rates`);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
  });

  it('GET /api/rates/USDT — USDTレート取得', async () => {
    const res = await fetch(`${BASE}/api/rates/USDT`);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
  });

  it('GET /api/best — ベストレート', async () => {
    const res = await fetch(`${BASE}/api/best`);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
  });

  it('GET /api/status — ステータス', async () => {
    const res = await fetch(`${BASE}/api/status`);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.uptime).toBeGreaterThan(0);
  });
});

// ==================== 注文API ====================
describe('注文API', () => {
  let orderId = '';

  it('POST /api/orders — 注文作成（正常）', async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10000, payMethod: 'bank' })
    });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.order.id).toMatch(/^ORD-/);
    expect(data.order.amount).toBe(10000);
    expect(data.order.status).toBe('pending_payment');
    orderId = data.order.id;
  });

  it('POST /api/orders — 金額不足でエラー', async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 100, payMethod: 'bank' })
    });
    const data = await res.json() as any;
    expect(data.success).toBe(false);
  });

  it('GET /api/orders/:id — 注文確認', async () => {
    const res = await fetch(`${BASE}/api/orders/${orderId}`);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.order.id).toBe(orderId);
  });

  it('POST /api/orders/:id/paid — 振込完了', async () => {
    const res = await fetch(`${BASE}/api/orders/${orderId}/paid`, { method: 'POST' });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.order.status).toBe('confirming');
  });

  it('GET /api/orders/:id — 存在しない注文', async () => {
    const res = await fetch(`${BASE}/api/orders/ORD-NONEXIST-XXXX`);
    const data = await res.json() as any;
    expect(data.success).toBe(false);
  });

  it('GET /api/orders — 全注文一覧（認証必須）', async () => {
    const res = await fetch(`${BASE}/api/orders`, { headers: authHeaders() });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.orders)).toBe(true);
  });

  it('GET /api/orders — 認証なしで401', async () => {
    const res = await fetch(`${BASE}/api/orders`);
    const data = await res.json() as any;
    expect(data.success).toBe(false);
    expect(data.error).toBe('Unauthorized');
  });
});

// ==================== 口座API ====================
describe('口座管理API（認証必須）', () => {
  let accountId = 0;

  it('POST /api/accounts — 口座追加', async () => {
    const res = await fetch(`${BASE}/api/accounts`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ bankName: 'テスト銀行', branchName: 'テスト支店', accountNumber: '9999999', accountHolder: 'テスト タロウ', dailyLimit: 1000000, priority: 'medium' })
    });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    accountId = data.id;
  });

  it('GET /api/accounts — 口座一覧', async () => {
    const res = await fetch(`${BASE}/api/accounts`, { headers: authHeaders() });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.accounts.length).toBeGreaterThan(0);
  });

  it('PUT /api/accounts/:id — 口座更新', async () => {
    const res = await fetch(`${BASE}/api/accounts/${accountId}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ status: 'rest' })
    });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
  });

  it('DELETE /api/accounts/:id — 口座削除', async () => {
    const res = await fetch(`${BASE}/api/accounts/${accountId}`, {
      method: 'DELETE', headers: authHeaders()
    });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
  });

  it('認証なしで401', async () => {
    const res = await fetch(`${BASE}/api/accounts`);
    const data = await res.json() as any;
    expect(data.error).toBe('Unauthorized');
  });
});

// ==================== 設定API ====================
describe('設定API（認証必須）', () => {
  it('POST /api/settings — 設定保存', async () => {
    const res = await fetch(`${BASE}/api/settings`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ minCompletion: '95', orderTimeout: '10' })
    });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
  });

  it('GET /api/settings — 設定取得', async () => {
    const res = await fetch(`${BASE}/api/settings`, { headers: authHeaders() });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.settings.minCompletion).toBe('95');
  });
});

// ==================== ウォレットAPI ====================
describe('ウォレットAPI（認証必須）', () => {
  it('POST /api/wallet — ウォレット保存', async () => {
    const res = await fetch(`${BASE}/api/wallet`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ address: 'TTestAddress123', label: 'テスト' })
    });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
  });

  it('GET /api/wallet — ウォレット取得', async () => {
    const res = await fetch(`${BASE}/api/wallet`, { headers: authHeaders() });
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.wallet.address).toBe('TTestAddress123');
  });
});
