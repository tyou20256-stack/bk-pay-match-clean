/**
 * @file priceNotifier.ts — 価格通知サービス
 * @description 日次レートサマリー、急変動アラート、週次レポートを
 *   Telegramで顧客にプッシュ通知する。
 */

import { getNotificationSubscribers } from './database.js';
import db from './database.js';
import logger from './logger.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3003}`;

let lastDailySentDate = '';
let lastWeeklySentDate = '';
let running = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
const arbNotifyCooldown = new Map<string, number>();

interface RateSnapshot {
  timestamp: number;
  rates: Record<string, { buy: number; sell: number }>;
}
const recentSnapshots: RateSnapshot[] = [];
const MAX_SNAPSHOTS = 10;

async function tg(method: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json() as Record<string, unknown>;
  } catch (e) {
    logger.error('TG API error', { method, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

async function sendMessage(chatId: number, text: string, opts?: { reply_markup?: Record<string, unknown> }) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...opts });
}

async function fetchCurrentRates(): Promise<Record<string, { buy: number; sell: number; exchange: string }>> {
  const result: Record<string, { buy: number; sell: number; exchange: string }> = {};
  for (const crypto of ['USDT', 'BTC', 'ETH']) {
    try {
      const res = await fetch(`${API_BASE}/api/rates/${crypto}`);
      const data = await res.json() as Record<string, unknown>;
      if (data.success && data.data) {
        const dataData = data.data as Record<string, unknown>;
        const exchanges = (dataData.rates || []) as Record<string, unknown>[];
        const allBuy: Record<string, unknown>[] = [];
        const allSell: Record<string, unknown>[] = [];
        for (const ex of exchanges) {
          for (const o of ((ex.buyOrders || []) as Record<string, unknown>[])) allBuy.push(o);
          for (const o of ((ex.sellOrders || []) as Record<string, unknown>[])) allSell.push(o);
        }
        allBuy.sort((a, b) => Number(a.price) - Number(b.price));
        allSell.sort((a, b) => Number(b.price) - Number(a.price));
        if (allBuy.length > 0) {
          result[crypto] = {
            buy: Number(allBuy[0].price),
            sell: allSell.length > 0 ? Number(allSell[0].price) : 0,
            exchange: String(allBuy[0].exchange || '-'),
          };
        }
      }
    } catch (_) {}
  }
  return result;
}

function getYesterdayAvgRate(crypto: string): { buy: number; sell: number } | null {
  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;
  const dayBefore = yesterday - 24 * 60 * 60 * 1000;
  const rows = db.prepare(
    `SELECT AVG(best_buy) as avgBuy, AVG(best_sell) as avgSell FROM price_history WHERE crypto = ? AND timestamp >= ? AND timestamp < ?`
  ).get(crypto, dayBefore, yesterday) as { avgBuy: number | null; avgSell: number | null } | undefined;
  if (!rows || (!rows.avgBuy && !rows.avgSell)) return null;
  return { buy: rows.avgBuy || 0, sell: rows.avgSell || 0 };
}

function getWeeklyStats(crypto: string): { min: number; max: number; minDate: string; maxDate: string } | null {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const minRow = db.prepare(
    `SELECT MIN(best_buy) as val, timestamp FROM price_history WHERE crypto = ? AND timestamp >= ? AND best_buy > 0`
  ).get(crypto, weekAgo) as { val: number | null; timestamp: number } | undefined;
  const maxRow = db.prepare(
    `SELECT MAX(best_buy) as val, timestamp FROM price_history WHERE crypto = ? AND timestamp >= ? AND best_buy > 0`
  ).get(crypto, weekAgo) as { val: number | null; timestamp: number } | undefined;
  if (!minRow?.val || !maxRow?.val) return null;
  const fmt = (ts: number) => new Date(ts).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
  return { min: minRow.val, max: maxRow.val, minDate: fmt(minRow.timestamp), maxDate: fmt(maxRow.timestamp) };
}

function formatChange(current: number, previous: number): string {
  if (!previous || previous === 0) return '';
  const pct = ((current - previous) / previous * 100).toFixed(1);
  const sign = Number(pct) >= 0 ? '+' : '';
  return `（前日比 ${sign}${pct}%）`;
}

function formatPrice(price: number, crypto: string): string {
  if (crypto === 'USDT') return `¥${price.toFixed(2)}`;
  return `¥${Math.round(price).toLocaleString()}`;
}

// ━━━━━━━━━━━━━━━━━━ A. 日次レートサマリー ━━━━━━━━━━━━━━━━━━

async function sendDailySummary() {
  const subscribers = getNotificationSubscribers('daily_summary');
  if (subscribers.length === 0) return;

  const rates = await fetchCurrentRates();
  if (Object.keys(rates).length === 0) return;

  const now = new Date();
  const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;

  let text = `📊 <b>Pay Match 本日のレート（${dateStr}）</b>\n\n`;
  let recommendation = '';

  for (const crypto of ['USDT', 'BTC', 'ETH']) {
    const rate = rates[crypto];
    if (!rate) continue;
    const yesterday = getYesterdayAvgRate(crypto);

    text += `━━ ${crypto}/JPY ━━\n`;
    text += `購入: ${formatPrice(rate.buy, crypto)}${yesterday ? formatChange(rate.buy, yesterday.buy) : ''}\n`;
    if (rate.sell > 0 && crypto === 'USDT') {
      text += `売却: ${formatPrice(rate.sell, crypto)}${yesterday ? formatChange(rate.sell, yesterday.sell) : ''}\n`;
    }
    text += `\n`;

    const weekly = getWeeklyStats(crypto);
    if (weekly && rate.buy <= weekly.min * 1.005) {
      recommendation = `💡 本日のおすすめ: ${crypto}購入レートが\n過去7日で最安です`;
    }
  }

  if (recommendation) text += recommendation + '\n';

  const markup = {
    inline_keyboard: [
      [
        { text: '💰 購入する', callback_data: 'cb_buy' },
        { text: '📊 チャート', callback_data: 'cb_rates' },
      ],
    ],
  };

  for (const telegramId of subscribers) {
    await sendMessage(telegramId, text, { reply_markup: markup });
  }
  logger.info('日次サマリー送信完了', { subscriberCount: subscribers.length });
}

// ━━━━━━━━━━━━━━━━━━ B. スパイクアラート ━━━━━━━━━━━━━━━━━━

async function checkSpikeAlerts() {
  const rates = await fetchCurrentRates();
  if (Object.keys(rates).length === 0) return;

  const now = Date.now();
  const snapshot: RateSnapshot = { timestamp: now, rates: {} };
  for (const [crypto, r] of Object.entries(rates)) {
    snapshot.rates[crypto] = { buy: r.buy, sell: r.sell };
  }
  recentSnapshots.push(snapshot);
  if (recentSnapshots.length > MAX_SNAPSHOTS) recentSnapshots.shift();

  const fiveMinAgo = now - 5 * 60 * 1000;
  const oldSnapshot = recentSnapshots.find(s => s.timestamp <= fiveMinAgo);
  if (!oldSnapshot) return;

  const subscribers = getNotificationSubscribers('spike_alerts');
  if (subscribers.length === 0) return;

  for (const crypto of ['USDT', 'BTC', 'ETH']) {
    const current = snapshot.rates[crypto];
    const old = oldSnapshot.rates[crypto];
    if (!current || !old || old.buy === 0) continue;

    const changePct = ((current.buy - old.buy) / old.buy) * 100;
    if (Math.abs(changePct) >= 3) {
      const direction = changePct < 0 ? '下落' : '上昇';
      const chance = changePct < 0 ? '今が購入チャンス！' : '売却のチャンスかも！';

      const text =
        `⚡ <b>レート急変動アラート</b>\n\n` +
        `${crypto}購入レートが5分間で${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%${direction}\n` +
        `${formatPrice(old.buy, crypto)} → ${formatPrice(current.buy, crypto)}\n\n` +
        `${chance}`;

      const markup = {
        inline_keyboard: [[{ text: '💰 今すぐ購入', callback_data: 'cb_buy' }]],
      };

      for (const telegramId of subscribers) {
        await sendMessage(telegramId, text, { reply_markup: markup });
      }
      logger.info('スパイクアラート送信', { crypto, changePct: changePct.toFixed(1) });
    }
  }

  // アービトラージ機会チェック（閾値25%、1時間に1回まで）
  for (const crypto of ['USDT']) {
    const rate = rates[crypto];
    if (!rate || rate.buy === 0 || rate.sell === 0) continue;
    const arbPct = ((rate.sell - rate.buy) / rate.buy) * 100;
    const arbCooldownKey = `arb_notify_${crypto}`;
    const lastArbNotify = arbNotifyCooldown.get(arbCooldownKey) || 0;
    const now = Date.now();
    if (arbPct >= 25 && now - lastArbNotify > 60 * 60 * 1000) {
      arbNotifyCooldown.set(arbCooldownKey, now);
      const text =
        `🔥 <b>アービトラージ機会</b>\n\n` +
        `${crypto} スプレッド: ${arbPct.toFixed(1)}%\n` +
        `購入: ${formatPrice(rate.buy, crypto)}\n` +
        `売却: ${formatPrice(rate.sell, crypto)}\n\n` +
        `差額で利益のチャンス！`;

      for (const telegramId of subscribers) {
        await sendMessage(telegramId, text);
      }
    }
  }

  // ユーザー個別アラートしきい値チェック
  try {
    const alertRows = db.prepare(
      `SELECT telegram_id, alert_crypto, alert_threshold FROM notification_preferences WHERE alert_threshold > 0`
    ).all() as { telegram_id: number; alert_crypto: string; alert_threshold: number }[];

    for (const row of alertRows) {
      const rate = rates[row.alert_crypto];
      if (!rate) continue;
      if (rate.buy <= row.alert_threshold) {
        const text =
          `🔔 <b>アラート通知</b>\n\n` +
          `${row.alert_crypto}が ¥${rate.buy.toLocaleString()} になりました！\n` +
          `設定しきい値: ¥${row.alert_threshold.toLocaleString()}`;

        await sendMessage(row.telegram_id, text, {
          reply_markup: {
            inline_keyboard: [[{ text: '💰 今すぐ購入', callback_data: 'cb_buy' }]],
          },
        });
        db.prepare('UPDATE notification_preferences SET alert_threshold = 0 WHERE telegram_id = ?').run(row.telegram_id);
      }
    }
  } catch (_) {}
}

// ━━━━━━━━━━━━━━━━━━ C. 週次レポート ━━━━━━━━━━━━━━━━━━

async function sendWeeklySummary() {
  const subscribers = getNotificationSubscribers('weekly_summary');
  if (subscribers.length === 0) return;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

  let text = `📈 <b>Pay Match 週間レポート（${fmt(weekAgo)}-${fmt(now)}）</b>\n\n`;

  const usdtStats = getWeeklyStats('USDT');
  if (usdtStats) {
    text += `USDT 最安値: ¥${usdtStats.min.toFixed(2)}（${usdtStats.minDate}）\n`;
    text += `USDT 最高値: ¥${usdtStats.max.toFixed(2)}（${usdtStats.maxDate}）\n\n`;
  }

  const btcStats = getWeeklyStats('BTC');
  if (btcStats) {
    text += `BTC 最安値: ¥${Math.round(btcStats.min).toLocaleString()}（${btcStats.minDate}）\n`;
    text += `BTC 最高値: ¥${Math.round(btcStats.max).toLocaleString()}（${btcStats.maxDate}）\n\n`;
  }

  const weekAgoTs = weekAgo.getTime();
  for (const telegramId of subscribers) {
    let personalText = text;
    try {
      const orderCount = db.prepare(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total FROM orders WHERE created_at >= ?`
      ).get(weekAgoTs) as { cnt: number; total: number } | undefined;
      if (orderCount && orderCount.cnt > 0) {
        personalText += `あなたの取引: ${orderCount.cnt}回 / ¥${Number(orderCount.total).toLocaleString()}\n\n`;
      }
    } catch (_) {}

    await sendMessage(telegramId, personalText, {
      reply_markup: {
        inline_keyboard: [[{ text: '📊 詳細を見る', callback_data: 'cb_history' }]],
      },
    });
  }
  logger.info('週次レポート送信完了', { subscriberCount: subscribers.length });
}

// ━━━━━━━━━━━━━━━━━━ メインループ ━━━━━━━━━━━━━━━━━━

async function tick() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const hour = now.getHours();
  const minute = now.getMinutes();
  const today = now.toISOString().slice(0, 10);
  const dayOfWeek = now.getDay();

  if (hour === 9 && minute === 0 && lastDailySentDate !== today) {
    lastDailySentDate = today;
    try { await sendDailySummary(); } catch (e) { logger.error('日次サマリーエラー', { error: e instanceof Error ? e.message : String(e) }); }

    if (dayOfWeek === 1 && lastWeeklySentDate !== today) {
      lastWeeklySentDate = today;
      try { await sendWeeklySummary(); } catch (e) { logger.error('週次レポートエラー', { error: e instanceof Error ? e.message : String(e) }); }
    }
  }

  try { await checkSpikeAlerts(); } catch (e) { logger.error('スパイクアラートエラー', { error: e instanceof Error ? e.message : String(e) }); }
}

export function startPriceNotifier() {
  if (running) return;
  running = true;
  logger.info('価格通知サービス起動');
  intervalId = setInterval(() => {
    tick().catch(e => logger.error('tick error', { error: e instanceof Error ? e.message : String(e) }));
  }, 60 * 1000);
  tick().catch(e => logger.error('initial tick error', { error: e instanceof Error ? e.message : String(e) }));
}

export function stopPriceNotifier() {
  running = false;
  if (intervalId) { clearInterval(intervalId); intervalId = null; }
}
