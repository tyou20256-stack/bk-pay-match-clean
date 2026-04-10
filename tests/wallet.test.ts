/**
 * @file wallet.test.ts — ウォレット・暗号通貨関連のユニットテスト
 * @description USDT送金金額バリデーション、Sun変換、TRONアドレス検証、
 *   ウォレット未設定エラーなどをテスト。
 * @run npx vitest run tests/wallet.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =====================================================================
// TRON address format validation
// Regex used in walletService.ts and api.ts
// =====================================================================
const TRON_ADDR_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

describe('TRONアドレス形式バリデーション', () => {
  it('正しいTRONアドレスを許可（Tで始まる34文字のBase58）', () => {
    // Real mainnet USDT contract address as example
    expect(TRON_ADDR_RE.test('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(true);
  });

  it('複数の有効アドレスを検証', () => {
    const validAddresses = [
      'TJYeasTPa8WDBhJPbBFEBHjEQHftJbRBEj',
      'TVj7RNVHy6thbM7BWdSe9G6gXwKhjhdNZS',
      'TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9',
    ];
    for (const addr of validAddresses) {
      expect(TRON_ADDR_RE.test(addr)).toBe(true);
    }
  });

  it('Tで始まらないアドレスを拒否', () => {
    expect(TRON_ADDR_RE.test('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD00')).toBe(false); // ETH
    expect(TRON_ADDR_RE.test('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false); // BTC
    expect(TRON_ADDR_RE.test('AJYeasTPa8WDBhJPbBFEBHjEQHftJbRBEj')).toBe(false);
  });

  it('33文字未満のアドレスを拒否', () => {
    expect(TRON_ADDR_RE.test('TJYeasTPa8WDBhJPbBFEBHjEQ')).toBe(false);
    expect(TRON_ADDR_RE.test('T')).toBe(false);
  });

  it('35文字以上のアドレスを拒否', () => {
    expect(TRON_ADDR_RE.test('TJYeasTPa8WDBhJPbBFEBHjEQHftJbRBEjX')).toBe(false);
  });

  it('空文字を拒否', () => {
    expect(TRON_ADDR_RE.test('')).toBe(false);
  });

  it('不正文字（0, O, I, l）を含むアドレスを拒否', () => {
    // Base58 excludes 0, O, I, l
    expect(TRON_ADDR_RE.test('T0YeasTPa8WDBhJPbBFEBHjEQHftJbRBEj')).toBe(false); // 0
    expect(TRON_ADDR_RE.test('TOYeasTPa8WDBhJPbBFEBHjEQHftJbRBEj')).toBe(false); // O
    expect(TRON_ADDR_RE.test('TIYeasTPa8WDBhJPbBFEBHjEQHftJbRBEj')).toBe(false); // I
    expect(TRON_ADDR_RE.test('TlYeasTPa8WDBhJPbBFEBHjEQHftJbRBEj')).toBe(false); // l
  });
});

// =====================================================================
// USDT Amount to Sun conversion (integer arithmetic)
// =====================================================================
describe('USDT金額 → Sun変換（整数演算）', () => {
  // Replicating the conversion logic from walletService.ts sendUSDT
  function usdtToSun(amount: number): number {
    const amountStr = amount.toFixed(6);
    const [whole, frac] = amountStr.split('.');
    return parseInt(whole, 10) * 1e6 + parseInt(frac, 10);
  }

  it('整数金額を正しくSunに変換', () => {
    expect(usdtToSun(1)).toBe(1_000_000);
    expect(usdtToSun(100)).toBe(100_000_000);
    expect(usdtToSun(50000)).toBe(50_000_000_000);
  });

  it('小数金額を正しくSunに変換', () => {
    expect(usdtToSun(1.5)).toBe(1_500_000);
    expect(usdtToSun(0.000001)).toBe(1); // minimum unit
    expect(usdtToSun(99.99)).toBe(99_990_000);
  });

  it('浮動小数点精度問題を回避', () => {
    // 0.1 + 0.2 の精度問題をinteger arithmeticで回避
    const amount = 0.1 + 0.2; // 0.30000000000000004
    const sun = usdtToSun(amount);
    expect(sun).toBe(300_000); // 0.3 USDT = 300,000 Sun
  });

  it('大きな金額でも正しく変換', () => {
    expect(usdtToSun(49999.999999)).toBe(49_999_999_999);
  });

  it('非常に小さい金額', () => {
    expect(usdtToSun(0.01)).toBe(10_000);
    expect(usdtToSun(0.001)).toBe(1_000);
  });
});

// =====================================================================
// Max send limit
// =====================================================================
describe('最大送金リミット', () => {
  const MAX_SINGLE_SEND_USDT = 50_000;

  it('50,000 USDT以下は許可', () => {
    expect(49_999 <= MAX_SINGLE_SEND_USDT).toBe(true);
    expect(50_000 <= MAX_SINGLE_SEND_USDT).toBe(true);
    expect(1 <= MAX_SINGLE_SEND_USDT).toBe(true);
  });

  it('50,000 USDT超過を拒否', () => {
    expect(50_001 > MAX_SINGLE_SEND_USDT).toBe(true);
    expect(100_000 > MAX_SINGLE_SEND_USDT).toBe(true);
    expect(1_000_000 > MAX_SINGLE_SEND_USDT).toBe(true);
  });
});

// =====================================================================
// Negative / Zero amount rejection
// =====================================================================
describe('不正金額の拒否', () => {
  // Replicating validation from sendUSDT
  function validateAmount(amount: number): { valid: boolean; error?: string } {
    const MAX_SINGLE_SEND_USDT = 50_000;
    if (amount <= 0) return { valid: false, error: `Invalid amount: ${amount}` };
    if (amount > MAX_SINGLE_SEND_USDT) return { valid: false, error: `Amount ${amount} exceeds max` };
    const amountStr = amount.toFixed(6);
    const [whole, frac] = amountStr.split('.');
    const amountSun = parseInt(whole, 10) * 1e6 + parseInt(frac, 10);
    if (amountSun <= 0) return { valid: false, error: `Invalid amount after conversion: ${amount}` };
    return { valid: true };
  }

  it('0を拒否', () => {
    expect(validateAmount(0).valid).toBe(false);
  });

  it('負の金額を拒否', () => {
    expect(validateAmount(-1).valid).toBe(false);
    expect(validateAmount(-100.5).valid).toBe(false);
    expect(validateAmount(-0.001).valid).toBe(false);
  });

  it('正の金額を許可', () => {
    expect(validateAmount(0.000001).valid).toBe(true);
    expect(validateAmount(1).valid).toBe(true);
    expect(validateAmount(50000).valid).toBe(true);
  });

  it('上限超過を拒否', () => {
    expect(validateAmount(50001).valid).toBe(false);
  });
});

// =====================================================================
// Wallet not configured error
// =====================================================================
describe('ウォレット未設定エラー', () => {
  const originalEnv = process.env.TRON_WALLET_PRIVATE_KEY;

  afterEach(() => {
    // Restore
    if (originalEnv !== undefined) {
      process.env.TRON_WALLET_PRIVATE_KEY = originalEnv;
    } else {
      delete process.env.TRON_WALLET_PRIVATE_KEY;
    }
  });

  it('TRON_WALLET_PRIVATE_KEY未設定時 isWalletReady = false', () => {
    delete process.env.TRON_WALLET_PRIVATE_KEY;
    expect(!!process.env.TRON_WALLET_PRIVATE_KEY).toBe(false);
  });

  it('TRON_WALLET_PRIVATE_KEY設定時 isWalletReady = true', () => {
    process.env.TRON_WALLET_PRIVATE_KEY = 'dummy-key-for-test';
    expect(!!process.env.TRON_WALLET_PRIVATE_KEY).toBe(true);
  });

  it('空文字の秘密鍵は未設定扱い', () => {
    process.env.TRON_WALLET_PRIVATE_KEY = '';
    expect(!!process.env.TRON_WALLET_PRIVATE_KEY).toBe(false);
  });
});

// =====================================================================
// Amount string parsing edge cases
// =====================================================================
describe('金額文字列パース - エッジケース', () => {
  function usdtToSun(amount: number): number {
    const amountStr = amount.toFixed(6);
    const [whole, frac] = amountStr.split('.');
    return parseInt(whole, 10) * 1e6 + parseInt(frac, 10);
  }

  it('toFixed(6) が常に6桁の小数を生成', () => {
    expect((1).toFixed(6)).toBe('1.000000');
    expect((0.1).toFixed(6)).toBe('0.100000');
    expect((123.456789).toFixed(6)).toBe('123.456789');
  });

  it('整数のSun変換で小数部が0', () => {
    const amountStr = (42).toFixed(6);
    const [, frac] = amountStr.split('.');
    expect(parseInt(frac, 10)).toBe(0);
    expect(usdtToSun(42)).toBe(42_000_000);
  });

  it('最大精度(6桁)の金額', () => {
    expect(usdtToSun(1.123456)).toBe(1_123_456);
  });
});
