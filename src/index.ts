/**
 * @file index.ts — エントリーポイント
 * @description Express app作成、ミドルウェア設定、ルートマウント、サーバー起動。
 *   HTTPスタック、レート制限、認証ガードはそれぞれ middleware/ 配下の
 *   httpStack / rateLimiters / authGuards に分割済み。
 *   ビジネスロジックは routes/* と bootstrap.ts に委譲。
 */
import express from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import authRouter from './routes/auth';
import pagesRouter from './routes/pages';
import apiRouter from './routes/api';
import externalApiRouter from './routes/externalApi';
import { CONFIG } from './config';
import { authRequired } from './middleware/auth';
import { setupHttpStack } from './middleware/httpStack';
import { setupAuthGuards, mountOrderLimiter } from './middleware/authGuards';
import { getHealthAsync, getMetrics, incrementRequests, incrementErrors, observeRequestDuration } from './services/healthService';
import logger, { runWithRequestId, getRequestId } from './services/logger';
import { startServices, shutdownServices, initWebSocket, waitForInflightSends } from './bootstrap';
import { AppError } from './errors.js';

// Ensure proof upload directory exists
import { mkdirSync } from 'fs';
try { mkdirSync(path.join(process.cwd(), 'data', 'proofs'), { recursive: true }); } catch { /* exists */ }

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const app = express();

// Core HTTP middleware: trust-proxy, CORS, body/cookies, security headers, CSRF
setupHttpStack(app);

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

// --- Mount routes ---

// Auth routes (login, logout, MFA, password change)
app.use('/api/auth', authRouter);

// HTML pages, sitemap, root
app.use(pagesRouter);

// Public static (CSS, JS, images)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Proof images (admin only via auth)
app.use('/proofs', authRequired, express.static(path.join(process.cwd(), 'data', 'proofs')));

// Auth + permission guards + rate limiters for /api/*
setupAuthGuards(app);

// External merchant API (API key auth)
app.use('/api/v1', externalApiRouter);

// Public API routes (rates, pay orders) — order limiter then router
mountOrderLimiter(app);
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
