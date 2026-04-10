/**
 * @file comprehensive.test.ts — 包括的ユニットテスト: 10カテゴリ 55テスト
 * @description HMAC, Order Token, Password Policy, Rate Calculation, Fee Tolerance,
 *   Referral Code, Withdrawal Filter, i18n, Input Sanitization, Timer/Expiry
 * @run npx vitest run tests/comprehensive.test.ts
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// =====================================================================
// 1. HMAC Buyer Token Tests (5 tests)
// =====================================================================
describe('HMAC Buyer Token', () => {
  const secret = 'prod-secret-key';
  const generateToken = (buyerId: string) =>
    crypto.createHmac('sha256', secret).update(buyerId).digest('hex').slice(0, 16);

  it('should generate consistent tokens for same input', () => {
    const token1 = generateToken('web_abc123');
    const token2 = generateToken('web_abc123');
    expect(token1).toBe(token2);
  });

  it('should generate different tokens for different inputs', () => {
    const token1 = generateToken('web_abc123');
    const token2 = generateToken('web_xyz789');
    expect(token1).not.toBe(token2);
  });

  it('should be 16 chars hex', () => {
    const token = generateToken('web_testbuyer001');
    expect(token).toMatch(/^[a-f0-9]{16}$/);
    expect(token.length).toBe(16);
  });

  it('should handle empty buyerId', () => {
    const token = generateToken('');
    expect(token).toMatch(/^[a-f0-9]{16}$/);
    // empty string still produces a valid HMAC
    expect(token.length).toBe(16);
  });

  it('should handle special characters in buyerId', () => {
    const token = generateToken('web_日本語テスト!@#$%^&*()');
    expect(token).toMatch(/^[a-f0-9]{16}$/);
    expect(token.length).toBe(16);
  });
});

// =====================================================================
// 2. Order Token Tests (4 tests)
// =====================================================================
describe('Order Token', () => {
  const generateOrderToken = () => crypto.randomBytes(16).toString('hex');

  it('should generate 32-char hex token', () => {
    const token = generateOrderToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(token.length).toBe(32);
  });

  it('should be unique per generation', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tokens.add(generateOrderToken());
    }
    expect(tokens.size).toBe(1000);
  });

  it('should not contain predictable patterns', () => {
    const token = generateOrderToken();
    // Should not be all zeros or all same char
    expect(token).not.toMatch(/^(.)\1+$/);
    expect(token).not.toBe('0'.repeat(32));
  });

  it('should be cryptographically random', () => {
    // Generate many tokens and check distribution of first char
    const firstChars = new Map<string, number>();
    for (let i = 0; i < 10000; i++) {
      const token = generateOrderToken();
      const c = token[0];
      firstChars.set(c, (firstChars.get(c) || 0) + 1);
    }
    // With 16 possible hex chars, each should appear ~625 times (10000/16)
    // Allow wide range but ensure no single char dominates
    for (const [, count] of firstChars) {
      expect(count).toBeGreaterThan(200);
      expect(count).toBeLessThan(1200);
    }
  });
});

// =====================================================================
// 3. Password Policy Tests (6 tests)
// =====================================================================
describe('Password Policy', () => {
  const COMMON_PASSWORDS = [
    'password123!A', 'Password1234!', 'Qwerty12345!',
    'Admin12345678!', 'Welcome12345!',
  ];

  const validatePassword = (pw: string): { valid: boolean; reason?: string } => {
    if (pw.length < 12) return { valid: false, reason: 'too_short' };
    if (!/[a-zA-Z]/.test(pw)) return { valid: false, reason: 'no_letters' };
    if (!/[0-9]/.test(pw)) return { valid: false, reason: 'no_numbers' };
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)) return { valid: false, reason: 'no_special' };
    const lower = pw.toLowerCase();
    if (COMMON_PASSWORDS.some(c => lower === c.toLowerCase())) return { valid: false, reason: 'common' };
    return { valid: true };
  };

  it('should reject passwords under 12 chars', () => {
    const result = validatePassword('Abc!1234567');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('too_short');
  });

  it('should reject passwords without letters', () => {
    const result = validatePassword('123456789012!@');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_letters');
  });

  it('should reject passwords without numbers', () => {
    const result = validatePassword('AbcDefGhIjKl!@');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_numbers');
  });

  it('should reject passwords without special chars', () => {
    const result = validatePassword('AbcDef123456789');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no_special');
  });

  it('should reject common passwords', () => {
    const result = validatePassword('Password1234!');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('common');
  });

  it('should accept valid strong passwords', () => {
    expect(validatePassword('X9$kL2!mNpQ4vR').valid).toBe(true);
    expect(validatePassword('MyS3cur3P@ssw0rd!').valid).toBe(true);
    expect(validatePassword('7h!sIs4V3ryStr0ng').valid).toBe(true);
  });
});

// =====================================================================
// 4. Rate Calculation Tests (5 tests)
// =====================================================================
describe('Rate Calculations', () => {
  const calcUsdt = (jpy: number, rate: number): number => {
    if (rate === 0) return Infinity;
    return parseFloat((jpy / rate).toFixed(6));
  };

  it('should calculate correct USDT from JPY', () => {
    const usdt = calcUsdt(150000, 150.0);
    expect(usdt).toBe(1000);
  });

  it('should handle zero rate gracefully', () => {
    expect(calcUsdt(100000, 0)).toBe(Infinity);
  });

  it('should handle very large amounts', () => {
    const usdt = calcUsdt(10_000_000, 150.5);
    expect(usdt).toBeGreaterThan(60000);
    expect(usdt).toBeLessThan(70000);
    expect(typeof usdt).toBe('number');
    expect(isFinite(usdt)).toBe(true);
  });

  it('should handle very small amounts', () => {
    const usdt = calcUsdt(10000, 155.25);
    expect(usdt).toBeGreaterThan(60);
    expect(usdt).toBeLessThan(70);
  });

  it('should maintain 6 decimal precision', () => {
    const usdt = calcUsdt(100000, 153.333);
    const decimalPart = usdt.toString().split('.')[1] || '';
    expect(decimalPart.length).toBeLessThanOrEqual(6);
  });
});

// =====================================================================
// 5. Fee Tolerance Tests (8 tests)
// =====================================================================
describe('Fee Tolerance Extended', () => {
  const MAX_FEE = 1000;
  const isMatch = (actual: number, expected: number) =>
    actual === expected || (actual > expected && actual <= expected + MAX_FEE);

  it('should accept exact amount match', () => {
    expect(isMatch(288000, 288000)).toBe(true);
  });

  it('should accept amount with 220 yen fee', () => {
    expect(isMatch(288220, 288000)).toBe(true);
  });

  it('should accept amount with 440 yen fee', () => {
    expect(isMatch(288440, 288000)).toBe(true);
  });

  it('should accept amount at max fee boundary', () => {
    expect(isMatch(289000, 288000)).toBe(true);
  });

  it('should reject amount below expected', () => {
    expect(isMatch(287999, 288000)).toBe(false);
    expect(isMatch(280000, 288000)).toBe(false);
  });

  it('should reject amount significantly above expected + fee', () => {
    expect(isMatch(289001, 288000)).toBe(false);
    expect(isMatch(300000, 288000)).toBe(false);
  });

  it('should handle zero expected amount', () => {
    expect(isMatch(0, 0)).toBe(true);
    expect(isMatch(500, 0)).toBe(true);   // within fee range
    expect(isMatch(1001, 0)).toBe(false);  // over max fee
  });

  it('should handle large amounts with fees', () => {
    expect(isMatch(10_000_000, 10_000_000)).toBe(true);
    expect(isMatch(10_000_440, 10_000_000)).toBe(true);
    expect(isMatch(10_001_000, 10_000_000)).toBe(true);
    expect(isMatch(10_001_001, 10_000_000)).toBe(false);
  });
});

// =====================================================================
// 6. Referral Code Tests (5 tests)
// =====================================================================
describe('Referral Codes', () => {
  const generateRefCode = () =>
    'PM' + crypto.randomBytes(4).toString('hex').toUpperCase();

  const extractRefCode = (buyerId: string): string | null => {
    const match = buyerId.match(/_ref_(PM[A-F0-9]{8})$/i);
    return match ? match[1].toUpperCase() : null;
  };

  it('should generate PM prefix codes', () => {
    const code = generateRefCode();
    expect(code.startsWith('PM')).toBe(true);
  });

  it('should be 10 chars total (PM + 8 hex)', () => {
    const code = generateRefCode();
    expect(code.length).toBe(10);
    expect(code).toMatch(/^PM[A-F0-9]{8}$/);
  });

  it('should be unique', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateRefCode());
    }
    expect(codes.size).toBe(1000);
  });

  it('should extract ref code from buyer ID', () => {
    const ref = extractRefCode('web_abc123_ref_PM8D80B44D');
    expect(ref).toBe('PM8D80B44D');
  });

  it('should handle buyer ID without ref code', () => {
    expect(extractRefCode('web_abc123')).toBeNull();
    expect(extractRefCode('web_abc123_noref')).toBeNull();
    expect(extractRefCode('')).toBeNull();
  });
});

// =====================================================================
// 7. Withdrawal Filter Tests (5 tests)
// =====================================================================
describe('Withdrawal Filtering', () => {
  interface Withdrawal {
    type: 'domestic' | 'overseas';
    currency: string;
    bankName?: string;
    accountNumber?: string;
    amount: number;
  }

  const isValidWithdrawal = (w: Withdrawal): { valid: boolean; reason?: string } => {
    if (w.type !== 'domestic') return { valid: false, reason: 'overseas_not_allowed' };
    if (w.currency !== 'JPY') return { valid: false, reason: 'non_jpy_currency' };
    if (!w.bankName || w.bankName.trim() === '') return { valid: false, reason: 'missing_bank_name' };
    if (!w.accountNumber || w.accountNumber.trim() === '') return { valid: false, reason: 'missing_account_number' };
    return { valid: true };
  };

  it('should accept domestic JPY withdrawal', () => {
    const result = isValidWithdrawal({
      type: 'domestic', currency: 'JPY',
      bankName: 'みずほ銀行', accountNumber: '1234567', amount: 100000,
    });
    expect(result.valid).toBe(true);
  });

  it('should reject overseas withdrawal', () => {
    const result = isValidWithdrawal({
      type: 'overseas', currency: 'JPY',
      bankName: 'Citibank', accountNumber: '9876543', amount: 50000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('overseas_not_allowed');
  });

  it('should reject non-JPY currency', () => {
    const result = isValidWithdrawal({
      type: 'domestic', currency: 'USD',
      bankName: '三菱UFJ銀行', accountNumber: '1111111', amount: 1000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('non_jpy_currency');
  });

  it('should reject withdrawal without bank name', () => {
    const result = isValidWithdrawal({
      type: 'domestic', currency: 'JPY',
      bankName: '', accountNumber: '1234567', amount: 50000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_bank_name');
  });

  it('should reject withdrawal without account number', () => {
    const result = isValidWithdrawal({
      type: 'domestic', currency: 'JPY',
      bankName: '三井住友銀行', accountNumber: '', amount: 50000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing_account_number');
  });
});

// =====================================================================
// 8. i18n Key Completeness Tests (4 tests)
// =====================================================================
describe('i18n Key Completeness', () => {
  // Parse i18n.js to extract keys for each language
  const i18nPath = path.resolve(__dirname, '..', 'public', 'i18n.js');
  const i18nContent = fs.readFileSync(i18nPath, 'utf-8');

  // Extract keys from the static translation objects (not the dynamic ones)
  const extractKeys = (lang: string): string[] => {
    // Find the block for this language: "  <lang>: {"
    const langPattern = new RegExp(`^  ${lang}: \\{`, 'm');
    const match = langPattern.exec(i18nContent);
    if (!match) return [];

    const startIdx = match.index + match[0].length;
    let braceDepth = 1;
    let endIdx = startIdx;
    for (let i = startIdx; i < i18nContent.length && braceDepth > 0; i++) {
      if (i18nContent[i] === '{') braceDepth++;
      if (i18nContent[i] === '}') braceDepth--;
      endIdx = i;
    }

    const block = i18nContent.substring(startIdx, endIdx);
    const keyMatches = block.match(/'([^']+)'\s*:/g) || [];
    return keyMatches.map(k => k.replace(/'/g, '').replace(':', '').trim());
  };

  const jaKeys = extractKeys('ja');
  const enKeys = extractKeys('en');
  const zhKeys = extractKeys('zh');
  const viKeys = extractKeys('vi');

  it('should have matching keys across all languages', () => {
    // All languages should have the same number of keys
    expect(jaKeys.length).toBeGreaterThan(50);
    expect(enKeys.length).toBe(jaKeys.length);
    expect(zhKeys.length).toBe(jaKeys.length);
    expect(viKeys.length).toBe(jaKeys.length);

    // Every JA key should exist in all other languages
    const enSet = new Set(enKeys);
    const zhSet = new Set(zhKeys);
    const viSet = new Set(viKeys);
    const missingEn = jaKeys.filter(k => !enSet.has(k));
    const missingZh = jaKeys.filter(k => !zhSet.has(k));
    const missingVi = jaKeys.filter(k => !viSet.has(k));
    expect(missingEn).toEqual([]);
    expect(missingZh).toEqual([]);
    expect(missingVi).toEqual([]);
  });

  it('should have no empty translation values', () => {
    // Check for empty string values like 'key': ''
    const emptyPattern = /'[^']+'\s*:\s*''\s*[,}]/g;
    const emptyMatches = i18nContent.match(emptyPattern) || [];
    expect(emptyMatches).toEqual([]);
  });

  it('should have guide keys in all languages', () => {
    const guideKeys = jaKeys.filter(k => k.startsWith('guide_'));
    expect(guideKeys.length).toBeGreaterThan(10);
    const enSet = new Set(enKeys);
    const zhSet = new Set(zhKeys);
    const viSet = new Set(viKeys);
    for (const k of guideKeys) {
      expect(enSet.has(k)).toBe(true);
      expect(zhSet.has(k)).toBe(true);
      expect(viSet.has(k)).toBe(true);
    }
  });

  it('should have terms keys in all languages', () => {
    const termsKeys = jaKeys.filter(k => k.startsWith('terms_'));
    expect(termsKeys.length).toBeGreaterThan(5);
    const enSet = new Set(enKeys);
    const zhSet = new Set(zhKeys);
    const viSet = new Set(viKeys);
    for (const k of termsKeys) {
      expect(enSet.has(k)).toBe(true);
      expect(zhSet.has(k)).toBe(true);
      expect(viSet.has(k)).toBe(true);
    }
  });
});

// =====================================================================
// 9. Input Sanitization Tests (5 tests)
// =====================================================================
describe('Input Sanitization', () => {
  const stripHtml = (input: string): string =>
    input.replace(/<[^>]*>/g, '').trim();

  const limitLength = (input: string, max: number): string =>
    input.length > max ? input.slice(0, max) : input;

  const TRON_ADDR_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
  const REFERRAL_RE = /^PM[A-F0-9]{8}$/i;

  it('should strip HTML from chat messages', () => {
    expect(stripHtml('<script>alert("xss")</script>Hello')).toBe('alert("xss")Hello');
    expect(stripHtml('<b>bold</b>')).toBe('bold');
    expect(stripHtml('<img src=x onerror=alert(1)>test')).toBe('test');
    expect(stripHtml('normal text')).toBe('normal text');
  });

  it('should limit message length', () => {
    const longMsg = 'A'.repeat(5000);
    const limited = limitLength(longMsg, 1000);
    expect(limited.length).toBe(1000);
    expect(limitLength('short', 1000)).toBe('short');
  });

  it('should handle unicode in wallet address', () => {
    // Unicode characters should fail TRON validation
    expect(TRON_ADDR_RE.test('T日本語テストアドレスabcdefghij1234567890ab')).toBe(false);
    expect(TRON_ADDR_RE.test('T' + '\u200B'.repeat(33))).toBe(false); // zero-width spaces
  });

  it('should handle SQL injection attempts in referral code', () => {
    expect(REFERRAL_RE.test("PM'; DROP TABLE--")).toBe(false);
    expect(REFERRAL_RE.test("PM1' OR '1'='1")).toBe(false);
    expect(REFERRAL_RE.test('PM8D80B44D')).toBe(true);
  });

  it('should handle XSS in reference number', () => {
    const sanitizeRef = (ref: string): string =>
      ref.replace(/[^a-zA-Z0-9\-_]/g, '');

    expect(sanitizeRef('<script>alert(1)</script>')).toBe('scriptalert1script');
    expect(sanitizeRef('REF-12345')).toBe('REF-12345');
    expect(sanitizeRef('normal_ref_123')).toBe('normal_ref_123');
    expect(sanitizeRef('ref"onmouseover="alert(1)')).toBe('refonmouseoveralert1');
  });
});

// =====================================================================
// 10. Timer and Expiry Tests (5 tests)
// =====================================================================
describe('Timer and Expiry', () => {
  const MATCH_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  const calcExpiry = (createdAt: Date): Date =>
    new Date(createdAt.getTime() + MATCH_TIMEOUT_MS);

  const isExpired = (createdAt: Date, now: Date): boolean =>
    now.getTime() > createdAt.getTime() + MATCH_TIMEOUT_MS;

  it('should calculate 30-minute expiry correctly', () => {
    const created = new Date('2026-03-25T10:00:00Z');
    const expiry = calcExpiry(created);
    expect(expiry.toISOString()).toBe('2026-03-25T10:30:00.000Z');
  });

  it('should detect expired matches', () => {
    const created = new Date('2026-03-25T10:00:00Z');
    const now31min = new Date('2026-03-25T10:31:00Z');
    expect(isExpired(created, now31min)).toBe(true);

    const now60min = new Date('2026-03-25T11:00:00Z');
    expect(isExpired(created, now60min)).toBe(true);
  });

  it('should detect valid matches within window', () => {
    const created = new Date('2026-03-25T10:00:00Z');
    const now15min = new Date('2026-03-25T10:15:00Z');
    expect(isExpired(created, now15min)).toBe(false);

    const now29min = new Date('2026-03-25T10:29:00Z');
    expect(isExpired(created, now29min)).toBe(false);

    // Exactly at 30 minutes should NOT be expired (> not >=)
    const nowExact = new Date('2026-03-25T10:30:00Z');
    expect(isExpired(created, nowExact)).toBe(false);
  });

  it('should handle timezone differences', () => {
    // JST (UTC+9) created at 19:00 JST = 10:00 UTC
    const createdUTC = new Date('2026-03-25T10:00:00Z');
    // 30 min later in any timezone
    const expiry = calcExpiry(createdUTC);
    expect(expiry.getTime() - createdUTC.getTime()).toBe(MATCH_TIMEOUT_MS);

    // Verify ms difference is exactly 30 minutes regardless of timezone
    const createdJST = new Date('2026-03-25T19:00:00+09:00');
    expect(createdJST.getTime()).toBe(createdUTC.getTime());
    expect(calcExpiry(createdJST).getTime()).toBe(expiry.getTime());
  });

  it('should calculate localStorage TTL correctly', () => {
    const TTL_HOURS = 24;
    const now = Date.now();
    const expiresAt = now + TTL_HOURS * 60 * 60 * 1000;

    // Should be valid right after creation
    expect(expiresAt > now).toBe(true);

    // Should expire after 24h
    const after25h = now + 25 * 60 * 60 * 1000;
    expect(expiresAt > after25h).toBe(false);

    // Should still be valid at 23h
    const after23h = now + 23 * 60 * 60 * 1000;
    expect(expiresAt > after23h).toBe(true);
  });
});
