/**
 * @file healthService.ts — ヘルスチェック・メトリクスサービス
 * @description /health エンドポイントのレスポンス生成。
 *   DB接続、メモリ使用量、アップタイム、各サービス状態を返す。
 */
import Database from 'better-sqlite3';
import { resolve } from 'path';
import { isWalletReady, tronCircuitBreaker, getInflightSendCount } from './walletService.js';
import { getErrorStats } from './errorTracker.js';
import { getWebhookDlqStats } from './merchantApiService.js';
import { getMigrationStatus } from './migrationManager.js';

const startTime = Date.now();

interface HealthCheck {
  database: { status: string; latencyMs: number };
  memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
  wallet: { configured: boolean; circuitBreaker: string; inflightSends: number };
  errors: { unresolved: number; last24h: number; fatal24h: number };
  webhookDlq: { pending: number; failed: number };
  migrations: { currentVersion: number; pending: number };
}

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  timestamp: string;
  version: string;
  checks: HealthCheck;
}

export function getHealth(): HealthStatus {
  const dbCheck = checkDatabase();
  const memCheck = getMemoryStats();

  let errorStats = { unresolved: 0, last24h: 0, fatal24h: 0 };
  try { const s = getErrorStats(); errorStats = { unresolved: s.unresolved, last24h: s.last24h, fatal24h: s.fatal24h }; } catch { /* ok */ }

  let dlqStats = { pending: 0, failed: 0 };
  try { const d = getWebhookDlqStats(); dlqStats = { pending: d.pending, failed: d.failed }; } catch { /* ok */ }

  let migrationInfo = { currentVersion: 0, pending: 0 };
  try { const m = getMigrationStatus(); migrationInfo = { currentVersion: m.currentVersion, pending: m.pending.length }; } catch { /* ok */ }

  const cbState = tronCircuitBreaker.getState();
  const inflightSends = getInflightSendCount();

  const checks: HealthCheck = {
    database: dbCheck,
    memory: memCheck,
    wallet: { configured: isWalletReady(), circuitBreaker: cbState, inflightSends },
    errors: errorStats,
    webhookDlq: dlqStats,
    migrations: migrationInfo,
  };

  const dbOk = dbCheck.status === 'ok';
  const cbOk = cbState !== 'OPEN';
  const noFatals = errorStats.fatal24h === 0;

  let status: 'ok' | 'degraded' | 'down' = 'ok';
  if (!dbOk) status = 'down';
  else if (!cbOk || !noFatals || dlqStats.pending > 10) status = 'degraded';

  return {
    status,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    checks,
  };
}

function checkDatabase(): { status: string; latencyMs: number } {
  const start = performance.now();
  try {
    const db = new Database(resolve(process.cwd(), 'data/bkpay.db'), { readonly: true });
    db.prepare('SELECT 1').get();
    db.close();
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { status: 'error', latencyMs: Math.round(performance.now() - start) };
  }
}

function getMemoryStats() {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
  };
}

// Simple request counter for metrics
let requestCount = 0;
let errorCount = 0;
// Tether USDT blacklist check metrics — surfaces the fail-open path
// documented in walletService.isAddressBlacklisted. Alert if
// failOpen rate > 0 in a sustained window.
let blacklistChecks = 0;
let blacklistFailOpens = 0;

export function incrementRequests() { requestCount++; }
export function incrementErrors() { errorCount++; }
export function incrementBlacklistCheck() { blacklistChecks++; }
export function incrementBlacklistFailOpen() { blacklistFailOpens++; }

export async function getMetrics(): Promise<string> {
  const mem = process.memoryUsage();
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const cbStats = tronCircuitBreaker.getStats();
  const inflight = getInflightSendCount();

  let errStats = { unresolved: 0, last24h: 0, fatal24h: 0 };
  try { const s = getErrorStats(); errStats = { unresolved: s.unresolved, last24h: s.last24h, fatal24h: s.fatal24h }; } catch { /* ok */ }

  let dlq = { pending: 0, failed: 0 };
  try { const d = getWebhookDlqStats(); dlq = { pending: d.pending, failed: d.failed }; } catch { /* ok */ }

  const cbStateNum = cbStats.state === 'CLOSED' ? 0 : cbStats.state === 'HALF_OPEN' ? 1 : 2;

  return [
    `# HELP bkpay_uptime_seconds Server uptime in seconds`,
    `# TYPE bkpay_uptime_seconds gauge`,
    `bkpay_uptime_seconds ${uptime}`,
    `# HELP bkpay_requests_total Total HTTP requests`,
    `# TYPE bkpay_requests_total counter`,
    `bkpay_requests_total ${requestCount}`,
    `# HELP bkpay_errors_total Total HTTP errors`,
    `# TYPE bkpay_errors_total counter`,
    `bkpay_errors_total ${errorCount}`,
    `# HELP bkpay_heap_used_bytes Heap memory used`,
    `# TYPE bkpay_heap_used_bytes gauge`,
    `bkpay_heap_used_bytes ${mem.heapUsed}`,
    `# HELP bkpay_rss_bytes Resident set size`,
    `# TYPE bkpay_rss_bytes gauge`,
    `bkpay_rss_bytes ${mem.rss}`,
    `# HELP bkpay_tron_circuit_breaker_state TronWeb circuit breaker state (0=closed 1=half_open 2=open)`,
    `# TYPE bkpay_tron_circuit_breaker_state gauge`,
    `bkpay_tron_circuit_breaker_state ${cbStateNum}`,
    `# HELP bkpay_tron_circuit_breaker_failures TronWeb circuit breaker failure count`,
    `# TYPE bkpay_tron_circuit_breaker_failures gauge`,
    `bkpay_tron_circuit_breaker_failures ${cbStats.failureCount}`,
    `# HELP bkpay_inflight_sends Number of in-flight crypto sends`,
    `# TYPE bkpay_inflight_sends gauge`,
    `bkpay_inflight_sends ${inflight}`,
    `# HELP bkpay_errors_unresolved Unresolved tracked errors`,
    `# TYPE bkpay_errors_unresolved gauge`,
    `bkpay_errors_unresolved ${errStats.unresolved}`,
    `# HELP bkpay_errors_fatal_24h Fatal errors in last 24h`,
    `# TYPE bkpay_errors_fatal_24h gauge`,
    `bkpay_errors_fatal_24h ${errStats.fatal24h}`,
    `# HELP bkpay_webhook_dlq_pending Pending webhook retries in DLQ`,
    `# TYPE bkpay_webhook_dlq_pending gauge`,
    `bkpay_webhook_dlq_pending ${dlq.pending}`,
    `# HELP bkpay_blacklist_checks_total Tether USDT blacklist lookups (cached + fresh)`,
    `# TYPE bkpay_blacklist_checks_total counter`,
    `bkpay_blacklist_checks_total ${blacklistChecks}`,
    `# HELP bkpay_blacklist_fail_open_total Blacklist lookups that fell open due to RPC errors (safety concern if non-zero)`,
    `# TYPE bkpay_blacklist_fail_open_total counter`,
    `bkpay_blacklist_fail_open_total ${blacklistFailOpens}`,
    ...(await getBusinessMetrics()),
  ].join('\n') + '\n';
}

async function getBusinessMetrics(): Promise<string[]> {
  try {
    const db = (await import('./database.js')).default;
    const orderStats = db.prepare("SELECT status, COUNT(*) as c FROM orders GROUP BY status").all() as Array<{status: string; c: number}>;
    const trupayMatchStats = db.prepare("SELECT status, COUNT(*) as c FROM trupay_matches GROUP BY status").all() as Array<{status: string; c: number}>;
    const trupayWdStats = db.prepare("SELECT status, COUNT(*) as c FROM trupay_withdrawals GROUP BY status").all() as Array<{status: string; c: number}>;
    const usdtSent = db.prepare("SELECT COALESCE(SUM(amount_usdt), 0) as total FROM trupay_matches WHERE status = 'completed'").get() as {total: number};

    const lines: string[] = [
      `# HELP bkpay_orders_total Orders by status`,
      `# TYPE bkpay_orders_total gauge`,
    ];
    for (const s of orderStats) {
      lines.push(`bkpay_orders_total{status="${s.status}"} ${s.c}`);
    }
    lines.push(`# HELP bkpay_trupay_matches_total TruPay matches by status`);
    lines.push(`# TYPE bkpay_trupay_matches_total gauge`);
    for (const s of trupayMatchStats) {
      lines.push(`bkpay_trupay_matches_total{status="${s.status}"} ${s.c}`);
    }
    lines.push(`# HELP bkpay_trupay_withdrawals_total TruPay withdrawals by status`);
    lines.push(`# TYPE bkpay_trupay_withdrawals_total gauge`);
    for (const s of trupayWdStats) {
      lines.push(`bkpay_trupay_withdrawals_total{status="${s.status}"} ${s.c}`);
    }
    lines.push(`# HELP bkpay_usdt_sent_amount_total Total USDT sent via TruPay matches`);
    lines.push(`# TYPE bkpay_usdt_sent_amount_total gauge`);
    lines.push(`bkpay_usdt_sent_amount_total ${usdtSent.total}`);
    return lines;
  } catch {
    return [];
  }
}
