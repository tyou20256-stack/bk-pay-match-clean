/**
 * @file queues/index.ts — BullMQ queue infrastructure
 * @description Centralized queue + worker lifecycle management.
 *
 * Queues defined here:
 *   - usdtSendQueue: TRC-20 USDT transfers (consumed by signer worker
 *     — either in-process or in a dedicated signer container)
 *   - notificationQueue: Telegram / Discord / email notifications
 *     (fire-and-forget, non-blocking for the main request path)
 *
 * Feature flags:
 *   - ENABLE_JOB_QUEUE=true: queues are initialized, workers start
 *     in the current process (unless a dedicated worker container is
 *     running and has its own entrypoint)
 *   - ENABLE_SIGNER_WORKER=true: the main app does NOT run the
 *     usdtSend worker itself (a separate signer container handles it).
 *     The main app still _enqueues_ jobs but does not consume them.
 *
 * Both flags default to false for safe rollout — when both are off,
 * the legacy synchronous sendUSDT path in walletService.ts is used
 * unchanged.
 */
import { Queue, Worker, QueueEvents, Job, JobsOptions } from 'bullmq';
import IORedis, { Redis } from 'ioredis';
import logger from '../services/logger.js';

// --- Redis connection ---
// BullMQ requires maxRetriesPerRequest: null for workers.
// We keep a single shared connection for queue producers and separate
// connections for workers (BullMQ best practice).
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

let sharedConnection: Redis | null = null;

function getConnection(): Redis {
  if (sharedConnection) return sharedConnection;
  sharedConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // required by bullmq
    enableReadyCheck: false,
  });
  sharedConnection.on('error', (e) => {
    logger.warn('Redis connection error', { error: e.message });
  });
  sharedConnection.on('connect', () => {
    logger.info('Redis connected', { url: REDIS_URL.replace(/\/\/.*@/, '//***@') });
  });
  return sharedConnection;
}

// --- Feature flags ---
export function isJobQueueEnabled(): boolean {
  return process.env.ENABLE_JOB_QUEUE === 'true';
}

export function isSignerWorkerEnabled(): boolean {
  return process.env.ENABLE_SIGNER_WORKER === 'true';
}

/** Determines if this process should run the usdtSend worker. */
export function shouldRunUsdtSendWorker(): boolean {
  // Only run the worker in the main app when:
  //   - queue is enabled AND
  //   - signer worker is NOT running in a separate process
  return isJobQueueEnabled() && !isSignerWorkerEnabled();
}

// --- Queue definitions ---

export interface UsdtSendJob {
  toAddress: string;
  amount: number;
  orderId?: string;
  idempotencyKey?: string; // for duplicate-send prevention
}

export interface NotificationJob {
  type: 'telegram' | 'discord';
  message: string;
  chatId?: string | number; // telegram
  priority?: 'info' | 'warn' | 'error';
}

// Default job options: 5 retries with exponential backoff, keep recent
// completed jobs for ~24h for audit, keep failed jobs for ~7d.
const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
};

let usdtSendQueue: Queue<UsdtSendJob> | null = null;
let notificationQueue: Queue<NotificationJob> | null = null;

/** Get or lazily create the usdt send queue (producer). */
export function getUsdtSendQueue(): Queue<UsdtSendJob> | null {
  if (!isJobQueueEnabled()) return null;
  if (usdtSendQueue) return usdtSendQueue;
  usdtSendQueue = new Queue<UsdtSendJob>('usdt-send', {
    connection: getConnection(),
    defaultJobOptions: DEFAULT_JOB_OPTS,
  });
  logger.info('usdt-send queue initialized');
  return usdtSendQueue;
}

/** Get or lazily create the notification queue (producer). */
export function getNotificationQueue(): Queue<NotificationJob> | null {
  if (!isJobQueueEnabled()) return null;
  if (notificationQueue) return notificationQueue;
  notificationQueue = new Queue<NotificationJob>('notification', {
    connection: getConnection(),
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTS,
      attempts: 3, // notifications are less critical
    },
  });
  logger.info('notification queue initialized');
  return notificationQueue;
}

// --- Worker lifecycle ---

const activeWorkers: Worker[] = [];

/**
 * Start the usdt-send worker in the current process.
 * Only called when shouldRunUsdtSendWorker() returns true.
 */
export function startUsdtSendWorker(
  processor: (job: Job<UsdtSendJob>) => Promise<{ success: boolean; txId?: string; error?: string }>
): Worker {
  const worker = new Worker<UsdtSendJob>(
    'usdt-send',
    async (job) => {
      const start = Date.now();
      logger.info('usdt-send job started', { jobId: job.id, toAddress: job.data.toAddress, amount: job.data.amount });
      const result = await processor(job);
      const durationMs = Date.now() - start;
      if (result.success) {
        logger.info('usdt-send job succeeded', { jobId: job.id, txId: result.txId, durationMs });
      } else {
        logger.error('usdt-send job failed', { jobId: job.id, error: result.error, durationMs });
        // Throwing tells BullMQ to retry with backoff
        throw new Error(result.error || 'Unknown send failure');
      }
      return result;
    },
    {
      connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false }),
      concurrency: 1, // serialize sends to avoid nonce races on the hot wallet
    }
  );
  worker.on('failed', (job, err) => {
    logger.error('usdt-send worker: job failed', {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      error: err.message,
    });
  });
  worker.on('error', (err) => {
    logger.error('usdt-send worker: error', { error: err.message });
  });
  activeWorkers.push(worker);
  logger.info('usdt-send worker started');
  return worker;
}

/**
 * Start the notification worker in the current process.
 * Always runs in the main app (never delegated to signer).
 */
export function startNotificationWorker(
  processor: (job: Job<NotificationJob>) => Promise<void>
): Worker {
  const worker = new Worker<NotificationJob>(
    'notification',
    async (job) => { await processor(job); },
    {
      connection: new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false }),
      concurrency: 5,
    }
  );
  worker.on('failed', (job, err) => {
    logger.warn('notification worker: job failed', {
      jobId: job?.id,
      type: job?.data.type,
      error: err.message,
    });
  });
  activeWorkers.push(worker);
  logger.info('notification worker started');
  return worker;
}

/**
 * Gracefully close all workers and queues.
 * Should be called on SIGTERM/SIGINT during shutdown.
 */
export async function closeQueues(): Promise<void> {
  logger.info('Closing queues and workers');
  // Close workers first so they stop accepting new jobs
  await Promise.all(activeWorkers.map((w) => w.close().catch((e: Error) => {
    logger.warn('Worker close error', { error: e.message });
  })));
  activeWorkers.length = 0;

  if (usdtSendQueue) {
    await usdtSendQueue.close().catch(() => {});
    usdtSendQueue = null;
  }
  if (notificationQueue) {
    await notificationQueue.close().catch(() => {});
    notificationQueue = null;
  }

  if (sharedConnection) {
    await sharedConnection.quit().catch(() => {});
    sharedConnection = null;
  }
  logger.info('Queues closed');
}

// --- Queue event monitoring (optional, runs in main app) ---

let usdtSendEvents: QueueEvents | null = null;

export function startQueueEventMonitoring(): void {
  if (!isJobQueueEnabled()) return;
  if (usdtSendEvents) return;
  usdtSendEvents = new QueueEvents('usdt-send', { connection: getConnection() });
  usdtSendEvents.on('completed', ({ jobId }) => {
    logger.info('QueueEvents: usdt-send completed', { jobId });
  });
  usdtSendEvents.on('failed', ({ jobId, failedReason }) => {
    logger.warn('QueueEvents: usdt-send failed', { jobId, failedReason });
  });
  usdtSendEvents.on('stalled', ({ jobId }) => {
    logger.warn('QueueEvents: usdt-send stalled', { jobId });
  });
}

export async function stopQueueEventMonitoring(): Promise<void> {
  if (usdtSendEvents) {
    await usdtSendEvents.close().catch(() => {});
    usdtSendEvents = null;
  }
}

/**
 * Accessor for the QueueEvents instance. Used by `enqueueOrSendUSDT` to
 * `job.waitUntilFinished(events)`. Returns null if event monitoring is
 * disabled or hasn't been started yet.
 */
export function getUsdtSendQueueEvents(): QueueEvents | null {
  return usdtSendEvents;
}
