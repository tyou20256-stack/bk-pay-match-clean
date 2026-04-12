/**
 * @file fees.test.ts — Unit tests for src/services/db/fees.ts
 */
import './setup.js';
import { describe, it, expect, beforeAll } from 'vitest';
import * as dbSvc from '../../src/services/db/index.js';

beforeAll(async () => {
  const { runMigrations } = await import('../../src/services/migrationManager.js');
  runMigrations();
});

describe('fees: getFeeSettings defaults', () => {
  it('returns the seeded default fee_settings row', () => {
    const s = dbSvc.getFeeSettings();
    expect(s).toBeDefined();
    expect(s!.id).toBe(1);
    expect(s!.base_fee_rate).toBeTypeOf('number');
    expect(s!.vip_bronze_rate).toBeGreaterThanOrEqual(0);
  });
});

describe('fees: updateFeeSettings persistence', () => {
  it('updates listed fields and persists them', () => {
    dbSvc.updateFeeSettings({
      vip_bronze_rate: 0.025,
      vip_silver_rate: 0.02,
      vip_gold_rate: 0.015,
      vip_platinum_rate: 0.01,
    });
    const s = dbSvc.getFeeSettings()!;
    expect(s.vip_bronze_rate).toBeCloseTo(0.025, 6);
    expect(s.vip_silver_rate).toBeCloseTo(0.02, 6);
    expect(s.vip_gold_rate).toBeCloseTo(0.015, 6);
    expect(s.vip_platinum_rate).toBeCloseTo(0.01, 6);
  });
});

describe('fees: getFeeRateForRank', () => {
  beforeAll(() => {
    dbSvc.updateFeeSettings({
      vip_bronze_rate: 0.02,
      vip_silver_rate: 0.017,
      vip_gold_rate: 0.015,
      vip_platinum_rate: 0.01,
    });
  });

  it('returns bronze rate for unknown / bronze rank', () => {
    expect(dbSvc.getFeeRateForRank('bronze')).toBeCloseTo(0.02, 6);
    expect(dbSvc.getFeeRateForRank('diamond')).toBeCloseTo(0.02, 6); // not defined → falls through to bronze
  });

  it('returns silver/gold/platinum for known ranks', () => {
    expect(dbSvc.getFeeRateForRank('silver')).toBeCloseTo(0.017, 6);
    expect(dbSvc.getFeeRateForRank('gold')).toBeCloseTo(0.015, 6);
    expect(dbSvc.getFeeRateForRank('platinum')).toBeCloseTo(0.01, 6);
  });
});

describe('fees: estimateOrderCost', () => {
  it('produces a cost breakdown with estimatedCost, minFeeJpy, minFeeRate', () => {
    const est = dbSvc.estimateOrderCost(100_000, 'buy');
    expect(est.estimatedCost).toBeGreaterThan(0);
    expect(est.minFeeJpy).toBeGreaterThan(0);
    expect(est.minFeeRate).toBeGreaterThan(0);
    expect(est.minFeeRate).toBeLessThan(1);
  });

  it('scales minFeeJpy with amount for the sell direction', () => {
    const small = dbSvc.estimateOrderCost(10_000, 'sell');
    const large = dbSvc.estimateOrderCost(1_000_000, 'sell');
    expect(large.minFeeJpy).toBeGreaterThan(small.minFeeJpy);
  });
});

describe('fees: recordTransactionCost + getTotalTransactionCost roundtrip', () => {
  it('sums costs for the same order_id', () => {
    const orderId = `ORD-FEE-${Date.now()}`;
    dbSvc.recordTransactionCost(orderId, 'tron_gas', 50, 'gas 1');
    dbSvc.recordTransactionCost(orderId, 'bank_fee', 100, 'bank');
    dbSvc.recordTransactionCost(orderId, 'other', 25);

    expect(dbSvc.getTotalTransactionCost(orderId)).toBeCloseTo(175, 2);

    const costs = dbSvc.getTransactionCosts(orderId);
    expect(costs.length).toBe(3);
    const types = costs.map(c => c.cost_type).sort();
    expect(types).toEqual(['bank_fee', 'other', 'tron_gas']);
  });

  it('returns 0 for an order with no costs recorded', () => {
    expect(dbSvc.getTotalTransactionCost('ORD-NONE-EVER')).toBe(0);
  });
});
