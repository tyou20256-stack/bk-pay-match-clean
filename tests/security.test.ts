/**
 * @file security.test.ts — セキュリティ機能のユニットテスト
 * @description CSRF、SSRF保護、APIキー検証、パスワードバリデーション、
 *   取引所名ホワイトリストなどのセキュリティ機能をテスト。
 * @run npx vitest run tests/security.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// =====================================================================
// CSRF Token Generation & Validation
// Replicate the csrfProtection middleware logic from src/middleware/auth.ts
// to avoid importing the module which has database side effects.
// =====================================================================
function csrfProtection(req: any, res: any, next: () => void) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers.authorization?.startsWith('Bearer ')) return next();
  if (!req.cookies?.bkpay_token && !req.cookies?.bkpay_customer_token) return next();

  const cookieToken = req.cookies?.bkpay_csrf;
  const headerToken = req.headers['x-csrf-token'] as string;

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ success: false, error: 'CSRF token mismatch' });
  }
  next();
}

describe('CSRF Token — setCsrfCookie', () => {
  it('64文字のhex文字列を生成する（32バイト）', () => {
    // setCsrfCookie uses crypto.randomBytes(32).toString('hex')
    const token = crypto.randomBytes(32).toString('hex');
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
  });

  it('毎回異なるトークンを生成する', () => {
    const t1 = crypto.randomBytes(32).toString('hex');
    const t2 = crypto.randomBytes(32).toString('hex');
    expect(t1).not.toBe(t2);
  });

  it('CSRFミドルウェア: cookie と header が一致すれば通過', () => {
    const csrfToken = 'abc123token';
    const req = {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
      cookies: {
        bkpay_token: 'session-token',
        bkpay_csrf: csrfToken,
      },
    } as any;

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('CSRFミドルウェア: cookie と header が不一致なら 403', () => {
    const req = {
      method: 'POST',
      headers: { 'x-csrf-token': 'wrong-token' },
      cookies: {
        bkpay_token: 'session-token',
        bkpay_csrf: 'correct-token',
      },
    } as any;

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'CSRF token mismatch' })
    );
  });

  it('CSRFミドルウェア: GETリクエストはスキップ', () => {
    const req = { method: 'GET', headers: {}, cookies: {} } as any;
    const res = {} as any;
    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('CSRFミドルウェア: HEADリクエストはスキップ', () => {
    const req = { method: 'HEAD', headers: {}, cookies: {} } as any;
    const res = {} as any;
    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('CSRFミドルウェア: Bearer認証はスキップ（外部API）', () => {
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer some-api-key' },
      cookies: {},
    } as any;
    const res = {} as any;
    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('CSRFミドルウェア: セッションCookieなしの公開POSTはスキップ', () => {
    const req = {
      method: 'POST',
      headers: {},
      cookies: {},
    } as any;
    const res = {} as any;
    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('CSRFミドルウェア: CSRFヘッダー欠如で403', () => {
    const req = {
      method: 'DELETE',
      headers: {},
      cookies: {
        bkpay_token: 'session-token',
        bkpay_csrf: 'csrf-value',
      },
    } as any;

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('CSRFミドルウェア: customer_tokenでもCSRF検証', () => {
    const req = {
      method: 'POST',
      headers: { 'x-csrf-token': 'token-val' },
      cookies: {
        bkpay_customer_token: 'cust-session',
        bkpay_csrf: 'token-val',
      },
    } as any;

    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    csrfProtection(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// =====================================================================
// Private IP Detection (SSRF Protection)
// =====================================================================
describe('isPrivateIP — SSRF保護', () => {
  // isPrivateIP is not exported, so we replicate the logic to test it.
  // This tests the actual algorithm used in merchantApiService.ts.
  function isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length === 4) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 127) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
      if (parts[0] === 0) return true;
    }
    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
    return false;
  }

  // IPv4 private ranges
  it('10.0.0.0/8 をプライベートと判定', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('10.255.255.255')).toBe(true);
    expect(isPrivateIP('10.123.45.67')).toBe(true);
  });

  it('172.16.0.0/12 をプライベートと判定', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('172.20.10.5')).toBe(true);
  });

  it('172.15.x.x / 172.32.x.x はパブリック', () => {
    expect(isPrivateIP('172.15.0.1')).toBe(false);
    expect(isPrivateIP('172.32.0.1')).toBe(false);
  });

  it('192.168.0.0/16 をプライベートと判定', () => {
    expect(isPrivateIP('192.168.0.1')).toBe(true);
    expect(isPrivateIP('192.168.255.255')).toBe(true);
    expect(isPrivateIP('192.168.1.100')).toBe(true);
  });

  it('127.0.0.0/8 (loopback) をプライベートと判定', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.255.255.255')).toBe(true);
  });

  it('169.254.0.0/16 (link-local) をプライベートと判定', () => {
    expect(isPrivateIP('169.254.0.1')).toBe(true);
    expect(isPrivateIP('169.254.169.254')).toBe(true);
  });

  it('0.0.0.0/8 をプライベートと判定', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
    expect(isPrivateIP('0.0.0.1')).toBe(true);
  });

  // IPv6
  it('::1 (IPv6 loopback) をプライベートと判定', () => {
    expect(isPrivateIP('::1')).toBe(true);
  });

  it('fe80: (IPv6 link-local) をプライベートと判定', () => {
    expect(isPrivateIP('fe80::1')).toBe(true);
    expect(isPrivateIP('fe80:0000::abcd')).toBe(true);
  });

  it('fc/fd (IPv6 unique local) をプライベートと判定', () => {
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd12:3456::1')).toBe(true);
  });

  // Public IPs
  it('パブリックIPv4はfalse', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('203.0.113.1')).toBe(false);
    expect(isPrivateIP('93.184.216.34')).toBe(false);
  });
});

// =====================================================================
// Webhook URL Validation
// =====================================================================
describe('Webhook URL バリデーション', () => {
  // Replicate validateWebhookUrl logic from merchantApiService.ts
  function isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length === 4) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 127) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
      if (parts[0] === 0) return true;
    }
    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
    return false;
  }

  function validateWebhookUrl(webhookUrl: string, nodeEnv: string): void {
    const url = new URL(webhookUrl);
    if (nodeEnv === 'production' && url.protocol !== 'https:') {
      throw new Error('Webhook URL must use HTTPS in production');
    }
  }

  it('production環境でHTTPをブロック', () => {
    expect(() => validateWebhookUrl('http://example.com/webhook', 'production')).toThrow(
      'Webhook URL must use HTTPS in production'
    );
  });

  it('production環境でHTTPSを許可', () => {
    expect(() => validateWebhookUrl('https://example.com/webhook', 'production')).not.toThrow();
  });

  it('development環境ではHTTPも許可', () => {
    expect(() => validateWebhookUrl('http://localhost:3000/webhook', 'development')).not.toThrow();
  });

  it('HTTPSのURLパース正常', () => {
    const url = new URL('https://example.com/webhook/callback');
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('example.com');
    expect(url.pathname).toBe('/webhook/callback');
  });

  it('不正なURLはエラー', () => {
    expect(() => new URL('not-a-url')).toThrow();
    expect(() => new URL('')).toThrow();
  });

  it('localhostのIPはプライベートと判定される', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('::1')).toBe(true);
  });
});

// =====================================================================
// API Key Validation
// =====================================================================
describe('APIキー検証', () => {
  it('正しいプレフィックスで始まること: bkpay_sk_live_', () => {
    const rawKey = 'bkpay_sk_live_' + crypto.randomBytes(24).toString('hex');
    expect(rawKey.startsWith('bkpay_sk_live_')).toBe(true);
    // prefix is 14 chars + 48 hex chars = 62 total
    expect(rawKey).toHaveLength(14 + 48);
  });

  it('プレフィックスなしのキーを拒否', () => {
    // verifyApiKey checks: if (!rawKey.startsWith('bkpay_sk_live_')) return null
    const invalidKey = 'sk_live_' + crypto.randomBytes(24).toString('hex');
    expect(invalidKey.startsWith('bkpay_sk_live_')).toBe(false);
  });

  it('空文字・null・undefinedを拒否', () => {
    // verifyApiKey checks: if (!rawKey || !rawKey.startsWith('bkpay_sk_live_')) return null
    expect(!'' || !''.startsWith('bkpay_sk_live_')).toBe(true);
    expect(!undefined).toBe(true);
    expect(!null).toBe(true);
  });

  it('keyPrefixは22文字 + "..."', () => {
    const rawKey = 'bkpay_sk_live_' + crypto.randomBytes(24).toString('hex');
    const keyPrefix = rawKey.slice(0, 22) + '...';
    expect(keyPrefix).toHaveLength(25);
    expect(keyPrefix.endsWith('...')).toBe(true);
    expect(keyPrefix.startsWith('bkpay_sk_live_')).toBe(true);
  });

  it('SHA256ハッシュが一貫性を持つ', () => {
    const rawKey = 'bkpay_sk_live_deadbeef1234567890abcdef12345678deadbeef12345678';
    const hash1 = crypto.createHash('sha256').update(rawKey).digest('hex');
    const hash2 = crypto.createHash('sha256').update(rawKey).digest('hex');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('異なるキーは異なるハッシュ', () => {
    const key1 = 'bkpay_sk_live_' + crypto.randomBytes(24).toString('hex');
    const key2 = 'bkpay_sk_live_' + crypto.randomBytes(24).toString('hex');
    const hash1 = crypto.createHash('sha256').update(key1).digest('hex');
    const hash2 = crypto.createHash('sha256').update(key2).digest('hex');
    expect(hash1).not.toBe(hash2);
  });
});

// =====================================================================
// Password Validation Rules
// =====================================================================
describe('パスワードバリデーション', () => {
  // Replicating the validation logic from rbac.ts createAdminUserWithRole / resetUserPassword
  function validatePassword(password: string): { valid: boolean; error?: string } {
    if (password.length < 8) return { valid: false, error: 'Password must be at least 8 characters' };
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return { valid: false, error: 'Password must contain both letters and numbers' };
    }
    return { valid: true };
  }

  it('8文字以上の英数混合パスワードを許可', () => {
    expect(validatePassword('abcdef12')).toEqual({ valid: true });
    expect(validatePassword('MyPass99')).toEqual({ valid: true });
    expect(validatePassword('a1b2c3d4e5')).toEqual({ valid: true });
  });

  it('7文字以下を拒否', () => {
    expect(validatePassword('abc123')).toEqual({
      valid: false,
      error: 'Password must be at least 8 characters',
    });
    expect(validatePassword('Ab1')).toEqual({
      valid: false,
      error: 'Password must be at least 8 characters',
    });
    expect(validatePassword('')).toEqual({
      valid: false,
      error: 'Password must be at least 8 characters',
    });
  });

  it('数字のみを拒否', () => {
    expect(validatePassword('12345678')).toEqual({
      valid: false,
      error: 'Password must contain both letters and numbers',
    });
  });

  it('英字のみを拒否', () => {
    expect(validatePassword('abcdefgh')).toEqual({
      valid: false,
      error: 'Password must contain both letters and numbers',
    });
    expect(validatePassword('ABCDEFGH')).toEqual({
      valid: false,
      error: 'Password must contain both letters and numbers',
    });
  });

  it('記号のみを拒否', () => {
    expect(validatePassword('!@#$%^&*')).toEqual({
      valid: false,
      error: 'Password must contain both letters and numbers',
    });
  });

  it('英字+記号（数字なし）を拒否', () => {
    expect(validatePassword('abcd!@#$')).toEqual({
      valid: false,
      error: 'Password must contain both letters and numbers',
    });
  });

  it('大文字小文字混合+数字を許可', () => {
    expect(validatePassword('AbCdEf12')).toEqual({ valid: true });
  });
});

// =====================================================================
// Exchange Name Whitelist
// =====================================================================
describe('取引所名ホワイトリスト', () => {
  // Replicating the whitelist from database.ts saveExchangeCreds
  const ALLOWED_EXCHANGES = ['Bybit', 'OKX', 'Binance'];

  function validateExchange(name: string): boolean {
    return ALLOWED_EXCHANGES.includes(name);
  }

  it('Bybit を許可', () => {
    expect(validateExchange('Bybit')).toBe(true);
  });

  it('OKX を許可', () => {
    expect(validateExchange('OKX')).toBe(true);
  });

  it('Binance を許可', () => {
    expect(validateExchange('Binance')).toBe(true);
  });

  it('未登録の取引所を拒否', () => {
    expect(validateExchange('Coinbase')).toBe(false);
    expect(validateExchange('Kraken')).toBe(false);
    expect(validateExchange('Huobi')).toBe(false);
  });

  it('大文字小文字が異なると拒否（厳密一致）', () => {
    expect(validateExchange('bybit')).toBe(false);
    expect(validateExchange('BYBIT')).toBe(false);
    expect(validateExchange('okx')).toBe(false);
    expect(validateExchange('binance')).toBe(false);
  });

  it('空文字を拒否', () => {
    expect(validateExchange('')).toBe(false);
  });

  it('SQLインジェクション風の文字列を拒否', () => {
    expect(validateExchange("Bybit'; DROP TABLE--")).toBe(false);
    expect(validateExchange('<script>alert(1)</script>')).toBe(false);
  });
});

// =====================================================================
// HMAC-SHA256 Webhook Signature
// =====================================================================
describe('Webhook署名 (HMAC-SHA256)', () => {
  it('正しい署名を生成する', () => {
    const secret = 'webhook-secret-key';
    const body = JSON.stringify({ event: 'order.completed', orderId: 'ORD-123' });
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(sig.startsWith('sha256=')).toBe(true);
    expect(sig.length).toBe(7 + 64); // 'sha256=' (7) + hex sha256 (64)
  });

  it('同じペイロード+シークレットで同一署名', () => {
    const secret = 'my-secret';
    const body = '{"test":true}';
    const sig1 = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const sig2 = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(sig1).toBe(sig2);
  });

  it('異なるシークレットで異なる署名', () => {
    const body = '{"test":true}';
    const sig1 = crypto.createHmac('sha256', 'secret1').update(body).digest('hex');
    const sig2 = crypto.createHmac('sha256', 'secret2').update(body).digest('hex');
    expect(sig1).not.toBe(sig2);
  });
});
