/**
 * @file merchant.ts — Merchant API keys
 */
import { db } from './connection.js';
import type { MerchantApiKeyRow } from './connection.js';

export function createMerchantApiKey(name: string, keyHash: string, keyPrefix: string, webhookUrl?: string, webhookSecret?: string): number {
  const r = db.prepare(`INSERT INTO merchant_api_keys (name, key_hash, key_prefix, webhook_url, webhook_secret, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    name, keyHash, keyPrefix, webhookUrl || null, webhookSecret || null, Date.now()
  );
  return r.lastInsertRowid as number;
}

export function getMerchantApiKeyByHash(hash: string): MerchantApiKeyRow | null {
  return (db.prepare('SELECT * FROM merchant_api_keys WHERE key_hash = ? AND is_active = 1').get(hash) as MerchantApiKeyRow | undefined) || null;
}

export function getMerchantApiKeyById(id: number): MerchantApiKeyRow | null {
  return (db.prepare('SELECT * FROM merchant_api_keys WHERE id = ?').get(id) as MerchantApiKeyRow | undefined) || null;
}

export function listMerchantApiKeys(): MerchantApiKeyRow[] {
  return db.prepare('SELECT id, name, key_prefix, webhook_url, is_active, created_at, last_used_at FROM merchant_api_keys ORDER BY created_at DESC').all() as MerchantApiKeyRow[];
}

export function revokeMerchantApiKey(id: number): boolean {
  const r = db.prepare('UPDATE merchant_api_keys SET is_active = 0 WHERE id = ?').run(id);
  return r.changes > 0;
}

export function touchMerchantApiKey(id: number): void {
  db.prepare('UPDATE merchant_api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), id);
}
