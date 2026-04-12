/**
 * @file connection.ts — Database connection, PRAGMAs, schema creation, lifecycle
 */
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import logger from '../logger.js';

// === Database Row Interfaces ===

export interface OrderRow {
  id: string;
  mode: string;
  status: string;
  amount: number;
  crypto: string;
  crypto_amount: number;
  rate: number;
  pay_method: string;
  exchange: string | null;
  merchant_name: string | null;
  merchant_completion_rate: number | null;
  payment_info: string | null;
  created_at: number;
  expires_at: number;
  paid_at: number | null;
  completed_at: number | null;
  direction?: string;
  customer_wallet?: string;
  customer_bank_info?: string;
  fee_rate?: number;
  fee_jpy?: number;
  fee_crypto?: number;
  verified_at?: number | null;
  tx_id?: string | null;
  customer_wallet_address?: string | null;
  webhook_url?: string | null;
  merchant_api_key_id?: number | null;
  seller_id?: number | null;
  seller_confirmed_at?: number | null;
  withdrawal_id?: number | null;
  order_token?: string | null;
}

export interface OrderData {
  [key: string]: unknown;
  id: string;
  mode: string;
  status: string;
  amount: number;
  crypto: string;
  cryptoAmount: number;
  rate: number;
  payMethod: string;
  exchange: string | null;
  merchantName: string | null;
  merchantCompletionRate: number | null;
  paymentInfo: Record<string, unknown> | null;
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  completedAt: number | null;
  direction: string;
  customerWallet: string;
  customerBankInfo: Record<string, unknown>;
  feeRate: number;
  feeJpy: number;
  feeCrypto: number;
  verifiedAt: number | null;
  txId: string | null;
  customerWalletAddress: string | null;
  webhookUrl: string | null;
  merchantApiKeyId: number | null;
  sellerId: number | null;
  sellerConfirmedAt: number | null;
  withdrawalId: number | null;
  orderToken: string | null;
}

export interface BankAccountRow {
  id: number;
  bank_name: string;
  branch_name: string;
  account_type: string;
  account_number: string;
  account_holder: string;
  daily_limit: number;
  used_today: number;
  used_today_date: string | null;
  priority: string;
  status: string;
  memo: string | null;
  created_at: number;
}

export interface BankAccountInput {
  bankName: string;
  branchName: string;
  accountType?: string;
  accountNumber: string;
  accountHolder: string;
  dailyLimit?: number;
  priority?: string;
  status?: string;
  memo?: string;
}

export interface EpayConfigRow {
  type: string;
  pay_id: string;
  display_name: string;
  qr_image: string;
  link_url: string;
  updated_at: number;
}

export interface EpayConfigInput {
  payId?: string;
  displayName?: string;
  qrImage?: string;
  linkUrl?: string;
}

export interface ExchangeCredsInput {
  email?: string;
  password?: string;
  apiKey?: string;
  apiSecret?: string;
  totpSecret?: string;
  passphrase?: string;
}

export interface ExchangeCredsSummary {
  exchange: string;
  email: string;
  hasPassword: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
}

export interface ExchangeCredsDecrypted {
  exchange: string;
  email: string;
  password: string;
  apiKey: string;
  apiSecret: string;
  totpSecret: string;
  passphrase: string;
}

export interface WalletConfigRow {
  id: number;
  address: string | null;
  label: string | null;
  network: string;
  updated_at: number;
}

export interface SettingRow {
  value: string;
}

export interface AdminUserRow {
  id: number;
  username: string;
  password_hash: string;
  force_pw_change?: number;
  mfa_secret?: string | null;
  mfa_enabled?: number;
  created_at: number;
}

export interface SessionRow {
  token: string;
  user_id: number;
  expires_at: number;
  ip_address?: string | null;
  user_agent?: string | null;
}

export interface CountRow {
  c: number;
}

export interface CustomerRow {
  id: number;
  telegram_id: string | null;
  referral_code: string;
  referred_by: string | null;
  total_volume_jpy: number;
  total_orders: number;
  vip_rank: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationPrefRow {
  telegram_id: number;
  daily_summary: number;
  spike_alerts: number;
  weekly_summary: number;
  alert_crypto: string;
  alert_threshold: number;
}

export interface FeeSettingsRow {
  id: number;
  base_fee_rate: number;
  vip_bronze_rate: number;
  vip_silver_rate: number;
  vip_gold_rate: number;
  vip_platinum_rate: number;
  updated_at: string;
}

export interface FeeReportTotalRow {
  total_fee_jpy: number;
  total_fee_crypto: number;
  order_count: number;
}

export interface FeeReportDayRow {
  day: string;
  fee_jpy: number;
  fee_crypto: number;
  order_count: number;
}

export interface FeeReportCryptoRow {
  crypto: string;
  fee_jpy: number;
  fee_crypto: number;
  order_count: number;
}

export interface BankTransferRow {
  id: number;
  order_id: string | null;
  bank_account_id: number | null;
  sender_name: string | null;
  amount: number;
  transfer_date: string;
  reference: string | null;
  verification_method: string;
  status: string;
  matched_at: number | null;
  created_at: number;
}

export interface CryptoTransactionRow {
  id: number;
  order_id: string;
  tx_id: string;
  crypto: string;
  amount: number;
  to_address: string;
  status: string;
  created_at: number;
  confirmed_at: number | null;
}

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string | null;
  ip_address: string | null;
  created_at: number;
}

export interface P2PSellerRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  paypay_id: string | null;
  linepay_id: string | null;
  aupay_id: string | null;
  usdt_balance: number;
  usdt_locked: number;
  min_amount: number;
  max_amount: number;
  pay_methods: string;
  status: string;
  confirm_token: string;
  telegram_chat_id: string | null;
  total_trades: number;
  created_at: number;
  last_active: number | null;
}

export interface WithdrawalRow {
  id: number;
  external_ref: string | null;
  tracking_token: string;
  merchant_api_key_id: number | null;
  amount: number;
  pay_method: string;
  bank_name: string | null;
  branch_name: string | null;
  account_type: string;
  account_number: string | null;
  account_holder: string | null;
  paypay_id: string | null;
  status: string;
  matched_order_id: string | null;
  matched_seller_id: number | null;
  webhook_url: string | null;
  created_at: number;
  expires_at: number;
  completed_at: number | null;
}

export interface WithdrawalData {
  id: number;
  externalRef: string | null;
  trackingToken: string;
  merchantApiKeyId: number | null;
  amount: number;
  payMethod: string;
  bankName: string | null;
  branchName: string | null;
  accountType: string;
  accountNumber: string;
  accountHolder: string;
  paypayId: string | null;
  status: string;
  matchedOrderId: string | null;
  matchedSellerId: number | null;
  webhookUrl: string | null;
  createdAt: number;
  expiresAt: number;
  completedAt: number | null;
}

export interface MerchantApiKeyRow {
  id: number;
  name: string;
  key_hash: string;
  key_prefix: string;
  webhook_url: string | null;
  webhook_secret: string | null;
  is_active: number;
  created_at: number;
  last_used_at: number | null;
}

export interface ExchangeOrderRow {
  id: number;
  order_id: string;
  exchange: string;
  channel: string;
  exchange_order_id: string | null;
  status: string;
  seller_name: string | null;
  seller_bank_info: string | null;
  amount_jpy: number | null;
  crypto_amount: number | null;
  rate: number | null;
  error_message: string | null;
  screenshot_path: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface ExchangeOrderData extends Omit<ExchangeOrderRow, 'seller_bank_info'> {
  sellerBankInfo: unknown;
}

export interface KeyValueRow {
  key: string;
  value: string;
}

export interface ReferralStatsRow {
  referral_count: number;
  total_rewards: number;
}

export interface ReferralRewardRow {
  id: number;
  referrer_telegram_id: string;
  referred_telegram_id: string;
  order_id: string;
  reward_jpy: number;
  status: string;
  created_at: string;
}

export interface TelegramIdRow {
  telegram_id: number;
}

export interface OrderStatusExtra {
  paidAt?: number;
  completedAt?: number;
  verifiedAt?: number;
  txId?: string;
}

export interface FeeSettingsUpdate {
  base_fee_rate?: number;
  vip_bronze_rate?: number;
  vip_silver_rate?: number;
  vip_gold_rate?: number;
  vip_platinum_rate?: number;
}

export interface CostConfig {
  id: number;
  tron_gas_jpy: number;
  bank_transfer_fee_jpy: number;
  exchange_fee_rate: number;
  min_margin_jpy: number;
  min_margin_rate: number;
  auto_adjust_fee: number;
  updated_at: number;
}

export interface TransactionCost {
  id: number;
  order_id: string;
  cost_type: string;
  amount_jpy: number;
  description: string | null;
  created_at: number;
}

export interface TruPayWithdrawalRow {
  id: number;
  trupay_id: number;
  system_transaction_id: string;
  transaction_id: string;
  amount_jpy: number;
  bank_name: string;
  branch_name: string;
  account_number: string;
  account_name: string;
  account_type: string;
  trupay_status: number;
  status: string;
  matched_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface TruPayMatchRow {
  id: number;
  withdrawal_id: number;
  buyer_id: string;
  buyer_wallet: string;
  rate_jpy_usdt: number;
  amount_jpy: number;
  amount_usdt: number;
  timeout_at: number;
  reference_number: string | null;
  usdt_tx_hash: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

// === Helpers ===

export function safeJsonParse(str: string | null | undefined, fallback: unknown = null): unknown {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// === Database Instance ===

const DB_PATH = resolve(process.cwd(), 'data/bkpay.db');

// Ensure data directory exists
mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });

const db: DatabaseType = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('cache_size = -64000');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = memory');

// === Schema ===
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL DEFAULT 'matching',
    amount INTEGER NOT NULL,
    crypto TEXT NOT NULL DEFAULT 'USDT',
    crypto_amount REAL DEFAULT 0,
    rate REAL DEFAULT 0,
    pay_method TEXT NOT NULL DEFAULT 'bank',
    exchange TEXT,
    merchant_name TEXT,
    merchant_completion_rate REAL,
    payment_info TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    paid_at INTEGER,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_name TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    account_type TEXT NOT NULL DEFAULT '普通',
    account_number TEXT NOT NULL,
    account_holder TEXT NOT NULL,
    daily_limit INTEGER DEFAULT 3000000,
    used_today INTEGER DEFAULT 0,
    used_today_date TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'active',
    memo TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS epay_config (
    type TEXT PRIMARY KEY,
    pay_id TEXT,
    display_name TEXT,
    qr_image TEXT,
    link_url TEXT,
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS exchange_credentials (
    exchange TEXT PRIMARY KEY,
    email TEXT,
    password_enc TEXT,
    api_key TEXT,
    api_secret_enc TEXT,
    totp_secret_enc TEXT,
    passphrase_enc TEXT,
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS wallet_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    address TEXT,
    label TEXT,
    network TEXT DEFAULT 'TRC-20',
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES admin_users(id)
  );

  CREATE TABLE IF NOT EXISTS p2p_sellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    paypay_id TEXT,
    linepay_id TEXT,
    aupay_id TEXT,
    usdt_balance REAL DEFAULT 0,
    usdt_locked REAL DEFAULT 0,
    min_amount INTEGER DEFAULT 1000,
    max_amount INTEGER DEFAULT 500000,
    pay_methods TEXT DEFAULT '["paypay"]',
    status TEXT DEFAULT 'pending',
    confirm_token TEXT UNIQUE NOT NULL,
    telegram_chat_id TEXT,
    total_trades INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    last_active INTEGER
  );

  CREATE TABLE IF NOT EXISTS merchant_api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    webhook_url TEXT,
    webhook_secret TEXT,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    last_used_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_ref TEXT UNIQUE,
    tracking_token TEXT UNIQUE NOT NULL,
    merchant_api_key_id INTEGER,
    amount INTEGER NOT NULL,
    pay_method TEXT NOT NULL DEFAULT 'bank',
    bank_name TEXT,
    branch_name TEXT,
    account_type TEXT DEFAULT '普通',
    account_number TEXT,
    account_holder TEXT,
    paypay_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    matched_order_id TEXT,
    matched_seller_id INTEGER,
    webhook_url TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS exchange_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    exchange TEXT NOT NULL,
    channel TEXT NOT NULL,
    exchange_order_id TEXT,
    status TEXT NOT NULL DEFAULT 'creating',
    seller_name TEXT,
    seller_bank_info TEXT,
    amount_jpy INTEGER,
    crypto_amount REAL,
    rate REAL,
    error_message TEXT,
    screenshot_path TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS auto_trade_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS wallet_thresholds (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
`);

// Auto-trade config defaults
try {
  const atCount = (db.prepare('SELECT COUNT(*) as c FROM auto_trade_config').get() as CountRow).c;
  if (atCount === 0) {
    const defaults: Record<string, string> = {
      enabled: 'false',
      preferred_channel: 'api',
      preferred_exchange: 'OKX',
      max_amount: '1000000',
      min_amount: '5000',
      auto_confirm_payment: 'true',
      polling_interval_ms: '15000',
    };
    const ins = db.prepare('INSERT INTO auto_trade_config (key, value, updated_at) VALUES (?, ?, ?)');
    const now = Date.now();
    for (const [k, v] of Object.entries(defaults)) {
      ins.run(k, v, now);
    }
  }
} catch { /* column may already exist */ }

// Wallet thresholds defaults (Hot/Cold wallet separation)
try {
  const wtCount = (db.prepare('SELECT COUNT(*) as c FROM wallet_thresholds').get() as CountRow).c;
  if (wtCount === 0) {
    const defaults: Record<string, string> = {
      hot_wallet_max: '10000',
      cold_wallet_address: '',
      sweep_alert_threshold: '8000',
      min_hot_balance: '500',
    };
    const ins = db.prepare('INSERT INTO wallet_thresholds (key, value, updated_at) VALUES (?, ?, ?)');
    const now = Date.now();
    for (const [k, v] of Object.entries(defaults)) {
      ins.run(k, v, now);
    }
  }
} catch { /* column may already exist */ }

// === Safe Migrations ===

// Ensure force_pw_change column exists (safe migration)
try { db.exec(`ALTER TABLE admin_users ADD COLUMN force_pw_change INTEGER DEFAULT 0`); } catch { /* column may already exist */ }
// MFA columns (safe migration)
try { db.exec(`ALTER TABLE admin_users ADD COLUMN mfa_secret TEXT`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE admin_users ADD COLUMN mfa_enabled INTEGER DEFAULT 0`); } catch { /* column may already exist */ }
// External API columns on orders (safe migration)
try { db.exec(`ALTER TABLE orders ADD COLUMN merchant_api_key_id INTEGER`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN webhook_url TEXT`); } catch { /* column may already exist */ }
// P2P seller columns on orders (safe migration)
try { db.exec(`ALTER TABLE orders ADD COLUMN seller_id INTEGER`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN seller_confirmed_at INTEGER`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN withdrawal_id INTEGER`); } catch { /* column may already exist */ }

// Sell Order Support: Add columns
try { db.exec(`ALTER TABLE orders ADD COLUMN direction TEXT DEFAULT 'buy'`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN customer_wallet TEXT DEFAULT ''`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN customer_bank_info TEXT DEFAULT ''`); } catch { /* column may already exist */ }

// Crypto Send: Add columns
try { db.exec(`ALTER TABLE orders ADD COLUMN verified_at INTEGER`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN tx_id TEXT`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN customer_wallet_address TEXT`); } catch { /* column may already exist */ }

// Fee columns on orders
try { db.exec(`ALTER TABLE orders ADD COLUMN fee_rate REAL DEFAULT 0.02`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN fee_jpy REAL DEFAULT 0`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN fee_crypto REAL DEFAULT 0`); } catch { /* column may already exist */ }

// Order token column
try { db.exec(`ALTER TABLE orders ADD COLUMN order_token TEXT`); } catch { /* column may already exist */ }

// Session columns (safe migration)
try { db.exec(`ALTER TABLE sessions ADD COLUMN ip_address TEXT`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE sessions ADD COLUMN user_agent TEXT`); } catch { /* column may already exist */ }

// Crypto Transactions Table
db.exec(`
  CREATE TABLE IF NOT EXISTS crypto_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    tx_id TEXT NOT NULL,
    crypto TEXT NOT NULL DEFAULT 'USDT',
    amount REAL NOT NULL,
    to_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    confirmed_at INTEGER
  );
`);

// Bank Transfers Table (Phase C: Auto-verification)
db.exec(`
  CREATE TABLE IF NOT EXISTS bank_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    bank_account_id INTEGER,
    sender_name TEXT,
    amount INTEGER NOT NULL,
    transfer_date TEXT NOT NULL,
    reference TEXT,
    verification_method TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'unmatched',
    matched_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
`);

// Customers & Referral Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE,
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    total_volume_jpy REAL DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    vip_rank TEXT DEFAULT 'bronze',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS referral_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_telegram_id TEXT,
    referred_telegram_id TEXT,
    order_id TEXT,
    reward_jpy REAL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Notification Preferences
db.exec(`
  CREATE TABLE IF NOT EXISTS notification_preferences (
    telegram_id INTEGER PRIMARY KEY,
    daily_summary INTEGER DEFAULT 1,
    spike_alerts INTEGER DEFAULT 1,
    weekly_summary INTEGER DEFAULT 1,
    alert_crypto TEXT DEFAULT '',
    alert_threshold REAL DEFAULT 0
  );
`);

// Fee Settings
db.exec(`
  CREATE TABLE IF NOT EXISTS fee_settings (
    id INTEGER PRIMARY KEY,
    base_fee_rate REAL DEFAULT 0.02,
    vip_bronze_rate REAL DEFAULT 0.02,
    vip_silver_rate REAL DEFAULT 0.017,
    vip_gold_rate REAL DEFAULT 0.015,
    vip_platinum_rate REAL DEFAULT 0.01,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);
try {
  const feeCount = (db.prepare('SELECT COUNT(*) as c FROM fee_settings').get() as CountRow).c;
  if (feeCount === 0) db.prepare('INSERT INTO fee_settings (id) VALUES (1)').run();
} catch { /* column may already exist */ }

// Transaction Cost Config & Margin Safety
db.exec(`
  CREATE TABLE IF NOT EXISTS cost_config (
    id INTEGER PRIMARY KEY,
    tron_gas_jpy REAL DEFAULT 50,
    bank_transfer_fee_jpy REAL DEFAULT 0,
    exchange_fee_rate REAL DEFAULT 0.001,
    min_margin_jpy REAL DEFAULT 100,
    min_margin_rate REAL DEFAULT 0.005,
    auto_adjust_fee INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
`);
try {
  const ccCount = (db.prepare('SELECT COUNT(*) as c FROM cost_config').get() as CountRow).c;
  if (ccCount === 0) db.prepare('INSERT INTO cost_config (id) VALUES (1)').run();
} catch { /* column may already exist */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS transaction_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    cost_type TEXT NOT NULL,
    amount_jpy REAL NOT NULL DEFAULT 0,
    description TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_tx_costs_order ON transaction_costs(order_id);
`);

try { db.exec(`ALTER TABLE profit_records ADD COLUMN total_cost REAL DEFAULT 0`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE profit_records ADD COLUMN net_profit REAL DEFAULT 0`); } catch { /* column may already exist */ }

// TruPay Pending Buyers (DB-backed)
db.exec(`CREATE TABLE IF NOT EXISTS trupay_pending_buyers (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  min_amount_jpy REAL NOT NULL DEFAULT 0,
  max_amount_jpy REAL NOT NULL DEFAULT 0,
  registered_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
)`);

// === Default Admin User ===
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
