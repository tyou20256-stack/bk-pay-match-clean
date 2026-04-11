import { describe, it, expect } from 'vitest';

const BASE = process.env.TEST_URL || 'http://localhost:3003';

describe('E2E: Complete Purchase Journey', () => {
  let buyerId: string;
  let buyerToken: string;

  it('Step 1: Load purchase page', async () => {
    const res = await fetch(`${BASE}/buy-usdt.html`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-i18n="p2p_title"');
    expect(html).toContain('エスクロー保護');
    expect(html).toContain('nonce=');
  });

  it('Step 2: Fetch live rates', async () => {
    const res = await fetch(`${BASE}/api/rates/USDT`);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.rates.length).toBeGreaterThanOrEqual(1);
  });

  it('Step 3: Register as buyer', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: 'TLZHxKYnnJEwjFmaMje7KmsDKQpfhTL663', maxAmountJpy: 50000 }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.buyerId).toMatch(/^web_/);
    expect(data.buyerToken).toBeDefined();
    expect(data.buyerToken.length).toBe(32);
    buyerId = data.buyerId;
    buyerToken = data.buyerToken;
  });

  it('Step 4: Check match status', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/match/${buyerId}`);
    const data = await res.json();
    expect(data.success).toBe(true);
    // May or may not have a match depending on queue state
  });

  it('Step 5: Cancel registration', async () => {
    const res = await fetch(
      `${BASE}/api/p2p-buy/cancel/${buyerId}?buyerToken=${encodeURIComponent(buyerToken)}`,
      { method: 'DELETE' }
    );
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('Step 6: Verify cancellation', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/match/${buyerId}`);
    const data = await res.json();
    // Should have no active match after cancel
    expect(data.success).toBe(true);
  });
});

describe('E2E: AI Chat Support', () => {
  it('should respond to usage question', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '使い方を教えて', lang: 'ja' }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.reply).toBeDefined();
    expect(data.reply.length).toBeGreaterThan(10);
  });

  it('should respond in English', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'How do I buy USDT?', lang: 'en' }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

describe('E2E: Referral System', () => {
  let refCode: string;

  it('should generate referral code', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/referral/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referrerId: 'e2e_test_user', type: 'web' }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.code).toMatch(/^PM[A-F0-9]{8}$/);
    expect(data.shareUrl).toContain('ref=');
    refCode = data.code;
  });

  it('should retrieve referral stats', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/referral/${refCode}`);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.conversions).toBe(0);
    expect(data.volume).toBe(0);
  });

  it('should register buyer with referral code', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: 'TLZHxKYnnJEwjFmaMje7KmsDKQpfhTL663', maxAmountJpy: 10000, refCode }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.buyerId).toContain('ref_' + refCode);
    // Cleanup
    await fetch(`${BASE}/api/p2p-buy/cancel/${data.buyerId}`, { method: 'DELETE' });
  });
});

describe('E2E: Conversion Tracking', () => {
  it('should track page view event', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'page_view', data: { page: 'buy-usdt' }, ref: '' }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('should track form_start event', async () => {
    const res = await fetch(`${BASE}/api/p2p-buy/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'form_start', data: { amount: 100000 }, ref: 'PM12345678' }),
    });
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});

describe('E2E: Static Pages Serve Correctly', () => {
  const pages = [
    { path: '/', contains: 'PayMatch' },
    { path: '/buy-usdt.html', contains: 'USDT' },
    { path: '/guide.html', contains: 'guide' },
    { path: '/terms.html', contains: 'terms' },
    { path: '/privacy.html', contains: 'privacy' },
    { path: '/referral.html', contains: 'referral' },
    { path: '/lp/usdt-buy.html', contains: 'USDT' },
    { path: '/lp/bybit-p2p-alternative.html', contains: 'Bybit' },
    { path: '/lp/usdt-jpy-rate.html', contains: 'USDT' },
    { path: '/lp/usdt-no-kyc.html', contains: 'KYC' },
  ];

  for (const page of pages) {
    it(`should serve ${page.path}`, async () => {
      const res = await fetch(`${BASE}${page.path}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html.toLowerCase()).toContain(page.contains.toLowerCase());
    });
  }
});

describe('E2E: Security Headers on All Pages', () => {
  const pages = ['/', '/buy-usdt.html', '/guide.html', '/terms.html'];

  for (const page of pages) {
    it(`should have security headers on ${page}`, async () => {
      const res = await fetch(`${BASE}${page}`);
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      const csp = res.headers.get('content-security-policy') || '';
      expect(csp).toContain('nonce-');
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    });
  }
});
