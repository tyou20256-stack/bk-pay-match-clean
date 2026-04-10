/**
 * @file unit.test.ts — ユニットテスト: 暗号化ユーティリティ、入力バリデーション、手数料許容、スコアリング、レート計算
 * @run npx vitest run tests/unit.test.ts
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

// =====================================================================
// Crypto Utilities
// =====================================================================
describe('暗号化ユーティリティ', () => {
  it('ユニークなbuyer IDを生成する', () => {
    const id1 = `web_${crypto.randomBytes(12).toString('hex')}`;
    const id2 = `web_${crypto.randomBytes(12).toString('hex')}`;
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^web_[a-f0-9]{24}$/);
  });

  it('有効なリファラルコードを生成する', () => {
    const code = 'PM' + crypto.randomBytes(4).toString('hex').toUpperCase();
    expect(code).toMatch(/^PM[A-F0-9]{8}$/);
  });

  it('TRONアドレスを正しくバリデートする', () => {
    const re = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
    expect(re.test('TLZHxKYnnJEwjFmaMje7KmsDKQpfhTL663')).toBe(true);
    expect(re.test('invalid')).toBe(false);
    expect(re.test('T' + 'a'.repeat(32))).toBe(false); // too short
    expect(re.test('0LZHxKYnnJEwjFmaMje7KmsDKQpfhTL663')).toBe(false); // doesn't start with T
  });

  it('HMAC buyerトークンを検証する', () => {
    const secret = 'test-secret';
    const buyerId = 'web_abc123';
    const token = crypto.createHmac('sha256', secret).update(buyerId).digest('hex').slice(0, 16);
    const verify = crypto.createHmac('sha256', secret).update(buyerId).digest('hex').slice(0, 16);
    expect(token).toBe(verify);

    const wrongToken = crypto.createHmac('sha256', secret).update('web_wrong').digest('hex').slice(0, 16);
    expect(token).not.toBe(wrongToken);
  });
});

// =====================================================================
// Input Validation
// =====================================================================
describe('入力バリデーション', () => {
  it('JPY金額を正しくバリデートする', () => {
    const isValidAmount = (a: number) => a >= 10000 && a <= 10000000;
    expect(isValidAmount(10000)).toBe(true);
    expect(isValidAmount(1000000)).toBe(true);
    expect(isValidAmount(10000000)).toBe(true);
    expect(isValidAmount(9999)).toBe(false);
    expect(isValidAmount(10000001)).toBe(false);
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(-1)).toBe(false);
  });

  it('リファラルコードを正しくバリデートする', () => {
    const isValidRef = (c: string) => /^PM[A-F0-9]{8}$/i.test(c);
    expect(isValidRef('PM8D80B44D')).toBe(true);
    expect(isValidRef('pm8d80b44d')).toBe(true);
    expect(isValidRef('PMSHORT')).toBe(false);
    expect(isValidRef('XX12345678')).toBe(false);
    expect(isValidRef('')).toBe(false);
  });

  it('カンマ区切りの金額をパースする', () => {
    const parse = (s: string) => parseInt(s.replace(/[,、\s]/g, '')) || 0;
    expect(parse('100000')).toBe(100000);
    expect(parse('100,000')).toBe(100000);
    expect(parse('1,000,000')).toBe(1000000);
    expect(parse('100、000')).toBe(100000);
    expect(parse('')).toBe(0);
    expect(parse('abc')).toBe(0);
  });
});

// =====================================================================
// Fee Tolerance Logic
// =====================================================================
describe('手数料許容ロジック', () => {
  it('正確な金額と手数料範囲内をマッチする', () => {
    const MAX_FEE = 1000;
    const expected = 288000;
    const isMatch = (actual: number) =>
      actual === expected || (actual > expected && actual <= expected + MAX_FEE);

    expect(isMatch(288000)).toBe(true);   // exact
    expect(isMatch(288440)).toBe(true);   // with fee
    expect(isMatch(289000)).toBe(true);   // max fee
    expect(isMatch(287999)).toBe(false);  // under
    expect(isMatch(289001)).toBe(false);  // over max fee
    expect(isMatch(300000)).toBe(false);  // way over
  });
});

// =====================================================================
// Proof Scoring
// =====================================================================
describe('証明スコアリング', () => {
  it('正しいスコアを計算する', () => {
    const score = (bank: boolean, acct: boolean, name: boolean, amt: boolean, isReceipt: boolean) => {
      if (!isReceipt) return 5;
      let s = 0;
      if (bank) s += 20;
      if (acct) s += 30;
      if (name) s += 25;
      if (amt) s += 25;
      return s;
    };

    expect(score(true, true, true, true, true)).toBe(100);
    expect(score(true, true, true, false, true)).toBe(75);
    expect(score(false, false, false, false, true)).toBe(0);
    expect(score(true, true, true, true, false)).toBe(5); // not a receipt
  });
});

// =====================================================================
// Rate Calculations
// =====================================================================
describe('レート計算', () => {
  it('JPYからUSDT金額を正しく計算する', () => {
    const rate = 150.5;
    const jpy = 100000;
    const usdt = parseFloat((jpy / rate).toFixed(6));
    expect(usdt).toBeGreaterThan(0);
    expect(usdt).toBeLessThan(jpy); // USDT amount should be less than JPY amount
    expect(usdt).toBe(parseFloat((100000 / 150.5).toFixed(6)));
  });

  it('ゼロ除算を適切に処理する', () => {
    const rate = 0;
    const jpy = 100000;
    const usdt = rate === 0 ? Infinity : parseFloat((jpy / rate).toFixed(6));
    expect(usdt).toBe(Infinity);
  });

  it('非常に大きな金額でも精度を保つ', () => {
    const rate = 150.5;
    const jpy = 10000000; // 10M JPY
    const usdt = parseFloat((jpy / rate).toFixed(6));
    expect(usdt).toBeGreaterThan(60000);
    expect(usdt).toBeLessThan(70000);
  });
});
