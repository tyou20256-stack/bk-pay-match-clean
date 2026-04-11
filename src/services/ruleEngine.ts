/**
 * @file ruleEngine.ts — 自動取引ルールエンジン
 * @description レート/時間/流動性条件に基づく自動取引ルール。
 *   条件評価 → 通知 or 自動売買実行。aggregatorの更新ごとに評価。
 */
import db from './database.js';
import { AggregatedRates } from '../types.js';
import { checkAndRecordUsage } from './tradingLimits.js';
import logger from './logger.js';

// === Schema ===
db.exec(`
  CREATE TABLE IF NOT EXISTS trading_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_by INTEGER,
    rate_conditions TEXT DEFAULT '[]',
    exchange_conditions TEXT DEFAULT '[]',
    time_conditions TEXT DEFAULT '{}',
    liquidity_conditions TEXT DEFAULT '{}',
    condition_logic TEXT DEFAULT 'AND',
    action_type TEXT NOT NULL DEFAULT 'buy',
    action_crypto TEXT DEFAULT 'USDT',
    action_amount INTEGER DEFAULT 0,
    action_exchange TEXT DEFAULT 'auto',
    action_pay_method TEXT DEFAULT 'bank',
    action_mode TEXT DEFAULT 'notify',
    max_per_execution INTEGER DEFAULT 100000,
    max_daily INTEGER DEFAULT 1000000,
    total_executions INTEGER DEFAULT 0,
    total_volume_jpy REAL DEFAULT 0,
    last_triggered_at TEXT,
    last_execution_result TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS rule_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL,
    triggered_at TEXT DEFAULT (datetime('now')),
    conditions_met TEXT,
    action_taken TEXT,
    result TEXT,
    order_id TEXT,
    details TEXT,
    FOREIGN KEY (rule_id) REFERENCES trading_rules(id)
  );
`);

// === Types ===
export interface TradingRule {
  id: number;
  name: string;
  description: string;
  status: string;
  created_by: number | null;
  rate_conditions: RateCondition[];
  exchange_conditions: ExchangeCondition[];
  time_conditions: TimeConditions;
  liquidity_conditions: LiquidityConditions;
  condition_logic: 'AND' | 'OR';
  action_type: 'buy' | 'sell';
  action_crypto: string;
  action_amount: number;
  action_exchange: string;
  action_pay_method: string;
  action_mode: 'notify' | 'execute';
  max_per_execution: number;
  max_daily: number;
  total_executions: number;
  total_volume_jpy: number;
  last_triggered_at: string | null;
  last_execution_result: string | null;
}

interface RateCondition {
  type: 'buy_below' | 'buy_above' | 'sell_below' | 'sell_above' | 'spread_below' | 'spread_above';
  value: number;
  crypto?: string;
  exchange?: string;
}

interface ExchangeCondition {
  exchange: string;
  minCompletion?: number;
  minOrders?: number;
}

interface TimeConditions {
  startHour?: number;
  endHour?: number;
  weekdays?: number[]; // 0=Sun, 1=Mon, ...
  expiresAt?: string | null;
}

interface LiquidityConditions {
  minAvailable?: number;
  crypto?: string;
}

export interface RuleExecution {
  id: number;
  rule_id: number;
  triggered_at: string;
  conditions_met: string;
  action_taken: string;
  result: string;
  order_id: string | null;
  details: string;
}

interface EvalResult {
  passed: boolean;
  matchedConditions: string[];
}

// === CRUD ===
export function createRule(data: Partial<TradingRule>): number {
  const result = db.prepare(`
    INSERT INTO trading_rules (name, description, status, created_by,
      rate_conditions, exchange_conditions, time_conditions, liquidity_conditions,
      condition_logic, action_type, action_crypto, action_amount, action_exchange,
      action_pay_method, action_mode, max_per_execution, max_daily)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.name || 'Unnamed Rule',
    data.description || '',
    data.status || 'active',
    data.created_by || null,
    JSON.stringify(data.rate_conditions || []),
    JSON.stringify(data.exchange_conditions || []),
    JSON.stringify(data.time_conditions || {}),
    JSON.stringify(data.liquidity_conditions || {}),
    data.condition_logic || 'AND',
    data.action_type || 'buy',
    data.action_crypto || 'USDT',
    data.action_amount || 0,
    data.action_exchange || 'auto',
    data.action_pay_method || 'bank',
    data.action_mode || 'notify',
    data.max_per_execution || 100000,
    data.max_daily || 1000000
  );
  return result.lastInsertRowid as number;
}

export function updateRule(id: number, data: Partial<TradingRule>): boolean {
  const fields: string[] = [];
  const vals: (string | number | null)[] = [];
  const allowed: Record<string, string> = {
    name: 'name', description: 'description', status: 'status',
    condition_logic: 'condition_logic', action_type: 'action_type',
    action_crypto: 'action_crypto', action_amount: 'action_amount',
    action_exchange: 'action_exchange', action_pay_method: 'action_pay_method',
    action_mode: 'action_mode', max_per_execution: 'max_per_execution',
    max_daily: 'max_daily',
  };
  for (const [key, col] of Object.entries(allowed)) {
    if ((data as Record<string, unknown>)[key] !== undefined) {
      fields.push(`${col} = ?`);
      vals.push((data as Record<string, unknown>)[key] as string | number | null);
    }
  }
  // JSON fields
  if (data.rate_conditions) { fields.push('rate_conditions = ?'); vals.push(JSON.stringify(data.rate_conditions)); }
  if (data.exchange_conditions) { fields.push('exchange_conditions = ?'); vals.push(JSON.stringify(data.exchange_conditions)); }
  if (data.time_conditions) { fields.push('time_conditions = ?'); vals.push(JSON.stringify(data.time_conditions)); }
  if (data.liquidity_conditions) { fields.push('liquidity_conditions = ?'); vals.push(JSON.stringify(data.liquidity_conditions)); }
  fields.push("updated_at = datetime('now')");
  vals.push(id);
  const result = db.prepare(`UPDATE trading_rules SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
  return result.changes > 0;
}

export function deleteRule(id: number): boolean {
  db.prepare('DELETE FROM rule_executions WHERE rule_id = ?').run(id);
  return db.prepare('DELETE FROM trading_rules WHERE id = ?').run(id).changes > 0;
}

export function getRule(id: number): TradingRule | null {
  const row = db.prepare('SELECT * FROM trading_rules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? parseRuleRow(row) : null;
}

export function getAllRules(): TradingRule[] {
  const rows = db.prepare('SELECT * FROM trading_rules ORDER BY id DESC').all() as Record<string, unknown>[];
  return rows.map(parseRuleRow);
}

export function setRuleStatus(id: number, status: 'active' | 'paused' | 'disabled'): boolean {
  return db.prepare('UPDATE trading_rules SET status = ? WHERE id = ?').run(status, id).changes > 0;
}

function safeJsonParse<T>(str: string, fallback: T): T {
  try { return JSON.parse(str); } catch { return fallback; }
}

function parseRuleRow(row: Record<string, unknown>): TradingRule {
  return {
    ...row,
    rate_conditions: safeJsonParse(String(row.rate_conditions || '[]'), []),
    exchange_conditions: safeJsonParse(String(row.exchange_conditions || '[]'), []),
    time_conditions: safeJsonParse(String(row.time_conditions || '{}'), {}),
    liquidity_conditions: safeJsonParse(String(row.liquidity_conditions || '{}'), {}),
  } as unknown as TradingRule;
}

// === Condition Evaluation ===
function evaluateRateConditions(conditions: RateCondition[], rates: AggregatedRates): { passed: boolean; matched: string[] } {
  const matched: string[] = [];
  for (const cond of conditions) {
    const exchangeRates = cond.exchange
      ? rates.rates.filter(r => r.exchange === cond.exchange)
      : rates.rates;

    let condMet = false;
    for (const er of exchangeRates) {
      switch (cond.type) {
        case 'buy_below':
          if (er.bestBuy && er.bestBuy <= cond.value) { condMet = true; matched.push(`${er.exchange} Buy ¥${er.bestBuy} ≤ ¥${cond.value}`); }
          break;
        case 'buy_above':
          if (er.bestBuy && er.bestBuy >= cond.value) { condMet = true; matched.push(`${er.exchange} Buy ¥${er.bestBuy} ≥ ¥${cond.value}`); }
          break;
        case 'sell_below':
          if (er.bestSell && er.bestSell <= cond.value) { condMet = true; matched.push(`${er.exchange} Sell ¥${er.bestSell} ≤ ¥${cond.value}`); }
          break;
        case 'sell_above':
          if (er.bestSell && er.bestSell >= cond.value) { condMet = true; matched.push(`${er.exchange} Sell ¥${er.bestSell} ≥ ¥${cond.value}`); }
          break;
        case 'spread_below':
          if (er.spread !== null && er.spread <= cond.value) { condMet = true; matched.push(`${er.exchange} Spread ¥${er.spread} ≤ ¥${cond.value}`); }
          break;
        case 'spread_above':
          if (er.spread !== null && er.spread >= cond.value) { condMet = true; matched.push(`${er.exchange} Spread ¥${er.spread} ≥ ¥${cond.value}`); }
          break;
      }
      if (condMet) break;
    }
    if (!condMet) return { passed: false, matched: [] };
  }
  return { passed: conditions.length > 0, matched };
}

function evaluateTimeConditions(conditions: TimeConditions): { passed: boolean; matched: string[] } {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  if (conditions.startHour !== undefined && conditions.endHour !== undefined) {
    if (conditions.startHour <= conditions.endHour) {
      if (hour < conditions.startHour || hour >= conditions.endHour) return { passed: false, matched: [] };
    } else {
      // Overnight range (e.g., 22:00 - 06:00)
      if (hour < conditions.startHour && hour >= conditions.endHour) return { passed: false, matched: [] };
    }
  }
  if (conditions.weekdays && conditions.weekdays.length > 0) {
    if (!conditions.weekdays.includes(day)) return { passed: false, matched: [] };
  }
  if (conditions.expiresAt) {
    if (new Date(conditions.expiresAt) < now) return { passed: false, matched: [] };
  }
  return { passed: true, matched: [`Time OK (${hour}:00, Day ${day})`] };
}

function evaluateLiquidityConditions(conditions: LiquidityConditions, rates: AggregatedRates): { passed: boolean; matched: string[] } {
  if (!conditions.minAvailable) return { passed: true, matched: [] };
  for (const er of rates.rates) {
    // Check buy-side liquidity only
    const orders = er.buyOrders || [];
    const totalAvailable = orders.reduce((sum, o) => sum + o.available * o.price, 0);
    if (totalAvailable >= conditions.minAvailable) {
      return { passed: true, matched: [`${er.exchange}: ¥${Math.round(totalAvailable).toLocaleString()} available`] };
    }
  }
  return { passed: false, matched: [] };
}

function evaluateExchangeConditions(conditions: ExchangeCondition[], rates: AggregatedRates): { passed: boolean; matched: string[] } {
  if (conditions.length === 0) return { passed: true, matched: [] };
  const matched: string[] = [];
  for (const cond of conditions) {
    const er = rates.rates.find(r => r.exchange === cond.exchange);
    if (!er) return { passed: false, matched: [] };
    if (cond.minCompletion) {
      const topMerchant = er.buyOrders[0]?.merchant;
      if (!topMerchant || topMerchant.completionRate < cond.minCompletion) return { passed: false, matched: [] };
      matched.push(`${cond.exchange}: Completion ${topMerchant.completionRate}% ≥ ${cond.minCompletion}%`);
    }
  }
  return { passed: true, matched };
}

export function evaluateRule(rule: TradingRule, rates: AggregatedRates): EvalResult {
  const results: { passed: boolean; matched: string[] }[] = [];

  if (rule.rate_conditions.length > 0) results.push(evaluateRateConditions(rule.rate_conditions, rates));
  if (Object.keys(rule.time_conditions).length > 0) results.push(evaluateTimeConditions(rule.time_conditions));
  if (Object.keys(rule.liquidity_conditions).length > 0) results.push(evaluateLiquidityConditions(rule.liquidity_conditions, rates));
  if (rule.exchange_conditions.length > 0) results.push(evaluateExchangeConditions(rule.exchange_conditions, rates));

  if (results.length === 0) return { passed: false, matchedConditions: [] };

  const allMatched = results.flatMap(r => r.matched);
  if (rule.condition_logic === 'AND') {
    return { passed: results.every(r => r.passed), matchedConditions: allMatched };
  } else {
    return { passed: results.some(r => r.passed), matchedConditions: allMatched };
  }
}

// === Execution ===
function getDailyExecutionVolume(ruleId: number): number {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(
    "SELECT COALESCE(SUM(CAST(json_extract(details, '$.amount') AS REAL)), 0) as vol FROM rule_executions WHERE rule_id = ? AND triggered_at >= ? AND result = 'success'"
  ).get(ruleId, today) as { vol: number } | undefined;
  return row?.vol || 0;
}

export async function executeRule(rule: TradingRule, matchedConditions: string[]): Promise<RuleExecution> {
  const amount = rule.action_amount;

  // Check daily limit for this rule
  const dailyVol = getDailyExecutionVolume(rule.id);
  if (dailyVol + amount > rule.max_daily) {
    return recordExecution(rule.id, matchedConditions, 'skipped', 'skipped', null, { reason: 'Daily rule limit reached', dailyVol, maxDaily: rule.max_daily });
  }

  // Atomic check + record trading limits (prevents TOCTOU race condition)
  const limitCheck = checkAndRecordUsage(amount, rule.created_by ?? undefined, rule.action_exchange !== 'auto' ? rule.action_exchange : undefined);
  if (!limitCheck.allowed) {
    return recordExecution(rule.id, matchedConditions, 'skipped', 'skipped', null, { reason: limitCheck.reason });
  }

  if (rule.action_mode === 'notify') {
    // Just record and notify (notification handled externally)
    return recordExecution(rule.id, matchedConditions, 'notify', 'success', null, { amount, crypto: rule.action_crypto, exchange: rule.action_exchange });
  }

  // Execute mode: create order
  try {
    const orderManager = (await import('./orderManager.js')).default;
    const order = await orderManager.createOrder(amount, rule.action_pay_method, rule.action_crypto);
    if (order) {
      db.prepare('UPDATE trading_rules SET total_executions = total_executions + 1, total_volume_jpy = total_volume_jpy + ?, last_triggered_at = datetime(\'now\'), last_execution_result = ? WHERE id = ?')
        .run(amount, 'success', rule.id);
      return recordExecution(rule.id, matchedConditions, 'execute', 'success', order.id, { amount, orderId: order.id });
    }
    return recordExecution(rule.id, matchedConditions, 'execute', 'failed', null, { reason: 'Order creation failed' });
  } catch (e: unknown) {
    return recordExecution(rule.id, matchedConditions, 'execute', 'failed', null, { error: e instanceof Error ? e.message : String(e) });
  }
}

function recordExecution(ruleId: number, conditions: string[], action: string, result: string, orderId: string | null, details: Record<string, unknown>): RuleExecution {
  const r = db.prepare(
    'INSERT INTO rule_executions (rule_id, conditions_met, action_taken, result, order_id, details) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(ruleId, JSON.stringify(conditions), action, result, orderId, JSON.stringify(details));
  return { id: r.lastInsertRowid as number, rule_id: ruleId, triggered_at: new Date().toISOString(), conditions_met: JSON.stringify(conditions), action_taken: action, result, order_id: orderId, details: JSON.stringify(details) };
}

// === Check All Rules (called after rate updates) ===
let lastCheckTime = 0;
const MIN_CHECK_INTERVAL = 30000; // 30 seconds minimum between checks

export async function checkAllRules(rates?: AggregatedRates): Promise<void> {
  const now = Date.now();
  if (now - lastCheckTime < MIN_CHECK_INTERVAL) return;
  lastCheckTime = now;

  if (!rates) return;

  const rules = db.prepare("SELECT * FROM trading_rules WHERE status = 'active'").all() as Record<string, unknown>[];
  for (const row of rules) {
    try {
      const rule = parseRuleRow(row);
      const evalResult = evaluateRule(rule, rates);
      if (evalResult.passed) {
        await executeRule(rule, evalResult.matchedConditions);
      }
    } catch (e) {
      logger.error('Error evaluating rule', { ruleId: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

// === History ===
export function getRuleExecutions(ruleId: number, limit: number = 50): RuleExecution[] {
  return db.prepare('SELECT * FROM rule_executions WHERE rule_id = ? ORDER BY triggered_at DESC LIMIT ?').all(ruleId, limit) as RuleExecution[];
}

export function getAllExecutions(limit: number = 100): RuleExecution[] {
  return db.prepare('SELECT * FROM rule_executions ORDER BY triggered_at DESC LIMIT ?').all(limit) as RuleExecution[];
}

// === Dry Run (test rule against current rates) ===
export function testRule(ruleId: number, rates: AggregatedRates): { passed: boolean; matchedConditions: string[]; wouldExecute: string } {
  const rule = getRule(ruleId);
  if (!rule) return { passed: false, matchedConditions: [], wouldExecute: 'Rule not found' };
  const result = evaluateRule(rule, rates);
  return {
    passed: result.passed,
    matchedConditions: result.matchedConditions,
    wouldExecute: result.passed ? `Would ${rule.action_mode === 'execute' ? 'execute' : 'notify'}: ${rule.action_type} ¥${rule.action_amount} ${rule.action_crypto}` : 'No action (conditions not met)',
  };
}

logger.info('Auto-trading rule engine initialized');
