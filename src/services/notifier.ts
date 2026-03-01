// Telegram notification service for BK Pay
const ENABLED = false; // Set to true to enable Telegram notifications
const BOT_TOKEN = '8447506670:AAGY2bcpbZxTe9OL3Jzxpdo86CHkb47XIig';
const STAFF_CHAT_ID = '5791086501';

async function sendTelegram(text: string): Promise<void> {
  if (!ENABLED) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: STAFF_CHAT_ID, text, parse_mode: 'HTML' })
    });
  } catch (e) {
    console.error('[Notifier] Telegram send failed:', e);
  }
}

export function notifyNewOrder(order: any): void {
  const mode = order.mode === 'auto' ? '🔄 AUTO' : '🏦 SELF';
  sendTelegram(
    `📥 <b>新規注文</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `金額: ¥${order.amount.toLocaleString()}\n` +
    `USDT: ${order.cryptoAmount}\n` +
    `レート: ¥${order.rate}\n` +
    `支払: ${order.payMethod}\n` +
    `モード: ${mode}\n` +
    `取引所: ${order.exchange || '-'}`
  );
}

export function notifyPaid(order: any): void {
  sendTelegram(
    `💰 <b>振込完了報告</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `金額: ¥${order.amount.toLocaleString()}\n` +
    `⚠️ 入金確認してください`
  );
}

export function notifyCompleted(order: any): void {
  sendTelegram(
    `✅ <b>注文完了</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `¥${order.amount.toLocaleString()} → ${order.cryptoAmount} USDT`
  );
}

export function notifyCancelled(order: any): void {
  sendTelegram(
    `❌ <b>注文キャンセル</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `金額: ¥${order.amount.toLocaleString()}`
  );
}

export function notifyExpired(order: any): void {
  sendTelegram(
    `⏰ <b>注文期限切れ</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `金額: ¥${order.amount.toLocaleString()}`
  );
}

export default { notifyNewOrder, notifyPaid, notifyCompleted, notifyCancelled, notifyExpired };
