/**
 * @file errorTracker.ts — エラートラッキングサービス
 * @description エラーをDBに記録し、重大エラーをTelegram通知する。
 *   管理画面からエラー履歴を閲覧可能。
 */
import db from './database.js';
import logger from './logger.js';

// === Schema ===
db.exec(`
  CREATE TABLE IF NOT EXISTS error_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    context TEXT,
    source TEXT,
    request_id TEXT,
    count INTEGER DEFAULT 1,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    resolved INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_error_log_last_seen ON error_log(last_seen_at);
  CREATE INDEX IF NOT EXISTS idx_error_log_level ON error_log(level);
`);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '';

// Dedup window: same message within 5 minutes → increment count
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

// Rate limit: max 1 Telegram notification per error per 30 minutes
const notifyCooldown = new Map<string, number>();
const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

interface TrackErrorInput {
  level: 'error' | 'fatal';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  source?: string;
  requestId?: string;
}

export function trackError(input: TrackErrorInput): void {
  const now = Date.now();

  try {
    // Dedup: check if same message was logged recently
    const existing = db.prepare(
      `SELECT id, count FROM error_log WHERE message = ? AND last_seen_at > ? AND resolved = 0 LIMIT 1`
    ).get(input.message, now - DEDUP_WINDOW_MS) as { id: number; count: number } | undefined;

    if (existing) {
      db.prepare('UPDATE error_log SET count = count + 1, last_seen_at = ?, context = ? WHERE id = ?')
        .run(now, input.context ? JSON.stringify(input.context) : null, existing.id);
    } else {
      db.prepare(
        `INSERT INTO error_log (level, message, stack, context, source, request_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        input.level, input.message, input.stack || null,
        input.context ? JSON.stringify(input.context) : null,
        input.source || null, input.requestId || null, now, now
      );
    }
  } catch (e) {
    // Don't recurse — just stderr
    process.stderr.write(`[errorTracker] Failed to write error_log: ${e}\n`);
  }

  // Telegram notification for fatal errors (or first occurrence of errors)
  if (input.level === 'fatal' || !notifyCooldown.has(input.message)) {
    notifyAdmin(input);
  }
}

async function notifyAdmin(input: TrackErrorInput): Promise<void> {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return;

  const key = input.message;
  const lastNotify = notifyCooldown.get(key) || 0;
  if (Date.now() - lastNotify < NOTIFY_COOLDOWN_MS) return;
  notifyCooldown.set(key, Date.now());

  const emoji = input.level === 'fatal' ? '🚨' : '⚠️';
  const text = `${emoji} <b>Pay Match ${input.level.toUpperCase()}</b>\n\n` +
    `<b>Message:</b> ${escapeHtml(input.message.slice(0, 200))}\n` +
    (input.source ? `<b>Source:</b> ${escapeHtml(input.source)}\n` : '') +
    (input.stack ? `<pre>${escapeHtml(input.stack.split('\n').slice(0, 3).join('\n'))}</pre>` : '');

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch {
    // Silently fail — don't create error loops
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// === Query functions for admin API ===

interface ErrorLogRow {
  id: number;
  level: string;
  message: string;
  stack: string | null;
  context: string | null;
  source: string | null;
  request_id: string | null;
  count: number;
  first_seen_at: number;
  last_seen_at: number;
  resolved: number;
}

export function getRecentErrors(limit = 50, includeResolved = false): ErrorLogRow[] {
  const where = includeResolved ? '' : 'WHERE resolved = 0';
  return db.prepare(
    `SELECT * FROM error_log ${where} ORDER BY last_seen_at DESC LIMIT ?`
  ).all(limit) as ErrorLogRow[];
}

export function getErrorStats(): { total: number; unresolved: number; last24h: number; fatal24h: number } {
  const total = (db.prepare('SELECT COUNT(*) as c FROM error_log').get() as { c: number }).c;
  const unresolved = (db.prepare('SELECT COUNT(*) as c FROM error_log WHERE resolved = 0').get() as { c: number }).c;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const last24h = (db.prepare('SELECT COUNT(*) as c FROM error_log WHERE last_seen_at > ?').get(dayAgo) as { c: number }).c;
  const fatal24h = (db.prepare("SELECT COUNT(*) as c FROM error_log WHERE level = 'fatal' AND last_seen_at > ?").get(dayAgo) as { c: number }).c;
  return { total, unresolved, last24h, fatal24h };
}

export function resolveError(id: number): void {
  db.prepare('UPDATE error_log SET resolved = 1 WHERE id = ?').run(id);
}

export function resolveAllErrors(): void {
  db.prepare('UPDATE error_log SET resolved = 1 WHERE resolved = 0').run();
}

// === Hook into logger — intercept error/fatal calls ===
// Override the logger's write function to also track errors
const origWrite = process.stderr.write.bind(process.stderr);
const origStdout = process.stdout.write.bind(process.stdout);

let hooked = false;
export function hookLogger(): void {
  if (hooked) return;
  hooked = true;

  // Intercept stderr (where error/fatal logs go)
  const origStderrWrite = process.stderr.write;
  process.stderr.write = function(chunk: string | Uint8Array, ...args: unknown[]): boolean {
    // Try to parse JSON log lines
    try {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      const trimmed = str.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const entry = JSON.parse(trimmed);
        if (entry.level === 'error' || entry.level === 'fatal') {
          trackError({
            level: entry.level,
            message: entry.msg || entry.message || 'Unknown error',
            stack: entry.stack,
            context: entry,
            source: entry.service,
            requestId: entry.reqId,
          });
        }
      }
    } catch {
      // Not JSON — ignore
    }
    return origStderrWrite.apply(process.stderr, [chunk, ...args] as Parameters<typeof process.stderr.write>);
  } as typeof process.stderr.write;
}
