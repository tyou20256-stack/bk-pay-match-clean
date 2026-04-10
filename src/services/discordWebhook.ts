/**
 * @file discordWebhook.ts — Discord rate posting via webhook
 * Posts rate updates to a Discord channel using the same data as Telegram.
 * Requires DISCORD_WEBHOOK_URL in .env.
 */
import logger from './logger.js';
import { getCachedRates } from './aggregator.js';

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';
let discordTimer: ReturnType<typeof setInterval> | null = null;

interface ExchangeRate {
  exchange: string;
  bestBuy?: number;
  bestSell?: number;
  buyOrders?: Array<{ price: number; available: number; paymentMethods?: string[] }>;
  sellOrders?: Array<{ price: number; available: number }>;
}

async function postToDiscord(): Promise<void> {
  if (!WEBHOOK_URL) return;

  try {
    const rates = getCachedRates('USDT') as { rates?: ExchangeRate[] } | null;
    if (!rates?.rates?.length) return;

    let bestBuy = Infinity, bestBuyEx = '';
    let bestSell = 0, bestSellEx = '';
    const lines: string[] = [];

    for (const ex of rates.rates) {
      if (ex.bestBuy && ex.bestBuy < bestBuy) { bestBuy = ex.bestBuy; bestBuyEx = ex.exchange; }
      if (ex.bestSell && ex.bestSell > bestSell) { bestSell = ex.bestSell; bestSellEx = ex.exchange; }
      const buyStr = ex.bestBuy ? `¥${ex.bestBuy.toFixed(2)}` : '-';
      const sellStr = ex.bestSell ? `¥${ex.bestSell.toFixed(2)}` : '-';
      lines.push(`**${ex.exchange}** — Buy: ${buyStr} | Sell: ${sellStr}`);
    }

    const spread = bestSell > 0 && bestBuy < Infinity ? ((bestSell - bestBuy) / bestBuy * 100).toFixed(2) : '0';
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    const message =
      `💰 **USDT/JPY P2Pレート**\n\n` +
      lines.join('\n') + '\n\n' +
      `📊 最安購入: **¥${bestBuy.toFixed(2)}** (${bestBuyEx})\n` +
      `📈 最高売却: **¥${bestSell.toFixed(2)}** (${bestSellEx})\n` +
      `📉 スプレッド: **${spread}%**\n\n` +
      `🔗 **銀行振込でUSDT購入 → KYC不要・即時マッチング**\n` +
      `👉 今すぐ購入: <https://bkpay.app/buy-usdt.html?utm_source=discord>\n` +
      `📊 ライブレート: <https://bkpay.app/?utm_source=discord>\n` +
      `⏰ ${now}`;

    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'PayMatch Rates',
        content: message,
      }),
    });

    logger.info('Discord webhook posted', { bestBuy, bestSell });
  } catch (e) {
    logger.warn('Discord webhook failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

export function startDiscordWebhook(): void {
  if (!WEBHOOK_URL) {
    logger.info('Discord webhook disabled (no DISCORD_WEBHOOK_URL)');
    return;
  }
  // First post after 30s (allow rates to load)
  setTimeout(postToDiscord, 30_000);
  discordTimer = setInterval(postToDiscord, 2 * 60 * 60 * 1000); // 2h
  logger.info('Discord webhook started', { intervalHours: 2 });
}

export function stopDiscordWebhook(): void {
  if (discordTimer) { clearInterval(discordTimer); discordTimer = null; }
}
