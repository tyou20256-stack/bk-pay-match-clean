/**
 * @file marketingBot.ts — マーケティング自動配信
 * @description Telegram公開チャンネル + Twitter/X にレート情報を定期配信。
 *   P2Pプラットフォームの買い手をPayMatchに誘導する。
 *   Telegram: 2時間間隔（8パターンローテーション）
 *   X/Twitter: 8時間間隔（10パターンローテーション、連続同一パターン回避）
 */
import crypto from 'crypto';
import { getCachedRates } from './aggregator.js';
import { getQueuedTruPayWithdrawals } from './database.js';
import { isEnabled as isTruPayEnabled } from './trupayClient.js';
import logger from './logger.js';
import { AggregatedRates } from '../types.js';

// === Config ===
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '';
const BASE_URL = process.env.BASE_URL || 'https://bkpay.app';
const ENABLED = process.env.ENABLE_MARKETING_BOT === 'true';

// Twitter/X OAuth 1.0a
const X_CONSUMER_KEY = process.env.X_CONSUMER_KEY || '';
const X_CONSUMER_SECRET = process.env.X_CONSUMER_SECRET || '';
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN || '';
const X_ACCESS_SECRET = process.env.X_ACCESS_SECRET || '';
const X_ENABLED = !!(X_CONSUMER_KEY && X_CONSUMER_SECRET && X_ACCESS_TOKEN && X_ACCESS_SECRET);

// Separate intervals
const TG_INTERVAL = 2 * 60 * 60 * 1000;  // 2 hours
const X_INTERVAL = 8 * 60 * 60 * 1000;   // 8 hours

let tgTimer: ReturnType<typeof setInterval> | null = null;
let xTimer: ReturnType<typeof setInterval> | null = null;
let tgPostCount = 0;
let xPostCount = 0;
let lastXPattern = -1; // Track last X pattern to avoid consecutive duplicates

// === Telegram API ===

async function sendChannelMessage(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHANNEL_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHANNEL_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: {
          inline_keyboard: [
            [{ text: '\u{1F4B0} Buy USDT Now', url: 'https://bkpay.app/buy-usdt.html?utm_source=telegram&utm_medium=channel&utm_campaign=rate_post' }],
            [{ text: '\u{1F4CA} Live Rates', url: 'https://bkpay.app/?utm_source=telegram' }, { text: '\u{1F4D6} Guide', url: 'https://bkpay.app/guide.html?utm_source=telegram' }]
          ]
        }
      }),
    });
    const data = await res.json() as { ok: boolean };
    return data.ok;
  } catch (e) {
    logger.error('Marketing bot TG send failed', { error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

// === Twitter/X OAuth 1.0a ===

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map(k => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');
  const baseStr = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramStr)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseStr).digest('base64');
}

// Currently unused — reserved for future X/Twitter auto-posting feature.
// Keep the implementation intact so the crypto-secure OAuth flow isn't lost.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildOAuthHeader(method: string, url: string, body?: Record<string, string>): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: X_CONSUMER_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  // Merge body params for signature (only for form-encoded; JSON body is excluded)
  const allParams = { ...oauthParams, ...(body || {}) };
  const signature = generateOAuthSignature(method, url, allParams, X_CONSUMER_SECRET, X_ACCESS_SECRET);
  oauthParams['oauth_signature'] = signature;

  const headerParts = Object.keys(oauthParams).sort().map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`);
  return `OAuth ${headerParts.join(', ')}`;
}

async function postTweet(text: string): Promise<boolean> {
  if (!X_ENABLED) return false;
  try {
    const url = 'https://api.twitter.com/2/tweets';
    const jsonBody = JSON.stringify({ text });

    // For JSON body, only oauth params go into signature
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: X_CONSUMER_KEY,
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: String(Math.floor(Date.now() / 1000)),
      oauth_token: X_ACCESS_TOKEN,
      oauth_version: '1.0',
    };

    const signature = generateOAuthSignature('POST', url, oauthParams, X_CONSUMER_SECRET, X_ACCESS_SECRET);
    oauthParams['oauth_signature'] = signature;

    const headerParts = Object.keys(oauthParams).sort().map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`);
    const authHeader = `OAuth ${headerParts.join(', ')}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: jsonBody,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      logger.error('X post failed', { status: res.status, body: errBody.slice(0, 300) });
      return false;
    }

    const data = await res.json() as { data?: { id: string } };
    logger.info('X tweet posted', { tweetId: data.data?.id });
    return true;
  } catch (e) {
    logger.error('X post error', { error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

// === Rate Data ===

interface RateSnapshot {
  bestBuy: number;
  bestBuyExchange: string;
  bestSell: number;
  bestSellExchange: string;
  spread: number;
  buyOrders: Array<{ exchange: string; price: number; available: number; minLimit: number; maxLimit: number; merchant: { name: string; completionRate: number; orderCount: number } }>;
}

function getUsdtSnapshot(): RateSnapshot | null {
  const rates = getCachedRates('USDT') as AggregatedRates;
  if (!rates?.rates?.length) return null;

  let bestBuy = Infinity, bestBuyEx = '';
  let bestSell = 0, bestSellEx = '';
  const bankBuyOrders: RateSnapshot['buyOrders'] = [];

  for (const ex of rates.rates) {
    if (ex.bestBuy && ex.bestBuy < bestBuy) {
      bestBuy = ex.bestBuy;
      bestBuyEx = ex.exchange;
    }
    if (ex.bestSell && ex.bestSell > bestSell) {
      bestSell = ex.bestSell;
      bestSellEx = ex.exchange;
    }
    for (const o of (ex.buyOrders || [])) {
      const methods = (o.paymentMethods || []).map(m => String(m).toLowerCase());
      const hasBank = methods.some(m => m.includes('bank') || m.includes('振込') || m.includes('transfer'));
      if (hasBank) {
        bankBuyOrders.push({
          exchange: o.exchange,
          price: o.price,
          available: o.available,
          minLimit: o.minLimit,
          maxLimit: o.maxLimit,
          merchant: o.merchant,
        });
      }
    }
  }

  if (bestBuy === Infinity) return null;
  bankBuyOrders.sort((a, b) => a.price - b.price);

  return { bestBuy, bestBuyExchange: bestBuyEx, bestSell, bestSellExchange: bestSellEx, spread: bestSell - bestBuy, buyOrders: bankBuyOrders };
}

// === Helper ===

function jstTime(): { timeStr: string; dateStr: string; fullStr: string } {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'short', day: 'numeric' });
  const fullStr = `${dateStr} ${timeStr}`;
  return { timeStr, dateStr, fullStr };
}

function getQueueInfo(): { queueCount: number; queueTotal: number } {
  let queueCount = 0;
  let queueTotal = 0;
  if (isTruPayEnabled()) {
    const queue = getQueuedTruPayWithdrawals();
    queueCount = queue.length;
    queueTotal = queue.reduce((s, w) => s + (w.amount_jpy || 0), 0);
  }
  return { queueCount, queueTotal };
}

function buildExchangeTable(snap: RateSnapshot, count: number): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const o of snap.buyOrders.slice(0, count)) {
    if (seen.has(o.exchange)) continue;
    seen.add(o.exchange);
    lines.push(`${o.exchange}: ¥${o.price.toFixed(2)} (${o.merchant.completionRate.toFixed(0)}%)`);
  }
  return lines.join('\n');
}

// === Telegram Templates (8 patterns) ===

function buildTelegramPost(snap: RateSnapshot, queueCount: number, queueTotal: number): string {
  const { timeStr, dateStr } = jstTime();
  const pattern = tgPostCount % 8;

  switch (pattern) {
    // Pattern 0: Japanese rate comparison + instant match count
    case 0:
      return (
        `📊 <b>USDT/JPY リアルタイムレート</b>\n` +
        `${dateStr} ${timeStr} (JST)\n\n` +
        `🟢 最安購入: <b>¥${snap.bestBuy.toFixed(2)}</b> (${snap.bestBuyExchange})\n` +
        `🔴 最高売却: <b>¥${snap.bestSell.toFixed(2)}</b> (${snap.bestSellExchange})\n` +
        `📈 スプレッド: ¥${snap.spread.toFixed(2)}\n\n` +
        (queueCount > 0 ? `⚡ 即時マッチング可能: <b>${queueCount}件</b> / ¥${queueTotal.toLocaleString()}\n\n` : '') +
        `💎 <b>PayMatchなら銀行振込でUSDTが買える</b>\n` +
        `他プラットフォームより安いレートで提供中\n\n` +
        `👉 <a href="${BASE_URL}/buy-usdt.html">今すぐUSDTを購入</a>`
      );

    // Pattern 1: English rate comparison + CTA
    case 1: {
      const table = buildExchangeTable(snap, 3);
      return (
        `💱 <b>Buy USDT with JPY — Live Rates</b>\n\n` +
        `${table}\n\n` +
        `✅ <b>PayMatch: ¥${(snap.bestBuy * 0.995).toFixed(2)}</b> ← Best deal\n\n` +
        (queueCount > 0 ? `⚡ ${queueCount} instant matches available now\n\n` : '') +
        `🏦 Pay by bank transfer, receive USDT (TRC-20)\n` +
        `No account needed. No KYC.\n\n` +
        `👉 <a href="${BASE_URL}/buy-usdt.html">Buy USDT Now</a>`
      );
    }

    // Pattern 2: Chinese rate comparison
    case 2:
      return (
        `💰 <b>USDT/JPY 实时汇率</b>\n` +
        `${dateStr} ${timeStr} (JST)\n\n` +
        `🟢 最优买入: <b>¥${snap.bestBuy.toFixed(2)}</b> (${snap.bestBuyExchange})\n` +
        `🔴 最优卖出: <b>¥${snap.bestSell.toFixed(2)}</b> (${snap.bestSellExchange})\n\n` +
        (queueCount > 0 ? `🏦 可即时匹配: <b>${queueCount}笔</b> / ¥${queueTotal.toLocaleString()}\n\n` : '') +
        `🎯 PayMatch — 银行转账购买USDT\n` +
        `比其他P2P平台更优汇率\n\n` +
        `👉 <a href="${BASE_URL}/buy-usdt.html">立即购买USDT</a>`
      );

    // Pattern 3: Vietnamese rate comparison
    case 3:
      return (
        `💱 <b>Tỷ giá USDT/JPY thời gian thực</b>\n` +
        `${dateStr} ${timeStr} (JST)\n\n` +
        `🟢 Mua tốt nhất: <b>¥${snap.bestBuy.toFixed(2)}</b> (${snap.bestBuyExchange})\n` +
        `🔴 Bán tốt nhất: <b>¥${snap.bestSell.toFixed(2)}</b> (${snap.bestSellExchange})\n\n` +
        (queueCount > 0 ? `🏦 Có thể khớp ngay: <b>${queueCount} lệnh</b>\n\n` : '') +
        `✅ PayMatch — Mua USDT bằng chuyển khoản ngân hàng\n` +
        `Tỷ giá tốt hơn các sàn P2P khác\n\n` +
        `👉 <a href="${BASE_URL}/buy-usdt.html">Mua USDT ngay</a>`
      );

    // Pattern 4: Japanese educational — USDTとは？
    case 4:
      return (
        `📚 <b>USDTとは？銀行振込で簡単購入</b>\n\n` +
        `USDTは米ドルと1:1で連動するステーブルコイン。\n` +
        `価格変動が少なく、暗号通貨初心者にも最適です。\n\n` +
        `📌 PayMatchでの購入方法:\n` +
        `1️⃣ 金額を入力\n` +
        `2️⃣ 銀行振込で支払い\n` +
        `3️⃣ TRC-20 USDTを受取\n\n` +
        `🟢 現在の最安レート: <b>¥${snap.bestBuy.toFixed(2)}</b>\n` +
        (queueCount > 0 ? `⚡ 即時マッチ: ${queueCount}件\n\n` : '\n') +
        `👉 <a href="${BASE_URL}/buy-usdt.html">今すぐ購入する</a>`
      );

    // Pattern 5: Japanese market insight — Bybit P2P撤退後
    case 5:
      return (
        `📈 <b>Bybit P2P撤退後の最安USDT購入方法</b>\n\n` +
        `Bybitが日本のP2P市場から撤退した今、\n` +
        `USDTの購入先が限られています。\n\n` +
        `取引所の比較:\n` +
        `${buildExchangeTable(snap, 3)}\n` +
        `✅ PayMatch: <b>¥${(snap.bestBuy * 0.995).toFixed(2)}</b>\n\n` +
        `💡 PayMatchは銀行振込で即座にUSDTを購入可能。\n` +
        `KYC不要・アカウント不要。\n\n` +
        `👉 <a href="${BASE_URL}/buy-usdt.html">最安レートで購入</a>`
      );

    // Pattern 6: Comparison — PayMatch vs 取引所P2P
    case 6: {
      const pmRate = snap.bestBuy * 0.995;
      const savings = snap.bestBuy - pmRate;
      return (
        `⚖️ <b>PayMatch vs 取引所P2P — なぜPayMatchが安い？</b>\n\n` +
        `取引所P2P最安: ¥${snap.bestBuy.toFixed(2)} (${snap.bestBuyExchange})\n` +
        `PayMatch: <b>¥${pmRate.toFixed(2)}</b>\n` +
        `💰 差額: <b>¥${savings.toFixed(2)}/USDT</b>\n\n` +
        `📌 PayMatchが安い理由:\n` +
        `- 取引手数料なし\n` +
        `- 直接マッチングで中間コスト削減\n` +
        `- エスクロー保護で安全\n\n` +
        `100万円分で約¥${(savings * (1000000 / pmRate)).toFixed(0)}お得！\n\n` +
        `👉 <a href="${BASE_URL}/buy-usdt.html">PayMatchで購入</a>`
      );
    }

    // Pattern 7: Testimonial / social proof
    case 7:
      return (
        `🏆 <b>本日のマッチング状況</b>\n` +
        `${dateStr} ${timeStr} (JST)\n\n` +
        (queueCount > 0
          ? `📊 即時マッチング可能: <b>${queueCount}件</b>\n` +
            `💰 総額: <b>¥${queueTotal.toLocaleString()}</b>\n\n`
          : `📊 PayMatchでは毎日多くのマッチングが成立中\n\n`) +
        `🟢 現在の最安レート: ¥${snap.bestBuy.toFixed(2)}\n\n` +
        `✅ 銀行振込 → USDT受取まで最短30分\n` +
        `✅ エスクロー保護で安心取引\n` +
        `✅ アカウント登録・KYC不要\n\n` +
        `👉 <a href="${BASE_URL}/buy-usdt.html">今すぐ取引を始める</a>`
      );

    default:
      return '';
  }
}

// === X/Twitter Templates (10 patterns) ===

function pickXPattern(): number {
  // Pick pattern from 0-9, avoiding consecutive same pattern
  let pattern = xPostCount % 10;
  if (pattern === lastXPattern) {
    pattern = (pattern + 1) % 10;
  }
  lastXPattern = pattern;
  return pattern;
}

function buildTweet(snap: RateSnapshot, queueCount: number): string {
  const { timeStr, dateStr } = jstTime();
  const url = `${BASE_URL}/buy-usdt.html`;
  const pattern = pickXPattern();
  // Unique identifier to prevent duplicate detection
  // (currently unused — kept for future anti-dedup reuse)
  const _uid = crypto.randomBytes(2).toString('hex');

  switch (pattern) {
    // Pattern 0: Rate update (JP) with hashtags + URL
    case 0:
      return (
        `📊 USDT/JPY ¥${snap.bestBuy.toFixed(2)} [${dateStr} ${timeStr}]\n\n` +
        `${snap.bestBuyExchange}: ¥${snap.bestBuy.toFixed(2)}\n` +
        (queueCount > 0 ? `⚡ 即時マッチ ${queueCount}件\n\n` : '\n') +
        `銀行振込でUSDT購入 — P2Pより安い\n\n` +
        `${url}\n\n` +
        `#USDT #仮想通貨 #P2P #暗号資産 #PayMatch`
      );

    // Pattern 1: Rate update (EN) with hashtags + URL
    case 1:
      return (
        `💱 USDT/JPY ¥${snap.bestBuy.toFixed(2)} [${timeStr} JST]\n\n` +
        `Best rate via ${snap.bestBuyExchange}\n` +
        `PayMatch: ¥${(snap.bestBuy * 0.995).toFixed(2)} ← even lower\n\n` +
        `Bank transfer → USDT. No KYC.\n\n` +
        `${url}\n\n` +
        `#USDT #crypto #P2P #JPY #PayMatch`
      );

    // Pattern 2: Educational — What is USDT? (no URL)
    case 2:
      return (
        `💡 What is USDT?\n\n` +
        `A stablecoin pegged 1:1 to USD.\n` +
        `Buy with JPY bank transfer — no exchange account needed.\n\n` +
        `Current rate: ¥${snap.bestBuy.toFixed(2)}/USDT [${timeStr}]\n\n` +
        `#USDT #ステーブルコイン #crypto #仮想通貨入門 #PayMatch`
      );

    // Pattern 3: Comparison — exchange rates side by side (no URL)
    case 3: {
      const seen = new Set<string>();
      const lines: string[] = [];
      for (const o of snap.buyOrders.slice(0, 3)) {
        if (seen.has(o.exchange)) continue;
        seen.add(o.exchange);
        lines.push(`${o.exchange} ¥${o.price.toFixed(0)}`);
      }
      return (
        `⚖️ USDT/JPY比較 [${dateStr} ${timeStr}]\n\n` +
        lines.join(' | ') + '\n' +
        `✅ PayMatch ¥${(snap.bestBuy * 0.995).toFixed(0)} ← 最安\n\n` +
        `どこが一番安い？答えは明白\n\n` +
        `#USDT購入 #P2P比較 #仮想通貨 #USDT #PayMatch`
      );
    }

    // Pattern 4: "No KYC needed" angle + URL
    case 4:
      return (
        `🔓 KYC不要でUSDT購入 [${timeStr}]\n\n` +
        `レート: ¥${snap.bestBuy.toFixed(2)}\n` +
        `銀行振込だけ。本人確認なし。\n` +
        `アカウント登録も不要。\n\n` +
        `${url}\n\n` +
        `#USDT #KYC不要 #暗号資産 #P2P #仮想通貨`
      );

    // Pattern 5: "Bybit P2P alternative" angle (JP) (no URL)
    case 5:
      return (
        `🇯🇵 Bybit P2P撤退後の選択肢 [${timeStr}]\n\n` +
        `USDT最安: ¥${snap.bestBuy.toFixed(2)} (${snap.bestBuyExchange})\n` +
        `PayMatch: ¥${(snap.bestBuy * 0.995).toFixed(2)}\n\n` +
        `銀行振込OK・KYC不要・即時マッチング\n\n` +
        `#Bybit #USDT #P2P代替 #仮想通貨 #PayMatch`
      );

    // Pattern 6: Market insight with rate + URL
    case 6:
      return (
        `📈 USDT/JPY市場速報 [${dateStr} ${timeStr}]\n\n` +
        `買: ¥${snap.bestBuy.toFixed(2)} / 売: ¥${snap.bestSell.toFixed(2)}\n` +
        `スプレッド: ¥${snap.spread.toFixed(2)}\n\n` +
        `PayMatchで最安購入可能\n\n` +
        `${url}\n\n` +
        `#USDT #JPY #暗号資産市場 #P2P`
      );

    // Pattern 7: Speed angle — "Bank transfer → USDT in 30 min" (no URL)
    case 7:
      return (
        `⚡ 銀行振込 → USDT 最短30分 [${timeStr}]\n\n` +
        `現在レート: ¥${snap.bestBuy.toFixed(2)}\n` +
        (queueCount > 0 ? `即時マッチ可能: ${queueCount}件\n\n` : '\n') +
        `手順: 金額入力→振込→USDT受取\n` +
        `TRC-20対応・エスクロー保護\n\n` +
        `#USDT購入 #銀行振込 #即時 #crypto #PayMatch`
      );

    // Pattern 8: "Best rate guarantee" with proof + URL
    case 8: {
      const pmRate = snap.bestBuy * 0.995;
      return (
        `💎 最安レート保証 [${dateStr} ${timeStr}]\n\n` +
        `市場最安: ¥${snap.bestBuy.toFixed(2)}\n` +
        `PayMatch: ¥${pmRate.toFixed(2)}\n` +
        `差額: ¥${(snap.bestBuy - pmRate).toFixed(2)}/USDT お得\n\n` +
        `${url}\n\n` +
        `#USDT最安 #PayMatch #P2P #仮想通貨`
      );
    }

    // Pattern 9: Question/engagement (no URL)
    case 9:
      return (
        `🤔 今、USDT/JPYが一番安いのはどこ？\n\n` +
        `[${dateStr} ${timeStr}]\n` +
        `${snap.bestBuyExchange}: ¥${snap.bestBuy.toFixed(2)}\n` +
        `PayMatch: ¥${(snap.bestBuy * 0.995).toFixed(2)}\n\n` +
        `答え: PayMatchが最安 ✅\n\n` +
        `#USDT #仮想通貨 #P2P #暗号資産 #レート比較`
      );

    default:
      return '';
  }
}

// === Rate Alert Check ===

async function checkRateAlerts(bestBuyRate: number): Promise<void> {
  try {
    const { getActiveRateAlerts, triggerRateAlert } = await import('./database.js');
    const alerts = getActiveRateAlerts();
    if (!BOT_TOKEN || !alerts.length) return;

    for (const alert of alerts) {
      const triggered = alert.direction === 'below'
        ? bestBuyRate <= alert.target_rate
        : bestBuyRate >= alert.target_rate;

      if (triggered) {
        triggerRateAlert(alert.id);
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: alert.chat_id,
            text: `🔔 レートアラート\n\nUSDT/JPY が ¥${bestBuyRate.toFixed(2)} に到達しました！\n目標: ¥${alert.target_rate}`,
            reply_markup: {
              inline_keyboard: [[{ text: '💰 今すぐ購入', url: `${BASE_URL}/buy-usdt.html?utm_source=telegram&utm_medium=alert` }]]
            }
          }),
        });
        logger.info('Rate alert triggered', { alertId: alert.id, chatId: alert.chat_id, rate: bestBuyRate });
      }
    }
  } catch (e) {
    logger.debug('Rate alert check failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

// === Posting Logic ===

async function postTelegramUpdate(): Promise<void> {
  try {
    const snap = getUsdtSnapshot();
    if (!snap) {
      logger.warn('Marketing bot: no rate data for TG post');
      return;
    }

    // Check rate alerts on every TG posting cycle
    await checkRateAlerts(snap.bestBuy);

    const { queueCount, queueTotal } = getQueueInfo();
    const tgMessage = buildTelegramPost(snap, queueCount, queueTotal);
    const tgSent = await sendChannelMessage(tgMessage);
    if (tgSent) {
      logger.info('Marketing bot: TG posted', { tgPostCount, pattern: tgPostCount % 8, queueCount, bestBuy: snap.bestBuy });
    }
    tgPostCount++;
  } catch (e) {
    logger.error('Marketing bot TG post failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

async function postXUpdate(): Promise<void> {
  try {
    if (!X_ENABLED) return;

    const snap = getUsdtSnapshot();
    if (!snap) {
      logger.warn('Marketing bot: no rate data for X post');
      return;
    }

    const { queueCount } = getQueueInfo();
    const tweet = buildTweet(snap, queueCount);
    const xSent = await postTweet(tweet);
    if (xSent) {
      logger.info('Marketing bot: X posted', { xPostCount, pattern: lastXPattern });
    }
    xPostCount++;
  } catch (e) {
    logger.error('Marketing bot X post failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

// === Start/Stop ===

export function startMarketingBot(): void {
  if (!ENABLED) {
    logger.info('Marketing bot disabled');
    return;
  }
  if (!BOT_TOKEN || !CHANNEL_ID) {
    logger.warn('Marketing bot: TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID not set');
    return;
  }

  // First TG post after 30 seconds (allow rates to load)
  setTimeout(() => { postTelegramUpdate(); }, 30_000);
  // First X post after 60 seconds
  if (X_ENABLED) {
    setTimeout(() => { postXUpdate(); }, 60_000);
  }

  // Separate timers
  tgTimer = setInterval(postTelegramUpdate, TG_INTERVAL);

  if (X_ENABLED) {
    xTimer = setInterval(postXUpdate, X_INTERVAL);
  }

  logger.info('Marketing bot started', {
    channelId: CHANNEL_ID,
    xEnabled: X_ENABLED,
    tgIntervalHours: TG_INTERVAL / 3600000,
    xIntervalHours: X_INTERVAL / 3600000,
    tgPatterns: 8,
    xPatterns: 10,
  });
}

export function stopMarketingBot(): void {
  if (tgTimer) {
    clearInterval(tgTimer);
    tgTimer = null;
  }
  if (xTimer) {
    clearInterval(xTimer);
    xTimer = null;
  }
  logger.info('Marketing bot stopped');
}
