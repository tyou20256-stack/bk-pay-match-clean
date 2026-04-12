/**
 * @file httpStack.ts — HTTP middleware stack setup
 * @description Applies the foundational HTTP middleware in the canonical order:
 *   trust-proxy → CORS (allowlist) → body parsing → cookies → security headers
 *   + CSP nonce → HTTPS enforcement (prod) → CSRF protection. Kept separate
 *   from index.ts so the entrypoint is just orchestration.
 */
import crypto from 'crypto';
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { csrfProtection } from './auth.js';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Install foundational HTTP middleware. Order matters — do not rearrange.
 */
export function setupHttpStack(app: Express): void {
  app.disable('x-powered-by');
  // Trust proxy headers (Cloudflare → Caddy → Express)
  app.set('trust proxy', 2);
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  // M6: CORS restricted in ALL environments — no wildcard origin
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
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src ${connectSrc}; frame-ancestors 'none'`
    );
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
}
