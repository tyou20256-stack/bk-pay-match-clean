/**
 * @file merchantApiService.ts — 外部マーチャントAPI キー管理・Webhook送信
 * @description 外部決済システムが bk-pay-match に接続するための API キー発行・検証と
 *   注文完了時の Webhook 通知（HMAC-SHA256 署名付き）を提供する。
 */
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import logger from './logger.js';
import db from './database.js';
import {
  createMerchantApiKey,
  getMerchantApiKeyByHash,
  listMerchantApiKeys,
  revokeMerchantApiKey,
  touchMerchantApiKey,
} from './database.js';
import * as dbSvc from './database.js';

// === Webhook Dead-Letter Queue ===
db.exec(`
  CREATE TABLE IF NOT EXISTS webhook_dlq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_url TEXT NOT NULL,
    webhook_secret TEXT,
    payload TEXT NOT NULL,
    error TEXT,
    attempts INTEGER DEFAULT 3,
    next_retry_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    resolved INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_webhook_dlq_retry ON webhook_dlq(next_retry_at, resolved);
`);

export interface MerchantApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  webhookUrl: string | null;
  webhookSecret: string | null;
  isActive: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface GeneratedKey {
  rawKey: string;    // 1回だけ表示する生キー
  keyPrefix: string; // 表示用 prefix (8文字)
  id: number;
}

// ── APIキー生成 ────────────────────────────────────────────────
export function generateApiKey(name: string, webhookUrl?: string): GeneratedKey {
  const rawKey = 'bkpay_sk_live_' + crypto.randomBytes(24).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 22) + '...'; // 'bkpay_sk_live_XXXXXXXX...'
  const webhookSecret = webhookUrl ? crypto.randomBytes(20).toString('hex') : undefined;

  const id = createMerchantApiKey(name, keyHash, keyPrefix, webhookUrl, webhookSecret);
  return { rawKey, keyPrefix, id };
}

// ── APIキー検証 ────────────────────────────────────────────────
export function verifyApiKey(rawKey: string): MerchantApiKey | null {
  if (!rawKey || !rawKey.startsWith('bkpay_sk_live_')) return null;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const row = getMerchantApiKeyByHash(keyHash);
  if (!row) return null;

  // Timing-safe verification: compare computed hash with stored hash
  const storedHash = row.key_hash;
  if (keyHash.length !== storedHash.length ||
      !crypto.timingSafeEqual(Buffer.from(keyHash), Buffer.from(storedHash))) {
    return null;
  }

  touchMerchantApiKey(row.id);
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    webhookUrl: row.webhook_url || null,
    webhookSecret: row.webhook_secret || null,
    isActive: !!row.is_active,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
  };
}

// ── APIキー一覧・失効 ──────────────────────────────────────────
export function listKeys() {
  return listMerchantApiKeys();
}

export function revokeKey(id: number): boolean {
  return revokeMerchantApiKey(id);
}

// ── SSRF保護: プライベートIPへのWebhook送信を拒否 ───────────────
import dns from 'dns';
import { promisify } from 'util';
const dnsLookup = promisify(dns.lookup);

function isPrivateIP(ip: string): boolean {
  // IPv4 private ranges
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 127) return true; // 127.0.0.0/8 (loopback)
    if (parts[0] === 169 && parts[1] === 254) return true; // 169.254.0.0/16 (link-local)
    if (parts[0] === 0) return true; // 0.0.0.0/8
  }
  // IPv6 loopback and link-local
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return false;
}

async function validateWebhookUrl(webhookUrl: string): Promise<void> {
  const url = new URL(webhookUrl);
  // Require HTTPS in production
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS in production');
  }
  // DNS resolve and check for private IPs
  try {
    const result = await dnsLookup(url.hostname);
    if (isPrivateIP(result.address)) {
      throw new Error(`Webhook URL resolves to private IP (${result.address}) — blocked for SSRF protection`);
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('SSRF')) throw e;
    throw new Error(`Cannot resolve webhook hostname: ${url.hostname}`);
  }
}

// ── Webhook 送信 ───────────────────────────────────────────────
export async function sendWebhook(
  webhookUrl: string,
  webhookSecret: string | null,
  payload: Record<string, any>,
  attempt = 1
): Promise<void> {
  // SSRF protection: validate URL on first attempt
  if (attempt === 1) {
    await validateWebhookUrl(webhookUrl);
  }

  const body = JSON.stringify(payload);
  const signature = webhookSecret
    ? 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(body).digest('hex')
    : undefined;

  const url = new URL(webhookUrl);
  const isHttps = url.protocol === 'https:';
  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'BKPayMatch-Webhook/1.0',
      ...(signature ? { 'X-BKPay-Signature': signature } : {}),
    },
  };

  const transport = isHttps ? https : http;

  await new Promise<void>((resolve, reject) => {
    const req = transport.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
        resolve();
      } else {
        reject(new Error(`Webhook HTTP ${res.statusCode}`));
      }
      res.resume();
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Webhook timeout')); });
    req.write(body);
    req.end();
  }).catch(async (err) => {
    if (attempt < 3) {
      // 指数バックオフ: 5s, 25s
      await new Promise(r => setTimeout(r, 5_000 * attempt));
      return sendWebhook(webhookUrl, webhookSecret, payload, attempt + 1);
    }
    logger.error('Webhook failed after retries', { attempts: attempt, error: err.message });
    // Persist to Dead-Letter Queue for later retry
    try {
      const nextRetry = Date.now() + 5 * 60 * 1000; // 5 minutes from now
      db.prepare(
        'INSERT INTO webhook_dlq (webhook_url, webhook_secret, payload, error, attempts, next_retry_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(webhookUrl, webhookSecret || null, JSON.stringify(payload), err.message, attempt, nextRetry, Date.now());
    } catch { /* don't fail on DLQ insert */ }
  });
}

// === DLQ Retry Processing ===
const MAX_DLQ_ATTEMPTS = 10;
const DLQ_BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 min base

interface DlqRow {
  id: number;
  webhook_url: string;
  webhook_secret: string | null;
  payload: string;
  attempts: number;
  next_retry_at: number;
}

async function processDlqBatch(): Promise<number> {
  const now = Date.now();
  const rows = db.prepare(
    'SELECT id, webhook_url, webhook_secret, payload, attempts FROM webhook_dlq WHERE resolved = 0 AND next_retry_at <= ? LIMIT 10'
  ).all(now) as DlqRow[];

  let processed = 0;
  for (const row of rows) {
    if (row.attempts >= MAX_DLQ_ATTEMPTS) {
      db.prepare('UPDATE webhook_dlq SET resolved = 1, error = ? WHERE id = ?').run('max attempts exceeded', row.id);
      processed++;
      continue;
    }

    try {
      const payload = JSON.parse(row.payload);
      await validateWebhookUrl(row.webhook_url);

      const body = JSON.stringify(payload);
      const signature = row.webhook_secret
        ? 'sha256=' + crypto.createHmac('sha256', row.webhook_secret).update(body).digest('hex')
        : undefined;

      const url = new URL(row.webhook_url);
      const isHttps = url.protocol === 'https:';
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'BKPayMatch-Webhook/1.0',
          ...(signature ? { 'X-BKPay-Signature': signature } : {}),
        },
      };

      const transport = isHttps ? https : http;

      await new Promise<void>((resolve, reject) => {
        const req = transport.request(options, (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve();
          else reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
        });
        req.on('error', reject);
        req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(body);
        req.end();
      });

      // Success — resolve the DLQ entry
      db.prepare('UPDATE webhook_dlq SET resolved = 1 WHERE id = ?').run(row.id);
      logger.info('DLQ webhook retry succeeded', { id: row.id, url: row.webhook_url });
    } catch (e) {
      // Failed — schedule next retry with exponential backoff
      const nextAttempts = row.attempts + 1;
      const backoff = DLQ_BACKOFF_BASE_MS * Math.pow(2, nextAttempts - 3); // exponential from attempt 3
      const nextRetry = now + Math.min(backoff, 60 * 60 * 1000); // cap at 1 hour
      db.prepare('UPDATE webhook_dlq SET attempts = ?, next_retry_at = ?, error = ? WHERE id = ?')
        .run(nextAttempts, nextRetry, e instanceof Error ? e.message : String(e), row.id);
    }
    processed++;
  }
  return processed;
}

let dlqIntervalId: ReturnType<typeof setInterval> | null = null;

export function startWebhookDlqProcessor(): void {
  if (dlqIntervalId) return;
  dlqIntervalId = setInterval(() => {
    processDlqBatch().catch(e => logger.error('DLQ processing error', { error: e instanceof Error ? e.message : String(e) }));
  }, 60_000); // Check every minute
  logger.info('Webhook DLQ processor started');
}

export function stopWebhookDlqProcessor(): void {
  if (dlqIntervalId) { clearInterval(dlqIntervalId); dlqIntervalId = null; }
}

export function getWebhookDlqStats(): { pending: number; resolved: number; failed: number } {
  const pending = (db.prepare('SELECT COUNT(*) as c FROM webhook_dlq WHERE resolved = 0 AND attempts < ?').get(MAX_DLQ_ATTEMPTS) as { c: number }).c;
  const resolved = (db.prepare('SELECT COUNT(*) as c FROM webhook_dlq WHERE resolved = 1').get() as { c: number }).c;
  const failed = (db.prepare('SELECT COUNT(*) as c FROM webhook_dlq WHERE resolved = 1 AND error = ?').get('max attempts exceeded') as { c: number }).c;
  return { pending, resolved, failed };
}

// ── 出金イベント Webhook ──────────────────────────────────────
export async function notifyWithdrawalEvent(
  withdrawal: dbSvc.WithdrawalData,
  webhookSecret: string | null,
  event: 'withdrawal.payment_sent' | 'withdrawal.completed' | 'withdrawal.cancelled',
  extra?: Record<string, unknown>
): Promise<void> {
  if (!withdrawal.webhookUrl) return;
  const payload: Record<string, unknown> = {
    event,
    withdrawalId: withdrawal.id,
    externalRef: withdrawal.externalRef || null,
    status: withdrawal.status,
    amount: withdrawal.amount,
    payMethod: withdrawal.payMethod,
    timestamp: Date.now(),
    ...extra,
  };
  await sendWebhook(withdrawal.webhookUrl as string, webhookSecret, payload);
}

// ── 注文完了 Webhook ───────────────────────────────────────────
export async function notifyOrderCompleted(order: Record<string, unknown>, webhookSecret: string | null): Promise<void> {
  if (!order.webhookUrl) return;
  const payload: Record<string, unknown> = {
    event: 'order.completed',
    orderId: order.id,
    status: order.status,
    amount: order.amount,
    crypto: order.crypto,
    cryptoAmount: order.cryptoAmount,
    txId: order.txId || null,
    customerWalletAddress: order.customerWalletAddress || null,
    completedAt: order.completedAt || Date.now(),
    timestamp: Date.now(),
  };
  await sendWebhook(order.webhookUrl as string, webhookSecret, payload);
}
