/**
 * @file orders.test.ts — Unit tests for src/services/db/orders.ts
 */
import './setup.js';
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import * as dbSvc from '../../src/services/db/index.js';

beforeAll(async () => {
  const { runMigrations } = await import('../../src/services/migrationManager.js');
  runMigrations();
});

const baseOrder = (overrides: Record<string, unknown> = {}) => ({
  id: `ORD-TEST-${crypto.randomBytes(4).toString('hex')}`,
  mode: 'auto',
  amount: 10000,
  cryptoAmount: 70,
  rate: 142.85,
  payMethod: 'bank',
  crypto: 'USDT',
  status: 'pending_payment',
  direction: 'buy',
  createdAt: Date.now(),
  expiresAt: Date.now() + 600_000,
  paymentInfo: null,
  ...overrides,
});

describe('orders: saveOrder + getOrder full roundtrip', () => {
  it('preserves core + optional fields (fee, token, wallet)', () => {
    const o = baseOrder({
      amount: 50_000,
      cryptoAmount: 333.5,
      rate: 150.1,
      feeRate: 0.015,
      feeJpy: 750,
      feeCrypto: 5,
      customerWalletAddress: 'TXYZ123',
      orderToken: 'tok-abc',
      merchantName: 'BKStock',
      merchantCompletionRate: 98.5,
    });
    dbSvc.saveOrder(o);
    const got = dbSvc.getOrder(o.id);
    expect(got).not.toBeNull();
    expect(got!.amount).toBe(50_000);
    expect(got!.cryptoAmount).toBe(333.5);
    expect(got!.rate).toBe(150.1);
    expect(got!.feeRate).toBeCloseTo(0.015, 6);
    expect(got!.feeJpy).toBeCloseTo(750, 2);
    expect(got!.feeCrypto).toBeCloseTo(5, 2);
    expect(got!.customerWalletAddress).toBe('TXYZ123');
    expect(got!.orderToken).toBe('tok-abc');
    expect(got!.merchantName).toBe('BKStock');
    expect(got!.merchantCompletionRate).toBeCloseTo(98.5, 2);
  });

  it('rowToOrder converts snake_case to camelCase with sensible defaults', () => {
    const o = baseOrder();
    dbSvc.saveOrder(o);
    const got = dbSvc.getOrder(o.id)!;
    expect(got.direction).toBe('buy');
    expect(got.customerWallet).toBe('');
    expect(got.feeRate).toBeGreaterThanOrEqual(0);
    expect(got.verifiedAt).toBeNull();
    expect(got.txId).toBeNull();
    expect(got.sellerId).toBeNull();
  });
});

describe('orders: updateOrderStatus with extras', () => {
  it('applies paid_at, verified_at, tx_id, completed_at fields', () => {
    const o = baseOrder();
    dbSvc.saveOrder(o);
    const paidAt = Date.now();
    dbSvc.updateOrderStatus(o.id, 'confirming', { paidAt });
    let got = dbSvc.getOrder(o.id)!;
    expect(got.status).toBe('confirming');
    expect(got.paidAt).toBe(paidAt);

    const verifiedAt = paidAt + 1000;
    const txId = 'tx-abc-123';
    dbSvc.updateOrderStatus(o.id, 'payment_verified', { verifiedAt, txId });
    got = dbSvc.getOrder(o.id)!;
    expect(got.status).toBe('payment_verified');
    expect(got.verifiedAt).toBe(verifiedAt);
    expect(got.txId).toBe(txId);

    const completedAt = verifiedAt + 1000;
    dbSvc.updateOrderStatus(o.id, 'completed', { completedAt });
    got = dbSvc.getOrder(o.id)!;
    expect(got.status).toBe('completed');
    expect(got.completedAt).toBe(completedAt);
  });
});

describe('orders: claimOrderForSending CAS', () => {
  it('returns true the first time and false on re-claim', () => {
    const o = baseOrder({ status: 'payment_verified' });
    dbSvc.saveOrder(o);
    const first = dbSvc.claimOrderForSending(o.id);
    expect(first).toBe(true);
    const second = dbSvc.claimOrderForSending(o.id);
    expect(second).toBe(false);
    expect(dbSvc.getOrder(o.id)!.status).toBe('sending_crypto');
  });

  it('returns false when current status is not payment_verified', () => {
    const o = baseOrder({ status: 'pending_payment' });
    dbSvc.saveOrder(o);
    expect(dbSvc.claimOrderForSending(o.id)).toBe(false);
    expect(dbSvc.getOrder(o.id)!.status).toBe('pending_payment');
  });
});

describe('orders: getAllOrders', () => {
  it('returns orders in descending created_at order', () => {
    const now = Date.now();
    const older = baseOrder({ createdAt: now - 60_000, id: `ORD-OLD-${crypto.randomBytes(3).toString('hex')}` });
    const newer = baseOrder({ createdAt: now, id: `ORD-NEW-${crypto.randomBytes(3).toString('hex')}` });
    dbSvc.saveOrder(older);
    dbSvc.saveOrder(newer);

    const all = dbSvc.getAllOrders(200);
    const olderIdx = all.findIndex(o => o.id === older.id);
    const newerIdx = all.findIndex(o => o.id === newer.id);
    expect(olderIdx).toBeGreaterThanOrEqual(0);
    expect(newerIdx).toBeGreaterThanOrEqual(0);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it('respects the limit parameter', () => {
    const list = dbSvc.getAllOrders(1);
    expect(list.length).toBeLessThanOrEqual(1);
  });
});

describe('orders: seller id + withdrawal id associations', () => {
  it('saveOrderWithdrawalId updates the withdrawal_id column', () => {
    const o = baseOrder();
    dbSvc.saveOrder(o);
    dbSvc.saveOrderWithdrawalId(o.id, 4242);
    const got = dbSvc.getOrder(o.id)!;
    expect(got.withdrawalId).toBe(4242);
  });
});
