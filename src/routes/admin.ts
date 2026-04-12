/**
 * @file admin.ts — Admin-only endpoints
 * @description RBAC user management, wallet config, error tracker, audit log,
 *   trading limits, trading rules, auto-trade config, auth/me.
 */
import { Router } from 'express';
import { getCachedRates } from '../services/aggregator.js';
import { AggregatedRates } from '../types.js';
import * as dbSvc from '../services/database.js';
import { getAllAdminUsers, createAdminUserWithRole, updateUserRole, deleteAdminUser, resetUserPassword, getAllRoles, getSessionInfo } from '../services/rbac.js';
import { getAllLimits, setLimits, deleteLimits, getUsageSummary, checkLimit } from '../services/tradingLimits.js';
import { getAllRules, getRule, createRule, updateRule, deleteRule, setRuleStatus, getRuleExecutions, testRule } from '../services/ruleEngine.js';
import { getStatus as getAutoTradeStatus, startPolling, stopPolling } from '../services/autoTradeService.js';
import { getAutoTradeConfig, setAutoTradeConfig, listExchangeOrders } from '../services/database.js';
import { getRecentErrors, getErrorStats, resolveError, resolveAllErrors } from '../services/errorTracker.js';
import * as customerSvc from '../services/customerAccounts.js';
import { ValidationError, AuthenticationError, NotFoundError } from '../errors.js';
import logger from '../services/logger.js';
import { safeError } from './_shared.js';

const router = Router();

// === RBAC User Management ===

router.get('/admin/users', (req, res) => {
  try {
    res.json({ success: true, users: getAllAdminUsers() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/users', (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) throw new ValidationError('username and password required');
    const result = createAdminUserWithRole(username, password, role || 'viewer');
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true, id: result.id });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.put('/admin/users/:id/role', (req, res) => {
  try {
    const { role } = req.body;
    if (!role) throw new ValidationError('role required');
    const result = updateUserRole(parseInt(req.params.id), role);
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.delete('/admin/users/:id', (req, res) => {
  try {
    const result = deleteAdminUser(parseInt(req.params.id));
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/users/:id/reset-password', (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) throw new ValidationError('newPassword required');
    const result = resetUserPassword(parseInt(req.params.id), newPassword);
    if (!result.success) return res.json({ success: false, error: result.error });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/admin/roles', (_req, res) => {
  res.json({ success: true, roles: getAllRoles() });
});

router.get('/auth/me', (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ success: false, error: 'Not logged in' });
  const info = getSessionInfo(token);
  if (!info.valid) return res.json({ success: false, error: 'Invalid session' });
  res.json({ success: true, user: { userId: info.userId, username: info.username, role: info.role } });
});

// === Trading Limits ===

router.get('/limits', (_req, res) => {
  try {
    res.json({ success: true, limits: getAllLimits() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/limits', (req, res) => {
  try {
    const { scope, scopeId, per_transaction, daily_limit, weekly_limit, monthly_limit } = req.body;
    setLimits(scope || 'global', scopeId || '', { per_transaction, daily_limit, weekly_limit, monthly_limit });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.delete('/limits', (req, res) => {
  try {
    const { scope, scopeId } = req.body;
    if (!scope) throw new ValidationError('scope required');
    const deleted = deleteLimits(scope, scopeId || '');
    res.json({ success: true, deleted });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/limits/usage', (req, res) => {
  try {
    const { scope, scopeId } = req.query as Record<string, string | undefined>;
    res.json({ success: true, usage: getUsageSummary(scope || 'global', scopeId || '') });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/limits/check', (req, res) => {
  try {
    const { amount, userId, exchange } = req.body;
    const result = checkLimit(amount, userId, exchange);
    res.json({ success: true, ...result });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Trading Rules ===

router.get('/rules', (_req, res) => {
  try {
    res.json({ success: true, rules: getAllRules() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/rules/:id', (req, res) => {
  try {
    const rule = getRule(parseInt(req.params.id));
    if (!rule) throw new NotFoundError('Rule');
    res.json({ success: true, rule });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/rules', (req, res) => {
  try {
    const { name, description, status, rate_conditions, exchange_conditions, time_conditions,
            liquidity_conditions, condition_logic, action_type, action_crypto, action_amount,
            action_exchange, action_pay_method, action_mode, max_per_execution, max_daily } = req.body;
    const id = createRule({
      name, description, status, rate_conditions, exchange_conditions, time_conditions,
      liquidity_conditions, condition_logic, action_type, action_crypto, action_amount,
      action_exchange, action_pay_method, action_mode, max_per_execution, max_daily,
      created_by: req.user?.userId,
    });
    res.json({ success: true, id });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.put('/rules/:id', (req, res) => {
  try {
    const { name, description, status, rate_conditions, exchange_conditions, time_conditions,
            liquidity_conditions, condition_logic, action_type, action_crypto, action_amount,
            action_exchange, action_pay_method, action_mode, max_per_execution, max_daily } = req.body;
    updateRule(parseInt(req.params.id), {
      name, description, status, rate_conditions, exchange_conditions, time_conditions,
      liquidity_conditions, condition_logic, action_type, action_crypto, action_amount,
      action_exchange, action_pay_method, action_mode, max_per_execution, max_daily,
    });
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.delete('/rules/:id', (req, res) => {
  try {
    deleteRule(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/rules/:id/toggle', (req, res) => {
  try {
    const rule = getRule(parseInt(req.params.id));
    if (!rule) throw new NotFoundError('Rule');
    const newStatus = rule.status === 'active' ? 'paused' : 'active';
    setRuleStatus(parseInt(req.params.id), newStatus);
    res.json({ success: true, status: newStatus });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/rules/:id/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json({ success: true, history: getRuleExecutions(parseInt(req.params.id), limit) });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/rules/test/:id', (req, res) => {
  try {
    const crypto = (req.body.crypto || 'USDT').toUpperCase();
    const rates = getCachedRates(crypto) as AggregatedRates;
    if (!rates) throw new NotFoundError('Rate data');
    const result = testRule(parseInt(req.params.id), rates);
    res.json({ success: true, result });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Auto-Trade ===

router.get('/auto-trade/config', (_req, res) => {
  try {
    res.json({ success: true, config: getAutoTradeConfig() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/auto-trade/config', (req, res) => {
  try {
    const allowed = ['enabled','preferred_channel','preferred_exchange','max_amount','min_amount','auto_confirm_payment','polling_interval_ms'];
    const updates = req.body;
    if (!updates || typeof updates !== 'object') return res.json({ success: false, error: 'body required' });
    for (const [k, v] of Object.entries(updates)) {
      if (allowed.includes(k) && typeof v === 'string') {
        setAutoTradeConfig(k, v);
      }
    }
    const config = getAutoTradeConfig();
    if (config.enabled === 'true') {
      startPolling();
    } else {
      stopPolling();
    }
    res.json({ success: true, config: getAutoTradeConfig() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/auto-trade/orders', (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    res.json({ success: true, orders: listExchangeOrders(limit) });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/auto-trade/status', (_req, res) => {
  try {
    res.json({ success: true, ...getAutoTradeStatus() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Audit Log ===

router.get('/admin/audit-log', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const entries = dbSvc.getAuditLog({ userId, action, limit, offset });
    res.json({ success: true, entries, limit, offset });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Error Tracking ===

router.get('/errors', (_req, res) => {
  try {
    const includeResolved = _req.query.includeResolved === 'true';
    const limit = Math.min(Number(_req.query.limit) || 50, 200);
    const errors = getRecentErrors(limit, includeResolved);
    res.json({ success: true, data: errors });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/errors/stats', (_req, res) => {
  try {
    const stats = getErrorStats();
    res.json({ success: true, data: stats });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/errors/:id/resolve', (req, res) => {
  try {
    resolveError(Number(req.params.id));
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/errors/resolve-all', (_req, res) => {
  try {
    resolveAllErrors();
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Admin Wallet Config ===

router.get('/admin/wallet-config', async (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthenticationError();
  const { validateSession, getSystemConfigMeta } = await import('../services/database.js');
  if (!validateSession(token, req.ip || '')) throw new AuthenticationError();
  try {
    const tronKey = getSystemConfigMeta('TRON_WALLET_PRIVATE_KEY');
    const tronAddr = getSystemConfigMeta('TRON_WALLET_ADDRESS');
    res.json({
      success: true,
      wallet: {
        privateKeySet: !!tronKey?.exists,
        addressSet: !!tronAddr?.exists,
        escrowEnabled: !!tronKey?.exists && !!tronAddr?.exists,
        lastUpdated: tronKey?.updatedAt || tronAddr?.updatedAt || null,
      }
    });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/wallet-config', async (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthenticationError();
  const { validateSession, setSystemConfig, getSystemConfig } = await import('../services/database.js');
  if (!validateSession(token, req.ip || '')) throw new AuthenticationError();
  try {
    const { privateKey, walletAddress } = req.body;
    if (privateKey) {
      if (!/^[a-fA-F0-9]{64}$/.test(privateKey)) throw new ValidationError('Private key must be 64 hex characters');
      setSystemConfig('TRON_WALLET_PRIVATE_KEY', privateKey, true);
      const { resetTronWeb } = await import('../services/walletService.js');
      resetTronWeb();
      logger.info('TRON wallet private key updated via admin UI');
    }
    if (walletAddress) {
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(walletAddress)) throw new ValidationError('Invalid TRON wallet address');
      setSystemConfig('TRON_WALLET_ADDRESS', walletAddress, false);
      logger.info('TRON wallet address updated via admin UI', { address: walletAddress });
    }
    const keySet = !!getSystemConfig('TRON_WALLET_PRIVATE_KEY');
    const addrSet = !!getSystemConfig('TRON_WALLET_ADDRESS');
    res.json({ success: true, escrowEnabled: keySet && addrSet });
  } catch (e: unknown) {
    if (e instanceof AuthenticationError || e instanceof ValidationError) throw e;
    res.json({ success: false, error: safeError(e) });
  }
});

router.delete('/admin/wallet-config', async (req, res) => {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new AuthenticationError();
  const { validateSession, deleteSystemConfig } = await import('../services/database.js');
  if (!validateSession(token, req.ip || '')) throw new AuthenticationError();
  try {
    deleteSystemConfig('TRON_WALLET_PRIVATE_KEY');
    deleteSystemConfig('TRON_WALLET_ADDRESS');
    const { resetTronWeb } = await import('../services/walletService.js');
    resetTronWeb();
    logger.info('TRON wallet config removed via admin UI');
    res.json({ success: true, escrowEnabled: false });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

// === Admin: Referrals & Customers ===

router.get('/admin/referrals', (req, res) => {
  res.json({ success: true, data: dbSvc.getAllReferralRewards() });
});

router.get('/admin/customers', (req, res) => {
  res.json({ success: true, data: dbSvc.getAllCustomers() });
});

// === Admin: KYC Management ===

router.get('/admin/kyc/pending', (_req, res) => {
  try {
    res.json({ success: true, submissions: customerSvc.getPendingKYC() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/kyc/:id/review', (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status || !['approved', 'rejected'].includes(status)) {
      throw new ValidationError('status must be approved or rejected');
    }
    const approved = status === 'approved';
    const reviewedBy = req.user?.userId || 0;
    customerSvc.reviewKYC(parseInt(req.params.id), approved, reviewedBy, notes);
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.get('/admin/customer-accounts', (_req, res) => {
  try {
    res.json({ success: true, accounts: customerSvc.getAllCustomerAccounts() });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/customer-accounts/:id/suspend', (req, res) => {
  try {
    customerSvc.suspendCustomer(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

router.post('/admin/customer-accounts/:id/activate', (req, res) => {
  try {
    customerSvc.activateCustomer(parseInt(req.params.id));
    res.json({ success: true });
  } catch (e: unknown) { res.json({ success: false, error: safeError(e) }); }
});

export default router;
