/**
 * @file bootstrap.ts — サービス起動・停止
 * @description 全バックグラウンドサービスの初期化と graceful shutdown を管理。
 *   index.ts からインポートして使用する。
 */
import { startMonitor } from './services/tronMonitor.js';
import { startTelegramBot } from './services/telegramBot.js';
import { initFreezeDetector } from './services/freezeDetector.js';
import { startAlerts } from './services/alertService.js';
import { startTxConfirmPolling, stopTxConfirmPolling } from './services/txConfirmService.js';
import { startPriceNotifier } from './services/priceNotifier.js';
import { startVerifier as startBankVerifier } from './services/bankVerifier.js';
import { updateAllCryptos } from './services/aggregator';
import { CONFIG } from './config';
import { initWebSocket, closeWebSocket } from './services/websocket';
import { startPolling as startAutoTradePolling, stopPolling as stopAutoTradePolling } from './services/autoTradeService';
import { startAutoSweep, stopAutoSweep, waitForInflightSends } from './services/walletService';
import { startTruPayPoller, stopTruPayPoller } from './services/trupayPoller';
import { startTruPayMatcher, stopTruPayMatcher } from './services/trupayMatcher';
import { startTruPayVerifier, stopTruPayVerifier } from './services/trupayVerifier';
import { startTokenRefresh, stopTokenRefresh } from './services/trupayClient';
import { startMarketingBot, stopMarketingBot } from './services/marketingBot';
import { startDiscordWebhook, stopDiscordWebhook } from './services/discordWebhook';
import { generateSeoPages } from './services/seoGenerator';
import { generateDailyReport } from './services/rateReportGenerator.js';
import { startWebhookDlqProcessor, stopWebhookDlqProcessor } from './services/merchantApiService';
import logger from './services/logger';
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

/**
 * Start all background services.
 * Called once from index.ts after the Express app is wired up.
 */
export async function startServices() {
  // Hook logger to capture errors in error_log table
  hookLogger();

  // Run DB migrations
  const migrationResult = runMigrations();
  if (migrationResult.applied > 0) {
    logger.info('DB migrations applied', migrationResult);
  }

  logger.info('BK P2P Aggregator starting', {
    cryptos: CONFIG.cryptos,
    updateIntervalMs: CONFIG.updateIntervalMs,
    port: CONFIG.port,
  });

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
  } else {
    logger.info('Job queue disabled (ENABLE_JOB_QUEUE != true)');
  }

  // Generate SEO landing pages
  generateSeoPages();

  // Generate daily rate report (first after 60s, then every 24h)
  setTimeout(() => generateDailyReport(), 60_000);
  setInterval(() => generateDailyReport(), 24 * 60 * 60 * 1000);
}

/**
 * Initialize the WebSocket server on the given HTTP(S) server.
 */
export { initWebSocket };

/**
 * Gracefully shut down all services.
 * Called from index.ts on SIGTERM/SIGINT.
 */
export async function shutdownServices() {
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
}

/**
 * Wait for in-flight crypto sends to complete (max timeout ms).
 */
export { waitForInflightSends };
