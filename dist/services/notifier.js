"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyNewOrder = notifyNewOrder;
exports.notifyPaid = notifyPaid;
exports.notifyCompleted = notifyCompleted;
exports.notifyCancelled = notifyCancelled;
exports.notifyExpired = notifyExpired;
/**
 * @file notifier.ts — Telegram通知サービス
 * @description 注文イベント（新規/振込完了/完了/キャンセル/期限切れ）を
 *   Telegram botでスタッフに即時通知。
 *   ENABLED = false で無効化可能。
 *   使用bot: @BKnewsmanagerbot
 */
// Telegram notification service for BK Pay
const ENABLED = false; // Set to true to enable Telegram notifications
const BOT_TOKEN = '8447506670:AAGY2bcpbZxTe9OL3Jzxpdo86CHkb47XIig';
const STAFF_CHAT_ID = '5791086501';
async function sendTelegram(text) {
    if (!ENABLED)
        return;
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: STAFF_CHAT_ID, text, parse_mode: 'HTML' })
        });
    }
    catch (e) {
        console.error('[Notifier] Telegram send failed:', e);
    }
}
function notifyNewOrder(order) {
    const mode = order.mode === 'auto' ? '🔄 AUTO' : '🏦 SELF';
    sendTelegram(`📥 <b>新規注文</b>\n` +
        `ID: <code>${order.id}</code>\n` +
        `金額: ¥${order.amount.toLocaleString()}\n` +
        `USDT: ${order.cryptoAmount}\n` +
        `レート: ¥${order.rate}\n` +
        `支払: ${order.payMethod}\n` +
        `モード: ${mode}\n` +
        `取引所: ${order.exchange || '-'}`);
}
function notifyPaid(order) {
    sendTelegram(`💰 <b>振込完了報告</b>\n` +
        `ID: <code>${order.id}</code>\n` +
        `金額: ¥${order.amount.toLocaleString()}\n` +
        `⚠️ 入金確認してください`);
}
function notifyCompleted(order) {
    sendTelegram(`✅ <b>注文完了</b>\n` +
        `ID: <code>${order.id}</code>\n` +
        `¥${order.amount.toLocaleString()} → ${order.cryptoAmount} USDT`);
}
function notifyCancelled(order) {
    sendTelegram(`❌ <b>注文キャンセル</b>\n` +
        `ID: <code>${order.id}</code>\n` +
        `金額: ¥${order.amount.toLocaleString()}`);
}
function notifyExpired(order) {
    sendTelegram(`⏰ <b>注文期限切れ</b>\n` +
        `ID: <code>${order.id}</code>\n` +
        `金額: ¥${order.amount.toLocaleString()}`);
}
exports.default = { notifyNewOrder, notifyPaid, notifyCompleted, notifyCancelled, notifyExpired };
