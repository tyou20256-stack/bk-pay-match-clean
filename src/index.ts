/**
 * @file index.ts — エントリーポイント
 * @description Expressサーバーの初期化、認証ルート、ミドルウェア設定、
 *   レート更新スケジューラー、TronMonitorの起動を行う。
 *   公開/保護ルートの境界もここで定義。
 */
import express from 'express';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { startMonitor } from './services/tronMonitor.js';
import { startTelegramBot } from './services/telegramBot.js';
import { initFreezeDetector } from './services/freezeDetector.js';
import { startAlerts } from './services/alertService.js';
import { startTxConfirmPolling, stopTxConfirmPolling } from './services/txConfirmService.js';
import { startPriceNotifier } from './services/priceNotifier.js';
import { startVerifier as startBankVerifier } from './services/bankVerifier.js';
import apiRouter from './routes/api';
import externalApiRouter from './routes/externalApi';
import { updateAllCryptos } from './services/aggregator';
import { CONFIG } from './config';
import { authRequired, requirePermission, customerAuthRequired, csrfProtection, setCsrfCookie } from './middleware/auth';
import { authenticateUser, verifyMfaAndLogin, setupMfa, enableMfa, disableMfa, getMfaStatus, verifyUserPassword, deleteSession, deleteAllUserSessions, getSessionUserId, validateSession, changePassword, recordAuditLog } from './services/database';
import { validateCustomerSession } from './services/customerAccounts';
import { initWebSocket, closeWebSocket } from './services/websocket';
import { startPolling as startAutoTradePolling, stopPolling as stopAutoTradePolling } from './services/autoTradeService';
import { startAutoSweep, stopAutoSweep, waitForInflightSends } from './services/walletService';
import { startTruPayPoller, stopTruPayPoller } from './services/trupayPoller';
import { startTruPayMatcher, stopTruPayMatcher } from './services/trupayMatcher';
import { startTruPayVerifier, stopTruPayVerifier } from './services/trupayVerifier';
import { startTokenRefresh, stopTokenRefresh } from './services/trupayClient';
import { startMarketingBot, stopMarketingBot } from './services/marketingBot';
import { startDiscordWebhook, stopDiscordWebhook } from './services/discordWebhook';
import { generateSeoPages, getSeoPageSlugs } from './services/seoGenerator';
import { generateDailyReport } from './services/rateReportGenerator.js';
import { getHealth, getMetrics, incrementRequests, incrementErrors } from './services/healthService';
import { startWebhookDlqProcessor, stopWebhookDlqProcessor } from './services/merchantApiService';
import logger, { runWithRequestId, getRequestId } from './services/logger';
import { hookLogger } from './services/errorTracker';
import { runMigrations } from './services/migrationManager';
import { closeDatabase } from './services/database';
import {
  isJobQueueEnabled,
  shouldRunUsdtSendWorker,
  startUsdtSendWorker,
  startQueueEventMonitoring,
  stopQueueEventMonitoring,
  closeQueues,
} from './queues';
import { sendUSDT } from './services/walletService';
import { AppError } from './errors.js';

// Ensure proof upload directory exists
import { mkdirSync } from 'fs';
try { mkdirSync(path.join(process.cwd(), 'data', 'proofs'), { recursive: true }); } catch { /* exists */ }

const app = express();
app.disable('x-powered-by');
// Trust proxy headers (Cloudflare → Caddy → Express)
// Required for secure cookies and correct req.protocol behind reverse proxy
app.set('trust proxy', 2);
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// CORS: restrict to own origin in production
app.use((_req, res, next) => {
  const origin = IS_PRODUCTION ? 'https://bkpay.app' : '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (_req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Security headers
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
app.use((_req, res, next) => {
  // Generate per-request nonce for CSP
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // Deprecated header — rely on CSP instead
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // CSP: nonce-based script-src (no unsafe-inline)
  const connectSrc = IS_PRODUCTION ? "'self' wss:" : "'self' ws: wss:";
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src ${connectSrc}; frame-ancestors 'none'`);
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// HTTPS enforcement in production — redirect HTTP to HTTPS
if (IS_PRODUCTION) {
  app.use((req, res, next) => {
    // Trust X-Forwarded-Proto from reverse proxy (Nginx, ALB, etc.)
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto === 'http' && req.path !== '/health') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Cookie options (secure in production)
const COOKIE_OPTS = { httpOnly: true, sameSite: 'strict' as const, secure: IS_PRODUCTION };

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

// A5: Rate limiting
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { success: false, error: 'Too many login attempts. Try again later.' } });
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { success: false, error: 'Too many requests. Please wait.' } });
const customerAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, message: { success: false, error: 'Too many attempts. Try again later.' } });
const orderMutateLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, error: 'Too many requests' }, standardHeaders: true, legacyHeaders: false });
const publicApiLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { success: false, error: 'Too many requests. Please try again later.' }, standardHeaders: true, legacyHeaders: false });


// Auth routes (no auth required)
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip || req.socket.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';
  const result = authenticateUser(username, password, ip, ua);
  if (!result) {
    recordAuditLog({ action: 'login_failed', details: `username=${username}`, ipAddress: ip });
    return res.json({ success: false, error: 'Invalid credentials' });
  }
  if (result.mfaRequired) {
    recordAuditLog({ userId: result.userId, username, action: 'login_mfa_pending', ipAddress: ip });
    return res.json({ success: true, mfaRequired: true, mfaPendingToken: result.token });
  }
  recordAuditLog({ userId: result.userId, username, action: 'login', ipAddress: ip });
  res.cookie('bkpay_token', result.token, { ...COOKIE_OPTS, maxAge: 24*60*60*1000 });
  const csrfToken = setCsrfCookie(res);
  // Body also returns the token for non-browser clients (tests, external
  // API consumers, mobile apps) that use Authorization: Bearer instead of
  // cookies. The Bearer path is exempt from CSRF checks (see
  // src/middleware/auth.ts:42) so these clients don't need the csrfToken.
  // Browser clients continue to use the httpOnly cookie + CSRF header
  // combination and can ignore the body token field.
  res.json({
    success: true,
    forcePasswordChange: result.forcePasswordChange,
    csrfToken,
    token: result.token,
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (token) {
    const userId = getSessionUserId(token);
    if (userId) {
      recordAuditLog({ userId, action: 'logout', ipAddress: req.ip || '' });
      deleteAllUserSessions(userId);
    } else {
      deleteSession(token);
    }
  }
  res.clearCookie('bkpay_token');
  res.json({ success: true });
});

// A4: Password change
app.post('/api/auth/change-password', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.json({ success: false, error: 'Both passwords required' });
  if (newPassword.length < 12) return res.json({ success: false, error: 'Password must be at least 12 characters' });
  if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*()_+\-=\[\]{};:'"\\|,.<>\/?]/.test(newPassword)) {
    return res.json({ success: false, error: 'Password must contain letters, numbers, and special characters' });
  }
  // Check against common passwords
  const commonPasswords = ['password123!', 'admin12345!', 'qwerty12345!', 'P@ssw0rd123', 'Passw0rd!23'];
  if (commonPasswords.some(p => newPassword.toLowerCase() === p.toLowerCase())) {
    return res.json({ success: false, error: 'This password is too common' });
  }
  // Get user from session
  const userId = getSessionUserId(token);
  const changed = changePassword(token, currentPassword, newPassword);
  if (!changed) return res.json({ success: false, error: 'Current password incorrect' });
  recordAuditLog({ userId, action: 'password_change', ipAddress: req.ip || '' });
  // Invalidate all sessions for this user (force re-login)
  if (userId) deleteAllUserSessions(userId);
  res.clearCookie('bkpay_token');
  res.json({ success: true, message: 'Password changed successfully. Please login again.' });
});

// MFA verify — complete login with TOTP code
app.post('/api/auth/mfa/verify', loginLimiter, (req, res) => {
  const { mfaPendingToken, totpCode } = req.body;
  if (!mfaPendingToken || !totpCode) return res.json({ success: false, error: 'Token and TOTP code required' });
  if (typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) return res.json({ success: false, error: 'TOTP code must be 6 digits' });
  const ip = req.ip || req.socket.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';
  const result = verifyMfaAndLogin(mfaPendingToken, totpCode, ip, ua);
  if (!result) {
    recordAuditLog({ action: 'login_mfa_failed', ipAddress: ip });
    return res.json({ success: false, error: 'Invalid or expired TOTP code' });
  }
  recordAuditLog({ userId: result.userId, action: 'login_mfa_success', ipAddress: ip });
  res.cookie('bkpay_token', result.token, { ...COOKIE_OPTS, maxAge: 24*60*60*1000 });
  const csrfToken = setCsrfCookie(res);
  res.json({ success: true, csrfToken });
});

// MFA setup — generate secret + QR code URL (requires auth)
app.post('/api/auth/mfa/setup', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const userId = getSessionUserId(token);
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const mfaData = setupMfa(userId);
  if (!mfaData) return res.json({ success: false, error: 'Failed to setup MFA' });
  res.json({ success: true, secret: mfaData.secret, otpauthUrl: mfaData.otpauthUrl });
});

// MFA enable — verify TOTP code and activate MFA
app.post('/api/auth/mfa/enable', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const userId = getSessionUserId(token);
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { totpCode } = req.body;
  if (!totpCode || typeof totpCode !== 'string' || !/^\d{6}$/.test(totpCode)) return res.json({ success: false, error: 'TOTP code must be 6 digits' });
  const ip = req.ip || req.socket.remoteAddress || '';
  const enabled = enableMfa(userId, totpCode);
  if (!enabled) return res.json({ success: false, error: 'Invalid TOTP code' });
  recordAuditLog({ userId, action: 'mfa_enabled', ipAddress: ip });
  res.json({ success: true, message: 'MFA enabled' });
});

// MFA disable — turn off MFA (requires password verification)
app.post('/api/auth/mfa/disable', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const userId = getSessionUserId(token);
  if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { password } = req.body;
  if (!password) return res.json({ success: false, error: 'Password required to disable MFA' });
  // Actually verify password before disabling MFA
  if (!verifyUserPassword(userId, password)) {
    const ip = req.ip || req.socket.remoteAddress || '';
    recordAuditLog({ userId, action: 'mfa_disable_failed', details: 'wrong password', ipAddress: ip });
    return res.json({ success: false, error: 'Incorrect password' });
  }
  const ip = req.ip || req.socket.remoteAddress || '';
  disableMfa(userId);
  recordAuditLog({ userId, action: 'mfa_disabled', ipAddress: ip });
  res.json({ success: true, message: 'MFA disabled' });
});

// MFA status — check if current user has MFA enabled
app.get('/api/auth/mfa/status', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.json({ success: false });
  const userId = getSessionUserId(token);
  if (!userId) return res.json({ success: false });
  const mfaEnabled = getMfaStatus(userId);
  res.json({ success: true, mfaEnabled });
});

app.get('/api/auth/check', (req, res) => {
  const token = req.cookies?.bkpay_token;
  res.json({ success: !!(token && validateSession(token, req.ip)) });
});

// Helper: serve HTML files with CSP nonce injection
function serveHtmlWithNonce(filePath: string) {
  return (_req: express.Request, res: express.Response) => {
    const nonce = res.locals.cspNonce || '';
    const fullPath = path.join(__dirname, '..', 'public', filePath);
    let html = fs.readFileSync(fullPath, 'utf-8');
    // Inject nonce into <script> tags (skip type="application/ld+json", skip already-nonced)
    html = html.replace(/<script(?![^>]*nonce=)(?![^>]*type="application\/ld\+json)(\s|>)/g, `<script nonce="${nonce}"$1`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  };
}

// Public pages (no auth) — served with nonce injection
app.get('/login.html', serveHtmlWithNonce('login.html'));
app.get('/pay.html', serveHtmlWithNonce('pay.html'));
app.get('/guide.html', serveHtmlWithNonce('guide.html'));
app.get('/customer-login.html', serveHtmlWithNonce('customer-login.html'));
app.get('/buy-usdt.html', serveHtmlWithNonce('buy-usdt.html'));
app.get('/manual.html', serveHtmlWithNonce('manual.html'));
app.get('/seller-register.html', serveHtmlWithNonce('seller-register.html'));
app.get('/seller-confirm.html', serveHtmlWithNonce('seller-confirm.html'));
app.get('/seller-dashboard.html', serveHtmlWithNonce('seller-dashboard.html'));
app.get('/paypay-convert.html', serveHtmlWithNonce('paypay-convert.html'));
app.get('/about.html', serveHtmlWithNonce('about.html'));
app.get('/terms.html', serveHtmlWithNonce('terms.html'));
app.get('/privacy.html', serveHtmlWithNonce('privacy.html'));
app.get('/referral.html', serveHtmlWithNonce('referral.html'));

// Protected admin page
app.get('/admin.html', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.redirect('/login.html');
  serveHtmlWithNonce('admin.html')(req, res);
});

// Analytics page (admin only)
app.get('/analytics.html', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.redirect('/login.html');
  serveHtmlWithNonce('analytics.html')(req, res);
});

// Admin-only pages (require admin session)
const adminPages = ['rules.html', 'simulator.html', 'prediction.html'];
adminPages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    const token = req.cookies?.bkpay_token;
    if (!token || !validateSession(token, req.ip)) return res.redirect('/login.html');
    serveHtmlWithNonce(page)(req, res);
  });
});

// Customer pages (require validated customer session)
app.get('/customer-dashboard.html', (req, res) => {
  const token = req.cookies?.bkpay_customer_token;
  if (!token) return res.redirect('/customer-login.html');
  const session = validateCustomerSession(token);
  if (!session.valid) return res.redirect('/customer-login.html');
  serveHtmlWithNonce('customer-dashboard.html')(req, res);
});

// Dynamic sitemap.xml (includes SEO landing pages)
app.get('/sitemap.xml', (_req, res) => {
  const slugs = getSeoPageSlugs();
  const staticPages = ['', 'buy-usdt.html', 'pay.html', 'guide.html', 'seller-register.html', 'terms.html', 'privacy.html', 'referral.html', 'paypay-convert.html', 'about.html'];
  const now = new Date().toISOString().split('T')[0];

  const langs = ['ja', 'en', 'zh', 'vi'];
  const hreflangBlock = (loc: string) => langs.map(l =>
    `    <xhtml:link rel="alternate" hreflang="${l}" href="${loc}"/>`
  ).join('\n') + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}"/>`;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

  for (const p of staticPages) {
    const priority = p === '' ? '1.0' : p.includes('buy-usdt') ? '0.9' : '0.7';
    const loc = `https://bkpay.app/${p}`;
    xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${now}</lastmod>\n    <priority>${priority}</priority>\n${hreflangBlock(loc)}\n  </url>\n`;
  }

  // SEO LP pages
  const lpLoc = 'https://bkpay.app/lp/usdt-buy.html';
  xml += `  <url>\n    <loc>${lpLoc}</loc>\n    <lastmod>${now}</lastmod>\n    <priority>0.9</priority>\n${hreflangBlock(lpLoc)}\n  </url>\n`;
  for (const slug of slugs) {
    const loc = `https://bkpay.app/lp/${slug}.html`;
    xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${now}</lastmod>\n    <priority>0.8</priority>\n    <changefreq>daily</changefreq>\n${hreflangBlock(loc)}\n  </url>\n`;
  }

  // Rate report pages
  const ratesDir = path.join(process.cwd(), 'public', 'rates');
  if (fs.existsSync(ratesDir)) {
    const rateFiles = fs.readdirSync(ratesDir).filter(f => f.endsWith('.html') && f !== 'index.html').sort().reverse().slice(0, 30);
    xml += `  <url><loc>https://bkpay.app/rates/</loc><lastmod>${now}</lastmod><priority>0.7</priority><changefreq>daily</changefreq></url>\n`;
    for (const f of rateFiles) {
      xml += `  <url><loc>https://bkpay.app/rates/${f}</loc><lastmod>${f.replace('.html','')}</lastmod><priority>0.6</priority></url>\n`;
    }
  }

  xml += '</urlset>';
  res.setHeader('Content-Type', 'application/xml');
  res.send(xml);
});

// Public static (CSS, JS, images)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Proof images (admin only via auth)
app.use('/proofs', authRequired, express.static(path.join(process.cwd(), 'data', 'proofs')));

// /api/refresh triggers an outbound fetch to all 3 exchanges; admin-only
// to prevent DoS / exchange IP bans. Internal throttle in routes/api.ts
// further limits to 1 call per 15s process-wide.
app.post('/api/refresh', authRequired);

// Protected API routes - orders: only GET list needs auth, POST is public (customer)
app.get('/api/orders', authRequired);
// POST /api/orders (create) is public for pay.html
// GET /api/orders/:id is public (customer checks status)
// POST /api/orders/:id/paid is public (customer marks paid)
// POST /api/orders/:id/cancel is public
// Admin-only order actions (Phase A/B)
app.post('/api/orders/:id/verify', authRequired);
app.post('/api/orders/:id/send-crypto', authRequired);
app.post('/api/orders/:id/manual-complete', authRequired);
app.post('/api/orders/:id/transfer-failed', authRequired);
app.use('/api/crypto-transactions', authRequired);
// Bank transfer verification (Phase C)
app.use('/api/bank-transfers', authRequired);
app.use('/api/accounts', authRequired);
app.use('/api/epay', authRequired);
app.use('/api/trader', authRequired);
app.use('/api/wallet', authRequired);
app.use('/api/settings', authRequired);
app.use('/api/reports', authRequired);
app.use('/api/export', authRequired);
// Note: GET /api/fees/rate (public preview) is NOT protected — only settings/report are
app.use('/api/fees/settings', authRequired);
app.use('/api/fees/report', authRequired);
// Note: GET /api/spread (public rate data) is NOT protected — only config/stats/recommendation are
app.use('/api/spread/config', authRequired);
app.use('/api/spread/stats', authRequired);
app.use('/api/spread/recommendation', authRequired);
app.use('/api/profit', authRequired);
app.use('/api/exchange-creds', authRequired);

// RBAC-protected routes — catch-all for /api/admin/* first
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

// P2P: /register, /login, /me, /me/orders are public (token-authenticated); seller management requires admin auth
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
// /api/p2p-buy/* is PUBLIC (buyer-facing) — no auth required

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

// External merchant API (API key auth — independent of admin session)
app.use('/api/v1', externalApiRouter);

// Public API routes (rates, pay orders)
app.use('/api/orders', orderLimiter);
app.use('/api', apiRouter);

// Readiness probe — lightweight DB-only check for container orchestration
app.get('/ready', (_req, res) => {
  try {
    // Use the health service's DB check logic (opens read-only connection)
    const health = getHealth();
    if (health.checks.database.status === 'ok') {
      res.json({ ready: true });
    } else {
      res.status(503).json({ ready: false });
    }
  } catch {
    res.status(503).json({ ready: false });
  }
});

// Health check & Prometheus metrics (no auth)
app.get('/health', (_req, res) => {
  const health = getHealth();
  // Expose minimal info to public — no error counts or memory details
  const publicHealth = {
    status: health.status,
    timestamp: health.timestamp,
    version: health.version,
  };
  res.status(health.status === 'ok' ? 200 : 503).json(publicHealth);
});
app.get('/metrics', authRequired, async (_req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(await getMetrics());
});

app.get('/', serveHtmlWithNonce('index.html'));

// Structured error handler (AppError subclasses)
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
  }
  incrementErrors();
  logger.error('Unhandled request error', { error: err.message, stack: err.stack });
  // Error tracker will capture this via the logger hook
  res.status(500).json({ success: false, error: 'Internal server error' });
});

async function start() {
  // Hook logger to capture errors in error_log table
  hookLogger();

  // Run DB migrations
  const migrationResult = runMigrations();
  if (migrationResult.applied > 0) {
    logger.info('DB migrations applied', migrationResult);
  }

  logger.info('BK P2P Aggregator starting', { cryptos: CONFIG.cryptos, updateIntervalMs: CONFIG.updateIntervalMs, port: CONFIG.port });

  // Initial fetch
  await updateAllCryptos().catch(err => logger.error('Initial fetch error', { error: err.message }));

  // Schedule updates
  setInterval(() => {
    updateAllCryptos().catch(err => logger.error('Update error', { error: err.message }));
  }, CONFIG.updateIntervalMs);

  // A3: Start USDT deposit monitor
  startMonitor();

  // TX confirmation polling (verifies broadcast TXs are confirmed on-chain)
  startTxConfirmPolling();

  // Phase C: Bank transfer auto-verification
  startBankVerifier();

  // Telegram Bot
  const ENABLE_TELEGRAM_BOT = process.env.ENABLE_TELEGRAM_BOT === 'true';
  if (ENABLE_TELEGRAM_BOT) {
    try { startTelegramBot(); } catch (e: unknown) { logger.error('TelegramBot failed to start', { error: e instanceof Error ? e.message : String(e) }); }
  } else {
    logger.info('TelegramBot disabled');
  }

  // Freeze Detector
  initFreezeDetector();

  // Rate Alert Service
  const ENABLE_ALERTS = process.env.ENABLE_ALERTS === 'true';
  if (ENABLE_ALERTS) {
    try { startAlerts(); } catch (e: unknown) { logger.error('AlertService failed to start', { error: e instanceof Error ? e.message : String(e) }); }
  } else {
    logger.info('AlertService disabled');
  }

  // Price Notifications (Daily/Spike/Weekly)
  const ENABLE_NOTIFICATIONS = process.env.ENABLE_NOTIFICATIONS === 'true';
  if (ENABLE_NOTIFICATIONS) {
    try { startPriceNotifier(); } catch (e: unknown) { logger.error('PriceNotifier failed to start', { error: e instanceof Error ? e.message : String(e) }); }
  } else {
    logger.info('PriceNotifier disabled');
  }

  // Auto-sweep: monitor hot wallet balance and auto-transfer to cold wallet
  startAutoSweep();

  // Webhook DLQ processor (retry failed webhook deliveries)
  startWebhookDlqProcessor();

  // TruPay Integration (Poller + Matcher + Verifier)
  const ENABLE_TRUPAY = process.env.ENABLE_TRUPAY === 'true';
  if (ENABLE_TRUPAY) {
    try {
      startTokenRefresh(); // JWT auto-refresh (login API + 12h interval)
      startTruPayPoller();
      startTruPayMatcher();
      startTruPayVerifier();
    } catch (e: unknown) { logger.error('TruPay services failed to start', { error: e instanceof Error ? e.message : String(e) }); }
  } else {
    logger.info('TruPay integration disabled');
  }

  // Auto-Trade Polling
  const ENABLE_AUTO_TRADE = process.env.ENABLE_AUTO_TRADE === 'true';
  if (ENABLE_AUTO_TRADE) {
    try { startAutoTradePolling(); } catch (e: unknown) { logger.error('AutoTrade failed to start', { error: e instanceof Error ? e.message : String(e) }); }
  } else {
    logger.info('AutoTrade disabled');
  }

  // Marketing Bot (Telegram channel auto-posting)
  startMarketingBot();

  // Discord Webhook (rate posting)
  startDiscordWebhook();

  // BullMQ queues + workers (feature-flagged)
  // When ENABLE_JOB_QUEUE=false (default): this is a no-op and the legacy
  // synchronous sendUSDT path is used by all callers (existing behavior).
  // When ENABLE_JOB_QUEUE=true: queues are initialized and workers are
  // started in this process UNLESS ENABLE_SIGNER_WORKER=true (in which
  // case the dedicated signer container consumes usdt-send jobs and this
  // main app only enqueues them + runs the notification worker).
  if (isJobQueueEnabled()) {
    logger.info('Job queue enabled', {
      signerWorkerInSeparateContainer: !shouldRunUsdtSendWorker(),
    });
    startQueueEventMonitoring();

    if (shouldRunUsdtSendWorker()) {
      startUsdtSendWorker(async (job) => {
        return sendUSDT(job.data.toAddress, job.data.amount);
      });
    } else {
      logger.info('usdt-send worker delegated to signer container');
    }

    // Notifications currently flow through `notifier.ts` called directly
    // from the send/confirm paths — they don't need a queue. If and when
    // that changes (e.g. high-volume fan-out to multiple channels),
    // uncomment the startNotificationWorker call and implement real
    // dispatch in the handler body. Removed placeholder to avoid
    // misleading operators into thinking notifications route via Redis.
  } else {
    logger.info('Job queue disabled (ENABLE_JOB_QUEUE != true)');
  }

  // Generate SEO landing pages
  generateSeoPages();

  // Generate daily rate report (first after 60s, then every 24h)
  setTimeout(() => generateDailyReport(), 60_000);
  setInterval(() => generateDailyReport(), 24 * 60 * 60 * 1000);

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
    if (process.env.NODE_ENV === 'production') {
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

    // Stop accepting new connections
    server.close(() => { logger.info('HTTP server closed'); });

    // Wait for in-flight crypto sends to complete (max 30s)
    await waitForInflightSends(30_000);

    closeWebSocket();
    stopAutoSweep();
    stopTxConfirmPolling();
    stopWebhookDlqProcessor();
    stopAutoTradePolling();
    stopMarketingBot();
    stopDiscordWebhook();
    stopTokenRefresh();
    stopTruPayPoller();
    stopTruPayMatcher();
    stopTruPayVerifier();
    // Close BullMQ queues and workers before the DB so pending jobs are
    // drained while DB is still usable.
    await stopQueueEventMonitoring();
    await closeQueues();
    closeDatabase();
    logger.info('Shutdown complete');
    process.exit(0);
  }

  // Force exit after 40 seconds if shutdown hangs
  function scheduleForceExit() {
    setTimeout(() => {
      logger.error('Forced shutdown after 40s timeout');
      process.exit(1);
    }, 40_000).unref();
  }

  process.on('SIGTERM', () => { scheduleForceExit(); shutdown('SIGTERM'); });
  process.on('SIGINT', () => { scheduleForceExit(); shutdown('SIGINT'); });

  // Unhandled error handlers — log and exit cleanly
  process.on('uncaughtException', (err) => {
    logger.fatal('Uncaught exception', { error: err.message, stack: err.stack });
    scheduleForceExit();
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.fatal('Unhandled rejection', { error: msg, stack });
    // Don't exit for unhandled rejections — log and continue
  });

  // Port binding error handler
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
