/**
 * @file circuitBreaker.ts — サーキットブレーカー
 * @description 外部サービス（TronWeb等）への呼び出しを保護する。
 *   連続失敗でOPENし、一定時間後にHALF-OPENで再試行する。
 */
import logger from './logger.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;  // failures before opening (default: 5)
  resetTimeoutMs?: number;    // ms before attempting half-open (default: 30s)
  halfOpenMax?: number;       // max calls in half-open before closing (default: 1)
}

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMax: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.halfOpenMax = options.halfOpenMax ?? 1;
  }

  getState(): CircuitState {
    if (this.state === 'OPEN') {
      // Check if reset timeout has elapsed → transition to HALF_OPEN
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        logger.info('Circuit breaker HALF_OPEN', { name: this.name });
      }
    }
    return this.state;
  }

  getStats(): { state: CircuitState; failureCount: number; successCount: number; lastFailureTime: number } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Execute a function through the circuit breaker.
   * If the circuit is OPEN, immediately throws without calling fn.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      throw new Error(`Circuit breaker ${this.name} is OPEN — service unavailable`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenMax) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        logger.info('Circuit breaker CLOSED (recovered)', { name: this.name });
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      logger.warn('Circuit breaker OPEN (half-open test failed)', { name: this.name, failureCount: this.failureCount });
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.warn('Circuit breaker OPEN', { name: this.name, failureCount: this.failureCount });
    }
  }

  /** Force reset to closed state (for admin use) */
  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    logger.info('Circuit breaker manually reset', { name: this.name });
  }
}
