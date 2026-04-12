/**
 * @file authGuards.ts — Mounts auth/permission middleware on protected routes
 * @description Centralises every `app.use('/api/xxx', authRequired)` call so
 *   index.ts doesn't drown in 30+ one-liners. Also mounts the path-conditional
 *   guards for endpoints that mix public and protected sub-paths (withdrawals,
 *   p2p/sellers).
 */
import express, { Express, Request, Response, NextFunction } from 'express';
import { authRequired, requirePermission, customerAuthRequired } from './auth.js';
import {
  orderLimiter,
  customerAuthLimiter,
  orderMutateLimiter,
  publicApiLimiter,
} from './rateLimiters.js';

/**
 * Register all auth/permission guards and rate limiters on the app.
 * Must be called after setupHttpStack() and before mounting routers.
 */
export function setupAuthGuards(app: Express): void {
  // Protected API routes — auth middleware guards
  app.post('/api/refresh', authRequired);
  app.get('/api/orders', authRequired);
  app.post('/api/orders/:id/verify', authRequired);
  app.post('/api/orders/:id/send-crypto', authRequired);
  app.post('/api/orders/:id/manual-complete', authRequired);
  app.post('/api/orders/:id/transfer-failed', authRequired);
  app.use('/api/crypto-transactions', authRequired);
  app.use('/api/bank-transfers', authRequired);
  app.use('/api/accounts', authRequired);
  app.use('/api/epay', authRequired);
  app.use('/api/trader', authRequired);
  app.use('/api/wallet', authRequired);
  app.use('/api/settings', authRequired);
  app.use('/api/reports', authRequired);
  app.use('/api/export', authRequired);
  app.use('/api/fees/settings', authRequired);
  app.use('/api/fees/report', authRequired);
  app.use('/api/spread/config', authRequired);
  app.use('/api/spread/stats', authRequired);
  app.use('/api/spread/recommendation', authRequired);
  app.use('/api/profit', authRequired);
  app.use('/api/exchange-creds', authRequired);

  // RBAC-protected routes
  app.use('/api/admin', requirePermission('users'));
  app.use('/api/limits', requirePermission('limits'));
  app.use('/api/rules', requirePermission('rules'));
  app.use('/api/merchants', authRequired);
  app.use('/api/chat', authRequired);
  app.use('/api/simulator', authRequired);

  // 出金管理: /by-token/ は公開(顧客向けステータス)、それ以外は admin auth
  app.use('/api/withdrawals', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && req.path.startsWith('/by-token/')) return next();
    authRequired(req, res, next);
  });

  // P2P: /register, /login, /me, /me/orders are public; seller management requires admin auth
  app.use('/api/p2p/sellers', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'POST' && req.path === '/register') return next();
    if (req.method === 'POST' && req.path === '/login') return next();
    if (req.method === 'GET' && (req.path === '/me' || req.path === '/me/orders')) return next();
    authRequired(req, res, next);
  });

  app.use('/api/routes', authRequired);
  app.use('/api/prediction', authRequired);
  app.use('/api/auto-trade', authRequired);
  app.use('/api/cost-config', authRequired);
  app.use('/api/errors', authRequired);
  app.use('/api/trupay', authRequired);

  // Rate limiting for public state-changing order endpoints
  app.use('/api/orders/:id/paid', orderMutateLimiter);
  app.use('/api/orders/:id/cancel', orderMutateLimiter);

  // Rate limiting for public P2P endpoints
  app.use('/api/p2p-buy', publicApiLimiter);
  app.use('/api/p2p/sellers/register', publicApiLimiter);

  // Customer auth rate limiting
  app.use('/api/customer/login', customerAuthLimiter);
  app.use('/api/customer/register', customerAuthLimiter);

  // Customer-auth routes
  app.use('/api/customer/profile', customerAuthRequired);
  app.use('/api/customer/balance', customerAuthRequired);
  app.use('/api/customer/transactions', customerAuthRequired);
  app.use('/api/customer/kyc', customerAuthRequired);
}

/** Mount the public-order rate limiter — called after external router but before public api router. */
export function mountOrderLimiter(app: Express): void {
  app.use('/api/orders', orderLimiter);
}

// Re-export so index.ts can keep a single import surface if desired.
export { express };
