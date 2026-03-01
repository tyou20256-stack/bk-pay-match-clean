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
  db.prepare(`INSERT OR REPLACE INTO orders (id, mode, status, amount, crypto, crypto_amount, rate, pay_method, exchange, merchant_name, merchant_completion_rate, payment_info, created_at, expires_at, paid_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    order.id, order.mode, order.status, order.amount, order.crypto, order.cryptoAmount, order.rate,
    order.payMethod, order.exchange, order.merchantName, order.merchantCompletionRate,
    JSON.stringify(order.paymentInfo), order.createdAt, order.expiresAt, order.paidAt || null, order.completedAt || null
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
    expiresAt: row.expires_at, paidAt: row.paid_at, completedAt: row.completed_at
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
