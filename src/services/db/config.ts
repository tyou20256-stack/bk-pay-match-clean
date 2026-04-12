/**
 * @file config.ts — Settings, auto_trade_config, wallet_thresholds, system_config
 */
import { db } from './connection.js';
import type { SettingRow, KeyValueRow } from './connection.js';
import { encrypt, decrypt } from './encryption.js';

// === Settings ===
export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getSetting(key: string, defaultVal = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow | undefined;
  return row ? row.value : defaultVal;
}

// === Auto-Trade Config ===
export function getAutoTradeConfig(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM auto_trade_config').all() as KeyValueRow[];
  const config: Record<string, string> = {};
  for (const r of rows) config[r.key] = r.value;
  return config;
}

export function setAutoTradeConfig(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO auto_trade_config (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, Date.now());
}

// === Wallet Thresholds (Hot/Cold wallet separation) ===
export function getWalletThresholds(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM wallet_thresholds').all() as KeyValueRow[];
  const config: Record<string, string> = {};
  for (const r of rows) config[r.key] = r.value;
  return config;
}

export function setWalletThreshold(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO wallet_thresholds (key, value, updated_at) VALUES (?, ?, ?)').run(key, value, Date.now());
}

// === System Config (encrypted settings) ===

export function setSystemConfig(key: string, value: string, isEncrypted = false): void {
  const storedValue = isEncrypted ? encrypt(value) : value;
  db.prepare('INSERT OR REPLACE INTO system_config (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)').run(key, storedValue, isEncrypted ? 1 : 0, Date.now());
}

export function getSystemConfig(key: string): string | null {
  const row = db.prepare('SELECT value, encrypted FROM system_config WHERE key = ?').get(key) as { value: string; encrypted: number } | undefined;
  if (!row) return null;
  if (row.encrypted) {
    const decrypted = decrypt(row.value);
    return decrypted === '[DECRYPTION_FAILED]' ? null : decrypted;
  }
  return row.value;
}

export function deleteSystemConfig(key: string): void {
  db.prepare('DELETE FROM system_config WHERE key = ?').run(key);
}

export function getSystemConfigMeta(key: string): { exists: boolean; encrypted: boolean; updatedAt: number } | null {
  const row = db.prepare('SELECT encrypted, updated_at FROM system_config WHERE key = ?').get(key) as { encrypted: number; updated_at: number } | undefined;
  if (!row) return null;
  return { exists: true, encrypted: row.encrypted === 1, updatedAt: row.updated_at };
}
