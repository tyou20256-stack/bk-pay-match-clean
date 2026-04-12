/**
 * @file migrationManager.ts — DBマイグレーション管理
 * @description バージョン管理されたDBスキーマ変更を安全に適用する。
 *   各マイグレーションは一度だけ実行され、結果が記録される。
 */
import db from './database.js';
import logger from './logger.js';

// === Migration tracking table ===
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    checksum TEXT
  );
`);

interface Migration {
  version: number;
  name: string;
  up: () => void;
}

function getAppliedVersions(): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
  return new Set(rows.map(r => r.version));
}

function markApplied(version: number, name: string): void {
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(version, name, Date.now());
}

/**
 * Safe ALTER TABLE ADD COLUMN — SQLite specific.
 * Does nothing if column already exists.
 */
function safeAddColumn(table: string, column: string, type: string): void {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); } catch { /* already exists */ }
}

// === Migration definitions ===
// Each migration gets a sequential version number. Once deployed, NEVER modify existing migrations.
// To make changes, add a new migration with the next version number.

const migrations: Migration[] = [
  {
    version: 1,
    name: 'admin_users_force_pw_change',
    up() { safeAddColumn('admin_users', 'force_pw_change', 'INTEGER DEFAULT 0'); },
  },
  {
    version: 2,
    name: 'admin_users_mfa',
    up() {
      safeAddColumn('admin_users', 'mfa_secret', 'TEXT');
      safeAddColumn('admin_users', 'mfa_enabled', 'INTEGER DEFAULT 0');
    },
  },
  {
    version: 3,
    name: 'orders_merchant_webhook',
    up() {
      safeAddColumn('orders', 'merchant_api_key_id', 'INTEGER');
      safeAddColumn('orders', 'webhook_url', 'TEXT');
    },
  },
  {
    version: 4,
    name: 'orders_seller_withdrawal',
    up() {
      safeAddColumn('orders', 'seller_id', 'INTEGER');
      safeAddColumn('orders', 'seller_confirmed_at', 'INTEGER');
      safeAddColumn('orders', 'withdrawal_id', 'INTEGER');
    },
  },
  {
    version: 5,
    name: 'orders_direction_wallet',
    up() {
      safeAddColumn('orders', 'direction', "TEXT DEFAULT 'buy'");
      safeAddColumn('orders', 'customer_wallet', "TEXT DEFAULT ''");
      safeAddColumn('orders', 'customer_bank_info', "TEXT DEFAULT ''");
    },
  },
  {
    version: 6,
    name: 'orders_verification',
    up() {
      safeAddColumn('orders', 'verified_at', 'INTEGER');
      safeAddColumn('orders', 'tx_id', 'TEXT');
      safeAddColumn('orders', 'customer_wallet_address', 'TEXT');
    },
  },
  {
    version: 7,
    name: 'orders_fees',
    up() {
      safeAddColumn('orders', 'fee_rate', 'REAL DEFAULT 0.02');
      safeAddColumn('orders', 'fee_jpy', 'REAL DEFAULT 0');
      safeAddColumn('orders', 'fee_crypto', 'REAL DEFAULT 0');
    },
  },
  {
    version: 8,
    name: 'profit_records_cost_tracking',
    up() {
      safeAddColumn('profit_records', 'total_cost', 'REAL DEFAULT 0');
      safeAddColumn('profit_records', 'net_profit', 'REAL DEFAULT 0');
    },
  },
  {
    version: 9,
    name: 'trupay_withdrawals_table',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS trupay_withdrawals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trupay_id INTEGER UNIQUE NOT NULL,
          system_transaction_id TEXT NOT NULL,
          transaction_id TEXT NOT NULL,
          amount_jpy REAL NOT NULL,
          bank_name TEXT NOT NULL,
          branch_name TEXT DEFAULT '',
          account_number TEXT NOT NULL,
          account_name TEXT NOT NULL,
          account_type TEXT DEFAULT 'savings',
          trupay_status INTEGER NOT NULL DEFAULT 31,
          status TEXT NOT NULL DEFAULT 'queued',
          matched_at INTEGER,
          completed_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_trupay_withdrawals_status ON trupay_withdrawals(status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_trupay_withdrawals_trupay_id ON trupay_withdrawals(trupay_id)`);
    },
  },
  {
    version: 10,
    name: 'trupay_matches_table',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS trupay_matches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          withdrawal_id INTEGER NOT NULL REFERENCES trupay_withdrawals(id),
          buyer_id TEXT NOT NULL,
          buyer_wallet TEXT NOT NULL,
          rate_jpy_usdt REAL NOT NULL,
          amount_jpy REAL NOT NULL,
          amount_usdt REAL NOT NULL,
          timeout_at INTEGER NOT NULL,
          reference_number TEXT,
          usdt_tx_hash TEXT,
          status TEXT NOT NULL DEFAULT 'waiting_transfer',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_trupay_matches_status ON trupay_matches(status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_trupay_matches_withdrawal_id ON trupay_matches(withdrawal_id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_trupay_matches_buyer_id ON trupay_matches(buyer_id)`);
    },
  },
  {
    version: 14,
    name: 'trupay_matches_proof_image',
    up() {
      try { db.exec(`ALTER TABLE trupay_matches ADD COLUMN proof_image TEXT`); } catch { /* column may already exist */ }
    },
  },
  {
    version: 15,
    name: 'trupay_matches_proof_analysis',
    up() {
      try { db.exec(`ALTER TABLE trupay_matches ADD COLUMN proof_score INTEGER`); } catch { /* exists */ }
      try { db.exec(`ALTER TABLE trupay_matches ADD COLUMN proof_analysis TEXT`); } catch { /* exists */ }
    },
  },
  {
    version: 17,
    name: 'referral_tables',
    up() {
      db.exec(`CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_code TEXT UNIQUE NOT NULL,
        referrer_type TEXT NOT NULL DEFAULT 'web',
        referrer_id TEXT NOT NULL,
        total_referrals INTEGER DEFAULT 0,
        total_volume_jpy REAL DEFAULT 0,
        total_reward_usdt REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS referral_conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referral_code TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        match_id INTEGER,
        amount_jpy REAL DEFAULT 0,
        reward_usdt REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_code ON referrals(referrer_code)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_referral_conv_code ON referral_conversions(referral_code)`);
    },
  },
  {
    version: 18,
    name: 'migrate_cbc_to_gcm',
    up() {
      // Re-encrypt any CBC data to GCM
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { encrypt, decrypt } = require('./database.js');
      const bankRows = db.prepare('SELECT id, account_number, account_holder FROM bank_accounts').all() as { id: number; account_number: string; account_holder: string }[];
      for (const row of bankRows) {
        try {
          if (row.account_number && row.account_number.includes(':') && !row.account_number.includes(':gcm:') && !row.account_number.startsWith('gcm:')) {
            const plain = decrypt(row.account_number);
            if (plain && plain !== '[DECRYPTION_FAILED]') {
              const reEncrypted = encrypt(plain);
              db.prepare('UPDATE bank_accounts SET account_number = ? WHERE id = ?').run(reEncrypted, row.id);
            }
          }
          if (row.account_holder && row.account_holder.includes(':') && !row.account_holder.includes(':gcm:') && !row.account_holder.startsWith('gcm:')) {
            const plain = decrypt(row.account_holder);
            if (plain && plain !== '[DECRYPTION_FAILED]') {
              const reEncrypted = encrypt(plain);
              db.prepare('UPDATE bank_accounts SET account_holder = ? WHERE id = ?').run(reEncrypted, row.id);
            }
          }
        } catch { /* skip failed records */ }
      }
      // Re-encrypt exchange_credentials encrypted fields
      const credRows = db.prepare('SELECT exchange, password_enc, api_key, api_secret_enc, totp_secret_enc, passphrase_enc FROM exchange_credentials').all() as { exchange: string; password_enc: string; api_key: string; api_secret_enc: string; totp_secret_enc: string; passphrase_enc: string }[];
      for (const row of credRows) {
        try {
          const updates: string[] = [];
          const vals: string[] = [];
          for (const field of ['password_enc', 'api_key', 'api_secret_enc', 'totp_secret_enc', 'passphrase_enc'] as const) {
            const val = row[field];
            if (val && val.includes(':') && !val.startsWith('gcm:')) {
              const plain = decrypt(val);
              if (plain && plain !== '[DECRYPTION_FAILED]') {
                updates.push(`${field} = ?`);
                vals.push(encrypt(plain));
              }
            }
          }
          if (updates.length > 0) {
            vals.push(row.exchange);
            db.prepare(`UPDATE exchange_credentials SET ${updates.join(', ')} WHERE exchange = ?`).run(...vals);
          }
        } catch { /* skip failed records */ }
      }
      logger.info('CBC to GCM migration completed');
    },
  },
  {
    version: 19,
    name: 'order_token',
    up() {
      try { db.exec('ALTER TABLE orders ADD COLUMN order_token TEXT'); } catch { /* exists */ }
    },
  },
  {
    version: 20,
    name: 'session_binding',
    up() {
      try { db.exec('ALTER TABLE sessions ADD COLUMN ip_address TEXT'); } catch { /* exists */ }
      try { db.exec('ALTER TABLE sessions ADD COLUMN user_agent TEXT'); } catch { /* exists */ }
    },
  },
  {
    version: 21,
    name: 'referral_tier2',
    up() {
      try { db.exec('ALTER TABLE referrals ADD COLUMN parent_code TEXT'); } catch { /* exists */ }
      try { db.exec('ALTER TABLE referrals ADD COLUMN tier2_reward_usdt REAL DEFAULT 0'); } catch { /* exists */ }
    },
  },
  {
    version: 22,
    name: 'rate_alerts',
    up() {
      db.exec(`CREATE TABLE IF NOT EXISTS rate_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        target_rate REAL NOT NULL,
        direction TEXT NOT NULL DEFAULT 'below',
        crypto TEXT NOT NULL DEFAULT 'USDT',
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        triggered_at INTEGER
      )`);
    },
  },
  {
    version: 23,
    name: 'funnel_events',
    up() {
      db.exec(`CREATE TABLE IF NOT EXISTS funnel_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        data TEXT,
        ref_code TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_funnel_event ON funnel_events(event)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_funnel_date ON funnel_events(created_at)');
    },
  },
  {
    version: 24,
    name: 'paypay_conversion',
    up() {
      db.exec(`CREATE TABLE IF NOT EXISTS paypay_conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id TEXT NOT NULL,
        requester_type TEXT NOT NULL DEFAULT 'lite_to_money',
        amount INTEGER NOT NULL,
        fee_rate REAL NOT NULL DEFAULT 0.05,
        fee_amount INTEGER NOT NULL DEFAULT 0,
        payout_amount INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'waiting',
        matched_with INTEGER,
        requester_paypay_id TEXT,
        provider_paypay_id TEXT,
        requester_proof TEXT,
        provider_proof TEXT,
        requester_proof_score INTEGER DEFAULT 0,
        provider_proof_score INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        matched_at INTEGER,
        completed_at INTEGER,
        timeout_at INTEGER
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS paypay_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT UNIQUE NOT NULL,
        provider_type TEXT NOT NULL DEFAULT 'money',
        paypay_id TEXT NOT NULL,
        min_amount INTEGER NOT NULL DEFAULT 1000,
        max_amount INTEGER NOT NULL DEFAULT 500000,
        fee_rate REAL NOT NULL DEFAULT 0.05,
        status TEXT NOT NULL DEFAULT 'active',
        registered_at INTEGER NOT NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_paypay_conv_status ON paypay_conversions(status)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_paypay_prov_status ON paypay_providers(status)');
    },
  },
  {
    version: 25,
    name: 'wallet_config',
    up() {
      db.exec(`CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        encrypted INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`);
    },
  },
  {
    version: 26,
    name: 'hot_path_indexes',
    up() {
      // Core indexes for every WHERE clause hit on the hot path.
      // Addresses the Performance audit finding that every operational
      // table had ZERO indexes, causing full table scans on every API
      // request. Expected latency improvement at 50k rows: 200ms → <5ms
      // per query.
      //
      // Defensive: production databases may have schema drift — some
      // tables were created before certain columns existed. We verify
      // both the table AND each referenced column exist before creating
      // the index, so the migration never aborts on drift.
      const tableExists = (name: string): boolean => {
        const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) as { [k: string]: unknown } | undefined;
        return !!row;
      };
      const columnsOf = (table: string): Set<string> => {
        if (!tableExists(table)) return new Set();
        const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        return new Set(rows.map((r) => r.name));
      };
      const safeIndex = (indexName: string, table: string, columns: string[]) => {
        const existing = columnsOf(table);
        if (existing.size === 0) {
          logger.warn('Skipping index — table missing', { indexName, table });
          return;
        }
        const missing = columns.filter((c) => !existing.has(c));
        if (missing.length > 0) {
          logger.warn('Skipping index — columns missing', { indexName, table, missing });
          return;
        }
        db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${table}(${columns.join(', ')})`);
      };

      safeIndex('idx_orders_status_created', 'orders', ['status', 'created_at']);
      safeIndex('idx_orders_direction_status', 'orders', ['direction', 'status']);
      safeIndex('idx_orders_created', 'orders', ['created_at']);
      safeIndex('idx_orders_seller', 'orders', ['seller_id']);
      safeIndex('idx_orders_expires', 'orders', ['expires_at']);

      safeIndex('idx_sessions_expires', 'sessions', ['expires_at']);
      safeIndex('idx_sessions_user', 'sessions', ['user_id']);

      safeIndex('idx_withdrawals_status_amount', 'withdrawals', ['status', 'amount', 'pay_method']);
      safeIndex('idx_withdrawals_tracking', 'withdrawals', ['tracking_token']);
      safeIndex('idx_withdrawals_created', 'withdrawals', ['created_at']);

      safeIndex('idx_p2p_sellers_status', 'p2p_sellers', ['status']);
      safeIndex('idx_p2p_sellers_email', 'p2p_sellers', ['email']);
      safeIndex('idx_p2p_sellers_token', 'p2p_sellers', ['confirm_token']);

      safeIndex('idx_trupay_wd_trupay_id', 'trupay_withdrawals', ['trupay_id']);
      safeIndex('idx_trupay_wd_status', 'trupay_withdrawals', ['status', 'created_at']);

      safeIndex('idx_trupay_matches_status', 'trupay_matches', ['status', 'created_at']);
      safeIndex('idx_trupay_matches_withdrawal', 'trupay_matches', ['withdrawal_id']);
      safeIndex('idx_trupay_matches_buyer', 'trupay_matches', ['buyer_id']);

      safeIndex('idx_crypto_tx_order', 'crypto_transactions', ['order_id', 'created_at']);
      safeIndex('idx_crypto_tx_txid', 'crypto_transactions', ['tx_id']);

      safeIndex('idx_bank_transfers_status', 'bank_transfers', ['status', 'created_at']);
      safeIndex('idx_bank_transfers_order', 'bank_transfers', ['order_id']);

      safeIndex('idx_customers_email', 'customers', ['email']);

      safeIndex('idx_exchange_orders_order', 'exchange_orders', ['order_id']);
    },
  },
  {
    version: 27,
    name: 'session_type_column',
    up() {
      // M3: Store session type ('admin' | 'customer') explicitly in DB
      // instead of inferring from user_agent string parsing
      safeAddColumn('sessions', 'session_type', "TEXT DEFAULT 'admin'");
    },
  },
  {
    version: 28,
    name: 'migrate_gcm_v1_to_v2',
    up() {
      // L2: Re-encrypt GCM v1 (100k iterations) data to GCM v2 (600k iterations)
      // Also picks up any remaining CBC data from v18
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { encrypt, decrypt } = require('./database.js');
      const reEncryptField = (val: string): string | null => {
        if (!val || val.startsWith('gcm2:')) return null; // already v2
        if (val.startsWith('gcm:') || /^[0-9a-f]+:[0-9a-f]+$/i.test(val)) {
          const plain = decrypt(val);
          if (plain && plain !== '[DECRYPTION_FAILED]') return encrypt(plain);
        }
        return null;
      };
      // Re-encrypt bank_accounts
      try {
        const bankRows = db.prepare('SELECT id, account_number, account_holder FROM bank_accounts').all() as { id: number; account_number: string; account_holder: string }[];
        for (const row of bankRows) {
          try {
            const newAccNum = reEncryptField(row.account_number);
            const newAccHolder = reEncryptField(row.account_holder);
            if (newAccNum) db.prepare('UPDATE bank_accounts SET account_number = ? WHERE id = ?').run(newAccNum, row.id);
            if (newAccHolder) db.prepare('UPDATE bank_accounts SET account_holder = ? WHERE id = ?').run(newAccHolder, row.id);
          } catch { /* skip failed records */ }
        }
      } catch { /* table may not exist */ }
      // Re-encrypt exchange_credentials
      try {
        const credRows = db.prepare('SELECT exchange, password_enc, api_key, api_secret_enc, totp_secret_enc, passphrase_enc FROM exchange_credentials').all() as { exchange: string; password_enc: string; api_key: string; api_secret_enc: string; totp_secret_enc: string; passphrase_enc: string }[];
        for (const row of credRows) {
          try {
            const updates: string[] = [];
            const vals: string[] = [];
            for (const field of ['password_enc', 'api_key', 'api_secret_enc', 'totp_secret_enc', 'passphrase_enc'] as const) {
              const newVal = reEncryptField(row[field]);
              if (newVal) { updates.push(`${field} = ?`); vals.push(newVal); }
            }
            if (updates.length > 0) {
              vals.push(row.exchange);
              db.prepare(`UPDATE exchange_credentials SET ${updates.join(', ')} WHERE exchange = ?`).run(...vals);
            }
          } catch { /* skip failed records */ }
        }
      } catch { /* table may not exist */ }
      // Re-encrypt MFA secrets
      try {
        const mfaRows = db.prepare('SELECT id, mfa_secret FROM admin_users WHERE mfa_secret IS NOT NULL').all() as { id: number; mfa_secret: string }[];
        for (const row of mfaRows) {
          try {
            const newVal = reEncryptField(row.mfa_secret);
            if (newVal) db.prepare('UPDATE admin_users SET mfa_secret = ? WHERE id = ?').run(newVal, row.id);
          } catch { /* skip failed records */ }
        }
      } catch { /* table may not exist */ }
      logger.info('GCM v1 to v2 migration completed (600k PBKDF2 iterations)');
    },
  },
];

/**
 * Run all pending migrations in order.
 * Called once at startup.
 */
export function runMigrations(): { applied: number; total: number } {
  const appliedVersions = getAppliedVersions();
  let appliedCount = 0;

  // Sort by version to ensure order
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  for (const migration of sorted) {
    if (appliedVersions.has(migration.version)) continue;

    try {
      logger.info('Running migration', { version: migration.version, name: migration.name });
      migration.up();
      markApplied(migration.version, migration.name);
      appliedCount++;
      logger.info('Migration applied', { version: migration.version, name: migration.name });
    } catch (e) {
      logger.error('Migration failed', {
        version: migration.version,
        name: migration.name,
        error: e instanceof Error ? e.message : String(e),
      });
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { applied: appliedCount, total: sorted.length };
}

/**
 * Get migration status for admin API.
 */
export function getMigrationStatus(): { applied: { version: number; name: string; applied_at: number }[]; pending: { version: number; name: string }[]; currentVersion: number } {
  const appliedVersions = getAppliedVersions();
  const appliedRows = db.prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version').all() as { version: number; name: string; applied_at: number }[];
  const pending = migrations.filter(m => !appliedVersions.has(m.version)).map(m => ({ version: m.version, name: m.name }));
  const currentVersion = appliedRows.length > 0 ? appliedRows[appliedRows.length - 1].version : 0;
  return { applied: appliedRows, pending, currentVersion };
}
