/**
 * @file logger.ts — 構造化ログモジュール
 * @description JSON形式の構造化ログを出力する軽量ロガー。
 *   外部依存なし。ログレベル制御、子ロガー、リクエストID追跡をサポート。
 *   出力はJSON Lines形式で、Grafana Loki / ELK / CloudWatch等で解析可能。
 *   AsyncLocalStorageによるリクエスト相関ID自動付与。
 */
import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

const MIN_LEVEL = (process.env.LOG_LEVEL as LogLevel) || 'info';

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  service?: string;
  reqId?: string;
  [key: string]: unknown;
}

// AsyncLocalStorage for per-request context (request ID)
interface RequestContext {
  reqId: string;
  [key: string]: unknown;
}
const requestStore = new AsyncLocalStorage<RequestContext>();

export function runWithRequestId<T>(fn: () => T, reqId?: string): T {
  const id = reqId || crypto.randomBytes(8).toString('hex');
  return requestStore.run({ reqId: id }, fn);
}

export function getRequestId(): string | undefined {
  return requestStore.getStore()?.reqId;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[MIN_LEVEL];
}

function write(entry: LogEntry): void {
  const str = JSON.stringify(entry);
  if (LEVELS[entry.level] >= LEVELS.error) {
    process.stderr.write(str + '\n');
  } else {
    process.stdout.write(str + '\n');
  }
}

class Logger {
  private context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}) {
    this.context = context;
  }

  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...extra });
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;
    const reqId = getRequestId();
    write({
      level,
      msg,
      ts: new Date().toISOString(),
      ...(reqId ? { reqId } : {}),
      ...this.context,
      ...data,
    });
  }

  debug(msg: string, data?: Record<string, unknown>) { this.log('debug', msg, data); }
  info(msg: string, data?: Record<string, unknown>) { this.log('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>) { this.log('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>) { this.log('error', msg, data); }
  fatal(msg: string, data?: Record<string, unknown>) { this.log('fatal', msg, data); }
}

const logger = new Logger({ service: 'bk-pay-match' });
export default logger;
export { Logger };
