/**
 * @file alertService.ts — レートアラートサービス
 * @description レートを60秒ごとに監視し、重要な変動をスタッフにTelegram通知。
 */

import logger from './logger.js';
import { getCachedRates } from './aggregator.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const STAFF_CHAT_ID = process.env.TELEGRAM_STAFF_CHAT_ID || '';
const CHECK_INTERVAL = 60_000;
const MIN_ALERT_INTERVAL = 60 * 60_000; // 1 hour between same type alerts

interface RateSnapshot {
  price: number;
  time: number;
}

const lastAlerts = new Map<string, number>();
const rateHistory: RateSnapshot[] = [];
let intervalId: ReturnType<typeof setInterval> | null = null;
let lastAlertsEvictionTime = Date.now();
const ALERTS_EVICTION_THRESHOLD = 1000;

/** Remove expired entries from lastAlerts to prevent unbounded growth. */
function evictStaleAlerts(): void {
  const now = Date.now();
  if (lastAlerts.size < ALERTS_EVICTION_THRESHOLD && now - lastAlertsEvictionTime < MIN_ALERT_INTERVAL) return;
  lastAlertsEvictionTime = now;
  for (const [key, timestamp] of lastAlerts) {
    if (now - timestamp > MIN_ALERT_INTERVAL) {
      lastAlerts.delete(key);
    }
  }
}

async function sendAlert(text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: STAFF_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    logger.error('Alert send failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

function canAlert(type: string): boolean {
  const last = lastAlerts.get(type);
  if (last && Date.now() - last < MIN_ALERT_INTERVAL) return false;
  lastAlerts.set(type, Date.now());
  evictStaleAlerts();
  return true;
}

async function checkRates() {
  try {
    // Read rates directly from in-process cache instead of making
    // an HTTP self-call. Avoids an extra network hop + auth surface.
    const cached = getCachedRates('USDT') as { rates?: Record<string, unknown>[] } | undefined;
    const rates = (cached && Array.isArray(cached.rates)) ? cached.rates : [];
    if (rates.length === 0) return;

    const prices = rates.map((r) => Number((r as Record<string, unknown>).price)).filter((p: number) => p > 0);
    if (prices.length === 0) return;

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
    const now = Date.now();

    // Track history
    rateHistory.push({ price: avgPrice, time: now });
    // Keep only last 10 minutes
    while (rateHistory.length > 0 && now - rateHistory[0].time > 10 * 60_000) {
      rateHistory.shift();
    }

    // Check 1: Spread below 1%
    if (maxPrice > 0) {
      const spread = ((maxPrice - minPrice) / maxPrice) * 100;
      if (spread < 1 && canAlert('low_spread')) {
        await sendAlert(
          `📉 <b>スプレッド縮小アラート</b>\n\n` +
          `スプレッド: ${spread.toFixed(2)}% (1%未満)\n` +
          `最安: ¥${minPrice.toLocaleString()}\n` +
          `最高: ¥${maxPrice.toLocaleString()}`
        );
      }
    }

    // Check 2: Arbitrage opportunity > 10% (P2P spreads are normally 5-20%)
    if (rates.length >= 2) {
      for (let i = 0; i < rates.length; i++) {
        for (let j = i + 1; j < rates.length; j++) {
          const p1 = Number(rates[i].price);
          const p2 = Number(rates[j].price);
          if (p1 <= 0 || p2 <= 0) continue;
          const diff = Math.abs(p1 - p2) / Math.min(p1, p2) * 100;
          if (diff > 10 && canAlert(`arb_${rates[i].exchange}_${rates[j].exchange}`)) {
            const [cheap, expensive] = p1 < p2
              ? [rates[i], rates[j]]
              : [rates[j], rates[i]];
            await sendAlert(
              `🔔 <b>アービトラージ機会</b>\n\n` +
              `差: ${diff.toFixed(2)}%\n` +
              `安値: ${cheap.exchange} ¥${Number(cheap.price).toLocaleString()}\n` +
              `高値: ${expensive.exchange} ¥${Number(expensive.price).toLocaleString()}`
            );
          }
        }
      }
    }

    // Check 3: Rate change > 3% in 5 minutes
    const fiveMinAgo = rateHistory.find(s => now - s.time >= 4.5 * 60_000 && now - s.time <= 6 * 60_000);
    if (fiveMinAgo) {
      const change = Math.abs(avgPrice - fiveMinAgo.price) / fiveMinAgo.price * 100;
      if (change > 3 && canAlert('rapid_change')) {
        const direction = avgPrice > fiveMinAgo.price ? '📈 上昇' : '📉 下落';
        await sendAlert(
          `⚡ <b>急激なレート変動</b>\n\n` +
          `${direction}: ${change.toFixed(2)}% (5分間)\n` +
          `5分前: ¥${fiveMinAgo.price.toLocaleString()}\n` +
          `現在: ¥${avgPrice.toLocaleString()}`
        );
      }
    }
  } catch (e) {
    logger.error('Rate check error', { error: e instanceof Error ? e.message : String(e) });
  }
}

export function startAlerts() {
  if (intervalId) return;
  logger.info('Starting rate monitoring (60s interval)');
  checkRates(); // Initial check
  intervalId = setInterval(checkRates, CHECK_INTERVAL);
}

export function stopAlerts() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
