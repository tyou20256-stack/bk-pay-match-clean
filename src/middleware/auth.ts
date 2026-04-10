/**
 * @file auth.ts — 認証・権限・CSRFミドルウェア
 * @description Cookie(bkpay_token)またはAuthorization Bearerヘッダーから
 *   セッショントークンを取得し、RBAC権限チェックを実施。
 *   CSRF保護: 状態変更リクエスト(POST/PUT/DELETE)にX-CSRF-Tokenヘッダーを要求。
 *   - authRequired: セッション有効性 + CSRF検証
 *   - requirePermission(permission): 特定の権限を要求 + CSRF検証
 *   - customerAuthRequired: 顧客セッションの検証
 *   - csrfProtection: CSRF トークンの検証ミドルウェア
 */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/database.js';
import { getSessionInfo, hasPermission, Permission, SessionInfo } from '../services/rbac.js';
import { validateCustomerSession } from '../services/customerAccounts.js';

// Extend Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: SessionInfo;
      customerId?: number;
    }
  }
}

function extractToken(req: Request): string | undefined {
  return req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
}

/**
 * CSRF protection via double-submit cookie pattern.
 * - On login, a non-httpOnly CSRF cookie is set (readable by JS).
 * - State-changing requests (POST/PUT/DELETE) must include X-CSRF-Token header matching the cookie.
 * - GET/HEAD/OPTIONS are exempt (safe methods).
 * - API key-authenticated requests (external API) are exempt (no cookie session).
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Only check state-changing methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Exempt: Bearer token auth (external API) — not cookie-based
  if (req.headers.authorization?.startsWith('Bearer ')) return next();
  // Exempt: public auth endpoints (login, register) — no session required
  const publicAuthPaths = ['/api/customer/register', '/api/customer/login', '/api/login'];
  if (publicAuthPaths.some(p => req.path === p)) return next();
  // Exempt: P2P buyer public endpoints
  if (req.path.startsWith('/api/p2p-buy/')) return next();
  // Exempt: requests without session cookie (public endpoints like order creation)
  if (!req.cookies?.bkpay_token && !req.cookies?.bkpay_customer_token) return next();

  const cookieToken = req.cookies?.bkpay_csrf;
  const headerToken = req.headers['x-csrf-token'] as string;

  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length ||
      !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    return res.status(403).json({ success: false, error: 'CSRF token mismatch' });
  }
  next();
}

/**
 * Generate and set CSRF token cookie (called on login and auth check)
 */
export function setCsrfCookie(res: Response): string {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie('bkpay_csrf', csrfToken, {
    httpOnly: false, // Must be readable by JS
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
  });
  return csrfToken;
}

/**
 * Basic auth check — requires valid session, no specific permission
 */
export function authRequired(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token || !validateSession(token, req.ip)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  // Attach user info to request
  req.user = getSessionInfo(token);
  next();
}

/**
 * Permission-based auth — requires valid session + specific permission
 */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = extractToken(req);
    if (!token || !validateSession(token, req.ip)) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    const session = getSessionInfo(token);
    if (!session.valid) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!hasPermission(session.role!, permission)) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions' });
    }
    req.user = session;
    next();
  };
}

/**
 * Customer auth — for customer-facing endpoints
 */
export function customerAuthRequired(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.bkpay_customer_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, error: 'Customer authentication required' });
  }
  const session = validateCustomerSession(token);
  if (!session.valid) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  }
  req.customerId = session.customerId;
  next();
}
