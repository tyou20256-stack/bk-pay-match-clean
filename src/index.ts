/**
 * @file index.ts — エントリーポイント
 * @description Express app作成、ミドルウェア設定、ルートマウント、サーバー起動。
 *   ビジネスロジックは routes/* と bootstrap.ts に委譲。
 */
import express from 'express';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth';
import pagesRouter from './routes/pages';
import apiRouter from './routes/api';
import externalApiRouter from './routes/externalApi';
import { CONFIG } from './config';
import { authRequired, requirePermission, customerAuthRequired, csrfProtection } from './middleware/auth';
import { getHealthAsync, getMetrics, incrementRequests, incrementErrors, observeRequestDuration } from './services/healthService';
import logger, { runWithRequestId, getRequestId } from './services/logger';
import { startServices, shutdownServices, initWebSocket, waitForInflightSends } from './bootstrap';
import { AppError } from './errors.js';

// Ensure proof upload directory exists
import { mkdirSync } from 'fs';
try { mkdirSync(path.join(process.cwd(), 'data', 'proofs'), { recursive: true }); } catch { /* exists */ }

const app = express();
app.disable('x-powered-by');
// Trust proxy headers (Cloudflare → Caddy → Express)
app.set('trust proxy', 2);
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// M6: CORS restricted in ALL environments — no wildcard origin
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ALLOWED_ORIGINS = ['https://bkpay.app'];
if (!IS_PRODUCTION) {
  // In dev/test, also allow localhost variants
  ALLOWED_ORIGINS.push('http://localhost:3003', 'http://127.0.0.1:3003');
}
app.use((_req, res, next) => {
  const reqOrigin = _req.headers.origin;
  if (reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
  } else if (!reqOrigin) {
    // Same-origin requests (no Origin header) — allow with production origin
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (_req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Security headers + CSP nonce generation
app.use((_req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  const connectSrc = IS_PRODUCTION ? "'self' wss:" : "'self' ws: wss:";
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src ${connectSrc}; frame-ancestors 'none'`);
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// HTTPS enforcement in production
if (IS_PRODUCTION) {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto === 'http' && req.path !== '/health') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// CSRF protection for state-changing requests
app.use(csrfProtection);

// Request ID + counting for metrics & correlation
app.use((req, res, next) => {
  incrementRequests();
  runWithRequestId(() => {
    const reqId = getRequestId();
    if (reqId) res.setHeader('X-Request-Id', reqId);
    next();
  });
});

// Request latency histogram — measures wall-clock duration per request
app.use((req, res, next) => {
  const startNs = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
    observeRequestDuration(req.method, req.path, res.statusCode, durationSec);
  });
  next();
});

// Rate limiters
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { success: false, error: 'Too many requests. Please wait.' } });
const customerAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: { success: false, error: 'Too many attempts. Try again later.' } });
const orderMutateLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, error: 'Too many requests' }, standardHeaders: true, legacyHeaders: false });
const publicApiLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { success: false, error: 'Too many requests. Please try again later.' }, standardHeaders: true, legacyHeaders: false });

// --- Mount routes ---

// Auth routes (login, logout, MFA, password change)
app.use('/api/auth', authRouter);

// HTML pages, sitemap, root
app.use(pagesRouter);

// Public static (CSS, JS, images)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Proof images (admin only via auth)
app.use('/proofs', authRequired, express.static(path.join(process.cwd(), 'data', 'proofs')));

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
app.use('/api/withdrawals', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === 'GET' && req.path.startsWith('/by-token/')) return next();
  authRequired(req, res, next);
});

// P2P: /register, /login, /me, /me/orders are public; seller management requires admin auth
app.use('/api/p2p/sellers', (req: express.Request, res: express.Response, next: express.NextFunction) => {
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

// External merchant API (API key auth)
app.use('/api/v1', externalApiRouter);

// Public API routes (rates, pay orders)
app.use('/api/orders', orderLimiter);
app.use('/api', apiRouter);

// --- Infrastructure endpoints ---

// Readiness probe
app.get('/ready', async (_req, res) => {
  try {
    const health = await getHealthAsync();
    if (health.checks.database.status === 'ok') {
      res.json({ ready: true });
    } else {
      res.status(503).json({ ready: false });
    }
  } catch {
    res.status(503).json({ ready: false });
  }
});

// Health check (public, minimal info)
app.get('/health', async (_req, res) => {
  const health = await getHealthAsync();
  const publicHealth = {
    status: health.status,
    timestamp: health.timestamp,
    version: health.version,
  };
  res.status(health.status === 'ok' ? 200 : 503).json(publicHealth);
});

// Prometheus metrics (admin only)
app.get('/metrics', authRequired, async (_req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(await getMetrics());
});

// Structured error handler (AppError subclasses)
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
  }
  incrementErrors();
  logger.error('Unhandled request error', { error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// --- Server startup ---

async function start() {
  await startServices();

  // HTTPS support: set SSL_CERT_PATH and SSL_KEY_PATH env vars
  const sslCert = process.env.SSL_CERT_PATH;
  const sslKey = process.env.SSL_KEY_PATH;
  let server: http.Server | https.Server;

  if (sslCert && sslKey && fs.existsSync(sslCert) && fs.existsSync(sslKey)) {
    const options = {
      cert: fs.readFileSync(sslCert),
      key: fs.readFileSync(sslKey),
    };
    server = https.createServer(options, app);
    logger.info('HTTPS enabled');
  } else {
    server = http.createServer(app);
    if (IS_PRODUCTION) {
      logger.warn('Running without HTTPS in production');
    }
  }

  initWebSocket(server);
  const protocol = server instanceof https.Server ? 'https' : 'http';
  server.listen(CONFIG.port, '0.0.0.0', () => {
    logger.info('Server started', { protocol, port: CONFIG.port, url: `${protocol}://localhost:${CONFIG.port}` });
  });

  // Graceful shutdown handler
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutdown signal received, draining connections', { signal });

    server.close(() => { logger.info('HTTP server closed'); });

    await waitForInflightSends(30_000);
    await shutdownServices();

    logger.info('Shutdown complete');
    process.exit(0);
  }

  function scheduleForceExit() {
    setTimeout(() => {
      logger.error('Forced shutdown after 40s timeout');
      process.exit(1);
    }, 40_000).unref();
  }

  process.on('SIGTERM', () => { scheduleForceExit(); shutdown('SIGTERM'); });
  process.on('SIGINT', () => { scheduleForceExit(); shutdown('SIGINT'); });

  process.on('uncaughtException', (err) => {
    logger.fatal('Uncaught exception', { error: err.message, stack: err.stack });
    scheduleForceExit();
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.fatal('Unhandled rejection', { error: msg, stack });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.fatal(`Port ${CONFIG.port} already in use`, { port: CONFIG.port });
      process.exit(1);
    }
    logger.fatal('Server error', { error: err.message });
    process.exit(1);
  });
}

start();
