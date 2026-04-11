/**
 * @file workers/signer.ts — Dedicated hot wallet signing worker
 * @description Runs as a separate Node process (ideally in its own
 *   container) that consumes `usdt-send` jobs from BullMQ/Redis and
 *   performs the actual on-chain TRON USDT transfer.
 *
 * Why separate:
 *   - The main app (src/index.ts) runs Puppeteer, Express, WebSocket,
 *     and a huge attack surface. A single RCE there would leak the
 *     TRON_WALLET_PRIVATE_KEY from memory and drain the hot wallet.
 *   - By running sendUSDT in a minimal Node process with only BullMQ
 *     + TronWeb loaded, the blast radius is dramatically reduced.
 *
 * Ideal deployment:
 *   - Separate Docker container (`bk-pay-match-signer`) with:
 *     - Only TRON_WALLET_PRIVATE_KEY in its env (NOT in the main app)
 *     - No public ports exposed
 *     - Minimal image (no Puppeteer/Chromium)
 *     - Read-only root filesystem where possible
 *     - Optional: nsjail/seccomp hardening
 *
 * Launch:
 *   ENABLE_JOB_QUEUE=true ENABLE_SIGNER_WORKER=true \
 *     node dist/workers/signer.js
 *
 * Required env vars for this worker:
 *   - REDIS_URL              (default: redis://redis:6379)
 *   - TRON_WALLET_PRIVATE_KEY (hex-encoded, 64 chars)
 *   - TRONGRID_API_KEY       (optional, for higher rate limits)
 *   - BK_ENC_KEY             (required by database.ts init — can be
 *                            a dummy value here since the signer does
 *                            not touch the SQLite tables for audit)
 *
 * NOT required (can be omitted for minimal attack surface):
 *   - BK_ADMIN_PASSWORD, session secrets, Telegram bot tokens,
 *     Anthropic API key, Puppeteer credentials, etc.
 *
 * On shutdown (SIGTERM/SIGINT): waits up to 60s for in-flight sends
 * to confirm, then exits. BullMQ marks stalled jobs for retry.
 */
import logger from '../services/logger.js';
import { sendUSDT } from '../services/walletService.js';
import { isJobQueueEnabled, isSignerWorkerEnabled, startUsdtSendWorker, closeQueues } from '../queues/index.js';

async function main() {
  logger.info('[signer] hot wallet signer worker starting', {
    nodeVersion: process.version,
    pid: process.pid,
  });

  if (!isJobQueueEnabled()) {
    logger.fatal('[signer] ENABLE_JOB_QUEUE must be true for this process');
    process.exit(1);
  }
  if (!isSignerWorkerEnabled()) {
    logger.fatal('[signer] ENABLE_SIGNER_WORKER must be true for this process');
    process.exit(1);
  }
  if (!process.env.TRON_WALLET_PRIVATE_KEY) {
    logger.fatal('[signer] TRON_WALLET_PRIVATE_KEY is required in this worker');
    process.exit(1);
  }

  // Start the USDT send worker — this binds to the Redis queue and
  // begins consuming jobs immediately.
  startUsdtSendWorker(async (job) => {
    const { toAddress, amount, orderId, idempotencyKey } = job.data;
    logger.info('[signer] processing send job', {
      jobId: job.id,
      toAddress,
      amount,
      orderId,
      idempotencyKey,
      attempt: job.attemptsMade + 1,
    });
    return sendUSDT(toAddress, amount);
  });

  logger.info('[signer] ready — consuming usdt-send queue');

  // Graceful shutdown
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('[signer] shutdown signal received', { signal });

    // Give in-flight sends 60s to finish before force-close
    const forceTimer = setTimeout(() => {
      logger.error('[signer] forced exit after 60s timeout');
      process.exit(1);
    }, 60_000);
    forceTimer.unref();

    try {
      await closeQueues();
      logger.info('[signer] shutdown complete');
      process.exit(0);
    } catch (e: unknown) {
      logger.error('[signer] shutdown error', {
        error: e instanceof Error ? e.message : String(e),
      });
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal('[signer] uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error('[signer] unhandled rejection', { error: msg });
  });
}

main().catch((e: unknown) => {
  logger.fatal('[signer] startup failed', {
    error: e instanceof Error ? e.message : String(e),
  });
  process.exit(1);
});
