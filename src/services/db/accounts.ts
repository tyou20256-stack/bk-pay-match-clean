/**
 * @file accounts.ts — Bank accounts, epay config, exchange credentials
 */
import { db } from './connection.js';
import type {
  BankAccountRow, BankAccountInput,
  EpayConfigRow, EpayConfigInput,
  ExchangeCredsInput, ExchangeCredsSummary, ExchangeCredsDecrypted,
  WalletConfigRow,
} from './connection.js';
import { encrypt, decrypt, encryptBankField, decryptBankField } from './encryption.js';

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
