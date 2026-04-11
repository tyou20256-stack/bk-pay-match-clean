/**
 * @file database.ts — データベース操作・認証・暗号化
 * @description SQLite(better-sqlite3)による永続化層。以下を管理:
 *   - orders: 注文データ
 *   - bank_accounts: 銀行口座（ローテーション用）
 *   - epay_config: 電子決済設定
 *   - exchange_credentials: 取引所認証情報（AES-256暗号化）
 *   - wallet_config: USDTウォレットアドレス
 *   - settings: システム設定（KVS）
 *   - admin_users: 管理ユーザー（SHA-256ハッシュ）
 *   - sessions: ログインセッション（24時間有効）
 * 
 *   初回起動時にデフォルト管理者(admin/bkpay2026)を自動作成。
 *   暗号化キーは環境変数 BK_ENC_KEY で設定（本番では必須）。
 */
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { resolve } from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import logger from './logger.js';

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

const DB_PATH = resolve(process.cwd(), 'data/bkpay.db');

// Ensure data directory exists
import { mkdirSync } from 'fs';
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

// === Encryption (AES-256-GCM with PBKDF2 key derivation) ===
const RAW_ENC_KEY = process.env.BK_ENC_KEY || '';
if (!RAW_ENC_KEY || RAW_ENC_KEY === 'bkpay-default-key-change-me-32ch' || RAW_ENC_KEY === 'change-me-to-random-32-chars-key-here') {
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('BK_ENC_KEY must be set to a secure random value in production! Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
  logger.warn('BK_ENC_KEY is not set or is a default value. ALL stored credentials are insecure. Set a proper key before deployment.');
} else if (RAW_ENC_KEY.length < 32) {
  logger.warn('BK_ENC_KEY should be at least 32 characters long');
}
const ENC_KEY_FALLBACK = RAW_ENC_KEY || 'bkpay-default-key-change-me-32ch';
// Derive a proper 32-byte key via PBKDF2 (deterministic, so existing data remains readable)
const ENC_SALT = process.env.BK_ENC_SALT || 'bkpay-enc-salt-v2';
if (!process.env.BK_ENC_SALT && process.env.NODE_ENV === 'production') {
  logger.warn('BK_ENC_SALT not set in production — using default salt. Set a unique value for stronger key derivation.');
}
const DERIVED_KEY = crypto.pbkdf2Sync(ENC_KEY_FALLBACK, ENC_SALT, 100000, 32, 'sha256');

export function encrypt(text: string): string {
  // AES-256-GCM: iv(12) + authTag(16) + ciphertext
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DERIVED_KEY, iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return 'gcm:' + iv.toString('hex') + ':' + authTag + ':' + enc;
}
export function decrypt(text: string): string {
  try {
    if (text.startsWith('gcm:')) {
      // AES-256-GCM format: gcm:iv:authTag:ciphertext
      const parts = text.split(':');
      const iv = Buffer.from(parts[1], 'hex');
      const authTag = Buffer.from(parts[2], 'hex');
      const encHex = parts[3];
      const decipher = crypto.createDecipheriv('aes-256-gcm', DERIVED_KEY, iv);
      decipher.setAuthTag(authTag);
      let dec = decipher.update(encHex, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return dec;
    }
    // Legacy AES-256-CBC fallback (for data encrypted before upgrade)
    logger.warn('Legacy CBC decryption used — data should be re-encrypted', { length: text.length });
    const [ivHex, encHex] = text.split(':');
    const legacyKey = Buffer.from(ENC_KEY_FALLBACK.padEnd(32).slice(0, 32));
    const decipher = crypto.createDecipheriv('aes-256-cbc', legacyKey, Buffer.from(ivHex, 'hex'));
    let dec = decipher.update(encHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch (e) {
    logger.warn('Decryption failed', { error: e instanceof Error ? e.message : String(e) });
    return '[DECRYPTION_FAILED]';
  }
}

// === Auth ===
function legacySha256Hash(pw: string): string {
  return crypto.createHash('sha256').update(pw + 'bkpay-salt').digest('hex');
}

function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10);
}

export function createAdminUser(username: string, password: string): boolean {
  try {
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
    return true;
  } catch { return false; }
}

export function authenticateUser(username: string, password: string, ip?: string, userAgent?: string): { token: string; userId: number; forcePasswordChange?: boolean; mfaRequired?: boolean } | null {
  const user = db.prepare('SELECT id, password_hash, force_pw_change, mfa_enabled FROM admin_users WHERE username = ?').get(username) as AdminUserRow | undefined;
  if (!user) return null;

  let valid = false;
  if (user.password_hash.length === 64) {
    // Legacy SHA-256 hash — verify and auto-upgrade to bcrypt
    if (legacySha256Hash(password) === user.password_hash) {
      valid = true;
      const bcryptHash = bcrypt.hashSync(password, 10);
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(bcryptHash, user.id);
    }
  } else {
    valid = bcrypt.compareSync(password, user.password_hash);
  }

  if (!valid) return null;

  // If MFA is enabled, return pending state (no session yet)
  if (user.mfa_enabled) {
    // Issue a short-lived MFA pending token (5 min)
    const mfaPending = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 5 * 60 * 1000;
    db.prepare('INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)').run(`mfa:${mfaPending}`, user.id, expiresAt, ip || null, userAgent || null);
    return { token: mfaPending, userId: user.id, mfaRequired: true };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)').run(token, user.id, expiresAt, ip || null, userAgent || null);
  return { token, userId: user.id, forcePasswordChange: !!user.force_pw_change };
}

/** Verify MFA TOTP code and issue full session */
export function verifyMfaAndLogin(pendingToken: string, totpCode: string, ip?: string, userAgent?: string): { token: string; userId: number } | null {
  const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(`mfa:${pendingToken}`) as SessionRow | undefined;
  if (!session || session.expires_at < Date.now()) return null;

  const user = db.prepare('SELECT id, mfa_secret, mfa_enabled FROM admin_users WHERE id = ?').get(session.user_id) as AdminUserRow | undefined;
  if (!user || !user.mfa_enabled || !user.mfa_secret) return null;

  // Decrypt MFA secret (stored encrypted since security hardening)
  const mfaSecret = user.mfa_secret.includes(':') ? decrypt(user.mfa_secret) : user.mfa_secret;
  if (!mfaSecret || mfaSecret === '[DECRYPTION_FAILED]') return null;

  // Verify TOTP (import at top level would cause issues, use dynamic require pattern)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { authenticator } = require('otplib');
  const valid = authenticator.check(totpCode, mfaSecret);
  if (!valid) return null;

  // Delete pending token, issue full session
  db.prepare('DELETE FROM sessions WHERE token = ?').run(`mfa:${pendingToken}`);
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)').run(token, user.id, expiresAt, ip || null, userAgent || null);
  return { token, userId: user.id };
}

/** Setup MFA for a user — generate secret and return otpauth URL */
export function setupMfa(userId: number): { secret: string; otpauthUrl: string } | null {
  const user = db.prepare('SELECT username FROM admin_users WHERE id = ?').get(userId) as { username: string } | undefined;
  if (!user) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { authenticator } = require('otplib');
  const secret = authenticator.generateSecret();
  db.prepare('UPDATE admin_users SET mfa_secret = ? WHERE id = ?').run(encrypt(secret), userId);
  const otpauthUrl = authenticator.keyuri(user.username, 'BK-Pay-Match', secret);
  return { secret, otpauthUrl };
}

/** Enable MFA after verifying first TOTP code */
export function enableMfa(userId: number, totpCode: string): boolean {
  const user = db.prepare('SELECT mfa_secret FROM admin_users WHERE id = ?').get(userId) as { mfa_secret: string | null } | undefined;
  if (!user?.mfa_secret) return false;
  const mfaSecret = user.mfa_secret.includes(':') ? decrypt(user.mfa_secret) : user.mfa_secret;
  if (!mfaSecret || mfaSecret === '[DECRYPTION_FAILED]') return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { authenticator } = require('otplib');
  if (!authenticator.check(totpCode, mfaSecret)) return false;
  db.prepare('UPDATE admin_users SET mfa_enabled = 1 WHERE id = ?').run(userId);
  return true;
}

/** Verify password for a given userId (used for sensitive operations like MFA disable) */
export function verifyUserPassword(userId: number, password: string): boolean {
  const user = db.prepare('SELECT password_hash FROM admin_users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
  if (!user) return false;
  if (user.password_hash.length === 64) {
    return legacySha256Hash(password) === user.password_hash;
  }
  return bcrypt.compareSync(password, user.password_hash);
}

/** Check if MFA is enabled for a user */
export function getMfaStatus(userId: number): boolean {
  const user = db.prepare('SELECT mfa_enabled FROM admin_users WHERE id = ?').get(userId) as { mfa_enabled: number } | undefined;
  return !!user?.mfa_enabled;
}

/** Disable MFA for a user */
export function disableMfa(userId: number): void {
  db.prepare('UPDATE admin_users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').run(userId);
}

export function validateSession(token: string, ip?: string): boolean {
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as SessionRow | undefined;
  if (!session) return false;
  // IP binding: strict for admin, soft for customer
  if (session.ip_address && ip && session.ip_address !== ip) {
    const isCustomer = (session as unknown as Record<string, unknown>).user_agent?.toString().includes('customer');
    if (!isCustomer) {
      logger.warn('Admin session IP mismatch — invalidating', { sessionId: token.slice(0, 8), expected: session.ip_address, actual: ip });
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return false;
    }
    logger.warn('Customer session IP mismatch (soft)', { sessionId: token.slice(0, 8), expected: session.ip_address, actual: ip });
  }
  return true;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** Delete all sessions for a given user (e.g. after password change) */
export function deleteAllUserSessions(userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Resolve session token to user_id (returns undefined if invalid/expired) */
export function getSessionUserId(token: string): number | undefined {
  const row = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as SessionRow | undefined;
  return row?.user_id;
}

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

// Create default admin if none exists
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
  if (false) { // legacy block replaced by production guard above
  }
}

// === Orders ===
export function saveOrder(order: Record<string, unknown>): void {
  db.prepare(`INSERT OR REPLACE INTO orders (id, mode, status, amount, crypto, crypto_amount, rate, pay_method, exchange, merchant_name, merchant_completion_rate, payment_info, created_at, expires_at, paid_at, completed_at, fee_rate, fee_jpy, fee_crypto, customer_wallet_address, order_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    order.id, order.mode, order.status, order.amount, order.crypto, order.cryptoAmount, order.rate,
    order.payMethod, order.exchange, order.merchantName, order.merchantCompletionRate,
    JSON.stringify(order.paymentInfo), order.createdAt, order.expiresAt, order.paidAt || null, order.completedAt || null,
    order.feeRate || 0, order.feeJpy || 0, order.feeCrypto || 0, order.customerWalletAddress || null,
    order.orderToken || null
  );
}

export function getOrder(id: string): OrderData | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined;
  if (!row) return null;
  return rowToOrder(row);
}

export function getAllOrders(limit = 100): OrderData[] {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit) as OrderRow[];
  return rows.map(rowToOrder);
}

export function updateOrderStatus(id: string, status: string, extra: OrderStatusExtra = {}): void {
  const sets = ['status = ?'];
  const vals: (string | number)[] = [status];
  if (extra.paidAt) { sets.push('paid_at = ?'); vals.push(extra.paidAt); }
  if (extra.completedAt) { sets.push('completed_at = ?'); vals.push(extra.completedAt); }
  if (extra.verifiedAt) { sets.push('verified_at = ?'); vals.push(extra.verifiedAt); }
  if (extra.txId) { sets.push('tx_id = ?'); vals.push(extra.txId); }
  vals.push(id);
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/**
 * Atomically claim an order for crypto sending (CAS: compare-and-swap).
 * Sets status to 'sending_crypto' only if current status is 'payment_verified'.
 * Returns true if claim succeeded (this process owns the send), false if already claimed.
 */
export function claimOrderForSending(id: string): boolean {
  const result = db.prepare(
    `UPDATE orders SET status = 'sending_crypto' WHERE id = ? AND status = 'payment_verified'`
  ).run(id);
  return result.changes > 0;
}

function safeJsonParse(str: string | null | undefined, fallback: unknown = null): unknown {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function rowToOrder(row: OrderRow): OrderData {
  return {
    id: row.id, mode: row.mode, status: row.status, amount: row.amount, crypto: row.crypto,
    cryptoAmount: row.crypto_amount, rate: row.rate, payMethod: row.pay_method, exchange: row.exchange,
    merchantName: row.merchant_name, merchantCompletionRate: row.merchant_completion_rate,
    paymentInfo: safeJsonParse(row.payment_info, null) as Record<string, unknown> | null, createdAt: row.created_at,
    expiresAt: row.expires_at, paidAt: row.paid_at, completedAt: row.completed_at,
    direction: row.direction || 'buy', customerWallet: row.customer_wallet || '', customerBankInfo: safeJsonParse(row.customer_bank_info, {}) as Record<string, unknown>,
    feeRate: row.fee_rate || 0, feeJpy: row.fee_jpy || 0, feeCrypto: row.fee_crypto || 0,
    verifiedAt: row.verified_at || null, txId: row.tx_id || null,
    customerWalletAddress: row.customer_wallet_address || null,
    webhookUrl: row.webhook_url || null,
    merchantApiKeyId: row.merchant_api_key_id || null,
    sellerId: row.seller_id || null,
    sellerConfirmedAt: row.seller_confirmed_at || null,
    withdrawalId: row.withdrawal_id || null,
    orderToken: row.order_token || null,
  };
}

// === Database lifecycle ===
export function closeDatabase(): void {
  try { db.close(); } catch { /* already closed */ }
}

// === Bank Account Field Encryption ===
// Transparent encrypt/decrypt for account_number and account_holder
function encryptBankField(value: string): string {
  if (!value) return value;
  return encrypt(value);
}
function decryptBankField(value: string): string {
  if (!value) return value;
  if (value.startsWith('gcm:')) return decrypt(value);
  return value; // Plaintext (legacy, not yet migrated)
}
function decryptBankRow(row: BankAccountRow | undefined): BankAccountRow | undefined {
  if (!row) return row;
  return {
    ...row,
    account_number: decryptBankField(row.account_number),
    account_holder: decryptBankField(row.account_holder),
  };
}

// === Bank Accounts ===
export function addBankAccount(acc: BankAccountInput): number {
  const r = db.prepare(`INSERT INTO bank_accounts (bank_name, branch_name, account_type, account_number, account_holder, daily_limit, priority, status, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    acc.bankName, acc.branchName, acc.accountType || '普通',
    encryptBankField(acc.accountNumber), encryptBankField(acc.accountHolder),
    acc.dailyLimit || 3000000, acc.priority || 'medium', acc.status || 'active', acc.memo || ''
  );
  return r.lastInsertRowid as number;
}

export function getBankAccounts(): BankAccountRow[] {
  const rows = db.prepare('SELECT * FROM bank_accounts ORDER BY priority DESC, id').all() as BankAccountRow[];
  return rows.map(row => decryptBankRow(row)!);
}

// Whitelist of allowed columns for bank account updates (prevents SQL injection via key names)
const BANK_ACCOUNT_COLUMNS: Record<string, string> = {
  bankName: 'bank_name', branchName: 'branch_name', accountType: 'account_type',
  accountNumber: 'account_number', accountHolder: 'account_holder',
  dailyLimit: 'daily_limit', priority: 'priority', status: 'status', memo: 'memo',
};

export function updateBankAccount(id: number, data: Partial<BankAccountInput>): void {
  const fields: string[] = [];
  const vals: (string | number)[] = [];
  for (const [k, v] of Object.entries(data)) {
    const col = BANK_ACCOUNT_COLUMNS[k];
    if (!col) continue; // Skip unknown fields
    // Encrypt sensitive bank fields
    const val = (k === 'accountNumber' || k === 'accountHolder') ? encryptBankField(v as string) : v;
    fields.push(`${col} = ?`);
    vals.push(val);
  }
  vals.push(id);
  if (fields.length) db.prepare(`UPDATE bank_accounts SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteBankAccount(id: number): void {
  db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id);
}

export const getRoutableAccount: (amount: number) => BankAccountRow | undefined = db.transaction((amount: number): BankAccountRow | undefined => {
  const today = new Date().toISOString().slice(0, 10);
  // Reset daily usage if date changed
  db.prepare("UPDATE bank_accounts SET used_today = 0, used_today_date = ? WHERE used_today_date != ? OR used_today_date IS NULL").run(today, today);
  // Get best account (atomic: SELECT + UPDATE in same transaction)
  const acc = db.prepare(`SELECT * FROM bank_accounts WHERE status = 'active' AND (used_today + ?) <= daily_limit ORDER BY
    CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, used_today ASC LIMIT 1`).get(amount) as BankAccountRow | undefined;
  if (acc) {
    db.prepare('UPDATE bank_accounts SET used_today = used_today + ?, used_today_date = ? WHERE id = ?').run(amount, today, acc.id);
  }
  return decryptBankRow(acc);
});

// === E-Pay Config ===
export function saveEpayConfig(type: string, data: EpayConfigInput): void {
  db.prepare('INSERT OR REPLACE INTO epay_config (type, pay_id, display_name, qr_image, link_url, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    type, data.payId || '', data.displayName || '', data.qrImage || '', data.linkUrl || '', Date.now()
  );
}

export function getEpayConfig(type: string): EpayConfigRow | undefined {
  return db.prepare('SELECT * FROM epay_config WHERE type = ?').get(type) as EpayConfigRow | undefined;
}

export function getAllEpayConfig(): EpayConfigRow[] {
  return db.prepare('SELECT * FROM epay_config').all() as EpayConfigRow[];
}

// === Exchange Credentials ===
export function saveExchangeCreds(exchange: string, data: ExchangeCredsInput): void {
  const ALLOWED_EXCHANGES = ['Bybit', 'OKX', 'Binance'];
  if (!ALLOWED_EXCHANGES.includes(exchange)) {
    throw new Error(`Invalid exchange: ${exchange}. Allowed: ${ALLOWED_EXCHANGES.join(', ')}`);
  }
  db.prepare('INSERT OR REPLACE INTO exchange_credentials (exchange, email, password_enc, api_key, api_secret_enc, totp_secret_enc, passphrase_enc, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    exchange, data.email || '', data.password ? encrypt(data.password) : '',
    data.apiKey ? encrypt(data.apiKey) : '',
    data.apiSecret ? encrypt(data.apiSecret) : '', data.totpSecret ? encrypt(data.totpSecret) : '',
    data.passphrase ? encrypt(data.passphrase) : '', Date.now()
  );
}

export function getExchangeCreds(exchange: string): ExchangeCredsSummary | null {
  const row = db.prepare('SELECT * FROM exchange_credentials WHERE exchange = ?').get(exchange) as { exchange: string; email: string; password_enc: string; api_key: string; api_secret_enc: string } | undefined;
  if (!row) return null;
  return { exchange: row.exchange, email: row.email, hasPassword: !!row.password_enc, hasApiKey: !!row.api_key, hasApiSecret: !!row.api_secret_enc };
}

export function getExchangeCredsDecrypted(exchange: string): ExchangeCredsDecrypted | null {
  const row = db.prepare('SELECT * FROM exchange_credentials WHERE exchange = ?').get(exchange) as { exchange: string; email: string; password_enc: string; api_key: string; api_secret_enc: string; totp_secret_enc: string; passphrase_enc: string } | undefined;
  if (!row) return null;
  return {
    exchange: row.exchange,
    email: row.email,
    password: row.password_enc ? decrypt(row.password_enc) : '',
    apiKey: row.api_key ? decrypt(row.api_key) : '',
    apiSecret: row.api_secret_enc ? decrypt(row.api_secret_enc) : '',
    totpSecret: row.totp_secret_enc ? decrypt(row.totp_secret_enc) : '',
    passphrase: row.passphrase_enc ? decrypt(row.passphrase_enc) : '',
  };
}

// === Wallet Config ===
export function saveWalletConfig(address: string, label: string): void {
  db.prepare('INSERT OR REPLACE INTO wallet_config (id, address, label, updated_at) VALUES (1, ?, ?, ?)').run(address, label, Date.now());
}

export function getWalletConfig(): WalletConfigRow | undefined {
  return db.prepare('SELECT * FROM wallet_config WHERE id = 1').get() as WalletConfigRow | undefined;
}

// === Settings ===
export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getSetting(key: string, defaultVal = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow | undefined;
  return row ? row.value : defaultVal;
}


// === Sell Order Support: Add columns ===
try { db.exec(`ALTER TABLE orders ADD COLUMN direction TEXT DEFAULT 'buy'`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN customer_wallet TEXT DEFAULT ''`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN customer_bank_info TEXT DEFAULT ''`); } catch { /* column may already exist */ }

// === Crypto Send: Add columns ===
try { db.exec(`ALTER TABLE orders ADD COLUMN verified_at INTEGER`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN tx_id TEXT`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN customer_wallet_address TEXT`); } catch { /* column may already exist */ }

// === Crypto Transactions Table ===
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

// === Bank Transfers Table (Phase C: Auto-verification) ===
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

// === Sell Orders ===
export function createSellOrder(data: {
  id: string;
  cryptoAmount: number;
  crypto: string;
  rate: number;
  jpyAmount: number;
  customerWallet?: string;
  customerBankInfo: Record<string, unknown>;
  expiresAt: number;
}): void {
  const now = Date.now();
  db.prepare(`INSERT INTO orders (id, mode, status, amount, crypto, crypto_amount, rate, pay_method, exchange, merchant_name, merchant_completion_rate, payment_info, created_at, expires_at, direction, customer_wallet, customer_bank_info)
    VALUES (?, 'self', 'awaiting_deposit', ?, ?, ?, ?, 'bank', 'BK Pay（自社決済）', 'BK Stock', 100, '{}', ?, ?, 'sell', ?, ?)`).run(
    data.id, data.jpyAmount, data.crypto, data.cryptoAmount, data.rate,
    now, data.expiresAt,
    data.customerWallet || '',
    JSON.stringify(data.customerBankInfo)
  );
}

export function getSellOrdersAwaitingDeposit(): OrderData[] {
  const rows = db.prepare("SELECT * FROM orders WHERE direction = 'sell' AND status = 'awaiting_deposit' ORDER BY created_at DESC").all() as OrderRow[];
  return rows.map(r => ({ ...rowToOrder(r), direction: r.direction || 'sell', customerWallet: r.customer_wallet || '', customerBankInfo: safeJsonParse(r.customer_bank_info, {}) as Record<string, unknown> }));
}

// === Customers & Referral Tables ===
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

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return 'BK-' + code;
}

function calculateVipRank(totalVolume: number): string {
  if (totalVolume >= 20_000_000) return 'platinum';
  if (totalVolume >= 5_000_000) return 'gold';
  if (totalVolume >= 1_000_000) return 'silver';
  return 'bronze';
}

export function getVipDiscount(rank: string): number {
  switch (rank) {
    case 'platinum': return 1.0;
    case 'gold': return 0.5;
    case 'silver': return 0.3;
    default: return 0;
  }
}

export function getOrCreateCustomer(telegramId: string): CustomerRow {
  let customer = db.prepare('SELECT * FROM customers WHERE telegram_id = ?').get(telegramId) as CustomerRow | undefined;
  if (!customer) {
    const code = generateReferralCode();
    db.prepare('INSERT INTO customers (telegram_id, referral_code) VALUES (?, ?)').run(telegramId, code);
    customer = db.prepare('SELECT * FROM customers WHERE telegram_id = ?').get(telegramId) as CustomerRow | undefined;
  }
  return customer!;
}

export function applyReferralCode(telegramId: string, code: string): { success: boolean; error?: string } {
  const customer = getOrCreateCustomer(telegramId);
  if (customer.referred_by) return { success: false, error: '既に紹介コードを登録済みです' };
  const referrer = db.prepare('SELECT * FROM customers WHERE referral_code = ?').get(code) as CustomerRow | undefined;
  if (!referrer) return { success: false, error: '無効な紹介コードです' };
  if (referrer.telegram_id === telegramId) return { success: false, error: '自分のコードは使用できません' };
  db.prepare("UPDATE customers SET referred_by = ?, updated_at = datetime('now') WHERE telegram_id = ?").run(code, telegramId);
  return { success: true };
}

export function addReferralReward(referrerId: string, referredId: string, orderId: string, rewardJpy: number): void {
  db.prepare('INSERT INTO referral_rewards (referrer_telegram_id, referred_telegram_id, order_id, reward_jpy) VALUES (?, ?, ?, ?)').run(referrerId, referredId, orderId, rewardJpy);
}

export function updateCustomerVolume(telegramId: string, jpyAmount: number): void {
  const customer = getOrCreateCustomer(telegramId);
  const newVolume = (customer.total_volume_jpy || 0) + jpyAmount;
  const newOrders = (customer.total_orders || 0) + 1;
  const newRank = calculateVipRank(newVolume);
  db.prepare("UPDATE customers SET total_volume_jpy = ?, total_orders = ?, vip_rank = ?, updated_at = datetime('now') WHERE telegram_id = ?").run(newVolume, newOrders, newRank, telegramId);
}

export function getCustomerStats(telegramId: string): CustomerRow & { referral_count: number; total_rewards: number } {
  const customer = getOrCreateCustomer(telegramId);
  const referralStats = getReferralStats(telegramId);
  return { ...customer, ...referralStats };
}

export function getReferralStats(telegramId: string): { referral_count: number; total_rewards: number } {
  const row = db.prepare('SELECT COUNT(*) as referral_count, COALESCE(SUM(reward_jpy), 0) as total_rewards FROM referral_rewards WHERE referrer_telegram_id = ?').get(telegramId) as ReferralStatsRow;
  return { referral_count: row.referral_count, total_rewards: row.total_rewards };
}

export function getAllCustomers(): CustomerRow[] {
  return db.prepare('SELECT * FROM customers ORDER BY total_volume_jpy DESC').all() as CustomerRow[];
}

export function getAllReferralRewards(): ReferralRewardRow[] {
  return db.prepare('SELECT * FROM referral_rewards ORDER BY created_at DESC').all() as ReferralRewardRow[];
}

export function getCustomerByReferralCode(code: string): CustomerRow | undefined {
  return db.prepare('SELECT * FROM customers WHERE referral_code = ?').get(code) as CustomerRow | undefined;
}

// === Notification Preferences ===
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

// === Notification Preferences ===
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

export function getNotificationSubscribers(type: string): number[] {
  const col = type === 'daily_summary' ? 'daily_summary' : type === 'spike_alerts' ? 'spike_alerts' : 'weekly_summary';
  const rows = db.prepare(`SELECT telegram_id FROM notification_preferences WHERE ${col} = 1`).all() as TelegramIdRow[];
  return rows.map(r => r.telegram_id);
}

export function setNotificationPreference(telegramId: number, type: string, enabled: boolean): void {
  const col = type === 'daily_summary' ? 'daily_summary' : type === 'spike_alerts' ? 'spike_alerts' : 'weekly_summary';
  db.prepare(`INSERT INTO notification_preferences (telegram_id, ${col}) VALUES (?, ?) ON CONFLICT(telegram_id) DO UPDATE SET ${col} = ?`).run(telegramId, enabled ? 1 : 0, enabled ? 1 : 0);
}

export function getNotificationPreferences(telegramId: number): { daily_summary: boolean; spike_alerts: boolean; weekly_summary: boolean } {
  const row = db.prepare('SELECT * FROM notification_preferences WHERE telegram_id = ?').get(telegramId) as NotificationPrefRow | undefined;
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO notification_preferences (telegram_id) VALUES (?)').run(telegramId);
    return { daily_summary: true, spike_alerts: true, weekly_summary: true };
  }
  return { daily_summary: !!row.daily_summary, spike_alerts: !!row.spike_alerts, weekly_summary: !!row.weekly_summary };
}

export function setAlertThreshold(telegramId: number, crypto: string, threshold: number): void {
  db.prepare(`INSERT INTO notification_preferences (telegram_id, alert_crypto, alert_threshold) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET alert_crypto = ?, alert_threshold = ?`).run(telegramId, crypto, threshold, crypto, threshold);
}


// === Fee Settings ===
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

try { db.exec(`ALTER TABLE orders ADD COLUMN fee_rate REAL DEFAULT 0.02`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN fee_jpy REAL DEFAULT 0`); } catch { /* column may already exist */ }
try { db.exec(`ALTER TABLE orders ADD COLUMN fee_crypto REAL DEFAULT 0`); } catch { /* column may already exist */ }

export function getFeeSettings(): FeeSettingsRow | undefined {
  return db.prepare('SELECT * FROM fee_settings WHERE id = 1').get() as FeeSettingsRow | undefined;
}

export function updateFeeSettings(settings: FeeSettingsUpdate): void {
  const allowed = ['base_fee_rate','vip_bronze_rate','vip_silver_rate','vip_gold_rate','vip_platinum_rate'];
  const fields: string[] = [];
  const vals: (string | number)[] = [];
  for (const [k, v] of Object.entries(settings)) {
    if (allowed.includes(k) && v !== undefined) { fields.push(`${k} = ?`); vals.push(v as number); }
  }
  fields.push("updated_at = datetime('now')");
  if (vals.length > 0) db.prepare(`UPDATE fee_settings SET ${fields.join(', ')} WHERE id = 1`).run(...vals);
}

export function getFeeRateForRank(rank: string): number {
  const s = getFeeSettings();
  if (!s) return 0.02;
  switch (rank) {
    case 'platinum': return s.vip_platinum_rate;
    case 'gold': return s.vip_gold_rate;
    case 'silver': return s.vip_silver_rate;
    default: return s.vip_bronze_rate;
  }
}

export function getFeeReport(from: string, to: string): { total: FeeReportTotalRow; byDay: FeeReportDayRow[]; byCrypto: FeeReportCryptoRow[] } {
  const total = db.prepare(`
    SELECT COALESCE(SUM(fee_jpy),0) as total_fee_jpy, COALESCE(SUM(fee_crypto),0) as total_fee_crypto, COUNT(*) as order_count
    FROM orders WHERE status='completed' AND datetime(created_at/1000,'unixepoch') BETWEEN ? AND ?
  `).get(from, to + ' 23:59:59') as FeeReportTotalRow;
  const byDay = db.prepare(`
    SELECT date(created_at/1000,'unixepoch') as day, COALESCE(SUM(fee_jpy),0) as fee_jpy, COALESCE(SUM(fee_crypto),0) as fee_crypto, COUNT(*) as order_count
    FROM orders WHERE status='completed' AND datetime(created_at/1000,'unixepoch') BETWEEN ? AND ?
    GROUP BY day ORDER BY day DESC
  `).all(from, to + ' 23:59:59') as FeeReportDayRow[];
  const byCrypto = db.prepare(`
    SELECT crypto, COALESCE(SUM(fee_jpy),0) as fee_jpy, COALESCE(SUM(fee_crypto),0) as fee_crypto, COUNT(*) as order_count
    FROM orders WHERE status='completed' AND datetime(created_at/1000,'unixepoch') BETWEEN ? AND ?
    GROUP BY crypto
  `).all(from, to + ' 23:59:59') as FeeReportCryptoRow[];
  return { total, byDay, byCrypto };
}

// === Transaction Cost Config & Margin Safety ===
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

export function getCostConfig(): CostConfig {
  const row = db.prepare('SELECT * FROM cost_config WHERE id = 1').get() as CostConfig | undefined;
  return row || {
    id: 1, tron_gas_jpy: 50, bank_transfer_fee_jpy: 0,
    exchange_fee_rate: 0.001, min_margin_jpy: 100, min_margin_rate: 0.005,
    auto_adjust_fee: 1, updated_at: Date.now(),
  };
}

export function updateCostConfig(updates: Partial<CostConfig>): void {
  const allowed = ['tron_gas_jpy', 'bank_transfer_fee_jpy', 'exchange_fee_rate',
    'min_margin_jpy', 'min_margin_rate', 'auto_adjust_fee'];
  const fields: string[] = [];
  const vals: (string | number)[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!allowed.includes(k) || v === undefined) continue;
    const num = Number(v);
    if (isNaN(num) || num < 0) continue; // NaN/負の値を拒否
    if (k === 'exchange_fee_rate' && num > 1) continue; // 取引所手数料率は100%以下
    if (k === 'min_margin_rate' && num > 1) continue; // マージン率は100%以下
    fields.push(`${k} = ?`);
    vals.push(num);
  }
  fields.push(`updated_at = ${Date.now()}`);
  if (vals.length > 0) db.prepare(`UPDATE cost_config SET ${fields.join(', ')} WHERE id = 1`).run(...vals);
}

export interface TransactionCost {
  id: number;
  order_id: string;
  cost_type: string;
  amount_jpy: number;
  description: string | null;
  created_at: number;
}

export function recordTransactionCost(orderId: string, costType: string, amountJpy: number, description?: string): void {
  db.prepare(
    `INSERT INTO transaction_costs (order_id, cost_type, amount_jpy, description, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, costType, amountJpy, description || null, Date.now());
}

export function getTransactionCosts(orderId: string): TransactionCost[] {
  return db.prepare('SELECT * FROM transaction_costs WHERE order_id = ?').all(orderId) as TransactionCost[];
}

export function getTotalTransactionCost(orderId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(amount_jpy), 0) as total FROM transaction_costs WHERE order_id = ?').get(orderId) as { total: number };
  return row.total;
}

/**
 * 取引のコストを見積もり、最低必要手数料を計算する。
 * @returns { estimatedCost, minFeeJpy, minFeeRate }
 */
export function estimateOrderCost(amountJpy: number, direction: 'buy' | 'sell'): {
  estimatedCost: number;
  minFeeJpy: number;
  minFeeRate: number;
} {
  const cc = getCostConfig();

  // 見積もりコスト = TRONガス + 銀行振込手数料 + 取引所手数料
  let estimatedCost = cc.tron_gas_jpy + cc.bank_transfer_fee_jpy;
  if (direction === 'buy') {
    // 購入時: 取引所手数料 = 金額 × exchange_fee_rate
    estimatedCost += amountJpy * cc.exchange_fee_rate;
  } else {
    // 売却時: ガス代のみ（顧客がUSDT送付）
    estimatedCost += amountJpy * cc.exchange_fee_rate;
  }

  // 最低必要手数料 = max(コスト + min_margin_jpy, 金額 × min_margin_rate)
  const minFeeByAmount = amountJpy * cc.min_margin_rate;
  const minFeeByMargin = estimatedCost + cc.min_margin_jpy;
  const minFeeJpy = Math.max(minFeeByAmount, minFeeByMargin);
  const minFeeRate = amountJpy > 0 ? minFeeJpy / amountJpy : 1;

  return {
    estimatedCost: Math.round(estimatedCost),
    minFeeJpy: Math.ceil(minFeeJpy),
    minFeeRate: parseFloat(minFeeRate.toFixed(6)),
  };
}

// === Bank Transfer Recording (Phase C) ===
export function recordBankTransfer(data: {
  orderId?: string; bankAccountId?: number; senderName?: string;
  amount: number; transferDate: string; reference?: string;
  verificationMethod?: string; status?: string;
}): number {
  const result = db.prepare(
    `INSERT INTO bank_transfers (order_id, bank_account_id, sender_name, amount, transfer_date, reference, verification_method, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.orderId || null, data.bankAccountId || null, data.senderName || null,
    data.amount, data.transferDate, data.reference || null,
    data.verificationMethod || 'manual', data.status || 'unmatched', Date.now()
  );
  return result.lastInsertRowid as number;
}

export function getBankTransfers(options?: { status?: string; orderId?: string; limit?: number }): BankTransferRow[] {
  let sql = 'SELECT * FROM bank_transfers';
  const conditions: string[] = [];
  const vals: (string | number)[] = [];
  if (options?.status) { conditions.push('status = ?'); vals.push(options.status); }
  if (options?.orderId) { conditions.push('order_id = ?'); vals.push(options.orderId); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  if (options?.limit) { sql += ' LIMIT ?'; vals.push(options.limit); }
  return db.prepare(sql).all(...vals) as BankTransferRow[];
}

export function updateBankTransfer(id: number, data: { orderId?: string; status?: string; matchedAt?: number }): void {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (data.orderId !== undefined) { sets.push('order_id = ?'); vals.push(data.orderId); }
  if (data.status) { sets.push('status = ?'); vals.push(data.status); }
  if (data.matchedAt) { sets.push('matched_at = ?'); vals.push(data.matchedAt); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE bank_transfers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getUnmatchedBankTransfers(): BankTransferRow[] {
  return db.prepare('SELECT * FROM bank_transfers WHERE status = ? ORDER BY created_at ASC').all('unmatched') as BankTransferRow[];
}

export function getConfirmingOrders(): OrderData[] {
  return db.prepare("SELECT * FROM orders WHERE status = 'confirming' ORDER BY paid_at ASC").all().map((r) => rowToOrder(r as OrderRow));
}

// === Crypto Transaction Recording ===
export function recordCryptoTransaction(orderId: string, data: { txId: string; crypto: string; amount: number; toAddress: string; status: string }): void {
  db.prepare(`INSERT INTO crypto_transactions (order_id, tx_id, crypto, amount, to_address, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    orderId, data.txId, data.crypto, data.amount, data.toAddress, data.status, Date.now()
  );
}

export function getCryptoTransactions(orderId?: string): CryptoTransactionRow[] {
  if (orderId) {
    return db.prepare('SELECT * FROM crypto_transactions WHERE order_id = ? ORDER BY created_at DESC').all(orderId) as CryptoTransactionRow[];
  }
  return db.prepare('SELECT * FROM crypto_transactions ORDER BY created_at DESC LIMIT 100').all() as CryptoTransactionRow[];
}

/** Get transactions that were sent but not yet confirmed on-chain */
export function getUnconfirmedTransactions(): CryptoTransactionRow[] {
  return db.prepare("SELECT * FROM crypto_transactions WHERE status = 'sent' AND confirmed_at IS NULL ORDER BY created_at ASC").all() as CryptoTransactionRow[];
}

/** Update transaction status and confirmation timestamp */
export function updateCryptoTransactionStatus(txId: string, status: string, confirmedAt?: number): void {
  if (confirmedAt) {
    db.prepare('UPDATE crypto_transactions SET status = ?, confirmed_at = ? WHERE tx_id = ?').run(status, confirmedAt, txId);
  } else {
    db.prepare('UPDATE crypto_transactions SET status = ? WHERE tx_id = ?').run(status, txId);
  }
}

// === Audit Log ===

/** Record an admin action for compliance audit trail */
export function recordAuditLog(entry: {
  userId?: number;
  username?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: string;
  ipAddress?: string;
}): void {
  db.prepare(
    `INSERT INTO audit_log (user_id, username, action, target_type, target_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.userId ?? null,
    entry.username ?? null,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.details ?? null,
    entry.ipAddress ?? null,
    Date.now(),
  );
}

/** Query audit log with optional filters */
export function getAuditLog(filters?: {
  userId?: number;
  action?: string;
  limit?: number;
  offset?: number;
}): AuditLogEntry[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters?.userId) {
    conditions.push('user_id = ?');
    params.push(filters.userId);
  }
  if (filters?.action) {
    conditions.push('action = ?');
    params.push(filters.action);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit || 100;
  const offset = filters?.offset || 0;

  return db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as AuditLogEntry[];
}

// Cleanup expired sessions periodically
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 60 * 60 * 1000);


export function changePassword(token: string, currentPassword: string, newPassword: string): boolean {
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as SessionRow | undefined;
  if (!session) return false;
  const user = db.prepare('SELECT id, password_hash FROM admin_users WHERE id = ?').get(session.user_id) as AdminUserRow | undefined;
  if (!user) return false;
  let currentValid = false;
  if (user.password_hash.length === 64) {
    currentValid = legacySha256Hash(currentPassword) === user.password_hash;
  } else {
    currentValid = bcrypt.compareSync(currentPassword, user.password_hash);
  }
  if (!currentValid) return false;
  db.prepare('UPDATE admin_users SET password_hash = ?, force_pw_change = 0 WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  // Invalidate all sessions for this user (forces re-login with new password)
  deleteAllUserSessions(user.id);
  return true;
}

export function bulkAddBankAccounts(accounts: BankAccountInput[]): number {
  const insert = db.prepare(`INSERT INTO bank_accounts (bank_name, branch_name, account_type, account_number, account_holder, daily_limit, priority, status, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const transaction = db.transaction((accs: BankAccountInput[]) => {
    let count = 0;
    for (const acc of accs) {
      insert.run(
        acc.bankName, acc.branchName, acc.accountType || '普通',
        encryptBankField(acc.accountNumber), encryptBankField(acc.accountHolder),
        acc.dailyLimit || 3000000, acc.priority || 'medium', acc.status || 'active', acc.memo || ''
      );
      count++;
    }
    return count;
  });
  return transaction(accounts);
}

// === P2P Sellers ===
export function createP2PSeller(data: {
  name: string; email: string; passwordHash: string; confirmToken: string;
  paypayId?: string; linepayId?: string; aupayId?: string;
  minAmount?: number; maxAmount?: number; payMethods?: string[];
}): number {
  const r = db.prepare(`INSERT INTO p2p_sellers
    (name, email, password_hash, confirm_token, paypay_id, linepay_id, aupay_id, min_amount, max_amount, pay_methods, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    data.name, data.email, data.passwordHash, data.confirmToken,
    data.paypayId || null, data.linepayId || null, data.aupayId || null,
    data.minAmount || 1000, data.maxAmount || 500000,
    JSON.stringify(data.payMethods || ['paypay']),
    Date.now()
  );
  return r.lastInsertRowid as number;
}

export function getP2PSeller(id: number): P2PSellerRow | null {
  return (db.prepare('SELECT * FROM p2p_sellers WHERE id = ?').get(id) as P2PSellerRow | undefined) || null;
}

export function getP2PSellerByEmail(email: string): P2PSellerRow | null {
  return (db.prepare('SELECT * FROM p2p_sellers WHERE email = ?').get(email) as P2PSellerRow | undefined) || null;
}

export function getP2PSellerByToken(token: string): P2PSellerRow | null {
  return (db.prepare('SELECT * FROM p2p_sellers WHERE confirm_token = ?').get(token) as P2PSellerRow | undefined) || null;
}

export function listP2PSellers(): P2PSellerRow[] {
  return db.prepare('SELECT * FROM p2p_sellers ORDER BY created_at DESC').all() as P2PSellerRow[];
}

export function listActiveP2PSellers(payMethod: string, minAmount: number, maxAmount: number): P2PSellerRow[] {
  return (db.prepare(`SELECT * FROM p2p_sellers WHERE status = 'active'
    AND min_amount <= ? AND max_amount >= ?`).all(minAmount, maxAmount) as P2PSellerRow[])
    .filter(s => {
      try {
        const methods: string[] = JSON.parse(s.pay_methods || '[]');
        return methods.includes(payMethod);
      } catch { return false; }
    });
}

export function updateP2PSellerStatus(id: number, status: string): void {
  db.prepare('UPDATE p2p_sellers SET status = ? WHERE id = ?').run(status, id);
}

export function updateP2PSeller(id: number, data: Partial<{
  name: string; paypayId: string; linepayId: string; aupayId: string;
  minAmount: number; maxAmount: number; payMethods: string[]; telegramChatId: string;
}>): void {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.paypayId !== undefined) { sets.push('paypay_id = ?'); vals.push(data.paypayId); }
  if (data.linepayId !== undefined) { sets.push('linepay_id = ?'); vals.push(data.linepayId); }
  if (data.aupayId !== undefined) { sets.push('aupay_id = ?'); vals.push(data.aupayId); }
  if (data.minAmount !== undefined) { sets.push('min_amount = ?'); vals.push(data.minAmount); }
  if (data.maxAmount !== undefined) { sets.push('max_amount = ?'); vals.push(data.maxAmount); }
  if (data.payMethods !== undefined) { sets.push('pay_methods = ?'); vals.push(JSON.stringify(data.payMethods)); }
  if (data.telegramChatId !== undefined) { sets.push('telegram_chat_id = ?'); vals.push(data.telegramChatId); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE p2p_sellers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function creditP2PSellerBalance(id: number, amount: number): void {
  db.prepare('UPDATE p2p_sellers SET usdt_balance = usdt_balance + ? WHERE id = ?').run(amount, id);
}

export function lockP2PSellerBalance(id: number, amount: number): boolean {
  const r = db.prepare(`UPDATE p2p_sellers SET usdt_locked = usdt_locked + ?
    WHERE id = ? AND (usdt_balance - usdt_locked) >= ?`).run(amount, id, amount);
  return r.changes > 0;
}

export function releaseP2PSellerBalance(id: number, amount: number): void {
  db.prepare('UPDATE p2p_sellers SET usdt_locked = MAX(0, usdt_locked - ?) WHERE id = ?').run(amount, id);
}

export function deductP2PSellerBalance(id: number, amount: number): void {
  db.prepare(`UPDATE p2p_sellers SET
    usdt_balance = MAX(0, usdt_balance - ?),
    usdt_locked = MAX(0, usdt_locked - ?),
    total_trades = total_trades + 1,
    last_active = ?
    WHERE id = ?`).run(amount, amount, Date.now(), id);
}

export function saveOrderSellerId(orderId: string, sellerId: number): void {
  db.prepare('UPDATE orders SET seller_id = ? WHERE id = ?').run(sellerId, orderId);
}

export function confirmOrderBySeller(orderId: string, sellerId: number): void {
  db.prepare('UPDATE orders SET seller_confirmed_at = ? WHERE id = ? AND seller_id = ?').run(Date.now(), orderId, sellerId);
}

export function getOrdersBySellerId(sellerId: number): { id: string; amount: number; cryptoAmount: number; status: string; payMethod: string; createdAt: number; completedAt: number | null; txId: string | null }[] {
  return db.prepare(`
    SELECT id, amount, crypto_amount as cryptoAmount, status,
           pay_method as payMethod, created_at as createdAt,
           completed_at as completedAt, tx_id as txId
    FROM orders WHERE seller_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(sellerId) as { id: string; amount: number; cryptoAmount: number; status: string; payMethod: string; createdAt: number; completedAt: number | null; txId: string | null }[];
}

export function saveOrderWithdrawalId(orderId: string, withdrawalId: number): void {
  db.prepare('UPDATE orders SET withdrawal_id = ? WHERE id = ?').run(withdrawalId, orderId);
}

// === Withdrawals (Triangle Matching) ===

function rowToWithdrawal(row: WithdrawalRow): WithdrawalData {
  return {
    id: row.id,
    externalRef: row.external_ref || null,
    trackingToken: row.tracking_token,
    merchantApiKeyId: row.merchant_api_key_id || null,
    amount: row.amount,
    payMethod: row.pay_method,
    bankName: row.bank_name || null,
    branchName: row.branch_name || null,
    accountType: row.account_type || '普通',
    accountNumber: decryptBankField(row.account_number || ''),
    accountHolder: decryptBankField(row.account_holder || ''),
    paypayId: row.paypay_id || null,
    status: row.status,
    matchedOrderId: row.matched_order_id || null,
    matchedSellerId: row.matched_seller_id || null,
    webhookUrl: row.webhook_url || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at || null,
  };
}

export function createWithdrawal(data: {
  trackingToken: string; merchantApiKeyId?: number; externalRef?: string;
  amount: number; payMethod: string;
  bankName?: string; branchName?: string; accountType?: string;
  accountNumber?: string; accountHolder?: string; paypayId?: string;
  webhookUrl?: string; expiresAt: number;
}): number {
  const r = db.prepare(`
    INSERT INTO withdrawals (tracking_token, merchant_api_key_id, external_ref, amount, pay_method,
      bank_name, branch_name, account_type, account_number, account_holder, paypay_id,
      webhook_url, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.trackingToken, data.merchantApiKeyId || null, data.externalRef || null,
    data.amount, data.payMethod,
    data.bankName || null, data.branchName || null, data.accountType || '普通',
    data.accountNumber ? encryptBankField(data.accountNumber) : null,
    data.accountHolder ? encryptBankField(data.accountHolder) : null,
    data.paypayId || null,
    data.webhookUrl || null, Date.now(), data.expiresAt
  );
  return r.lastInsertRowid as number;
}

export function getWithdrawal(id: number): WithdrawalData | null {
  const row = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id) as WithdrawalRow | undefined;
  return row ? rowToWithdrawal(row) : null;
}

export function getWithdrawalByToken(token: string): WithdrawalData | null {
  const row = db.prepare('SELECT * FROM withdrawals WHERE tracking_token = ?').get(token) as WithdrawalRow | undefined;
  return row ? rowToWithdrawal(row) : null;
}

export function getWithdrawalByExternalRef(ref: string): WithdrawalData | null {
  const row = db.prepare('SELECT * FROM withdrawals WHERE external_ref = ?').get(ref) as WithdrawalRow | undefined;
  return row ? rowToWithdrawal(row) : null;
}

export function updateWithdrawalStatus(id: number, status: string, extra?: {
  matchedOrderId?: string; matchedSellerId?: number; completedAt?: number;
}): void {
  const sets = ['status = ?'];
  const vals: (string | number)[] = [status];
  if (extra?.matchedOrderId !== undefined) { sets.push('matched_order_id = ?'); vals.push(extra.matchedOrderId); }
  if (extra?.matchedSellerId !== undefined) { sets.push('matched_seller_id = ?'); vals.push(extra.matchedSellerId); }
  if (extra?.completedAt !== undefined) { sets.push('completed_at = ?'); vals.push(extra.completedAt); }
  vals.push(id);
  db.prepare(`UPDATE withdrawals SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function listWithdrawals(limit: number = 100): WithdrawalData[] {
  return (db.prepare('SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT ?').all(limit) as WithdrawalRow[])
    .map(rowToWithdrawal);
}

export function findPendingWithdrawalByAmount(amount: number, payMethod: string): WithdrawalData | null {
  const now = Date.now();
  const row = db.prepare(`
    SELECT * FROM withdrawals
    WHERE status = 'pending' AND amount = ? AND pay_method = ? AND expires_at > ?
    ORDER BY created_at ASC LIMIT 1
  `).get(amount, payMethod, now) as WithdrawalRow | undefined;
  return row ? rowToWithdrawal(row) : null;
}

export function listActiveP2PSellersAnyMethod(minAvailableUsdt: number): P2PSellerRow[] {
  return db.prepare(`
    SELECT * FROM p2p_sellers
    WHERE status = 'active' AND (usdt_balance - usdt_locked) >= ?
    ORDER BY total_trades DESC
  `).all(minAvailableUsdt) as P2PSellerRow[];
}

// === Merchant API Keys ===
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

export function saveOrderWithMerchantKey(order: { id: string }, merchantApiKeyId: number, webhookUrl?: string): void {
  db.prepare(`UPDATE orders SET merchant_api_key_id = ?, webhook_url = ? WHERE id = ?`).run(
    merchantApiKeyId, webhookUrl || null, order.id
  );
}

// === Exchange Orders (Auto-Trade) ===
export function createExchangeOrder(data: {
  orderId: string; exchange: string; channel: string; exchangeOrderId?: string;
  status?: string; sellerName?: string; sellerBankInfo?: Record<string, unknown>;
  amountJpy?: number; cryptoAmount?: number; rate?: number;
}): number {
  const now = Date.now();
  const r = db.prepare(`INSERT INTO exchange_orders
    (order_id, exchange, channel, exchange_order_id, status, seller_name, seller_bank_info, amount_jpy, crypto_amount, rate, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    data.orderId, data.exchange, data.channel, data.exchangeOrderId || null,
    data.status || 'creating', data.sellerName || null,
    data.sellerBankInfo ? JSON.stringify(data.sellerBankInfo) : null,
    data.amountJpy ?? null, data.cryptoAmount ?? null, data.rate ?? null,
    now, now
  );
  return r.lastInsertRowid as number;
}

export function getExchangeOrder(orderId: string): ExchangeOrderData | null {
  const row = db.prepare('SELECT * FROM exchange_orders WHERE order_id = ? ORDER BY created_at DESC LIMIT 1').get(orderId) as ExchangeOrderRow | undefined;
  if (!row) return null;
  return { ...row, sellerBankInfo: safeJsonParse(row.seller_bank_info) };
}

export function getExchangeOrderById(id: number): ExchangeOrderData | null {
  const row = db.prepare('SELECT * FROM exchange_orders WHERE id = ?').get(id) as ExchangeOrderRow | undefined;
  if (!row) return null;
  return { ...row, sellerBankInfo: safeJsonParse(row.seller_bank_info) };
}

export function updateExchangeOrder(id: number, updates: Record<string, unknown>): void {
  const allowed = ['channel','exchange_order_id','status','seller_name','seller_bank_info','error_message','screenshot_path','completed_at'];
  const fields: string[] = ['updated_at = ?'];
  const vals: unknown[] = [Date.now()];
  for (const [k, v] of Object.entries(updates)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase(); // camelCase → snake_case
    if (allowed.includes(col)) {
      fields.push(`${col} = ?`);
      vals.push(col === 'seller_bank_info' && typeof v === 'object' ? JSON.stringify(v) : v);
    }
  }
  vals.push(id);
  db.prepare(`UPDATE exchange_orders SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
}

export function listExchangeOrders(limit = 100): ExchangeOrderData[] {
  return (db.prepare('SELECT * FROM exchange_orders ORDER BY created_at DESC LIMIT ?').all(limit) as ExchangeOrderRow[]).map(row => ({
    ...row, sellerBankInfo: safeJsonParse(row.seller_bank_info),
  }));
}

export function listActiveExchangeOrders(): ExchangeOrderData[] {
  return (db.prepare("SELECT * FROM exchange_orders WHERE status IN ('creating','placed','paid') ORDER BY created_at ASC").all() as ExchangeOrderRow[]).map(row => ({
    ...row, sellerBankInfo: safeJsonParse(row.seller_bank_info),
  }));
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

// === TruPay Withdrawals ===

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

export function insertTruPayWithdrawal(data: {
  trupay_id: number;
  system_transaction_id: string;
  transaction_id: string;
  amount_jpy: number;
  bank_name: string;
  branch_name: string;
  account_number: string;
  account_name: string;
  account_type?: string;
}): number {
  const now = Date.now();
  const result = db.prepare(`
    INSERT OR IGNORE INTO trupay_withdrawals
      (trupay_id, system_transaction_id, transaction_id, amount_jpy, bank_name, branch_name, account_number, account_name, account_type, trupay_status, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 31, 'queued', ?, ?)
  `).run(
    data.trupay_id, data.system_transaction_id, data.transaction_id,
    data.amount_jpy, data.bank_name, data.branch_name,
    data.account_number, data.account_name, data.account_type || 'savings',
    now, now
  );
  return result.changes;
}

export function getTruPayWithdrawalById(id: number): TruPayWithdrawalRow | undefined {
  return db.prepare('SELECT * FROM trupay_withdrawals WHERE id = ?').get(id) as TruPayWithdrawalRow | undefined;
}

export function getTruPayWithdrawalByTruPayId(trupayId: number): TruPayWithdrawalRow | undefined {
  return db.prepare('SELECT * FROM trupay_withdrawals WHERE trupay_id = ?').get(trupayId) as TruPayWithdrawalRow | undefined;
}

const TRUPAY_QUEUE_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours

export function getQueuedTruPayWithdrawals(): TruPayWithdrawalRow[] {
  const cutoff = Date.now() - TRUPAY_QUEUE_MAX_AGE_MS;
  return db.prepare('SELECT * FROM trupay_withdrawals WHERE status = ? AND created_at > ? ORDER BY created_at ASC').all('queued', cutoff) as TruPayWithdrawalRow[];
}

/**
 * 48時間以上古いqueued出金をexpiredに移行
 */
export function expireOldQueuedWithdrawals(): number {
  const cutoff = Date.now() - TRUPAY_QUEUE_MAX_AGE_MS;
  const result = db.prepare("UPDATE trupay_withdrawals SET status = 'expired', updated_at = ? WHERE status = 'queued' AND created_at <= ?").run(Date.now(), cutoff);
  return result.changes;
}

export function getTruPayWithdrawals(status?: string, limit = 50, offset = 0): TruPayWithdrawalRow[] {
  if (status) {
    return db.prepare('SELECT * FROM trupay_withdrawals WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, limit, offset) as TruPayWithdrawalRow[];
  }
  return db.prepare('SELECT * FROM trupay_withdrawals ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as TruPayWithdrawalRow[];
}

const TRUPAY_WD_EXTRA_COLS = new Set(['trupay_status', 'matched_at', 'completed_at']);

export function updateTruPayWithdrawalStatus(id: number, status: string, extra?: Record<string, unknown>): void {
  const now = Date.now();
  if (extra && Object.keys(extra).length > 0) {
    const filtered = Object.entries(extra).filter(([k]) => TRUPAY_WD_EXTRA_COLS.has(k));
    const sets = filtered.map(([k]) => `${k} = ?`).join(', ');
    const values = filtered.map(([, v]) => v);
    if (sets) {
      db.prepare(`UPDATE trupay_withdrawals SET status = ?, ${sets}, updated_at = ? WHERE id = ?`).run(status, ...values, now, id);
    } else {
      db.prepare('UPDATE trupay_withdrawals SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    }
  } else {
    db.prepare('UPDATE trupay_withdrawals SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }
}

// === TruPay Matches ===

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

export function insertTruPayMatch(data: {
  withdrawal_id: number;
  buyer_id: string;
  buyer_wallet: string;
  rate_jpy_usdt: number;
  amount_jpy: number;
  amount_usdt: number;
  timeout_at: number;
}): number {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO trupay_matches
      (withdrawal_id, buyer_id, buyer_wallet, rate_jpy_usdt, amount_jpy, amount_usdt, timeout_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting_transfer', ?, ?)
  `).run(
    data.withdrawal_id, data.buyer_id, data.buyer_wallet,
    data.rate_jpy_usdt, data.amount_jpy, data.amount_usdt,
    data.timeout_at, now, now
  );
  return Number(result.lastInsertRowid);
}

export function getTruPayMatch(id: number): TruPayMatchRow | undefined {
  return db.prepare('SELECT * FROM trupay_matches WHERE id = ?').get(id) as TruPayMatchRow | undefined;
}

export function getTruPayMatchByWithdrawalId(withdrawalId: number): TruPayMatchRow | undefined {
  return db.prepare('SELECT * FROM trupay_matches WHERE withdrawal_id = ? AND status NOT IN (?, ?) ORDER BY created_at DESC LIMIT 1')
    .get(withdrawalId, 'timeout', 'cancelled') as TruPayMatchRow | undefined;
}

export function getActiveTruPayMatches(): TruPayMatchRow[] {
  return db.prepare("SELECT * FROM trupay_matches WHERE status IN ('waiting_transfer', 'buyer_paid', 'needs_review', 'transfer_confirmed') ORDER BY created_at ASC").all() as TruPayMatchRow[];
}

export function getTruPayMatches(status?: string, limit = 50, offset = 0): TruPayMatchRow[] {
  if (status) {
    return db.prepare('SELECT * FROM trupay_matches WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(status, limit, offset) as TruPayMatchRow[];
  }
  return db.prepare('SELECT * FROM trupay_matches ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as TruPayMatchRow[];
}

const TRUPAY_MATCH_EXTRA_COLS = new Set(['usdt_tx_hash', 'reference_number', 'proof_image', 'proof_score', 'proof_analysis']);

export function updateTruPayMatchStatus(id: number, status: string, extra?: Record<string, unknown>): void {
  const now = Date.now();
  if (extra && Object.keys(extra).length > 0) {
    const filtered = Object.entries(extra).filter(([k]) => TRUPAY_MATCH_EXTRA_COLS.has(k));
    const sets = filtered.map(([k]) => `${k} = ?`).join(', ');
    const values = filtered.map(([, v]) => v);
    if (sets) {
      db.prepare(`UPDATE trupay_matches SET status = ?, ${sets}, updated_at = ? WHERE id = ?`).run(status, ...values, now, id);
    } else {
      db.prepare('UPDATE trupay_matches SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    }
  } else {
    db.prepare('UPDATE trupay_matches SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  }
}

export function getTruPayStats(): { queued: number; matched: number; completed: number; timeout: number; total_jpy: number; total_usdt: number } {
  const queued = (db.prepare("SELECT COUNT(*) as c FROM trupay_withdrawals WHERE status = 'queued'").get() as CountRow).c;
  const matched = (db.prepare("SELECT COUNT(*) as c FROM trupay_matches WHERE status IN ('waiting_transfer', 'transfer_confirmed')").get() as CountRow).c;
  const completed = (db.prepare("SELECT COUNT(*) as c FROM trupay_matches WHERE status = 'completed'").get() as CountRow).c;
  const timeout = (db.prepare("SELECT COUNT(*) as c FROM trupay_matches WHERE status = 'timeout'").get() as CountRow).c;
  const totals = db.prepare("SELECT COALESCE(SUM(amount_jpy), 0) as total_jpy, COALESCE(SUM(amount_usdt), 0) as total_usdt FROM trupay_matches WHERE status = 'completed'").get() as { total_jpy: number; total_usdt: number };
  return { queued, matched, completed, timeout, total_jpy: totals.total_jpy, total_usdt: totals.total_usdt };
}

// === TruPay Pending Buyers (DB-backed) ===
db.exec(`CREATE TABLE IF NOT EXISTS trupay_pending_buyers (
  id TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  min_amount_jpy REAL NOT NULL DEFAULT 0,
  max_amount_jpy REAL NOT NULL DEFAULT 0,
  registered_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
)`);

export function dbInsertPendingBuyer(buyer: { id: string; walletAddress: string; minAmountJpy: number; maxAmountJpy: number; registeredAt: number }): void {
  db.prepare('INSERT OR REPLACE INTO trupay_pending_buyers (id, wallet_address, min_amount_jpy, max_amount_jpy, registered_at, status) VALUES (?, ?, ?, ?, ?, ?)').run(buyer.id, buyer.walletAddress, buyer.minAmountJpy, buyer.maxAmountJpy, buyer.registeredAt, 'active');
}

export function dbGetActivePendingBuyers(): Array<{ id: string; wallet_address: string; min_amount_jpy: number; max_amount_jpy: number; registered_at: number }> {
  return db.prepare("SELECT * FROM trupay_pending_buyers WHERE status = 'active'").all() as Array<{ id: string; wallet_address: string; min_amount_jpy: number; max_amount_jpy: number; registered_at: number }>;
}

export function dbDeletePendingBuyer(id: string): boolean {
  return db.prepare('DELETE FROM trupay_pending_buyers WHERE id = ?').run(id).changes > 0;
}

export function dbExpireOldPendingBuyers(): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return db.prepare("UPDATE trupay_pending_buyers SET status = 'expired' WHERE status = 'active' AND registered_at <= ?").run(cutoff).changes;
}

// === P2P Buy Referral Program ===

export function createReferralCode(referrerId: string, referrerType: string, parentCode?: string): string {
  const code = 'PM' + crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('INSERT INTO referrals (referrer_code, referrer_type, referrer_id, parent_code, created_at) VALUES (?, ?, ?, ?, ?)').run(code, referrerType, referrerId, parentCode || null, Date.now());
  return code;
}

export function getReferralByCode(code: string): { referrer_code: string; referrer_id: string; total_referrals: number; total_volume_jpy: number; total_reward_usdt: number } | undefined {
  return db.prepare("SELECT * FROM referrals WHERE referrer_code = ? AND status = 'active'").get(code) as { referrer_code: string; referrer_id: string; total_referrals: number; total_volume_jpy: number; total_reward_usdt: number } | undefined;
}

export function recordReferralConversion(code: string, buyerId: string, matchId: number, amountJpy: number): void {
  const TIER1_RATE = 0.0015; // 0.15%
  const TIER2_RATE = 0.0005; // 0.05%
  const rewardUsdt = amountJpy * TIER1_RATE;

  db.prepare('INSERT INTO referral_conversions (referral_code, buyer_id, match_id, amount_jpy, reward_usdt, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(code, buyerId, matchId, amountJpy, rewardUsdt, 'confirmed', Date.now());
  db.prepare('UPDATE referrals SET total_referrals = total_referrals + 1, total_volume_jpy = total_volume_jpy + ?, total_reward_usdt = total_reward_usdt + ? WHERE referrer_code = ?').run(amountJpy, rewardUsdt, code);

  // Tier 2: reward parent referrer
  const ref = db.prepare("SELECT parent_code FROM referrals WHERE referrer_code = ?").get(code) as { parent_code: string | null } | undefined;
  if (ref?.parent_code) {
    const tier2Reward = amountJpy * TIER2_RATE;
    db.prepare('UPDATE referrals SET tier2_reward_usdt = tier2_reward_usdt + ? WHERE referrer_code = ?').run(tier2Reward, ref.parent_code);
    logger.info('Tier2 referral reward', { parentCode: ref.parent_code, reward: tier2Reward });
  }
}

export function getP2pReferralStats(code: string): { conversions: number; volume: number; rewards: number } {
  const ref = db.prepare("SELECT total_referrals, total_volume_jpy, total_reward_usdt FROM referrals WHERE referrer_code = ?").get(code) as { total_referrals: number; total_volume_jpy: number; total_reward_usdt: number } | undefined;
  if (!ref) return { conversions: 0, volume: 0, rewards: 0 };
  return { conversions: ref.total_referrals, volume: ref.total_volume_jpy, rewards: ref.total_reward_usdt };
}

// === Rate Alerts ===

export function createRateAlert(chatId: number, targetRate: number, direction: string = 'below'): number {
  const result = db.prepare('INSERT INTO rate_alerts (chat_id, target_rate, direction, crypto, active, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(chatId, targetRate, direction, 'USDT', Date.now());
  return Number(result.lastInsertRowid);
}

export function getActiveRateAlerts(): Array<{ id: number; chat_id: number; target_rate: number; direction: string }> {
  return db.prepare("SELECT id, chat_id, target_rate, direction FROM rate_alerts WHERE active = 1").all() as Array<{ id: number; chat_id: number; target_rate: number; direction: string }>;
}

export function triggerRateAlert(id: number): void {
  db.prepare('UPDATE rate_alerts SET active = 0, triggered_at = ? WHERE id = ?').run(Date.now(), id);
}

// === Funnel Events ===

export function insertFunnelEvent(event: string, data: string, refCode: string, ip: string, userAgent: string): void {
  db.prepare('INSERT INTO funnel_events (event, data, ref_code, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(event, data, refCode, ip, userAgent, Date.now());
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

// === PayPay Conversion ===

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

export default db;
