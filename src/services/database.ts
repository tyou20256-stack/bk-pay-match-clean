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
import Database from 'better-sqlite3';
import { resolve } from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const DB_PATH = resolve(process.cwd(), 'data/bkpay.db');

// Ensure data directory exists
import { mkdirSync } from 'fs';
mkdirSync(resolve(process.cwd(), 'data'), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
`);

// === Encryption (simple, for sensitive fields) ===
const ENC_KEY = process.env.BK_ENC_KEY || 'bkpay-default-key-change-me-32ch';
function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENC_KEY.padEnd(32).slice(0,32)), iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}
function decrypt(text: string): string {
  try {
    const [ivHex, encHex] = text.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENC_KEY.padEnd(32).slice(0,32)), Buffer.from(ivHex, 'hex'));
    let dec = decipher.update(encHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch { return ''; }
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

export function authenticateUser(username: string, password: string): { token: string; userId: number } | null {
  const user = db.prepare('SELECT id, password_hash FROM admin_users WHERE username = ?').get(username) as any;
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
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt);
  return { token, userId: user.id };
}

export function validateSession(token: string): boolean {
  const session = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as any;
  return !!session;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// Create default admin if none exists
const adminCount = (db.prepare('SELECT COUNT(*) as c FROM admin_users').get() as any).c;
if (adminCount === 0) {
  createAdminUser('admin', 'bkpay2026');
  console.log('[DB] Default admin created: admin / bkpay2026');
}

// === Orders ===
export function saveOrder(order: any): void {
  db.prepare(`INSERT OR REPLACE INTO orders (id, mode, status, amount, crypto, crypto_amount, rate, pay_method, exchange, merchant_name, merchant_completion_rate, payment_info, created_at, expires_at, paid_at, completed_at, fee_rate, fee_jpy, fee_crypto)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    order.id, order.mode, order.status, order.amount, order.crypto, order.cryptoAmount, order.rate,
    order.payMethod, order.exchange, order.merchantName, order.merchantCompletionRate,
    JSON.stringify(order.paymentInfo), order.createdAt, order.expiresAt, order.paidAt || null, order.completedAt || null,
    order.feeRate || 0, order.feeJpy || 0, order.feeCrypto || 0
  );
}

export function getOrder(id: string): any {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
  if (!row) return null;
  return rowToOrder(row);
}

export function getAllOrders(limit = 100): any[] {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit) as any[];
  return rows.map(rowToOrder);
}

export function updateOrderStatus(id: string, status: string, extra: any = {}): void {
  const sets = ['status = ?'];
  const vals: any[] = [status];
  if (extra.paidAt) { sets.push('paid_at = ?'); vals.push(extra.paidAt); }
  if (extra.completedAt) { sets.push('completed_at = ?'); vals.push(extra.completedAt); }
  vals.push(id);
  db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function rowToOrder(row: any): any {
  return {
    id: row.id, mode: row.mode, status: row.status, amount: row.amount, crypto: row.crypto,
    cryptoAmount: row.crypto_amount, rate: row.rate, payMethod: row.pay_method, exchange: row.exchange,
    merchantName: row.merchant_name, merchantCompletionRate: row.merchant_completion_rate,
    paymentInfo: JSON.parse(row.payment_info || 'null'), createdAt: row.created_at,
    expiresAt: row.expires_at, paidAt: row.paid_at, completedAt: row.completed_at,
    direction: row.direction || 'buy', customerWallet: row.customer_wallet || '', customerBankInfo: row.customer_bank_info ? JSON.parse(row.customer_bank_info) : {},
    feeRate: row.fee_rate || 0, feeJpy: row.fee_jpy || 0, feeCrypto: row.fee_crypto || 0
  };
}

// === Bank Accounts ===
export function addBankAccount(acc: any): number {
  const r = db.prepare(`INSERT INTO bank_accounts (bank_name, branch_name, account_type, account_number, account_holder, daily_limit, priority, status, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    acc.bankName, acc.branchName, acc.accountType || '普通', acc.accountNumber, acc.accountHolder,
    acc.dailyLimit || 3000000, acc.priority || 'medium', acc.status || 'active', acc.memo || ''
  );
  return r.lastInsertRowid as number;
}

export function getBankAccounts(): any[] {
  return db.prepare('SELECT * FROM bank_accounts ORDER BY priority DESC, id').all() as any[];
}

export function updateBankAccount(id: number, data: any): void {
  const fields = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(data)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    fields.push(`${col} = ?`);
    vals.push(v);
  }
  vals.push(id);
  if (fields.length) db.prepare(`UPDATE bank_accounts SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteBankAccount(id: number): void {
  db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id);
}

export function getRoutableAccount(amount: number): any {
  const today = new Date().toISOString().slice(0, 10);
  // Reset daily usage if date changed
  db.prepare("UPDATE bank_accounts SET used_today = 0, used_today_date = ? WHERE used_today_date != ? OR used_today_date IS NULL").run(today, today);
  // Get best account
  const acc = db.prepare(`SELECT * FROM bank_accounts WHERE status = 'active' AND (used_today + ?) <= daily_limit ORDER BY
    CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, used_today ASC LIMIT 1`).get(amount) as any;
  if (acc) {
    db.prepare('UPDATE bank_accounts SET used_today = used_today + ?, used_today_date = ? WHERE id = ?').run(amount, today, acc.id);
  }
  return acc;
}

// === E-Pay Config ===
export function saveEpayConfig(type: string, data: any): void {
  db.prepare('INSERT OR REPLACE INTO epay_config (type, pay_id, display_name, qr_image, link_url, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    type, data.payId || '', data.displayName || '', data.qrImage || '', data.linkUrl || '', Date.now()
  );
}

export function getEpayConfig(type: string): any {
  return db.prepare('SELECT * FROM epay_config WHERE type = ?').get(type);
}

export function getAllEpayConfig(): any[] {
  return db.prepare('SELECT * FROM epay_config').all() as any[];
}

// === Exchange Credentials ===
export function saveExchangeCreds(exchange: string, data: any): void {
  db.prepare('INSERT OR REPLACE INTO exchange_credentials (exchange, email, password_enc, api_key, api_secret_enc, totp_secret_enc, passphrase_enc, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    exchange, data.email || '', data.password ? encrypt(data.password) : '', data.apiKey || '',
    data.apiSecret ? encrypt(data.apiSecret) : '', data.totpSecret ? encrypt(data.totpSecret) : '',
    data.passphrase ? encrypt(data.passphrase) : '', Date.now()
  );
}

export function getExchangeCreds(exchange: string): any {
  const row = db.prepare('SELECT * FROM exchange_credentials WHERE exchange = ?').get(exchange) as any;
  if (!row) return null;
  return { exchange: row.exchange, email: row.email, hasPassword: !!row.password_enc, apiKey: row.api_key, hasApiSecret: !!row.api_secret_enc };
}

// === Wallet Config ===
export function saveWalletConfig(address: string, label: string): void {
  db.prepare('INSERT OR REPLACE INTO wallet_config (id, address, label, updated_at) VALUES (1, ?, ?, ?)').run(address, label, Date.now());
}

export function getWalletConfig(): any {
  return db.prepare('SELECT * FROM wallet_config WHERE id = 1').get();
}

// === Settings ===
export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getSetting(key: string, defaultVal = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row ? row.value : defaultVal;
}


// === Sell Order Support: Add columns ===
try { db.exec(`ALTER TABLE orders ADD COLUMN direction TEXT DEFAULT 'buy'`); } catch {}
try { db.exec(`ALTER TABLE orders ADD COLUMN customer_wallet TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE orders ADD COLUMN customer_bank_info TEXT DEFAULT ''`); } catch {}

// === Sell Orders ===
export function createSellOrder(data: {
  id: string;
  cryptoAmount: number;
  crypto: string;
  rate: number;
  jpyAmount: number;
  customerWallet?: string;
  customerBankInfo: any;
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

export function getSellOrdersAwaitingDeposit(): any[] {
  const rows = db.prepare("SELECT * FROM orders WHERE direction = 'sell' AND status = 'awaiting_deposit' ORDER BY created_at DESC").all() as any[];
  return rows.map(r => ({ ...rowToOrder(r), direction: r.direction, customerWallet: r.customer_wallet, customerBankInfo: JSON.parse(r.customer_bank_info || '{}') }));
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

export function getOrCreateCustomer(telegramId: string): any {
  let customer = db.prepare('SELECT * FROM customers WHERE telegram_id = ?').get(telegramId) as any;
  if (!customer) {
    const code = generateReferralCode();
    db.prepare('INSERT INTO customers (telegram_id, referral_code) VALUES (?, ?)').run(telegramId, code);
    customer = db.prepare('SELECT * FROM customers WHERE telegram_id = ?').get(telegramId) as any;
  }
  return customer;
}

export function applyReferralCode(telegramId: string, code: string): { success: boolean; error?: string } {
  const customer = getOrCreateCustomer(telegramId);
  if (customer.referred_by) return { success: false, error: '既に紹介コードを登録済みです' };
  const referrer = db.prepare('SELECT * FROM customers WHERE referral_code = ?').get(code) as any;
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

export function getCustomerStats(telegramId: string): any {
  const customer = getOrCreateCustomer(telegramId);
  const referralStats = getReferralStats(telegramId);
  return { ...customer, ...referralStats };
}

export function getReferralStats(telegramId: string): { referral_count: number; total_rewards: number } {
  const row = db.prepare('SELECT COUNT(*) as referral_count, COALESCE(SUM(reward_jpy), 0) as total_rewards FROM referral_rewards WHERE referrer_telegram_id = ?').get(telegramId) as any;
  return { referral_count: row.referral_count, total_rewards: row.total_rewards };
}

export function getAllCustomers(): any[] {
  return db.prepare('SELECT * FROM customers ORDER BY total_volume_jpy DESC').all() as any[];
}

export function getAllReferralRewards(): any[] {
  return db.prepare('SELECT * FROM referral_rewards ORDER BY created_at DESC').all() as any[];
}

export function getCustomerByReferralCode(code: string): any {
  return db.prepare('SELECT * FROM customers WHERE referral_code = ?').get(code) as any;
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
  const rows = db.prepare(`SELECT telegram_id FROM notification_preferences WHERE ${col} = 1`).all() as any[];
  return rows.map(r => r.telegram_id);
}

export function setNotificationPreference(telegramId: number, type: string, enabled: boolean): void {
  const col = type === 'daily_summary' ? 'daily_summary' : type === 'spike_alerts' ? 'spike_alerts' : 'weekly_summary';
  db.prepare(`INSERT INTO notification_preferences (telegram_id, ${col}) VALUES (?, ?) ON CONFLICT(telegram_id) DO UPDATE SET ${col} = ?`).run(telegramId, enabled ? 1 : 0, enabled ? 1 : 0);
}

export function getNotificationPreferences(telegramId: number): { daily_summary: boolean; spike_alerts: boolean; weekly_summary: boolean } {
  const row = db.prepare('SELECT * FROM notification_preferences WHERE telegram_id = ?').get(telegramId) as any;
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
  const feeCount = (db.prepare('SELECT COUNT(*) as c FROM fee_settings').get() as any).c;
  if (feeCount === 0) db.prepare('INSERT INTO fee_settings (id) VALUES (1)').run();
} catch {}

try { db.exec(`ALTER TABLE orders ADD COLUMN fee_rate REAL DEFAULT 0.02`); } catch {}
try { db.exec(`ALTER TABLE orders ADD COLUMN fee_jpy REAL DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE orders ADD COLUMN fee_crypto REAL DEFAULT 0`); } catch {}

export function getFeeSettings(): any {
  return db.prepare('SELECT * FROM fee_settings WHERE id = 1').get();
}

export function updateFeeSettings(settings: any): void {
  const allowed = ['base_fee_rate','vip_bronze_rate','vip_silver_rate','vip_gold_rate','vip_platinum_rate'];
  const fields: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(settings)) {
    if (allowed.includes(k)) { fields.push(`${k} = ?`); vals.push(v); }
  }
  fields.push("updated_at = datetime('now')");
  if (vals.length > 0) db.prepare(`UPDATE fee_settings SET ${fields.join(', ')} WHERE id = 1`).run(...vals);
}

export function getFeeRateForRank(rank: string): number {
  const s = getFeeSettings() as any;
  if (!s) return 0.02;
  switch (rank) {
    case 'platinum': return s.vip_platinum_rate;
    case 'gold': return s.vip_gold_rate;
    case 'silver': return s.vip_silver_rate;
    default: return s.vip_bronze_rate;
  }
}

export function getFeeReport(from: string, to: string): any {
  const total = db.prepare(`
    SELECT COALESCE(SUM(fee_jpy),0) as total_fee_jpy, COALESCE(SUM(fee_crypto),0) as total_fee_crypto, COUNT(*) as order_count
    FROM orders WHERE status='completed' AND datetime(created_at/1000,'unixepoch') BETWEEN ? AND ?
  `).get(from, to + ' 23:59:59') as any;
  const byDay = db.prepare(`
    SELECT date(created_at/1000,'unixepoch') as day, COALESCE(SUM(fee_jpy),0) as fee_jpy, COALESCE(SUM(fee_crypto),0) as fee_crypto, COUNT(*) as order_count
    FROM orders WHERE status='completed' AND datetime(created_at/1000,'unixepoch') BETWEEN ? AND ?
    GROUP BY day ORDER BY day DESC
  `).all(from, to + ' 23:59:59') as any[];
  const byCrypto = db.prepare(`
    SELECT crypto, COALESCE(SUM(fee_jpy),0) as fee_jpy, COALESCE(SUM(fee_crypto),0) as fee_crypto, COUNT(*) as order_count
    FROM orders WHERE status='completed' AND datetime(created_at/1000,'unixepoch') BETWEEN ? AND ?
    GROUP BY crypto
  `).all(from, to + ' 23:59:59') as any[];
  return { total, byDay, byCrypto };
}

// Cleanup expired sessions periodically
setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}, 60 * 60 * 1000);


export function changePassword(token: string, currentPassword: string, newPassword: string): boolean {
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as any;
  if (!session) return false;
  const user = db.prepare('SELECT id, password_hash FROM admin_users WHERE id = ?').get(session.user_id) as any;
  if (!user) return false;
  let currentValid = false;
  if (user.password_hash.length === 64) {
    currentValid = legacySha256Hash(currentPassword) === user.password_hash;
  } else {
    currentValid = bcrypt.compareSync(currentPassword, user.password_hash);
  }
  if (!currentValid) return false;
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  return true;
}

export function bulkAddBankAccounts(accounts: any[]): number {
  const insert = db.prepare(`INSERT INTO bank_accounts (bank_name, branch_name, account_type, account_number, account_holder, daily_limit, priority, status, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const transaction = db.transaction((accs: any[]) => {
    let count = 0;
    for (const acc of accs) {
      insert.run(
        acc.bankName, acc.branchName, acc.accountType || '普通', acc.accountNumber, acc.accountHolder,
        acc.dailyLimit || 3000000, acc.priority || 'medium', acc.status || 'active', acc.memo || ''
      );
      count++;
    }
    return count;
  });
  return transaction(accounts);
}

export default db;
