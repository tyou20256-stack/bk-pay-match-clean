/**
 * @file errors.ts — Structured error types
 * @description Application-specific error classes for consistent error handling.
 *   Each error carries a machine-readable code, human-readable message, and HTTP status.
 */

export class AppError extends Error {
  constructor(public code: string, message: string, public statusCode: number = 400) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) { super('VALIDATION_ERROR', message, 400); }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Unauthorized') { super('AUTH_ERROR', message, 401); }
}

export class NotFoundError extends AppError {
  constructor(resource: string) { super('NOT_FOUND', `${resource} not found`, 404); }
}

export class RateLimitError extends AppError {
  constructor() { super('RATE_LIMIT', 'Too many requests', 429); }
}

export class TronNetworkError extends AppError {
  constructor(message: string) { super('TRON_ERROR', message, 502); }
}

export class TruPayApiError extends AppError {
  constructor(message: string, public trupayStatus?: number) { super('TRUPAY_ERROR', message, 502); }
}

export class ProofAnalysisError extends AppError {
  constructor(message: string) { super('PROOF_ERROR', message, 500); }
}
