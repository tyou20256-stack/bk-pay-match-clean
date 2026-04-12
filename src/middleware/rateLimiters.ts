/**
 * @file rateLimiters.ts — express-rate-limit instances
 * @description Factory + singleton limiters used by the route mounting layer.
 *   Kept separate so limits are tunable and testable in isolation from the
 *   HTTP stack / auth guards.
 */
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';

/** Per-IP cap on general order endpoints. */
export const orderLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many requests. Please wait.' },
});

/** Stricter cap on customer login/register to blunt brute force. */
export const customerAuthLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { success: false, error: 'Too many attempts. Try again later.' },
});

/** Narrow cap on order state-change endpoints (paid, cancel). */
export const orderMutateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Cap on public P2P endpoints (register, buy). */
export const publicApiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
