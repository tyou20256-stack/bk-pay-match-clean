/**
 * @file telegramBot.ts — Telegram注文ボット
 * @description 顧客がTelegram経由でUSDT購入注文を作成できるボット。
 *   Long polling (getUpdates) を使用。ライブラリ不要。
 */

const BOT_TOKEN = '8447506670:AAGY2bcpbZxTe9OL3Jzxpdo86CHkb47XIig';
const API_BASE = 'http://localhost:3003';

type ConversationState = 'idle' | 'awaiting_amount';

interface ChatState {
  state: ConversationState;
  data?: any;
}

const conversations = new Map<number, ChatState>();
let updateOffset = 0;
let running = false;

function getState(chatId: number): ChatState {
  if (!conversations.has(chatId)) conversations.set(chatId, { state: 'idle' });
  return conversations.get(chatId)!;
}

async function tg(method: string, body: any): Promise<any> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error(`[TelegramBot] API error (${method}):`, e);
    return null;
  }
}

async function sendMessage(chatId: number, text: string, opts?: { reply_markup?: any }) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...opts });
}

async function answerCallback(callbackId: string, text?: string) {
  return tg('answerCallbackQuery', { callback_query_id: callbackId, text });
}

async function handleStart(chatId: number) {
  conversations.set(chatId, { state: 'idle' });
  await sendMessage(chatId,
    `🏦 <b>BK Pay — USDT購入ボット</b>\n\n` +
    `日本円でUSDTを簡単に購入できます。\n` +
    `下のボタンまたはコマンドをお使いください。`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'USDT購入', callback_data: 'buy' }],
          [{ text: 'レート確認', callback_data: 'rates' }, { text: 'ヘルプ', callback_data: 'help' }],
        ],
      },
    }
  );
}

async function handleBuy(chatId: number) {
  conversations.set(chatId, { state: 'awaiting_amount' });
  await sendMessage(chatId,
    `💱 <b>USDT購入</b>\n\n購入したい金額（日本円）を入力してください。\n\n例: <code>10000</code>\n\n最小: ¥1,000 / 最大: ¥1,000,000`
  );
}

async function handleAmount(chatId: number, text: string) {
  const amount = parseInt(text.replace(/[,，￥¥]/g, ''), 10);
  if (isNaN(amount) || amount < 1000 || amount > 1000000) {
    await sendMessage(chatId, '⚠️ 有効な金額を入力してください（1,000〜1,000,000円）');
    return;
  }

  await sendMessage(chatId, `⏳ 注文を作成中... ¥${amount.toLocaleString()}`);

  try {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        crypto: 'USDT',
        payMethod: 'bank',
        walletAddress: `tg_${chatId}`,
        source: 'telegram',
      }),
    });
    const data = await res.json();

    if (!data.success || !data.order) {
      await sendMessage(chatId, `❌ 注文作成に失敗しました: ${data.error || '不明なエラー'}`);
      conversations.set(chatId, { state: 'idle' });
      return;
    }

    const order = data.order;
    const account = data.account || order.bankAccount || {};

    let paymentInfo = `✅ <b>注文が作成されました</b>\n\n`;
    paymentInfo += `📋 注文ID: <code>${order.id}</code>\n`;
    paymentInfo += `💴 金額: ¥${order.amount?.toLocaleString()}\n`;
    paymentInfo += `💱 USDT: ${order.cryptoAmount}\n`;
    paymentInfo += `📊 レート: ¥${order.rate}\n\n`;
    paymentInfo += `🏦 <b>振込先情報</b>\n`;
    paymentInfo += `銀行名: ${account.bankName || '-'}\n`;
    paymentInfo += `支店名: ${account.branchName || '-'}\n`;
    paymentInfo += `口座種別: ${account.accountType || '普通'}\n`;
    paymentInfo += `口座番号: <code>${account.accountNumber || '-'}</code>\n`;
    paymentInfo += `口座名義: ${account.accountHolder || '-'}\n\n`;
    paymentInfo += `⏰ 制限時間内にお振込みください。\n`;
    paymentInfo += `振込完了後、下のボタンを押してください。`;

    await sendMessage(chatId, paymentInfo, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '振込完了', callback_data: `paid_${order.id}` }],
          [{ text: '注文状況確認', callback_data: `status_${order.id}` }],
        ],
      },
    });
  } catch (e) {
    console.error('[TelegramBot] Order creation error:', e);
    await sendMessage(chatId, '❌ サーバーに接続できませんでした。しばらくしてから再度お試しください。');
  }

  conversations.set(chatId, { state: 'idle' });
}

async function handleStatus(chatId: number, orderId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}`);
    const data = await res.json();

    if (!data.success || !data.order) {
      await sendMessage(chatId, `❌ 注文 <code>${orderId}</code> が見つかりません。`);
      return;
    }

    const o = data.order;
    const statusMap: Record<string, string> = {
      pending: '⏳ 支払い待ち',
      paid: '💰 振込完了（確認中）',
      completed: '✅ 完了',
      cancelled: '❌ キャンセル',
      expired: '⏰ 期限切れ',
    };

    await sendMessage(chatId,
      `📋 <b>注文状況</b>\n\n` +
      `ID: <code>${o.id}</code>\n` +
      `状態: ${statusMap[o.status] || o.status}\n` +
      `金額: ¥${o.amount?.toLocaleString()}\n` +
      `USDT: ${o.cryptoAmount}\n` +
      `レート: ¥${o.rate}\n` +
      `作成: ${new Date(o.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
    );
  } catch (e) {
    await sendMessage(chatId, '❌ ステータスの取得に失敗しました。');
  }
}

async function handleRates(chatId: number) {
  try {
    const res = await fetch(`${API_BASE}/api/rates/USDT`);
    const data = await res.json();

    if (!data.success) {
      await sendMessage(chatId, '❌ レート情報を取得できませんでした。');
      return;
    }

    let text = `📊 <b>USDT/JPY 現在のレート</b>\n\n`;
    const rates = data.rates || data.data || [];
    if (Array.isArray(rates) && rates.length > 0) {
      for (const r of rates.slice(0, 10)) {
        text += `${r.exchange || '-'}: ¥${Number(r.price).toLocaleString()} (${r.payMethod || '-'})\n`;
      }
    } else if (data.bestRate) {
      text += `ベストレート: ¥${Number(data.bestRate).toLocaleString()}\n`;
    } else {
      text += `データなし\n`;
    }

    await sendMessage(chatId, text);
  } catch (e) {
    await sendMessage(chatId, '❌ レート情報を取得できませんでした。');
  }
}

async function handleHelp(chatId: number) {
  await sendMessage(chatId,
    `📖 <b>コマンド一覧</b>\n\n` +
    `/start — メニュー表示\n` +
    `/buy — USDT購入\n` +
    `/status ORD-xxx — 注文状況確認\n` +
    `/rates — 現在のレート\n` +
    `/help — このヘルプ`
  );
}

async function handlePaid(chatId: number, orderId: string) {
  try {
    const res = await fetch(`${API_BASE}/api/orders/${orderId}/paid`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      await sendMessage(chatId,
        `✅ <b>振込完了を受け付けました</b>\n\n` +
        `注文ID: <code>${orderId}</code>\n` +
        `スタッフが確認中です。しばらくお待ちください。`
      );
    } else {
      await sendMessage(chatId, `❌ エラー: ${data.error || '処理に失敗しました'}`);
    }
  } catch (e) {
    await sendMessage(chatId, '❌ サーバーに接続できませんでした。');
  }
}

async function processUpdate(update: any) {
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const data = cb.data as string;
    if (!chatId) return;

    await answerCallback(cb.id);

    if (data === 'buy') return handleBuy(chatId);
    if (data === 'rates') return handleRates(chatId);
    if (data === 'help') return handleHelp(chatId);
    if (data.startsWith('paid_')) return handlePaid(chatId, data.slice(5));
    if (data.startsWith('status_')) return handleStatus(chatId, data.slice(7));
    return;
  }

  const msg = update.message;
  if (!msg?.text || !msg.chat?.id) return;

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const chat = getState(chatId);

  if (text === '/start') return handleStart(chatId);
  if (text === '/buy' || text === 'USDT購入') return handleBuy(chatId);
  if (text === '/rates') return handleRates(chatId);
  if (text === '/help') return handleHelp(chatId);
  if (text.startsWith('/status')) {
    const id = text.split(/\s+/)[1];
    if (id) return handleStatus(chatId, id);
    await sendMessage(chatId, '使い方: /status ORD-xxxxx');
    return;
  }

  if (chat.state === 'awaiting_amount') {
    return handleAmount(chatId, text);
  }
}

async function poll() {
  while (running) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${updateOffset}&timeout=30&allowed_updates=["message","callback_query"]`
      );
      const data = await res.json();

      if (data.ok && data.result?.length) {
        for (const update of data.result) {
          updateOffset = update.update_id + 1;
          processUpdate(update).catch(e => console.error('[TelegramBot] Update error:', e));
        }
      }
    } catch (e) {
      console.error('[TelegramBot] Polling error:', e);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

export function startTelegramBot() {
  if (running) return;
  running = true;
  console.log('[TelegramBot] Starting long polling...');
  poll();
}

export function stopTelegramBot() {
  running = false;
}
