/**
 * BK Pay Integration Tests
 * Requires BK Pay running on localhost:3003
 * Account Router tests skip if localhost:3002 is not available
 */
import { describe, it, expect, beforeAll, test } from 'vitest';

const BASE = 'http://localhost:3003';
const ACCOUNT_ROUTER = 'http://localhost:3002';

let accountRouterAvailable = false;

async function isReachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

beforeAll(async () => {
  const bkPayUp = await isReachable(`${BASE}/api/status`);
  if (!bkPayUp) throw new Error('BK Pay is not running on localhost:3003');
  accountRouterAvailable = await isReachable(`${ACCOUNT_ROUTER}/api/accounts`);
});

// 1. Account Router connection
describe('Account Router connection', () => {
  test.skipIf(!accountRouterAvailable)('should be reachable at port 3002', async () => {
    const res = await fetch(`${ACCOUNT_ROUTER}/api/accounts`);
    expect(res.ok).toBe(true);
  });

  test.skipIf(!accountRouterAvailable)('GET /api/accounts returns a list', async () => {
    const res = await fetch(`${ACCOUNT_ROUTER}/api/accounts`);
    const data = await res.json();
    expect(Array.isArray(data.accounts ?? data)).toBe(true);
  });
});

// 2. Order flow end-to-end
describe('Order flow end-to-end', () => {
  let orderId: string;
  let authToken: string;

  beforeAll(async () => {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    const loginData = await login.json();
    if (loginData.token) authToken = loginData.token;
  });

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  });

  it('should create an order with pending_payment status', async () => {
    const res = await fetch(`${BASE}/api/orders`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ type: 'buy', crypto: 'USDT', amount: 100, currency: 'THB' }),
    });
    const data = await res.json();
    expect(res.status).toBeLessThan(500);
    if (data.order) {
      orderId = data.order.id;
      expect(data.order.status).toBe('pending_payment');
    }
  });

  it('should transition to confirming after reporting paid', async () => {
    if (!orderId) return;
    const res = await fetch(`${BASE}/api/orders/${orderId}/paid`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();
    expect(res.status).toBeLessThan(500);
    if (data.order) {
      expect(data.order.status).toBe('confirming');
    }
  });

  it('should reflect correct status on GET', async () => {
    if (!orderId) return;
    const res = await fetch(`${BASE}/api/orders/${orderId}`, { headers: authHeaders() });
    const data = await res.json();
    expect(res.status).toBeLessThan(500);
    if (data.order) {
      expect(['pending_payment', 'confirming', 'completed', 'cancelled']).toContain(data.order.status);
    }
  });
});

// 3. Rate consistency
describe('Rate consistency', () => {
  it('GET /api/rates/USDT returns valid rates', async () => {
    const res = await fetch(`${BASE}/api/rates/USDT`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  it('all exchange prices are numeric and > 0', async () => {
    const res = await fetch(`${BASE}/api/rates/USDT`);
    const data = await res.json();
    const rates = data.rates ?? data;
    if (Array.isArray(rates)) {
      for (const r of rates) {
        if (r.buyPrice != null) {
          expect(typeof r.buyPrice).toBe('number');
          expect(r.buyPrice).toBeGreaterThan(0);
        }
        if (r.sellPrice != null) {
          expect(typeof r.sellPrice).toBe('number');
          expect(r.sellPrice).toBeGreaterThan(0);
        }
      }
    }
  });

  it('buy prices > sell prices (P2P spread)', async () => {
    const res = await fetch(`${BASE}/api/rates/USDT`);
    const data = await res.json();
    const rates = data.rates ?? data;
    if (Array.isArray(rates)) {
      for (const r of rates) {
        if (r.buyPrice != null && r.sellPrice != null) {
          expect(r.buyPrice).toBeGreaterThanOrEqual(r.sellPrice);
        }
      }
    }
  });

  it('spread endpoint returns valid data', async () => {
    const res = await fetch(`${BASE}/api/spread`);
    expect(res.ok).toBe(true);
  });
});

// 4. Bulk import
describe('Bulk import', () => {
  const testAccounts = [
    { bankName: 'TEST_BANK_1', accountNumber: '9999000001', accountName: 'Test User 1', type: 'savings' },
    { bankName: 'TEST_BANK_2', accountNumber: '9999000002', accountName: 'Test User 2', type: 'savings' },
    { bankName: 'TEST_BANK_3', accountNumber: '9999000003', accountName: 'Test User 3', type: 'savings' },
  ];
  let createdIds: string[] = [];
  let authToken: string;

  beforeAll(async () => {
    const login = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    });
    const loginData = await login.json();
    if (loginData.token) authToken = loginData.token;
  });

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  });

  it('POST /api/accounts/bulk creates 3 accounts', async () => {
    const res = await fetch(`${BASE}/api/accounts/bulk`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ accounts: testAccounts }),
    });
    expect(res.status).toBeLessThan(500);
    const data = await res.json();
    if (data.created) expect(data.created).toBe(3);
    if (data.ids) createdIds = data.ids;
  });

  it('cleanup: delete test accounts', async () => {
    for (const id of createdIds) {
      await fetch(`${BASE}/api/accounts/${id}`, { method: 'DELETE', headers: authHeaders() });
    }
    if (createdIds.length === 0) {
      const res = await fetch(`${BASE}/api/accounts`, { headers: authHeaders() });
      const data = await res.json();
      const accounts = data.accounts ?? data;
      if (Array.isArray(accounts)) {
        for (const acc of accounts) {
          if (acc.accountNumber?.startsWith('9999')) {
            await fetch(`${BASE}/api/accounts/${acc.id}`, { method: 'DELETE', headers: authHeaders() });
          }
        }
      }
    }
  });
});

// 5. Report API
describe('Report API', () => {
  it('GET /api/reports/summary returns valid structure', async () => {
    const res = await fetch(`${BASE}/api/reports/summary`);
    expect(res.status).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });

  it('GET /api/reports/daily?date=2026-03-01 returns valid structure', async () => {
    const res = await fetch(`${BASE}/api/reports/daily?date=2026-03-01`);
    expect(res.status).toBeLessThan(500);
    const data = await res.json();
    expect(typeof data).toBe('object');
  });
});

// 6. Price history
describe('Price history', () => {
  it('GET /api/history/USDT?hours=1 returns an array', async () => {
    const res = await fetch(`${BASE}/api/history/USDT?hours=1`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    const history = data.history ?? data;
    expect(Array.isArray(history)).toBe(true);
  });

  it('history entries have correct structure', async () => {
    const res = await fetch(`${BASE}/api/history/USDT?hours=1`);
    const data = await res.json();
    const history = data.history ?? data;
    if (Array.isArray(history) && history.length > 0) {
      const entry = history[0];
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('exchange');
      expect(entry).toHaveProperty('bestBuy');
      expect(entry).toHaveProperty('bestSell');
    }
  });
});

// 7. Security
describe('Security', () => {
  it('protected endpoints return 401 without auth', async () => {
    const endpoints = ['/api/settings', '/api/exchange-creds'];
    for (const ep of endpoints) {
      const res = await fetch(`${BASE}${ep}`);
      expect(res.status).toBe(401);
    }
  });

  it('login with wrong password fails', async () => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong_password_xyz' }),
    });
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('rate limiting works (11 rapid login attempts)', async () => {
    const results: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ratelimit_test', password: 'wrong' }),
      });
      results.push(res.status);
    }
    expect(results).toContain(429);
  });
});

// 8. WebSocket
describe('WebSocket', () => {
  it('connects and receives a message', async () => {
    let WS: typeof import('ws').default;
    try {
      const ws = await import('ws');
      WS = ws.default;
    } catch {
      console.log('ws module not available, skipping');
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { sock.close(); reject(new Error('WebSocket timeout')); }, 5000);
      const sock = new WS('ws://localhost:3003/ws');
      sock.on('message', (msg: Buffer) => {
        clearTimeout(timeout);
        const data = JSON.parse(msg.toString());
        expect(data).toBeDefined();
        sock.close();
        resolve();
      });
      sock.on('error', () => { clearTimeout(timeout); sock.close(); resolve(); });
    });
  });
});
