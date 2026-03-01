/**
 * @file telegramBot.ts — Telegram注文ボット
 * @description 顧客がTelegram経由でUSDT購入注文を作成できるボット。
 *   Long polling (getUpdates) を使用。ライブラリ不要。
 */

const BOT_TOKEN = '8447506670:AAGY2bcpbZxTe9OL3Jzxpdo86CHkb47XIig';
const API_BASE = 'http://localhost:3003';
const MINIAPP_URL = process.env.MINIAPP_URL || 'https://debi-unominous-overcasually.ngrok-free.dev/miniapp.html';

type ConversationState = 'idle' | 'awaiting_amount' | 'awaiting_crypto_selection' | 'awaiting_order_id';

interface ChatState {
  state: ConversationState;
  data?: any;
}

interface AlertSetting {
  crypto: string;
  threshold: number;
}

const conversations = new Map<number, ChatState>();
const userAlerts = new Map<number, AlertSetting>();
let updateOffset = 0;
let running = false;

function getState(chatId: number): ChatState {
  if (!conversations.has(chatId)) conversations.set(chatId, { state: 'idle' });
  return conversations.get(chatId)!;
}

/** Parse Japanese amount expressions like "5万", "10万円", "1万5千", "5000円" */
function parseJapaneseAmount(text: string): number | null {
  let s = text.replace(/[,，￥¥円\s]/g, '');
  let total = 0;
  const manMatch = s.match(/(\d+)万/);
  if (manMatch) {
    total += parseInt(manMatch[1]) * 10000;
    s = s.replace(/\d+万/, '');
  }
  const senMatch = s.match(/(\d+)千/);
  if (senMatch) {
    total += parseInt(senMatch[1]) * 1000;
    s = s.replace(/\d+千/, '');
  }
  const remaining = s.replace(/[^\d]/g, '');
  if (remaining) {
    if (total === 0) {
      total = parseInt(remaining);
    } else {
      total += parseInt(remaining);
    }
  }
  return total > 0 ? total : null;
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

async function sendMessage(chatId: number, text: string, opts?: { reply_markup?: any; parse_mode?: string }) {
  return tg('sendMessage', { chat_id: chatId, text, parse_mode: opts?.parse_mode || 'HTML', ...opts });
}

async function answerCallback(callbackId: string, text?: string) {
  return tg('answerCallbackQuery', { callback_query_id: callbackId, text });
}

// ━━━━━━━━━━━━━━━━━━ Handlers ━━━━━━━━━━━━━━━━━━

async function handleStart(chatId: number) {
  conversations.set(chatId, { state: 'idle' });
  await sendMessage(chatId,
    `━━━━━━━━━━━━━━\n` +
    `🏦 <b>BK Pay へようこそ！</b>\n\n` +
    `日本円で暗号通貨を簡単に購入できます。\n` +
    `3つの取引所から最安レートを自動検索。\n\n` +
    `↓ メニューからお選びください\n` +
    `━━━━━━━━━━━━━━`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 USDT購入', callback_data: 'cb_buy' },
            { text: '📊 レート確認', callback_data: 'cb_rates' },
          ],
          [
            { text: '🔍 注文確認', callback_data: 'cb_status' },
            { text: '📋 注文履歴', callback_data: 'cb_history' },
          ],
          [
            { text: '🧮 金額計算', callback_data: 'cb_calc' },
            { text: '⏰ アラート設定', callback_data: 'cb_alert' },
          ],
          [{ text: '📖 使い方ガイド', callback_data: 'cb_help' }],
          [{ text: '🌐 BK Payを開く', web_app: { url: MINIAPP_URL } }],
        ],
      },
    }
  );
}

async function handleBuy(chatId: number) {
  conversations.set(chatId, { state: 'awaiting_amount' });
  await sendMessage(chatId,
    `💱 <b>暗号通貨購入</b>\n\n` +
    `購入したい金額（日本円）を入力してください。\n\n` +
    `例: <code>10000</code> または <code>5万</code>\n\n` +
    `最小: ¥1,000 / 最大: ¥1,000,000`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '¥5,000', callback_data: 'amt_5000' },
            { text: '¥10,000', callback_data: 'amt_10000' },
          ],
          [
            { text: '¥30,000', callback_data: 'amt_30000' },
            { text: '¥50,000', callback_data: 'amt_50000' },
          ],
          [{ text: '¥100,000', callback_data: 'amt_100000' }],
        ],
      },
    }
  );
}

async function fetchCurrentRates(): Promise<{ usdt?: any; btc?: any; eth?: any }> {
  const result: any = {};
  for (const crypto of ['USDT', 'BTC', 'ETH']) {
    try {
      const res = await fetch(`${API_BASE}/api/rates/${crypto}`);
      const data = await res.json();
      if (data.success && data.data) {
        const exchanges = data.data.rates || [];
        const allBuy: any[] = [];
        const allSell: any[] = [];
        for (const ex of exchanges) {
          for (const o of (ex.buyOrders || [])) allBuy.push(o);
          for (const o of (ex.sellOrders || [])) allSell.push(o);
        }
        allBuy.sort((a: any, b: any) => Number(a.price) - Number(b.price));
        allSell.sort((a: any, b: any) => Number(b.price) - Number(a.price));
        if (allBuy.length > 0 || allSell.length > 0) {
          result[crypto.toLowerCase()] = {
            bestBuy: allBuy[0] || { price: 0, exchange: '-' },
            bestSell: allSell[0] || { price: 0, exchange: '-' },
            spread: allBuy[0] && allSell[0] ? (Number(allBuy[0].price) - Number(allSell[0].price)).toFixed(2) : '0',
          };
        }
      }
    } catch (_) {}
  }
  return result;
}

async function showCryptoSelection(chatId: number, amount: number) {
  const rateData = await fetchCurrentRates();

  let text = `🧮 <b>金額シミュレーション</b>\n\n💴 入金額: ¥${amount.toLocaleString()}\n\n`;

  const calcLine = (crypto: string, key: string, label: string) => {
    const d = (rateData as any)[key];
    if (!d?.bestBuy) return { text: '', amount: '---', exchange: '' };
    const price = Number(d.bestBuy.price);
    const cryptoAmt = (amount / price).toFixed(crypto === 'USDT' ? 2 : 6);
    return {
      text: `│ ${label}: ${cryptoAmt}\n│ レート: ¥${price.toLocaleString()}\n│ 取引所: ${d.bestBuy.exchange || '-'}\n`,
      amount: cryptoAmt,
      exchange: d.bestBuy.exchange || '-',
    };
  };

  const usdt = calcLine('USDT', 'usdt', 'USDT');
  const btc = calcLine('BTC', 'btc', 'BTC');
  const eth = calcLine('ETH', 'eth', 'ETH');

  text += `┌─────────────────────┐\n`;
  text += usdt.text || `│ USDT: データなし\n`;
  text += `├─────────────────────┤\n`;
  text += btc.text || `│ BTC: データなし\n`;
  text += `├─────────────────────┤\n`;
  text += eth.text || `│ ETH: データなし\n`;
  text += `└─────────────────────┘\n\n`;
  text += `購入する通貨を選択:`;

  await sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `USDT (${usdt.amount})`, callback_data: `buy_USDT_${amount}` }],
        [{ text: `BTC (${btc.amount})`, callback_data: `buy_BTC_${amount}` }],
        [{ text: `ETH (${eth.amount})`, callback_data: `buy_ETH_${amount}` }],
      ],
    },
  });

  conversations.set(chatId, { state: 'idle' });
}

async function handleAmount(chatId: number, text: string) {
  const amount = parseJapaneseAmount(text);
  if (!amount || amount < 1000 || amount > 1000000) {
    await sendMessage(chatId, '⚠️ 有効な金額を入力してください（1,000〜1,000,000円）');
    return;
  }

  await sendMessage(chatId, `⏳ レートを取得中... ¥${amount.toLocaleString()}`);
  await showCryptoSelection(chatId, amount);
}

async function handleCreateOrder(chatId: number, crypto: string, amount: number) {
  await sendMessage(chatId, `⏳ 注文を作成中... ¥${amount.toLocaleString()} → ${crypto}`);

  try {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        crypto,
        payMethod: 'bank',
        walletAddress: `tg_${chatId}`,
        source: 'telegram',
      }),
    });
    const data = await res.json();

    if (!data.success || !data.order) {
      await sendMessage(chatId, `❌ 注文作成に失敗しました: ${data.error || '不明なエラー'}`);
      return;
    }

    const order = data.order;
    const account = data.account || order.bankAccount || {};

    let paymentInfo = `✅ <b>注文が作成されました</b>\n\n`;
    paymentInfo += `📋 注文ID: <code>${order.id}</code>\n`;
    paymentInfo += `💴 金額: ¥${order.amount?.toLocaleString()}\n`;
    paymentInfo += `💱 ${crypto}: ${order.cryptoAmount}\n`;
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
          [{ text: '✅ 振込完了', callback_data: `paid_${order.id}` }],
          [{ text: '📋 注文状況確認', callback_data: `status_${order.id}` }],
        ],
      },
    });
  } catch (e) {
    console.error('[TelegramBot] Order creation error:', e);
    await sendMessage(chatId, '❌ サーバーに接続できませんでした。しばらくしてから再度お試しください。');
  }
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
      `${o.crypto || 'USDT'}: ${o.cryptoAmount}\n` +
      `レート: ¥${o.rate}\n` +
      `作成: ${new Date(o.createdAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`
    );
  } catch (e) {
    await sendMessage(chatId, '❌ ステータスの取得に失敗しました。');
  }
}

async function handleRates(chatId: number) {
  try {
    const rateData = await fetchCurrentRates();
    const now = new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

    let text = `📊 <b>現在のレート（リアルタイム）</b>\n\n`;

    const formatCryptoRate = (label: string, data: any) => {
      if (!data?.bestBuy) return `━━ ${label} ━━\nデータなし\n\n`;
      const buyPrice = Number(data.bestBuy.price);
      const sellPrice = Number(data.bestSell.price);
      const spread = Math.abs(sellPrice - buyPrice);
      const spreadPct = ((spread / buyPrice) * 100).toFixed(2);

      let s = `━━ ${label} ━━\n`;
      s += `🟢 購入: ¥${buyPrice.toLocaleString()}（${data.bestBuy.exchange}最安）\n`;
      s += `🔴 売却: ¥${sellPrice.toLocaleString()}（${data.bestSell.exchange}最高）\n`;
      s += `📈 スプレッド: ¥${spread.toLocaleString()} (${spreadPct}%)\n\n`;
      return s;
    };

    text += formatCryptoRate('USDT/JPY', rateData.usdt);
    text += formatCryptoRate('BTC/JPY', rateData.btc);
    text += formatCryptoRate('ETH/JPY', rateData.eth);
    text += `更新: ${now} | 30秒毎に自動更新`;

    await sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 更新', callback_data: 'cb_rates' },
            { text: '💰 購入する', callback_data: 'cb_buy' },
          ],
        ],
      },
    });
  } catch (e) {
    await sendMessage(chatId, '❌ レート情報を取得できませんでした。');
  }
}

async function handleHelp(chatId: number) {
  await sendMessage(chatId,
    `📖 <b>BK Pay の使い方</b>\n\n` +
    `1️⃣ /buy → 購入する通貨と金額を選択\n` +
    `2️⃣ 振込先が表示されます\n` +
    `3️⃣ 振込後「振込完了」ボタンをタップ\n` +
    `4️⃣ 確認後、暗号通貨が送金されます\n\n` +
    `⏱ 制限時間: 15分以内に振込\n` +
    `💰 対応通貨: USDT / BTC / ETH\n` +
    `🏦 対応支払: 銀行振込 / PayPay\n\n` +
    `━━ コマンド一覧 ━━\n` +
    `/buy — 暗号通貨を購入\n` +
    `/rates — レート確認\n` +
    `/calc — 金額シミュレーション\n` +
    `/status — 注文確認\n` +
    `/history — 注文履歴\n` +
    `/alert — アラート設定\n` +
    `/wallet — ウォレット確認\n` +
    `/help — この画面\n\n` +
    `💡 下のメニューボタン「BK Pay」から\n` +
    `   アプリ版もご利用いただけます`
  );
}

async function handleCalc(chatId: number, amountStr?: string) {
  if (amountStr) {
    const amount = parseJapaneseAmount(amountStr);
    if (amount && amount > 0) {
      await showCryptoSelection(chatId, amount);
      return;
    }
  }

  await sendMessage(chatId,
    `🧮 <b>金額シミュレーション</b>\n\n計算したい金額を選択または入力してください:`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '¥5,000', callback_data: 'calc_5000' },
            { text: '¥10,000', callback_data: 'calc_10000' },
          ],
          [
            { text: '¥30,000', callback_data: 'calc_30000' },
            { text: '¥50,000', callback_data: 'calc_50000' },
          ],
          [{ text: '¥100,000', callback_data: 'calc_100000' }],
        ],
      },
    }
  );
}

async function handleHistory(chatId: number) {
  try {
    const res = await fetch(`${API_BASE}/api/orders`, {
      headers: { 'X-Telegram-Chat-Id': String(chatId) },
    });
    const data = await res.json();

    const orders = data.orders || data.data || [];
    if (!Array.isArray(orders) || orders.length === 0) {
      await sendMessage(chatId, '📋 注文履歴がありません。');
      return;
    }

    const statusEmoji: Record<string, string> = {
      pending: '⏳',
      paid: '💰',
      completed: '✅',
      cancelled: '❌',
      expired: '⏰',
    };
    const statusLabel: Record<string, string> = {
      pending: '待機中',
      paid: '確認中',
      completed: '完了',
      cancelled: 'キャンセル',
      expired: '期限切れ',
    };

    let text = `📋 <b>最近の注文</b>\n\n`;
    const recent = orders.slice(0, 5);
    recent.forEach((o: any, i: number) => {
      const date = new Date(o.createdAt).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      const emoji = statusEmoji[o.status] || '❓';
      const label = statusLabel[o.status] || o.status;
      text += `${i + 1}. <code>${o.id}</code> | ¥${Number(o.amount).toLocaleString()} → ${o.cryptoAmount} ${o.crypto || 'USDT'} | ${emoji}${label}\n   ${date}\n\n`;
    });

    text += `(過去${recent.length}件を表示)`;
    await sendMessage(chatId, text);
  } catch (e) {
    await sendMessage(chatId, '❌ 注文履歴の取得に失敗しました。');
  }
}

async function handleAlert(chatId: number, args?: string) {
  if (!args) {
    const alert = userAlerts.get(chatId);
    if (!alert) {
      await sendMessage(chatId,
        `⏰ <b>アラート設定</b>\n\n現在アラートは設定されていません。\n\n` +
        `設定方法:\n<code>/alert usdt 150</code> → USDTが¥150以下になったら通知\n` +
        `<code>/alert off</code> → アラート解除`
      );
    } else {
      await sendMessage(chatId,
        `⏰ <b>アラート設定</b>\n\n` +
        `通貨: ${alert.crypto.toUpperCase()}\n` +
        `しきい値: ¥${alert.threshold.toLocaleString()}\n\n` +
        `<code>/alert off</code> で解除`
      );
    }
    return;
  }

  if (args.toLowerCase() === 'off') {
    userAlerts.delete(chatId);
    await sendMessage(chatId, '✅ アラートを解除しました。');
    return;
  }

  const parts = args.split(/\s+/);
  if (parts.length >= 2) {
    const crypto = parts[0].toUpperCase();
    const threshold = Number(parts[1]);
    if (['USDT', 'BTC', 'ETH'].includes(crypto) && threshold > 0) {
      userAlerts.set(chatId, { crypto, threshold });
      await sendMessage(chatId,
        `✅ アラートを設定しました。\n\n` +
        `${crypto}が ¥${threshold.toLocaleString()} 以下になったら通知します。`
      );
      return;
    }
  }

  await sendMessage(chatId, '⚠️ 使い方: <code>/alert usdt 150</code> または <code>/alert off</code>');
}

async function handleWallet(chatId: number) {
  try {
    const res = await fetch(`${API_BASE}/api/wallet`);
    const data = await res.json();

    if (data.success && data.wallet) {
      const w = data.wallet;
      await sendMessage(chatId,
        `👛 <b>USDT受取ウォレット</b>\n\n` +
        `ネットワーク: ${w.network || 'TRC-20 (TRON)'}\n` +
        `アドレス: <code>${w.address}</code>\n\n` +
        `⚠️ 送金前に必ずアドレスを確認してください`
      );
    } else {
      await sendMessage(chatId, '❌ ウォレット情報を取得できませんでした。');
    }
  } catch (e) {
    await sendMessage(chatId, '❌ ウォレット情報を取得できませんでした。');
  }
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

async function checkAlerts() {
  if (userAlerts.size === 0) return;
  const rateData = await fetchCurrentRates();

  for (const [chatId, alert] of Array.from(userAlerts)) {
    const data = (rateData as any)[alert.crypto.toLowerCase()];
    if (!data?.bestBuy) continue;
    const price = Number(data.bestBuy.price);
    if (price <= alert.threshold) {
      await sendMessage(chatId,
        `🔔 <b>アラート通知</b>\n\n` +
        `${alert.crypto}が ¥${price.toLocaleString()} になりました！\n` +
        `設定しきい値: ¥${alert.threshold.toLocaleString()}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💰 今すぐ購入', callback_data: 'cb_buy' }],
              [{ text: '🔕 アラート解除', callback_data: 'alert_off' }],
            ],
          },
        }
      );
    }
  }
}

// ━━━━━━━━━━━━━━━━━━ Update Processing ━━━━━━━━━━━━━━━━━━

async function processUpdate(update: any) {
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat?.id;
    const data = cb.data as string;
    if (!chatId) return;

    await answerCallback(cb.id);

    if (data === 'cb_buy') return handleBuy(chatId);
    if (data === 'cb_rates') return handleRates(chatId);
    if (data === 'cb_status') {
      conversations.set(chatId, { state: 'awaiting_order_id' });
      await sendMessage(chatId, '🔍 注文IDを入力してください:\n\n例: <code>ORD-xxxxx</code>');
      return;
    }
    if (data === 'cb_history') return handleHistory(chatId);
    if (data === 'cb_calc') return handleCalc(chatId);
    if (data === 'cb_alert') return handleAlert(chatId);
    if (data === 'cb_help') return handleHelp(chatId);

    // Legacy callbacks
    if (data === 'buy') return handleBuy(chatId);
    if (data === 'rates') return handleRates(chatId);
    if (data === 'help') return handleHelp(chatId);

    // Amount quick select
    if (data.startsWith('amt_')) {
      const amount = parseInt(data.slice(4));
      await showCryptoSelection(chatId, amount);
      return;
    }

    // Calc quick select
    if (data.startsWith('calc_')) {
      const amount = parseInt(data.slice(5));
      await showCryptoSelection(chatId, amount);
      return;
    }

    // Crypto buy selection: buy_USDT_50000
    if (data.startsWith('buy_')) {
      const parts = data.split('_');
      if (parts.length === 3) {
        const crypto = parts[1];
        const amount = parseInt(parts[2]);
        return handleCreateOrder(chatId, crypto, amount);
      }
    }

    // Alert off from button
    if (data === 'alert_off') {
      userAlerts.delete(chatId);
      await sendMessage(chatId, '✅ アラートを解除しました。');
      return;
    }

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
  if (text === '/history') return handleHistory(chatId);
  if (text === '/wallet') return handleWallet(chatId);

  if (text.startsWith('/calc')) {
    const arg = text.replace('/calc', '').trim();
    return handleCalc(chatId, arg || undefined);
  }

  if (text.startsWith('/alert')) {
    const arg = text.replace('/alert', '').trim();
    return handleAlert(chatId, arg || undefined);
  }

  if (text.startsWith('/status')) {
    const id = text.split(/\s+/)[1];
    if (id) return handleStatus(chatId, id);
    conversations.set(chatId, { state: 'awaiting_order_id' });
    await sendMessage(chatId, '🔍 注文IDを入力してください:\n\n例: <code>ORD-xxxxx</code>');
    return;
  }

  // Conversation states
  if (chat.state === 'awaiting_amount') {
    return handleAmount(chatId, text);
  }

  if (chat.state === 'awaiting_order_id') {
    conversations.set(chatId, { state: 'idle' });
    return handleStatus(chatId, text);
  }
}

// ━━━━━━━━━━━━━━━━━━ Polling ━━━━━━━━━━━━━━━━━━

let alertCheckInterval: ReturnType<typeof setInterval> | null = null;

async function poll() {
  while (running) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${updateOffset}&timeout=30&allowed_updates=["message","callback_query"]`
      );
      const data = await res.json();
      console.log("[TelegramBot] Poll response:", data.ok, "updates:", data.result?.length || 0);

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

  // Check alerts every 60 seconds
  alertCheckInterval = setInterval(() => {
    checkAlerts().catch(e => console.error('[TelegramBot] Alert check error:', e));
  }, 60000);
}

export function stopTelegramBot() {
  running = false;
  if (alertCheckInterval) {
    clearInterval(alertCheckInterval);
    alertCheckInterval = null;
  }
}
