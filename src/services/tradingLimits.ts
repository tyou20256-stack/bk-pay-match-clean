/**
 * @file tradingLimits.ts — 取引上限管理
 * @description 取引ごと/日次/週次/月次の上限設定と使用量追跡。
 *   グローバル/ユーザー別/取引所別のスコープに対応。
 */
import db from './database.js';
import logger from './logger.js';

// === Schema ===
db.exec(`
  CREATE TABLE IF NOT EXISTS trading_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'global',
    scope_id TEXT DEFAULT '',
    per_transaction INTEGER DEFAULT 1000000,
    daily_limit INTEGER DEFAULT 10000000,
    weekly_limit INTEGER DEFAULT 50000000,
    monthly_limit INTEGER DEFAULT 200000000,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(scope, scope_id)
  );

  CREATE TABLE IF NOT EXISTS limit_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    scope_id TEXT DEFAULT '',
    period TEXT NOT NULL,
    period_key TEXT NOT NULL,
    used_amount REAL DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(scope, scope_id, period, period_key)
  );
`);

// Insert default global limits if not exists
try {
  const existing = db.prepare("SELECT COUNT(*) as c FROM trading_limits WHERE scope = 'global'").get() as { c: number };
  if (existing.c === 0) {
    db.prepare("INSERT INTO trading_limits (scope, scope_id) VALUES ('global', '')").run();
  }
} catch {}

// === Types ===
export interface TradingLimit {
  id: number;
  scope: string;
  scope_id: string;
  per_transaction: number;
  daily_limit: number;
  weekly_limit: number;
  monthly_limit: number;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: {
    per_transaction: number;
    daily: number;
    weekly: number;
    monthly: number;
  };
}

export interface UsageSummary {
  scope: string;
  scope_id: string;
  daily_used: number;
  daily_limit: number;
  weekly_used: number;
  weekly_limit: number;
  monthly_used: number;
  monthly_limit: number;
  per_transaction: number;
}

// === Period Key Helpers ===
function getDailyKey(): string {
  return new Date().toISOString().slice(0, 10); // 2026-03-03
}

function getWeeklyKey(): string {
  const d = new Date();
  const year = d.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function getMonthlyKey(): string {
  return new Date().toISOString().slice(0, 7); // 2026-03
}

// === CRUD ===
export function getLimits(scope: string = 'global', scopeId: string = ''): TradingLimit | null {
  const row = db.prepare('SELECT * FROM trading_limits WHERE scope = ? AND scope_id = ?').get(scope, scopeId) as TradingLimit | undefined;
  if (row) return row;
  // Fallback to global
  if (scope !== 'global') {
    return db.prepare("SELECT * FROM trading_limits WHERE scope = 'global' AND scope_id = ''").get() as TradingLimit | undefined ?? null;
  }
  return null;
}

export function getAllLimits(): TradingLimit[] {
  return db.prepare('SELECT * FROM trading_limits ORDER BY scope, scope_id').all() as TradingLimit[];
}

export function setLimits(scope: string, scopeId: string, limits: Partial<TradingLimit>): void {
  const existing = db.prepare('SELECT id FROM trading_limits WHERE scope = ? AND scope_id = ?').get(scope, scopeId);
  if (existing) {
    const fields: string[] = [];
    const vals: (string | number)[] = [];
    if (limits.per_transaction !== undefined) { fields.push('per_transaction = ?'); vals.push(limits.per_transaction); }
    if (limits.daily_limit !== undefined) { fields.push('daily_limit = ?'); vals.push(limits.daily_limit); }
    if (limits.weekly_limit !== undefined) { fields.push('weekly_limit = ?'); vals.push(limits.weekly_limit); }
    if (limits.monthly_limit !== undefined) { fields.push('monthly_limit = ?'); vals.push(limits.monthly_limit); }
    fields.push("updated_at = datetime('now')");
    vals.push(scope, scopeId);
    db.prepare(`UPDATE trading_limits SET ${fields.join(', ')} WHERE scope = ? AND scope_id = ?`).run(...vals);
  } else {
    db.prepare(
      'INSERT INTO trading_limits (scope, scope_id, per_transaction, daily_limit, weekly_limit, monthly_limit) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(scope, scopeId, limits.per_transaction ?? 1000000, limits.daily_limit ?? 10000000, limits.weekly_limit ?? 50000000, limits.monthly_limit ?? 200000000);
  }
}

export function deleteLimits(scope: string, scopeId: string): boolean {
  if (scope === 'global' && scopeId === '') return false; // Cannot delete global limits
  const result = db.prepare('DELETE FROM trading_limits WHERE scope = ? AND scope_id = ?').run(scope, scopeId);
  return result.changes > 0;
}

// === Usage Tracking ===
function getUsage(scope: string, scopeId: string, period: string, periodKey: string): number {
  const row = db.prepare(
    'SELECT used_amount FROM limit_usage WHERE scope = ? AND scope_id = ? AND period = ? AND period_key = ?'
  ).get(scope, scopeId, period, periodKey) as { used_amount: number } | undefined;
  return row ? row.used_amount : 0;
}

export function recordUsage(amount: number, userId?: number, exchange?: string): void {
  const dailyKey = getDailyKey();
  const weeklyKey = getWeeklyKey();
  const monthlyKey = getMonthlyKey();

  const scopes = [{ scope: 'global', scopeId: '' }];
  if (userId) scopes.push({ scope: 'user', scopeId: String(userId) });
  if (exchange) scopes.push({ scope: 'exchange', scopeId: exchange });

  const upsert = db.prepare(`
    INSERT INTO limit_usage (scope, scope_id, period, period_key, used_amount)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope, scope_id, period, period_key)
    DO UPDATE SET used_amount = used_amount + ?, updated_at = datetime('now')
  `);

  for (const { scope, scopeId } of scopes) {
    upsert.run(scope, scopeId, 'daily', dailyKey, amount, amount);
    upsert.run(scope, scopeId, 'weekly', weeklyKey, amount, amount);
    upsert.run(scope, scopeId, 'monthly', monthlyKey, amount, amount);
  }
}

// === Atomic Limit Check + Record ===
export function checkAndRecordUsage(amount: number, userId?: number, exchange?: string): LimitCheckResult {
  // Atomic: check + record in a single transaction to prevent race conditions
  const result = db.transaction(() => {
    const limitResult = checkLimit(amount, userId, exchange);
    if (limitResult.allowed) {
      recordUsage(amount, userId ? Number(userId) : undefined, exchange);
    }
    return limitResult;
  })();
  return result;
}

// === Limit Checking ===
export function checkLimit(amount: number, userId?: number, exchange?: string): LimitCheckResult {
  // Check global limits
  const globalCheck = checkScopeLimit(amount, 'global', '');
  if (!globalCheck.allowed) return globalCheck;

  // Check user limits
  if (userId) {
    const userCheck = checkScopeLimit(amount, 'user', String(userId));
    if (!userCheck.allowed) return userCheck;
  }

  // Check exchange limits
  if (exchange) {
    const exchangeCheck = checkScopeLimit(amount, 'exchange', exchange);
    if (!exchangeCheck.allowed) return exchangeCheck;
  }

  return { allowed: true, remaining: globalCheck.remaining };
}

function checkScopeLimit(amount: number, scope: string, scopeId: string): LimitCheckResult {
  const limits = getLimits(scope, scopeId);
  if (!limits) return { allowed: true };

  // Per-transaction check
  if (amount > limits.per_transaction) {
    return { allowed: false, reason: `1回の取引上限(¥${limits.per_transaction.toLocaleString()})を超えています` };
  }

  const dailyUsed = getUsage(scope, scopeId, 'daily', getDailyKey());
  const weeklyUsed = getUsage(scope, scopeId, 'weekly', getWeeklyKey());
  const monthlyUsed = getUsage(scope, scopeId, 'monthly', getMonthlyKey());

  if (dailyUsed + amount > limits.daily_limit) {
    return { allowed: false, reason: `日次上限(¥${limits.daily_limit.toLocaleString()})を超えます。残り: ¥${(limits.daily_limit - dailyUsed).toLocaleString()}` };
  }
  if (weeklyUsed + amount > limits.weekly_limit) {
    return { allowed: false, reason: `週次上限(¥${limits.weekly_limit.toLocaleString()})を超えます` };
  }
  if (monthlyUsed + amount > limits.monthly_limit) {
    return { allowed: false, reason: `月次上限(¥${limits.monthly_limit.toLocaleString()})を超えます` };
  }

  return {
    allowed: true,
    remaining: {
      per_transaction: limits.per_transaction,
      daily: limits.daily_limit - dailyUsed,
      weekly: limits.weekly_limit - weeklyUsed,
      monthly: limits.monthly_limit - monthlyUsed,
    },
  };
}

// === Summary ===
export function getUsageSummary(scope: string = 'global', scopeId: string = ''): UsageSummary {
  const limits = getLimits(scope, scopeId);
  if (!limits) {
    return { scope, scope_id: scopeId, daily_used: 0, daily_limit: 0, weekly_used: 0, weekly_limit: 0, monthly_used: 0, monthly_limit: 0, per_transaction: 0 };
  }
  return {
    scope, scope_id: scopeId,
    daily_used: getUsage(scope, scopeId, 'daily', getDailyKey()),
    daily_limit: limits.daily_limit,
    weekly_used: getUsage(scope, scopeId, 'weekly', getWeeklyKey()),
    weekly_limit: limits.weekly_limit,
    monthly_used: getUsage(scope, scopeId, 'monthly', getMonthlyKey()),
    monthly_limit: limits.monthly_limit,
    per_transaction: limits.per_transaction,
  };
}

// === Cleanup old usage records (keep 90 days) ===
setInterval(() => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    db.prepare("DELETE FROM limit_usage WHERE updated_at < ?").run(cutoff.toISOString());
  } catch {}
}, 24 * 60 * 60 * 1000);

logger.info('Trading limits system initialized');
