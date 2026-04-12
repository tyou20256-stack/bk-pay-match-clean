/**
 * @file connection.ts — Database instance, PRAGMAs, lifecycle
 * @description Owns the singleton better-sqlite3 connection, applies PRAGMAs,
 *   runs schema DDL via schema.ts, seeds default admin user, and schedules
 *   the expired-session cleanup interval. Row/DTO interfaces live in types.ts;
 *   DDL lives in schema.ts. This file is intentionally small (~150 lines).
 */
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import logger from '../logger.js';
import { applySchema } from './schema.js';
import type { CountRow } from './types.js';

// Re-export all types from types.ts so existing `from './connection.js'`
// import sites continue to work without churn. New code should import from
// './types.js' directly.
export type {
  OrderRow,
  OrderData,
  BankAccountRow,
  BankAccountInput,
  EpayConfigRow,
  EpayConfigInput,
  ExchangeCredsInput,
  ExchangeCredsSummary,
  ExchangeCredsDecrypted,
  WalletConfigRow,
  SettingRow,
  AdminUserRow,
  SessionRow,
  CountRow,
  CustomerRow,
  NotificationPrefRow,
  FeeSettingsRow,
  FeeReportTotalRow,
  FeeReportDayRow,
  FeeReportCryptoRow,
  BankTransferRow,
  CryptoTransactionRow,
  AuditLogEntry,
  P2PSellerRow,
  WithdrawalRow,
  WithdrawalData,
  MerchantApiKeyRow,
  ExchangeOrderRow,
  ExchangeOrderData,
  KeyValueRow,
  ReferralStatsRow,
  ReferralRewardRow,
  TelegramIdRow,
  OrderStatusExtra,
  FeeSettingsUpdate,
  CostConfig,
  TransactionCost,
  TruPayWithdrawalRow,
  TruPayMatchRow,
} from './types.js';

// === Helper ===
export function safeJsonParse(str: string | null | undefined, fallback: unknown = null): unknown {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// === Database Instance ===

// Allow tests to override via DB_PATH env (e.g. ':memory:' for unit tests)
const DB_PATH = process.env.DB_PATH || resolve(process.cwd(), 'data/bkpay.db');

// Ensure data directory exists (skip for :memory: or absolute test paths)
if (DB_PATH !== ':memory:' && !DB_PATH.startsWith('/tmp/') && !DB_PATH.includes('test-')) {
  mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });
}

const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -64000');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = memory');

// === Schema + seeds + safe migrations ===
applySchema(db);

// === Default Admin User ===
// Imported after schema is ready so the admin_users table exists.
import { createAdminUser } from './auth.js';

const adminCount = (db.prepare('SELECT COUNT(*) as c FROM admin_users').get() as CountRow).c;
if (adminCount === 0) {
  let defaultPass = process.env.BK_ADMIN_PASSWORD;
  if (!defaultPass) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('FATAL: BK_ADMIN_PASSWORD not set in production');
      process.exit(1);
    }
    defaultPass = 'bkpay2026'; // dev fallback only
    logger.warn('Using default admin password. Set BK_ADMIN_PASSWORD env var for production.');
  }
  createAdminUser('admin', defaultPass);
  db.prepare("UPDATE admin_users SET force_pw_change = 1 WHERE username = 'admin'").run();
  logger.info('Default admin created: admin (password change required on first login)');
}

// Cleanup expired sessions periodically
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 60 * 60 * 1000);

// === Database lifecycle ===
export function closeDatabase(): void {
  try { db.close(); } catch { /* already closed */ }
}

export { db };
export default db;
