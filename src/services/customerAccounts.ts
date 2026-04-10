/**
 * @file customerAccounts.ts — 顧客アカウントシステム
 * @description 顧客登録/ログイン、残高管理、取引履歴、KYC申請/審査。
 *   admin認証とは別系統で、顧客専用のセッション管理を行う。
 */
import db from './database.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import logger from './logger.js';

// === Schema ===
db.exec(`
  CREATE TABLE IF NOT EXISTS customer_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE,
    email TEXT UNIQUE,
    phone TEXT,
    password_hash TEXT,
    display_name TEXT DEFAULT '',
    kyc_status TEXT DEFAULT 'none',
    kyc_documents TEXT DEFAULT '[]',
    balance_jpy REAL DEFAULT 0,
    balance_usdt REAL DEFAULT 0,
    balance_btc REAL DEFAULT 0,
    balance_eth REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customer_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    currency TEXT NOT NULL,
    amount REAL NOT NULL,
    balance_after REAL DEFAULT 0,
    reference_id TEXT,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id)
  );

  CREATE TABLE IF NOT EXISTS kyc_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    document_type TEXT NOT NULL,
    file_path TEXT,
    status TEXT DEFAULT 'pending',
    reviewed_by INTEGER,
    reviewed_at TEXT,
    rejection_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id)
  );

  CREATE TABLE IF NOT EXISTS customer_sessions (
    token TEXT PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customer_accounts(id)
  );
`);

// === Types ===
export interface CustomerAccount {
  id: number;
  telegram_id: string | null;
  email: string | null;
  phone: string | null;
  display_name: string;
  kyc_status: string;
  balance_jpy: number;
  balance_usdt: number;
  balance_btc: number;
  balance_eth: number;
  status: string;
  created_at: string;
}

export interface CustomerTransaction {
  id: number;
  customer_id: number;
  type: string;
  currency: string;
  amount: number;
  balance_after: number;
  reference_id: string | null;
  description: string;
  created_at: string;
}

export interface KYCSubmission {
  id: number;
  customer_id: number;
  document_type: string;
  file_path: string;
  status: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

// === Registration & Auth ===
export function registerCustomer(data: {
  email?: string;
  password?: string;
  telegramId?: string;
  displayName?: string;
  phone?: string;
}): { success: boolean; customerId?: number; error?: string } {
  if (!data.email && !data.telegramId) {
    return { success: false, error: 'メールアドレスまたはTelegram IDが必要です' };
  }
  if (data.email && !data.password) {
    return { success: false, error: 'パスワードが必要です' };
  }
  try {
    const hash = data.password ? bcrypt.hashSync(data.password, 10) : null;
    const result = db.prepare(
      'INSERT INTO customer_accounts (email, password_hash, telegram_id, display_name, phone) VALUES (?, ?, ?, ?, ?)'
    ).run(
      data.email || null,
      hash,
      data.telegramId || null,
      data.displayName || (data.email ? data.email.split('@')[0] : `User-${data.telegramId}`),
      data.phone || null
    );
    return { success: true, customerId: result.lastInsertRowid as number };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE')) {
      return { success: false, error: '既に登録されたメールアドレスまたはTelegram IDです' };
    }
    return { success: false, error: msg };
  }
}

export function authenticateCustomer(email: string, password: string): { token: string; customerId: number } | null {
  const customer = db.prepare('SELECT id, password_hash FROM customer_accounts WHERE email = ? AND status = ?').get(email, 'active') as { id: number; password_hash: string } | undefined;
  if (!customer || !customer.password_hash) return null;
  if (!bcrypt.compareSync(password, customer.password_hash)) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  db.prepare('INSERT INTO customer_sessions (token, customer_id, expires_at) VALUES (?, ?, ?)').run(token, customer.id, expiresAt);
  return { token, customerId: customer.id };
}

export function validateCustomerSession(token: string): { valid: boolean; customerId?: number } {
  const session = db.prepare('SELECT customer_id FROM customer_sessions WHERE token = ? AND expires_at > ?').get(token, Date.now()) as { customer_id: number } | undefined;
  if (!session) return { valid: false };
  return { valid: true, customerId: session.customer_id };
}

export function deleteCustomerSession(token: string): void {
  db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token);
}

// === Account Management ===
export function getCustomerAccount(id: number): CustomerAccount | null {
  const row = db.prepare('SELECT id, telegram_id, email, phone, display_name, kyc_status, balance_jpy, balance_usdt, balance_btc, balance_eth, status, created_at FROM customer_accounts WHERE id = ?').get(id) as CustomerAccount | undefined;
  return row || null;
}

export function getCustomerByTelegram(telegramId: string): CustomerAccount | null {
  const row = db.prepare('SELECT id, telegram_id, email, phone, display_name, kyc_status, balance_jpy, balance_usdt, balance_btc, balance_eth, status, created_at FROM customer_accounts WHERE telegram_id = ?').get(telegramId) as CustomerAccount | undefined;
  return row || null;
}

export function updateCustomerProfile(id: number, data: { display_name?: string; phone?: string }): boolean {
  const fields: string[] = [];
  const vals: (string | number)[] = [];
  if (data.display_name !== undefined) { fields.push('display_name = ?'); vals.push(data.display_name); }
  if (data.phone !== undefined) { fields.push('phone = ?'); vals.push(data.phone); }
  fields.push("updated_at = datetime('now')");
  vals.push(id);
  return db.prepare(`UPDATE customer_accounts SET ${fields.join(', ')} WHERE id = ?`).run(...vals).changes > 0;
}

// === Balance Management ===
const CURRENCY_COLUMNS: Record<string, string> = {
  JPY: 'balance_jpy',
  USDT: 'balance_usdt',
  BTC: 'balance_btc',
  ETH: 'balance_eth',
};

export function updateBalance(
  customerId: number,
  currency: string,
  amount: number,
  type: string,
  referenceId?: string,
  description?: string
): { success: boolean; newBalance?: number; error?: string } {
  const col = CURRENCY_COLUMNS[currency.toUpperCase()];
  if (!col) return { success: false, error: `Unsupported currency: ${currency}` };

  try {
    let newBalance = 0;
    const updateTx = db.transaction(() => {
      // Atomic balance update using SQL arithmetic — prevents race conditions
      if (amount < 0) {
        // Withdrawal: ensure sufficient funds atomically
        const result = db.prepare(
          `UPDATE customer_accounts SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE id = ? AND ${col} + ? >= 0`
        ).run(amount, customerId, amount);
        if (result.changes === 0) {
          throw new Error('残高不足です');
        }
      } else {
        // Deposit: always succeeds
        const result = db.prepare(
          `UPDATE customer_accounts SET ${col} = ${col} + ?, updated_at = datetime('now') WHERE id = ?`
        ).run(amount, customerId);
        if (result.changes === 0) {
          throw new Error('Account not found');
        }
      }
      // Read the new balance after atomic update
      const row = db.prepare(`SELECT ${col} as balance FROM customer_accounts WHERE id = ?`).get(customerId) as { balance: number };
      newBalance = row.balance;
      db.prepare(
        'INSERT INTO customer_transactions (customer_id, type, currency, amount, balance_after, reference_id, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(customerId, type, currency.toUpperCase(), amount, newBalance, referenceId || null, description || null);
    });
    updateTx();
    return { success: true, newBalance };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function getBalances(customerId: number): Record<string, number> {
  const row = db.prepare('SELECT balance_jpy, balance_usdt, balance_btc, balance_eth FROM customer_accounts WHERE id = ?').get(customerId) as { balance_jpy: number; balance_usdt: number; balance_btc: number; balance_eth: number } | undefined;
  if (!row) return { JPY: 0, USDT: 0, BTC: 0, ETH: 0 };
  return { JPY: row.balance_jpy, USDT: row.balance_usdt, BTC: row.balance_btc, ETH: row.balance_eth };
}

// === Transaction History ===
export function getTransactionHistory(customerId: number, limit: number = 50, offset: number = 0): CustomerTransaction[] {
  return db.prepare(
    'SELECT * FROM customer_transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(customerId, limit, offset) as CustomerTransaction[];
}

export function getTransactionCount(customerId: number): number {
  return (db.prepare('SELECT COUNT(*) as c FROM customer_transactions WHERE customer_id = ?').get(customerId) as { c: number }).c;
}

// === KYC ===
export function submitKYC(customerId: number, documentType: string, filePath: string): { success: boolean; id?: number; error?: string } {
  // Sanitize file path: strip to basename only (prevents directory traversal)
  const sanitized = path.basename(filePath);
  const allowedTypes = ['passport', 'drivers_license', 'national_id', 'residence_card'];
  if (!allowedTypes.includes(documentType)) {
    return { success: false, error: `Invalid document type. Allowed: ${allowedTypes.join(', ')}` };
  }
  const result = db.prepare(
    'INSERT INTO kyc_submissions (customer_id, document_type, file_path) VALUES (?, ?, ?)'
  ).run(customerId, documentType, sanitized);
  db.prepare("UPDATE customer_accounts SET kyc_status = 'pending', updated_at = datetime('now') WHERE id = ?").run(customerId);
  return { success: true, id: result.lastInsertRowid as number };
}

export function reviewKYC(submissionId: number, approved: boolean, reviewedBy: number, rejectionReason?: string): boolean {
  const status = approved ? 'approved' : 'rejected';
  const result = db.prepare(
    "UPDATE kyc_submissions SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), rejection_reason = ? WHERE id = ?"
  ).run(status, reviewedBy, rejectionReason || null, submissionId);

  if (result.changes > 0) {
    const submission = db.prepare('SELECT customer_id FROM kyc_submissions WHERE id = ?').get(submissionId) as { customer_id: number } | undefined;
    if (submission) {
      const newStatus = approved ? 'verified' : 'rejected';
      db.prepare("UPDATE customer_accounts SET kyc_status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, submission.customer_id);
    }
  }
  return result.changes > 0;
}

export function getPendingKYC(): (KYCSubmission & { customer_email: string; customer_name: string })[] {
  return db.prepare(
    "SELECT k.*, c.email as customer_email, c.display_name as customer_name FROM kyc_submissions k JOIN customer_accounts c ON k.customer_id = c.id WHERE k.status = 'pending' ORDER BY k.created_at ASC"
  ).all() as (KYCSubmission & { customer_email: string; customer_name: string })[];
}

export function getKYCStatus(customerId: number): { status: string; submissions: KYCSubmission[] } {
  const account = db.prepare('SELECT kyc_status FROM customer_accounts WHERE id = ?').get(customerId) as { kyc_status: string } | undefined;
  const submissions = db.prepare('SELECT * FROM kyc_submissions WHERE customer_id = ? ORDER BY created_at DESC').all(customerId) as KYCSubmission[];
  return { status: account?.kyc_status || 'none', submissions };
}

// === Admin Functions ===
export function getAllCustomerAccounts(limit: number = 100): CustomerAccount[] {
  return db.prepare('SELECT id, telegram_id, email, phone, display_name, kyc_status, balance_jpy, balance_usdt, balance_btc, balance_eth, status, created_at FROM customer_accounts ORDER BY created_at DESC LIMIT ?').all(limit) as CustomerAccount[];
}

export function suspendCustomer(id: number): boolean {
  return db.prepare("UPDATE customer_accounts SET status = 'suspended', updated_at = datetime('now') WHERE id = ?").run(id).changes > 0;
}

export function activateCustomer(id: number): boolean {
  return db.prepare("UPDATE customer_accounts SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id).changes > 0;
}

// Session cleanup
setInterval(() => {
  db.prepare('DELETE FROM customer_sessions WHERE expires_at < ?').run(Date.now());
}, 60 * 60 * 1000);

logger.info('Customer account system initialized');
