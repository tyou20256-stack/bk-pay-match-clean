"use strict";
/**
 * @file priceNotifier.ts — 価格通知サービス
 * @description 日次レートサマリー、急変動アラート、週次レポートを
 *   Telegramで顧客にプッシュ通知する。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPriceNotifier = startPriceNotifier;
exports.stopPriceNotifier = stopPriceNotifier;
const database_js_1 = require("./database.js");
const database_js_2 = __importDefault(require("./database.js"));
const BOT_TOKEN = '8447506670:AAGY2bcpbZxTe9OL3Jzxpdo86CHkb47XIig';
const API_BASE = 'http://localhost:3003';
let lastDailySentDate = '';
let lastWeeklySentDate = '';
let running = false;
let intervalId = null;
const recentSnapshots = [];
const MAX_SNAPSHOTS = 10;
async function tg(method, body) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return await res.json();
    }
    catch (e) {
        console.error(`[PriceNotifier] TG API error (${method}):`, e);
        return null;
    }
}
async function sendMessage(chatId, text, opts) {
    return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...opts });
}
async function fetchCurrentRates() {
    const result = {};
    for (const crypto of ['USDT', 'BTC', 'ETH']) {
        try {
            const res = await fetch(`${API_BASE}/api/rates/${crypto}`);
            const data = await res.json();
            if (data.success && data.data) {
                const exchanges = data.data.rates || [];
                const allBuy = [];
                const allSell = [];
                for (const ex of exchanges) {
                    for (const o of (ex.buyOrders || []))
                        allBuy.push(o);
                    for (const o of (ex.sellOrders || []))
                        allSell.push(o);
                }
                allBuy.sort((a, b) => Number(a.price) - Number(b.price));
                allSell.sort((a, b) => Number(b.price) - Number(a.price));
                if (allBuy.length > 0) {
                    result[crypto] = {
                        buy: Number(allBuy[0].price),
                        sell: allSell.length > 0 ? Number(allSell[0].price) : 0,
                        exchange: allBuy[0].exchange || '-',
                    };
                }
            }
        }
        catch (_) { }
    }
    return result;
}
function getYesterdayAvgRate(crypto) {
    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;
    const dayBefore = yesterday - 24 * 60 * 60 * 1000;
    const rows = database_js_2.default.prepare(`SELECT AVG(best_buy) as avgBuy, AVG(best_sell) as avgSell FROM price_history WHERE crypto = ? AND timestamp >= ? AND timestamp < ?`).get(crypto, dayBefore, yesterday);
    if (!rows || (!rows.avgBuy && !rows.avgSell))
        return null;
    return { buy: rows.avgBuy || 0, sell: rows.avgSell || 0 };
}
function getWeeklyStats(crypto) {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const minRow = database_js_2.default.prepare(`SELECT MIN(best_buy) as val, timestamp FROM price_history WHERE crypto = ? AND timestamp >= ? AND best_buy > 0`).get(crypto, weekAgo);
    const maxRow = database_js_2.default.prepare(`SELECT MAX(best_buy) as val, timestamp FROM price_history WHERE crypto = ? AND timestamp >= ? AND best_buy > 0`).get(crypto, weekAgo);
    if (!minRow?.val || !maxRow?.val)
        return null;
    const fmt = (ts) => new Date(ts).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' });
    return { min: minRow.val, max: maxRow.val, minDate: fmt(minRow.timestamp), maxDate: fmt(maxRow.timestamp) };
}
function formatChange(current, previous) {
    if (!previous || previous === 0)
        return '';
    const pct = ((current - previous) / previous * 100).toFixed(1);
    const sign = Number(pct) >= 0 ? '+' : '';
    return `（前日比 ${sign}${pct}%）`;
}
function formatPrice(price, crypto) {
    if (crypto === 'USDT')
        return `¥${price.toFixed(2)}`;
    return `¥${Math.round(price).toLocaleString()}`;
}
// ━━━━━━━━━━━━━━━━━━ A. 日次レートサマリー ━━━━━━━━━━━━━━━━━━
async function sendDailySummary() {
    const subscribers = (0, database_js_1.getNotificationSubscribers)('daily_summary');
    if (subscribers.length === 0)
        return;
    const rates = await fetchCurrentRates();
    if (Object.keys(rates).length === 0)
        return;
    const now = new Date();
    const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;
    let text = `📊 <b>BK Pay 本日のレート（${dateStr}）</b>\n\n`;
    let recommendation = '';
    for (const crypto of ['USDT', 'BTC', 'ETH']) {
        const rate = rates[crypto];
        if (!rate)
            continue;
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
    if (recommendation)
        text += recommendation + '\n';
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
    console.log(`[PriceNotifier] 日次サマリー送信完了: ${subscribers.length}人`);
}
// ━━━━━━━━━━━━━━━━━━ B. スパイクアラート ━━━━━━━━━━━━━━━━━━
async function checkSpikeAlerts() {
    const rates = await fetchCurrentRates();
    if (Object.keys(rates).length === 0)
        return;
    const now = Date.now();
    const snapshot = { timestamp: now, rates: {} };
    for (const [crypto, r] of Object.entries(rates)) {
        snapshot.rates[crypto] = { buy: r.buy, sell: r.sell };
    }
    recentSnapshots.push(snapshot);
    if (recentSnapshots.length > MAX_SNAPSHOTS)
        recentSnapshots.shift();
    const fiveMinAgo = now - 5 * 60 * 1000;
    const oldSnapshot = recentSnapshots.find(s => s.timestamp <= fiveMinAgo);
    if (!oldSnapshot)
        return;
    const subscribers = (0, database_js_1.getNotificationSubscribers)('spike_alerts');
    if (subscribers.length === 0)
        return;
    for (const crypto of ['USDT', 'BTC', 'ETH']) {
        const current = snapshot.rates[crypto];
        const old = oldSnapshot.rates[crypto];
        if (!current || !old || old.buy === 0)
            continue;
        const changePct = ((current.buy - old.buy) / old.buy) * 100;
        if (Math.abs(changePct) >= 3) {
            const direction = changePct < 0 ? '下落' : '上昇';
            const chance = changePct < 0 ? '今が購入チャンス！' : '売却のチャンスかも！';
            const text = `⚡ <b>レート急変動アラート</b>\n\n` +
                `${crypto}購入レートが5分間で${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%${direction}\n` +
                `${formatPrice(old.buy, crypto)} → ${formatPrice(current.buy, crypto)}\n\n` +
                `${chance}`;
            const markup = {
                inline_keyboard: [[{ text: '💰 今すぐ購入', callback_data: 'cb_buy' }]],
            };
            for (const telegramId of subscribers) {
                await sendMessage(telegramId, text, { reply_markup: markup });
            }
            console.log(`[PriceNotifier] スパイクアラート送信: ${crypto} ${changePct.toFixed(1)}%`);
        }
    }
    // アービトラージ機会チェック
    for (const crypto of ['USDT']) {
        const rate = rates[crypto];
        if (!rate || rate.buy === 0 || rate.sell === 0)
            continue;
        const arbPct = ((rate.sell - rate.buy) / rate.buy) * 100;
        if (arbPct >= 5) {
            const text = `🔥 <b>アービトラージ機会</b>\n\n` +
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
        const alertRows = database_js_2.default.prepare(`SELECT telegram_id, alert_crypto, alert_threshold FROM notification_preferences WHERE alert_threshold > 0`).all();
        for (const row of alertRows) {
            const rate = rates[row.alert_crypto];
            if (!rate)
                continue;
            if (rate.buy <= row.alert_threshold) {
                const text = `🔔 <b>アラート通知</b>\n\n` +
                    `${row.alert_crypto}が ¥${rate.buy.toLocaleString()} になりました！\n` +
                    `設定しきい値: ¥${row.alert_threshold.toLocaleString()}`;
                await sendMessage(row.telegram_id, text, {
                    reply_markup: {
                        inline_keyboard: [[{ text: '💰 今すぐ購入', callback_data: 'cb_buy' }]],
                    },
                });
                database_js_2.default.prepare('UPDATE notification_preferences SET alert_threshold = 0 WHERE telegram_id = ?').run(row.telegram_id);
            }
        }
    }
    catch (_) { }
}
// ━━━━━━━━━━━━━━━━━━ C. 週次レポート ━━━━━━━━━━━━━━━━━━
async function sendWeeklySummary() {
    const subscribers = (0, database_js_1.getNotificationSubscribers)('weekly_summary');
    if (subscribers.length === 0)
        return;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    let text = `📈 <b>BK Pay 週間レポート（${fmt(weekAgo)}-${fmt(now)}）</b>\n\n`;
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
            const orderCount = database_js_2.default.prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total FROM orders WHERE created_at >= ?`).get(weekAgoTs);
            if (orderCount?.cnt > 0) {
                personalText += `あなたの取引: ${orderCount.cnt}回 / ¥${Number(orderCount.total).toLocaleString()}\n\n`;
            }
        }
        catch (_) { }
        await sendMessage(telegramId, personalText, {
            reply_markup: {
                inline_keyboard: [[{ text: '📊 詳細を見る', callback_data: 'cb_history' }]],
            },
        });
    }
    console.log(`[PriceNotifier] 週次レポート送信完了: ${subscribers.length}人`);
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
        try {
            await sendDailySummary();
        }
        catch (e) {
            console.error('[PriceNotifier] 日次サマリーエラー:', e);
        }
        if (dayOfWeek === 1 && lastWeeklySentDate !== today) {
            lastWeeklySentDate = today;
            try {
                await sendWeeklySummary();
            }
            catch (e) {
                console.error('[PriceNotifier] 週次レポートエラー:', e);
            }
        }
    }
    try {
        await checkSpikeAlerts();
    }
    catch (e) {
        console.error('[PriceNotifier] スパイクアラートエラー:', e);
    }
}
function startPriceNotifier() {
    if (running)
        return;
    running = true;
    console.log('[PriceNotifier] 価格通知サービス起動');
    intervalId = setInterval(() => {
        tick().catch(e => console.error('[PriceNotifier] tick error:', e));
    }, 60 * 1000);
    tick().catch(e => console.error('[PriceNotifier] initial tick error:', e));
}
function stopPriceNotifier() {
    running = false;
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}
