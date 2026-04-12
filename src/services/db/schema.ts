/**
 * @file schema.ts — CREATE TABLE / ALTER TABLE / seed-default statements
 * @description Owns all DDL for the SQLite database. Called once at startup
 *   from connection.ts. Split from connection.ts so lifecycle/PRAGMA logic
 *   is separated from raw schema definition.
 */
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CountRow } from './types.js';

export function applySchema(db: DatabaseType): void {
  // === Core tables ===
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

  // === Seed defaults: auto-trade config ===
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

  // === Seed defaults: wallet thresholds (Hot/Cold separation) ===
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

  // === Safe migrations (idempotent ALTER TABLE) ===
  // admin_users: force password change + MFA columns
  try { db.exec(`ALTER TABLE admin_users ADD COLUMN force_pw_change INTEGER DEFAULT 0`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE admin_users ADD COLUMN mfa_secret TEXT`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE admin_users ADD COLUMN mfa_enabled INTEGER DEFAULT 0`); } catch { /* column may already exist */ }

  // orders: external API columns
  try { db.exec(`ALTER TABLE orders ADD COLUMN merchant_api_key_id INTEGER`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN webhook_url TEXT`); } catch { /* column may already exist */ }
  // orders: P2P seller columns
  try { db.exec(`ALTER TABLE orders ADD COLUMN seller_id INTEGER`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN seller_confirmed_at INTEGER`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN withdrawal_id INTEGER`); } catch { /* column may already exist */ }

  // orders: Sell Order Support
  try { db.exec(`ALTER TABLE orders ADD COLUMN direction TEXT DEFAULT 'buy'`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN customer_wallet TEXT DEFAULT ''`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN customer_bank_info TEXT DEFAULT ''`); } catch { /* column may already exist */ }

  // orders: Crypto Send columns
  try { db.exec(`ALTER TABLE orders ADD COLUMN verified_at INTEGER`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN tx_id TEXT`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN customer_wallet_address TEXT`); } catch { /* column may already exist */ }

  // orders: fee columns
  try { db.exec(`ALTER TABLE orders ADD COLUMN fee_rate REAL DEFAULT 0.02`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN fee_jpy REAL DEFAULT 0`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE orders ADD COLUMN fee_crypto REAL DEFAULT 0`); } catch { /* column may already exist */ }

  // orders: order token
  try { db.exec(`ALTER TABLE orders ADD COLUMN order_token TEXT`); } catch { /* column may already exist */ }

  // sessions: IP/UA/session_type
  try { db.exec(`ALTER TABLE sessions ADD COLUMN ip_address TEXT`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE sessions ADD COLUMN user_agent TEXT`); } catch { /* column may already exist */ }

  // === Crypto Transactions ===
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

  // === Bank Transfers (Phase C: Auto-verification) ===
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

  // === Customers & Referral ===
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

  // profit_records migrations (table defined elsewhere; these are safe if it already exists)
  try { db.exec(`ALTER TABLE profit_records ADD COLUMN total_cost REAL DEFAULT 0`); } catch { /* column may already exist */ }
  try { db.exec(`ALTER TABLE profit_records ADD COLUMN net_profit REAL DEFAULT 0`); } catch { /* column may already exist */ }

  // === TruPay Pending Buyers (DB-backed) ===
  db.exec(`CREATE TABLE IF NOT EXISTS trupay_pending_buyers (
    id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    min_amount_jpy REAL NOT NULL DEFAULT 0,
    max_amount_jpy REAL NOT NULL DEFAULT 0,
    registered_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  )`);
}
