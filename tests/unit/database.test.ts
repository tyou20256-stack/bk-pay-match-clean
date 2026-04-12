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

describe('database: CAS order transitions', () => {
  it('transitionOrderStatus succeeds when current status matches', () => {
    const o = baseOrder();
    dbSvc.saveOrder(o);
    const ok = dbSvc.transitionOrderStatus(o.id, 'pending_payment', 'confirming', {});
    expect(ok).toBe(true);
    expect(dbSvc.getOrder(o.id)?.status).toBe('confirming');
  });

  it('transitionOrderStatus fails when current status differs (CAS guard)', () => {
    const o = baseOrder({ status: 'completed' });
    dbSvc.saveOrder(o);
    const ok = dbSvc.transitionOrderStatus(o.id, 'pending_payment', 'confirming', {});
    expect(ok).toBe(false);
    expect(dbSvc.getOrder(o.id)?.status).toBe('completed');
  });

  it('concurrent CAS: only one wins', () => {
    const o = baseOrder();
    dbSvc.saveOrder(o);
    const a = dbSvc.transitionOrderStatus(o.id, 'pending_payment', 'confirming', {});
    const b = dbSvc.transitionOrderStatus(o.id, 'pending_payment', 'cancelled', {});
    expect(a).toBe(true);
    expect(b).toBe(false);
  });

  it('transitionOrderStatus on non-existent order returns false', () => {
    const ok = dbSvc.transitionOrderStatus('ORD-NONEXISTENT', 'pending_payment', 'confirming', {});
    expect(ok).toBe(false);
  });
});

describe('database: P2P seller balance', () => {
  const email = `balance-${Date.now()}@example.com`;
  let sellerId: number;

  beforeAll(() => {
    sellerId = dbSvc.createP2PSeller({
      name: 'Balance Test',
      email,
      passwordHash: 'dummy-hash',
      confirmToken: crypto.randomBytes(16).toString('hex'),
      paypayId: '@balance',
      payMethods: ['paypay'],
      minAmount: 1000,
      maxAmount: 50000,
    });
  });

  it('creditP2PSellerBalance increases balance', () => {
    const before = Number(dbSvc.getP2PSeller(sellerId)?.usdt_balance || 0);
    dbSvc.creditP2PSellerBalance(sellerId, 100);
    const after = Number(dbSvc.getP2PSeller(sellerId)?.usdt_balance || 0);
    expect(after).toBeGreaterThanOrEqual(before + 100);
  });

  it('lock + release is balance-neutral', () => {
    dbSvc.creditP2PSellerBalance(sellerId, 50);
    const before = Number(dbSvc.getP2PSeller(sellerId)?.usdt_balance || 0);
    const locked = dbSvc.lockP2PSellerBalance(sellerId, 20);
    expect(locked).toBe(true);
    dbSvc.releaseP2PSellerBalance(sellerId, 20);
    const after = Number(dbSvc.getP2PSeller(sellerId)?.usdt_balance || 0);
    expect(after).toBe(before);
  });

  it('lockP2PSellerBalance fails if insufficient balance', () => {
    const seller = dbSvc.getP2PSeller(sellerId);
    const huge = Number(seller?.usdt_balance || 0) + 10_000_000;
    const locked = dbSvc.lockP2PSellerBalance(sellerId, huge);
    expect(locked).toBe(false);
  });

  it('creditP2PSellerBalance rejects non-positive amounts (guard)', () => {
    const before = Number(dbSvc.getP2PSeller(sellerId)?.usdt_balance || 0);
    try { dbSvc.creditP2PSellerBalance(sellerId, 0); } catch { /* ok */ }
    try { dbSvc.creditP2PSellerBalance(sellerId, -10); } catch { /* ok */ }
    const after = Number(dbSvc.getP2PSeller(sellerId)?.usdt_balance || 0);
    expect(after).toBe(before);
  });
});

describe('database: expired orders', () => {
  it('getExpiredPendingOrders returns orders past expiresAt', () => {
    const past = Date.now() - 60_000;
    const o = baseOrder({ createdAt: past - 30_000, expiresAt: past });
    dbSvc.saveOrder(o);
    const expired = dbSvc.getExpiredPendingOrders(Date.now());
    expect(expired.some((x: { id: string }) => x.id === o.id)).toBe(true);
  });

  it('getExpiredPendingOrders excludes non-pending orders', () => {
    const past = Date.now() - 60_000;
    const o = baseOrder({ status: 'completed', createdAt: past - 30_000, expiresAt: past });
    dbSvc.saveOrder(o);
    const expired = dbSvc.getExpiredPendingOrders(Date.now());
    expect(expired.some((x: { id: string }) => x.id === o.id)).toBe(false);
  });
});

describe('database: order CRUD', () => {
  it('saveOrder + getOrder roundtrip preserves fields', () => {
    const o = baseOrder({ amount: 50000, cryptoAmount: 333.5, orderToken: 'tok-abc' });
    dbSvc.saveOrder(o);
    const got = dbSvc.getOrder(o.id);
    expect(got?.amount).toBe(50000);
    expect(got?.cryptoAmount).toBe(333.5);
    expect(got?.orderToken).toBe('tok-abc');
    expect(got?.direction).toBe('buy');
  });

  it('getOrder returns null for missing id', () => {
    expect(dbSvc.getOrder('ORD-DOES-NOT-EXIST')).toBeNull();
  });
});
