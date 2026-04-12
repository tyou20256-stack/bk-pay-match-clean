/**
 * @file api.ts — API Router (combiner)
 * @description Mounts all feature-specific sub-routers onto a single Express router.
 *   Each sub-router is self-contained with its own imports, middleware, and route definitions.
 */
import { Router } from 'express';
import express from 'express';
import { AppError } from '../errors.js';
import logger from '../services/logger.js';

import ordersRouter from './orders.js';
import accountsRouter from './accounts.js';
import reportsRouter from './reports.js';
import p2pRouter from './p2p.js';
import p2pBuyRouter from './p2p-buy.js';
import trupayRouter from './trupay.js';
import adminRouter from './admin.js';
import paypayRouter from './paypay.js';
import customersRouter from './customers.js';

const router = Router();

// Mount all sub-routers
router.use('/', reportsRouter);
router.use('/', ordersRouter);
router.use('/', accountsRouter);
router.use('/', p2pRouter);
router.use('/', p2pBuyRouter);
router.use('/', trupayRouter);
router.use('/', adminRouter);
router.use('/', paypayRouter);
router.use('/', customersRouter);

// Structured error handler (must be last)
router.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, error: err.message, code: err.code });
  }
  logger.error('Unhandled route error', { error: err.message });
  res.status(500).json({ success: false, error: 'Internal server error' });
});

export default router;
