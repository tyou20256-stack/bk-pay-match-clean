/**
 * @file phase3-5.test.ts — Phase 3-5 新機能のAPIテスト
 * @description RBAC、取引上限、ルールエンジン、マーチャントスコア、
 *   シミュレーター、通貨ルーティング、レート予測、顧客アカウントのテスト
 * @run npx vitest run tests/phase3-5.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Use explicit IPv4 loopback to avoid Node 20 undici IPv4/IPv6 dual-stack
// flake that triggers the admin session IP binding check. See
// tests/api.test.ts for the full explanation.
const BASE = process.env.TEST_URL || 'http://127.0.0.1:3003';
let authToken = '';

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'bkpay2026' }),
  });
  const data = (await res.json()) as any;
  return data.token;
}

beforeAll(async () => {
  authToken = await login();
});

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };
}

// ==================== RBAC ====================
describe('RBAC ユーザー管理', () => {
  let createdUserId: number;

  it('GET /api/auth/me — 現在のユーザー情報取得', async () => {
    const res = await fetch(`${BASE}/api/auth/me`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.user).toBeDefined();
    expect(data.user.username).toBe('admin');
    expect(data.user.role).toBeDefined();
  });

  it('GET /api/admin/roles — ロール一覧取得', async () => {
    const res = await fetch(`${BASE}/api/admin/roles`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.roles).toBeDefined();
    expect(Array.isArray(data.roles)).toBe(true);
  });

  it('GET /api/admin/users — ユーザー一覧取得', async () => {
    const res = await fetch(`${BASE}/api/admin/users`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.users)).toBe(true);
  });

  it('POST /api/admin/users — 新規ユーザー作成', async () => {
    const res = await fetch(`${BASE}/api/admin/users`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ username: `testuser_${Date.now()}`, password: 'testpass123', role: 'viewer' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.id).toBeDefined();
    createdUserId = data.id;
  });

  it('PUT /api/admin/users/:id/role — ロール更新', async () => {
    if (!createdUserId) return;
    const res = await fetch(`${BASE}/api/admin/users/${createdUserId}/role`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ role: 'operator' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
  });

  it('POST /api/admin/users/:id/reset-password — パスワードリセット', async () => {
    if (!createdUserId) return;
    const res = await fetch(`${BASE}/api/admin/users/${createdUserId}/reset-password`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ newPassword: 'newpass123' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
  });

  it('DELETE /api/admin/users/:id — ユーザー削除', async () => {
    if (!createdUserId) return;
    const res = await fetch(`${BASE}/api/admin/users/${createdUserId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
  });
});

// ==================== 取引上限 ====================
describe('取引上限', () => {
  it('GET /api/limits — 上限一覧取得', async () => {
    const res = await fetch(`${BASE}/api/limits`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.limits)).toBe(true);
  });

  it('POST /api/limits — 上限設定', async () => {
    const res = await fetch(`${BASE}/api/limits`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        scope: 'exchange',
        scopeId: 'Bybit',
        per_transaction: 500000,
        daily_limit: 5000000,
        weekly_limit: 20000000,
        monthly_limit: 80000000,
      }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
  });

  it('GET /api/limits/usage — 使用量取得', async () => {
    const res = await fetch(`${BASE}/api/limits/usage?scope=global&scopeId=`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.usage).toBeDefined();
    expect(data.usage.daily_used).toBeDefined();
  });

  it('POST /api/limits/check — 上限チェック', async () => {
    const res = await fetch(`${BASE}/api/limits/check`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ amount: 100000 }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.allowed).toBeDefined();
  });

  it('DELETE /api/limits — テスト上限削除', async () => {
    const res = await fetch(`${BASE}/api/limits`, {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({ scope: 'exchange', scopeId: 'Bybit' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
  });
});

// ==================== ルールエンジン ====================
describe('自動取引ルール', () => {
  let ruleId: number;

  it('POST /api/rules — ルール作成', async () => {
    const res = await fetch(`${BASE}/api/rules`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        name: 'テストルール',
        description: 'テスト用自動売買ルール',
        rate_conditions: [{ type: 'buy_below', value: 150 }],
        time_conditions: { startHour: 9, endHour: 18 },
        action_type: 'buy',
        action_crypto: 'USDT',
        action_amount: 50000,
        action_mode: 'notify',
      }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.id).toBeDefined();
    ruleId = data.id;
  });

  it('GET /api/rules — ルール一覧取得', async () => {
    const res = await fetch(`${BASE}/api/rules`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules.length).toBeGreaterThan(0);
  });

  it('GET /api/rules/:id — ルール詳細', async () => {
    if (!ruleId) return;
    const res = await fetch(`${BASE}/api/rules/${ruleId}`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.rule.name).toBe('テストルール');
  });

  it('PUT /api/rules/:id — ルール更新', async () => {
    if (!ruleId) return;
    const res = await fetch(`${BASE}/api/rules/${ruleId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'テストルール（更新済み）', action_amount: 100000 }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
  });

  it('POST /api/rules/:id/toggle — ルール切替', async () => {
    if (!ruleId) return;
    const res = await fetch(`${BASE}/api/rules/${ruleId}/toggle`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.status).toBeDefined();
  });

  it('POST /api/rules/test/:id — ルールテスト（ドライラン）', async () => {
    if (!ruleId) return;
    const res = await fetch(`${BASE}/api/rules/test/${ruleId}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ crypto: 'USDT' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.result).toBeDefined();
  });

  it('GET /api/rules/:id/history — 実行履歴', async () => {
    if (!ruleId) return;
    const res = await fetch(`${BASE}/api/rules/${ruleId}/history`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.history)).toBe(true);
  });

  it('DELETE /api/rules/:id — ルール削除', async () => {
    if (!ruleId) return;
    const res = await fetch(`${BASE}/api/rules/${ruleId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
  });
});

// ==================== マーチャントスコア ====================
describe('マーチャントスコアリング', () => {
  it('GET /api/merchants/scores — スコア一覧', async () => {
    const res = await fetch(`${BASE}/api/merchants/scores`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.merchants)).toBe(true);
  });

  it('GET /api/merchants/stats — 統計', async () => {
    const res = await fetch(`${BASE}/api/merchants/stats`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.stats).toBeDefined();
  });
});

// ==================== 一括購入シミュレーター ====================
describe('一括購入シミュレーター', () => {
  it('POST /api/simulator/bulk — シミュレーション実行', async () => {
    const res = await fetch(`${BASE}/api/simulator/bulk`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ totalAmountJpy: 1000000, crypto: 'USDT' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.simulation).toBeDefined();
    expect(data.simulation.totalAmountJpy).toBe(1000000);
    expect(data.simulation.crypto).toBe('USDT');
  });

  it('POST /api/simulator/optimize — 最適化', async () => {
    const res = await fetch(`${BASE}/api/simulator/optimize`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ totalAmountJpy: 500000, crypto: 'USDT' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.strategies).toBeDefined();
    expect(data.strategies.conservative).toBeDefined();
    expect(data.strategies.balanced).toBeDefined();
    expect(data.strategies.aggressive).toBeDefined();
  });

  it('POST /api/simulator/bulk — 金額なしでエラー', async () => {
    const res = await fetch(`${BASE}/api/simulator/bulk`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(false);
  });
});

// ==================== 通貨ルーティング ====================
describe('マルチ通貨ルーティング', () => {
  it('GET /api/routes/JPY/USDT — ルート検索', async () => {
    const res = await fetch(`${BASE}/api/routes/JPY/USDT?amount=100000`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.routes)).toBe(true);
  });

  it('GET /api/routes/best/JPY/USDT — 最適ルート', async () => {
    const res = await fetch(`${BASE}/api/routes/best/JPY/USDT?amount=100000`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    // route can be null if no data
  });

  it('GET /api/routes/compare/JPY/USDT — ルート比較', async () => {
    const res = await fetch(`${BASE}/api/routes/compare/JPY/USDT?amount=100000`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.comparison).toBeDefined();
    expect(data.comparison.recommendation).toBeDefined();
  });
});

// ==================== レート予測 ====================
describe('レート予測', () => {
  it('GET /api/prediction/USDT — 予測取得', async () => {
    const res = await fetch(`${BASE}/api/prediction/USDT`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.prediction).toBeDefined();
    expect(data.prediction.crypto).toBe('USDT');
    expect(data.prediction.buyTimingScore).toBeDefined();
    expect(data.prediction.predictedDirection).toBeDefined();
  });

  it('GET /api/prediction/BTC — BTC予測', async () => {
    const res = await fetch(`${BASE}/api/prediction/BTC`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.prediction.crypto).toBe('BTC');
  });

  it('GET /api/prediction/USDT/optimal-time — 最適購入時間', async () => {
    const res = await fetch(`${BASE}/api/prediction/USDT/optimal-time`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.optimal).toBeDefined();
    expect(data.optimal.bestBuyHour).toBeDefined();
  });
});

// ==================== 顧客アカウント ====================
describe('顧客アカウント', () => {
  const testEmail = `testcust_${Date.now()}@test.com`;
  let customerToken = '';

  it('POST /api/customer/register — 顧客登録', async () => {
    const res = await fetch(`${BASE}/api/customer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'custpass123', displayName: 'テスト顧客' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.customerId).toBeDefined();
  });

  it('POST /api/customer/register — 重複メール拒否', async () => {
    const res = await fetch(`${BASE}/api/customer/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'custpass123' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(false);
  });

  it('POST /api/customer/login — 顧客ログイン', async () => {
    const res = await fetch(`${BASE}/api/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'custpass123' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.token).toBeTruthy();
    customerToken = data.token;
  });

  it('POST /api/customer/login — 間違ったパスワード', async () => {
    const res = await fetch(`${BASE}/api/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'wrong' }),
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(false);
  });

  it('GET /api/customer/profile — プロフィール取得', async () => {
    if (!customerToken) return;
    const res = await fetch(`${BASE}/api/customer/profile`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.profile).toBeDefined();
    expect(data.profile.email).toBe(testEmail);
  });

  it('GET /api/customer/balance — 残高取得', async () => {
    if (!customerToken) return;
    const res = await fetch(`${BASE}/api/customer/balance`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(data.balance).toBeDefined();
    expect(data.balance.jpy).toBe(0);
    expect(data.balance.usdt).toBe(0);
  });

  it('GET /api/customer/transactions — 取引履歴', async () => {
    if (!customerToken) return;
    const res = await fetch(`${BASE}/api/customer/transactions`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.transactions)).toBe(true);
  });

  it('GET /api/customer/profile — 認証なしで401', async () => {
    const res = await fetch(`${BASE}/api/customer/profile`);
    expect(res.status).toBe(401);
  });

  // Admin: customer management
  it('GET /api/admin/customer-accounts — 顧客一覧（Admin）', async () => {
    const res = await fetch(`${BASE}/api/admin/customer-accounts`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.accounts)).toBe(true);
  });

  it('GET /api/admin/kyc/pending — 保留中KYC一覧', async () => {
    const res = await fetch(`${BASE}/api/admin/kyc/pending`, { headers: authHeaders() });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
    expect(Array.isArray(data.submissions)).toBe(true);
  });

  it('POST /api/customer/logout — ログアウト', async () => {
    if (!customerToken) return;
    const res = await fetch(`${BASE}/api/customer/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const data = (await res.json()) as any;
    expect(data.success).toBe(true);
  });
});
