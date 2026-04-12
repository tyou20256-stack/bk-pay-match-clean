/**
 * @file paypay.ts — PayPay conversions + providers
 */
import { db } from './connection.js';

export function insertPayPayConversion(data: { requesterId: string; requesterType: string; amount: number; feeRate: number; requesterPaypayId: string }): number {
  const feeAmount = Math.round(data.amount * data.feeRate);
  const payoutAmount = data.amount - feeAmount;
  const timeoutAt = Date.now() + 30 * 60 * 1000;
  const result = db.prepare('INSERT INTO paypay_conversions (requester_id, requester_type, amount, fee_rate, fee_amount, payout_amount, requester_paypay_id, status, created_at, timeout_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    data.requesterId, data.requesterType, data.amount, data.feeRate, feeAmount, payoutAmount, data.requesterPaypayId, 'waiting', Date.now(), timeoutAt
  );
  return Number(result.lastInsertRowid);
}

export function getWaitingPayPayConversions(type: string): Array<{ id: number; requester_id: string; amount: number; fee_rate: number; payout_amount: number; requester_paypay_id: string; created_at: number }> {
  return db.prepare("SELECT id, requester_id, amount, fee_rate, payout_amount, requester_paypay_id, created_at FROM paypay_conversions WHERE status = 'waiting' AND requester_type = ? AND timeout_at > ? ORDER BY created_at ASC").all(type, Date.now()) as Array<{ id: number; requester_id: string; amount: number; fee_rate: number; payout_amount: number; requester_paypay_id: string; created_at: number }>;
}

export function getActivePayPayProviders(type: string): Array<{ id: number; provider_id: string; paypay_id: string; min_amount: number; max_amount: number; fee_rate: number }> {
  return db.prepare("SELECT id, provider_id, paypay_id, min_amount, max_amount, fee_rate FROM paypay_providers WHERE status = 'active' AND provider_type = ? ORDER BY fee_rate ASC").all(type) as Array<{ id: number; provider_id: string; paypay_id: string; min_amount: number; max_amount: number; fee_rate: number }>;
}

export function insertPayPayProvider(data: { providerId: string; providerType: string; paypayId: string; minAmount: number; maxAmount: number; feeRate: number }): void {
  db.prepare('INSERT OR REPLACE INTO paypay_providers (provider_id, provider_type, paypay_id, min_amount, max_amount, fee_rate, status, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    data.providerId, data.providerType, data.paypayId, data.minAmount, data.maxAmount, data.feeRate, 'active', Date.now()
  );
}

export function matchPayPayConversion(conversionId: number, providerId: number): boolean {
  const result = db.prepare("UPDATE paypay_conversions SET status = 'matched', matched_with = ?, matched_at = ? WHERE id = ? AND status = 'waiting'").run(providerId, Date.now(), conversionId);
  return result.changes > 0;
}

export function updatePayPayConversionStatus(id: number, status: string, extra?: Record<string, unknown>): void {
  const ALLOWED = new Set(['requester_proof', 'provider_proof', 'requester_proof_score', 'provider_proof_score', 'completed_at', 'provider_paypay_id']);
  if (extra) {
    const safe = Object.fromEntries(Object.entries(extra).filter(([k]) => ALLOWED.has(k)));
    const sets = Object.entries(safe).map(([k]) => `${k} = ?`).join(', ');
    const vals = Object.values(safe);
    if (sets) { db.prepare(`UPDATE paypay_conversions SET status = ?, ${sets} WHERE id = ?`).run(status, ...vals, id); return; }
  }
  db.prepare('UPDATE paypay_conversions SET status = ? WHERE id = ?').run(status, id);
}

export function getPayPayConversion(id: number): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM paypay_conversions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

export function getPayPayConversionByRequesterId(requesterId: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM paypay_conversions WHERE requester_id = ? AND status IN ('waiting', 'matched', 'requester_sent', 'provider_sent') ORDER BY id DESC LIMIT 1").get(requesterId) as Record<string, unknown> | undefined;
}

export function deletePayPayProvider(providerId: string): void {
  db.prepare("UPDATE paypay_providers SET status = 'inactive' WHERE provider_id = ?").run(providerId);
}

export function expirePayPayConversions(): number {
  const result = db.prepare("UPDATE paypay_conversions SET status = 'expired' WHERE status = 'waiting' AND timeout_at < ?").run(Date.now());
  return result.changes;
}
