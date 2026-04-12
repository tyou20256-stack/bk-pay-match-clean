/**
 * @file healthService.ts — ヘルスチェック・メトリクスサービス
 * @description /health エンドポイントのレスポンス生成。
 *   DB接続、メモリ使用量、アップタイム、各サービス状態を返す。
 */
import Database from 'better-sqlite3';
import { resolve } from 'path';
import IORedis from 'ioredis';
import { isWalletReady, tronCircuitBreaker, getInflightSendCount } from './walletService.js';
import { getErrorStats } from './errorTracker.js';
import { getWebhookDlqStats } from './merchantApiService.js';
import { getMigrationStatus } from './migrationManager.js';

const startTime = Date.now();

// Lazy Redis client for health checks (reuses REDIS_URL from env)
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
let redisHealthClient: IORedis | null = null;

function getRedisHealthClient(): IORedis {
  if (redisHealthClient) return redisHealthClient;
  redisHealthClient = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    connectTimeout: 2000,
    lazyConnect: true,
  });
  redisHealthClient.on('error', () => { /* suppress — checked via ping */ });
  return redisHealthClient;
}

interface HealthCheck {
  database: { status: string; latencyMs: number };
  redis: { status: string; latencyMs: number };
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

// Redis status is cached for 5s to avoid hammering on every health check
let cachedRedisStatus: { status: string; latencyMs: number } = { status: 'unknown', latencyMs: 0 };
let redisStatusTimestamp = 0;
const REDIS_CACHE_TTL_MS = 5000;

async function checkRedis(): Promise<{ status: string; latencyMs: number }> {
  const now = Date.now();
  if (now - redisStatusTimestamp < REDIS_CACHE_TTL_MS) return cachedRedisStatus;

  const start = performance.now();
  try {
    const client = getRedisHealthClient();
    if (client.status === 'wait') await client.connect();
    await client.ping();
    cachedRedisStatus = { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch {
    cachedRedisStatus = { status: 'error', latencyMs: Math.round(performance.now() - start) };
  }
  redisStatusTimestamp = now;
  return cachedRedisStatus;
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
    redis: cachedRedisStatus,
    memory: memCheck,
    wallet: { configured: isWalletReady(), circuitBreaker: cbState, inflightSends },
    errors: errorStats,
    webhookDlq: dlqStats,
    migrations: migrationInfo,
  };

  const dbOk = dbCheck.status === 'ok';
  const redisOk = cachedRedisStatus.status !== 'error';
  const cbOk = cbState !== 'OPEN';
  const noFatals = errorStats.fatal24h === 0;

  let status: 'ok' | 'degraded' | 'down' = 'ok';
  if (!dbOk) status = 'down';
  else if (!redisOk || !cbOk || !noFatals || dlqStats.pending > 10) status = 'degraded';

  return {
    status,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    checks,
  };
}

/** Async health check that refreshes Redis status before returning. */
export async function getHealthAsync(): Promise<HealthStatus> {
  await checkRedis();
  return getHealth();
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

// --- Request latency histogram (Prometheus-compatible) ---
// Buckets in seconds — standard Prometheus web request buckets
const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramEntry {
  buckets: number[];  // count per bucket (le)
  sum: number;
  count: number;
}

// Key: "method:normalizedPath:statusCode"
const latencyHistograms = new Map<string, HistogramEntry>();

/** Normalize path to prevent high-cardinality label explosion. */
function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8,}/gi, '/:id')  // hex IDs (UUIDs, mongo IDs)
    .replace(/\/\d+/g, '/:id')             // numeric IDs
    .replace(/\/by-token\/[^/]+/, '/by-token/:token');
}

/** Record a request duration observation into the histogram. */
export function observeRequestDuration(method: string, path: string, statusCode: number, durationSec: number): void {
  const normalizedPath = normalizePath(path);
  const key = `${method}:${normalizedPath}:${statusCode}`;
  let entry = latencyHistograms.get(key);
  if (!entry) {
    entry = { buckets: new Array(HISTOGRAM_BUCKETS.length + 1).fill(0), sum: 0, count: 0 };
    latencyHistograms.set(key, entry);
  }
  entry.sum += durationSec;
  entry.count++;
  for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
    if (durationSec <= HISTOGRAM_BUCKETS[i]) {
      entry.buckets[i]++;
    }
  }
  // +Inf bucket
  entry.buckets[HISTOGRAM_BUCKETS.length]++;
}

/** Render the latency histogram in Prometheus exposition format. */
function renderHistogramMetrics(): string[] {
  const lines: string[] = [
    '# HELP bkpay_http_request_duration_seconds HTTP request duration in seconds',
    '# TYPE bkpay_http_request_duration_seconds histogram',
  ];
  for (const [key, entry] of latencyHistograms) {
    const [method, path, statusCode] = key.split(':');
    const labels = `method="${method}",path="${path}",status_code="${statusCode}"`;
    let cumulative = 0;
    for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
      cumulative += entry.buckets[i];
      lines.push(`bkpay_http_request_duration_seconds_bucket{${labels},le="${HISTOGRAM_BUCKETS[i]}"} ${cumulative}`);
    }
    // +Inf is the total count
    lines.push(`bkpay_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${entry.count}`);
    lines.push(`bkpay_http_request_duration_seconds_sum{${labels}} ${entry.sum.toFixed(6)}`);
    lines.push(`bkpay_http_request_duration_seconds_count{${labels}} ${entry.count}`);
  }
  return lines;
}

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
    ...renderHistogramMetrics(),
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
