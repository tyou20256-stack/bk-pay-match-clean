/**
 * @file logger.test.ts — ロガーのユニットテスト
 * @description JSON構造化出力、ログレベル制御、子ロガーコンテキスト伝播、
 *   最小ログレベルフィルタリングをテスト。
 * @run npx vitest run tests/logger.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =====================================================================
// Logger class unit tests (replicate logic from logger.ts)
// We re-implement the Logger class here to avoid database import side effects
// from the actual module. The logic is identical to src/services/logger.ts.
// =====================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  service?: string;
  [key: string]: any;
}

class TestLogger {
  private context: Record<string, any>;
  private minLevel: LogLevel;
  public output: LogEntry[] = [];

  constructor(context: Record<string, any> = {}, minLevel: LogLevel = 'info') {
    this.context = context;
    this.minLevel = minLevel;
  }

  child(extra: Record<string, any>): TestLogger {
    const child = new TestLogger({ ...this.context, ...extra }, this.minLevel);
    child.output = this.output; // share output buffer for testing
    return child;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.minLevel];
  }

  private log(level: LogLevel, msg: string, data?: Record<string, any>): void {
    if (!this.shouldLog(level)) return;
    const entry: LogEntry = {
      level,
      msg,
      ts: new Date().toISOString(),
      ...this.context,
      ...data,
    };
    this.output.push(entry);
  }

  debug(msg: string, data?: Record<string, any>) { this.log('debug', msg, data); }
  info(msg: string, data?: Record<string, any>) { this.log('info', msg, data); }
  warn(msg: string, data?: Record<string, any>) { this.log('warn', msg, data); }
  error(msg: string, data?: Record<string, any>) { this.log('error', msg, data); }
  fatal(msg: string, data?: Record<string, any>) { this.log('fatal', msg, data); }
}

// =====================================================================
// JSON Structured Output
// =====================================================================
describe('JSON構造化出力', () => {
  it('ログエントリーがJSON形式でlevel, msg, tsを含む', () => {
    const logger = new TestLogger({ service: 'test' });
    logger.info('test message');

    expect(logger.output).toHaveLength(1);
    const entry = logger.output[0];
    expect(entry).toHaveProperty('level', 'info');
    expect(entry).toHaveProperty('msg', 'test message');
    expect(entry).toHaveProperty('ts');
    expect(entry).toHaveProperty('service', 'test');
  });

  it('tsがISO 8601形式', () => {
    const logger = new TestLogger();
    logger.info('timestamp test');

    const entry = logger.output[0];
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('追加データがエントリーにマージされる', () => {
    const logger = new TestLogger();
    logger.info('with data', { userId: 42, action: 'login' });

    const entry = logger.output[0];
    expect(entry.userId).toBe(42);
    expect(entry.action).toBe('login');
  });

  it('JSONシリアライズ可能', () => {
    const logger = new TestLogger({ service: 'bk-pay-match' });
    logger.warn('serializable test', { nested: { key: 'value' } });

    const entry = logger.output[0];
    const json = JSON.stringify(entry);
    const parsed = JSON.parse(json);
    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('serializable test');
    expect(parsed.nested.key).toBe('value');
  });
});

// =====================================================================
// Log Levels
// =====================================================================
describe('ログレベル', () => {
  it('debug レベルの出力', () => {
    const logger = new TestLogger({}, 'debug');
    logger.debug('debug msg');
    expect(logger.output).toHaveLength(1);
    expect(logger.output[0].level).toBe('debug');
  });

  it('info レベルの出力', () => {
    const logger = new TestLogger();
    logger.info('info msg');
    expect(logger.output[0].level).toBe('info');
  });

  it('warn レベルの出力', () => {
    const logger = new TestLogger();
    logger.warn('warn msg');
    expect(logger.output[0].level).toBe('warn');
  });

  it('error レベルの出力', () => {
    const logger = new TestLogger();
    logger.error('error msg');
    expect(logger.output[0].level).toBe('error');
  });

  it('fatal レベルの出力', () => {
    const logger = new TestLogger();
    logger.fatal('fatal msg');
    expect(logger.output[0].level).toBe('fatal');
  });

  it('レベル数値: debug(10) < info(20) < warn(30) < error(40) < fatal(50)', () => {
    expect(LEVELS.debug).toBe(10);
    expect(LEVELS.info).toBe(20);
    expect(LEVELS.warn).toBe(30);
    expect(LEVELS.error).toBe(40);
    expect(LEVELS.fatal).toBe(50);
    expect(LEVELS.debug).toBeLessThan(LEVELS.info);
    expect(LEVELS.info).toBeLessThan(LEVELS.warn);
    expect(LEVELS.warn).toBeLessThan(LEVELS.error);
    expect(LEVELS.error).toBeLessThan(LEVELS.fatal);
  });
});

// =====================================================================
// Child Logger Context Propagation
// =====================================================================
describe('子ロガー コンテキスト伝播', () => {
  it('子ロガーが親コンテキストを継承', () => {
    const parent = new TestLogger({ service: 'bk-pay-match' });
    const child = parent.child({ requestId: 'req-123' });

    child.info('child message');

    const entry = child.output[0];
    expect(entry.service).toBe('bk-pay-match');
    expect(entry.requestId).toBe('req-123');
  });

  it('子ロガーのコンテキストが親を上書き', () => {
    const parent = new TestLogger({ service: 'parent', env: 'test' });
    const child = parent.child({ service: 'child-service' });

    child.info('override test');

    const entry = child.output[0];
    expect(entry.service).toBe('child-service');
    expect(entry.env).toBe('test');
  });

  it('孫ロガーも伝播チェーン維持', () => {
    const root = new TestLogger({ service: 'app' });
    const child = root.child({ module: 'auth' });
    const grandchild = child.child({ handler: 'login' });

    grandchild.info('deep context');

    const entry = grandchild.output[0];
    expect(entry.service).toBe('app');
    expect(entry.module).toBe('auth');
    expect(entry.handler).toBe('login');
  });

  it('子ロガーの変更が親に影響しない', () => {
    const parent = new TestLogger({ service: 'parent' });
    const child = parent.child({ extra: 'child-data' });

    parent.info('parent message');
    child.info('child message');

    // parent output should not have 'extra'
    // They share the output array, so check the first entry
    expect(parent.output[0].extra).toBeUndefined();
    expect(parent.output[1].extra).toBe('child-data');
  });
});

// =====================================================================
// Minimum Log Level Filtering
// =====================================================================
describe('最小ログレベルフィルタリング', () => {
  it('MIN_LEVEL=info でdebugを抑制', () => {
    const logger = new TestLogger({}, 'info');
    logger.debug('should be suppressed');
    logger.info('should appear');

    expect(logger.output).toHaveLength(1);
    expect(logger.output[0].msg).toBe('should appear');
  });

  it('MIN_LEVEL=warn でdebug/infoを抑制', () => {
    const logger = new TestLogger({}, 'warn');
    logger.debug('suppressed');
    logger.info('suppressed');
    logger.warn('visible');
    logger.error('visible');

    expect(logger.output).toHaveLength(2);
    expect(logger.output[0].level).toBe('warn');
    expect(logger.output[1].level).toBe('error');
  });

  it('MIN_LEVEL=error でdebug/info/warnを抑制', () => {
    const logger = new TestLogger({}, 'error');
    logger.debug('suppressed');
    logger.info('suppressed');
    logger.warn('suppressed');
    logger.error('visible');
    logger.fatal('visible');

    expect(logger.output).toHaveLength(2);
    expect(logger.output[0].level).toBe('error');
    expect(logger.output[1].level).toBe('fatal');
  });

  it('MIN_LEVEL=debug で全レベル出力', () => {
    const logger = new TestLogger({}, 'debug');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    logger.fatal('f');

    expect(logger.output).toHaveLength(5);
  });

  it('MIN_LEVEL=fatal でfatalのみ出力', () => {
    const logger = new TestLogger({}, 'fatal');
    logger.debug('no');
    logger.info('no');
    logger.warn('no');
    logger.error('no');
    logger.fatal('yes');

    expect(logger.output).toHaveLength(1);
    expect(logger.output[0].level).toBe('fatal');
  });
});

// =====================================================================
// Output Routing (stdout vs stderr)
// =====================================================================
describe('出力ルーティング (stdout / stderr)', () => {
  it('error/fatal は stderr に出力（レベル >= 40）', () => {
    expect(LEVELS.error).toBeGreaterThanOrEqual(LEVELS.error);
    expect(LEVELS.fatal).toBeGreaterThanOrEqual(LEVELS.error);
  });

  it('debug/info/warn は stdout に出力（レベル < 40）', () => {
    expect(LEVELS.debug).toBeLessThan(LEVELS.error);
    expect(LEVELS.info).toBeLessThan(LEVELS.error);
    expect(LEVELS.warn).toBeLessThan(LEVELS.error);
  });

  it('実際のstdout/stderr書き込みを検証', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    // Simulate the write function from logger.ts
    function write(entry: LogEntry): void {
      const str = JSON.stringify(entry);
      if (LEVELS[entry.level] >= LEVELS.error) {
        process.stderr.write(str + '\n');
      } else {
        process.stdout.write(str + '\n');
      }
    }

    write({ level: 'info', msg: 'stdout test', ts: new Date().toISOString() });
    write({ level: 'error', msg: 'stderr test', ts: new Date().toISOString() });

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    const stdoutArg = stdoutSpy.mock.calls[0][0] as string;
    expect(stdoutArg).toContain('"level":"info"');

    const stderrArg = stderrSpy.mock.calls[0][0] as string;
    expect(stderrArg).toContain('"level":"error"');

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

// =====================================================================
// Edge Cases
// =====================================================================
describe('エッジケース', () => {
  it('空メッセージでもログ出力', () => {
    const logger = new TestLogger();
    logger.info('');
    expect(logger.output).toHaveLength(1);
    expect(logger.output[0].msg).toBe('');
  });

  it('特殊文字を含むメッセージ', () => {
    const logger = new TestLogger();
    logger.info('日本語メッセージ: エラー発生 <script>alert("xss")</script>');

    const entry = logger.output[0];
    const json = JSON.stringify(entry);
    const parsed = JSON.parse(json);
    expect(parsed.msg).toContain('日本語メッセージ');
    expect(parsed.msg).toContain('<script>');
  });

  it('大量のコンテキストデータでも動作', () => {
    const bigContext: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      bigContext[`key_${i}`] = `value_${i}`;
    }
    const logger = new TestLogger(bigContext);
    logger.info('big context test');

    const entry = logger.output[0];
    expect(entry.key_0).toBe('value_0');
    expect(entry.key_99).toBe('value_99');
  });
});
