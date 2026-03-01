/**
 * @file telegramBot.ts — Telegram注文ボット
 * @description 顧客がTelegram経由でUSDT購入注文を作成できるボット。
 *   Long polling (getUpdates) を使用。ライブラリ不要。
 */

import { getNotificationPreferences, setNotificationPreference, setAlertThreshold } from './database.js';

const BOT_TOKEN = '8447506670:AAGY2bcpbZxTe9OL3Jzxpdo86CHkb47XIig';
const API_BASE = 'http://localhost:3003';
import * as dbSvc from './database.js';
const MINIAPP_URL = process.env.MINIAPP_URL || 'https://debi-unominous-overcasually.ngrok-free.dev/miniapp.html';
const MYPAGE_URL = MINIAPP_URL.replace('miniapp.html', 'mypage.html');

type ConversationState = 'idle' | 'awaiting_amount' | 'awaiting_crypto_selection' | 'awaiting_order_id' | 'sell_awaiting_crypto' | 'sell_awaiting_amount' | 'sell_awaiting_bank' | 'sell_confirm';

interface ChatState {
  state: ConversationState;
  data?: any;
}

interface AlertSetting {
  crypto: string;
  threshold: number;
}

const conversations = new Map<number, ChatState>();

// ━━━━━━━━━━━━━━━━━━ Multi-language Support ━━━━━━━━━━━━━━━━━━
const userLanguages = new Map<number, string>();

const botTranslations: Record<string, Record<string, string>> = {
  ja: {
    welcome: '🏦 <b>BK Pay へようこそ！</b>\n\n日本円で暗号通貨を簡単に購入できます。\n3つの取引所から最安レートを自動検索。\n\n↓ メニューからお選びください',
    buy_prompt: '💱 <b>暗号通貨購入</b>\n\n購入したい金額（日本円）を入力してください。\n\n例: <code>10000</code> または <code>5万</code>\n\n最小: ¥1,000 / 最大: ¥1,000,000',
    rates_title: '📊 <b>現在のレート（リアルタイム）</b>\n\n',
    help_title: '📖 <b>BK Pay の使い方</b>',
    lang_title: '🌐 <b>言語設定 / Language</b>\n\n現在の言語: 日本語\n\n言語を選択してください:',
    lang_set: '✅ 言語を日本語に設定しました。',
    buy_btn: '💰 USDT購入',
    sell_btn: '💱 暗号通貨売却',
    rates_btn: '📊 レート確認',
    status_btn: '🔍 注文確認',
    history_btn: '📋 注文履歴',
    calc_btn: '🧮 金額計算',
    alert_btn: '⏰ アラート設定',
    notify_btn: '🔔 通知設定',
    help_btn: '📖 使い方ガイド',
    open_btn: '🌐 BK Payを開く',
    mypage_btn: '📊 マイページ',
  },
  en: {
    welcome: '🏦 <b>Welcome to BK Pay!</b>\n\nEasily buy cryptocurrency with Japanese Yen.\nAutomatically finds the best rates from 3 exchanges.\n\n↓ Select from the menu below',
    buy_prompt: '💱 <b>Buy Cryptocurrency</b>\n\nEnter the amount in JPY you want to spend.\n\nExample: <code>10000</code> or <code>5万</code>\n\nMin: ¥1,000 / Max: ¥1,000,000',
    rates_title: '📊 <b>Current Rates (Real-time)</b>\n\n',
    help_title: '📖 <b>How to use BK Pay</b>',
    lang_title: '🌐 <b>Language Settings</b>\n\nCurrent: English\n\nSelect your language:',
    lang_set: '✅ Language set to English.',
    buy_btn: '💰 Buy USDT',
    sell_btn: '💱 Sell Crypto',
    rates_btn: '📊 Check Rates',
    status_btn: '🔍 Order Status',
    history_btn: '📋 Order History',
    calc_btn: '🧮 Calculator',
    alert_btn: '⏰ Price Alerts',
    notify_btn: '🔔 Notifications',
    help_btn: '📖 User Guide',
    open_btn: '🌐 Open BK Pay',
    mypage_btn: '📊 My Page',
  },
  zh: {
    welcome: '🏦 <b>欢迎使用 BK Pay！</b>\n\n用日元轻松购买加密货币。\n自动从3个交易所搜索最优汇率。\n\n↓ 请从菜单中选择',
    buy_prompt: '💱 <b>购买加密货币</b>\n\n请输入您想购买的日元金额。\n\n例: <code>10000</code> 或 <code>5万</code>\n\n最低: ¥1,000 / 最高: ¥1,000,000',
    rates_title: '📊 <b>当前汇率（实时）</b>\n\n',
    help_title: '📖 <b>BK Pay 使用方法</b>',
    lang_title: '🌐 <b>语言设置</b>\n\n当前语言: 中文\n\n选择语言:',
    lang_set: '✅ 语言已设置为中文。',
    buy_btn: '💰 购买USDT',
    sell_btn: '💱 出售加密货币',
    rates_btn: '📊 查看汇率',
    status_btn: '🔍 订单查询',
    history_btn: '📋 订单历史',
    calc_btn: '🧮 金额计算',
    alert_btn: '⏰ 价格提醒',
    notify_btn: '🔔 通知设置',
    help_btn: '📖 使用指南',
    open_btn: '🌐 打开BK Pay',
    mypage_btn: '📊 我的页面',
  },
  vi: {
    welcome: '🏦 <b>Chào mừng đến BK Pay!</b>\n\nMua tiền mã hóa dễ dàng bằng Yên Nhật.\nTự động tìm tỷ giá tốt nhất từ 3 sàn giao dịch.\n\n↓ Chọn từ menu bên dưới',
    buy_prompt: '💱 <b>Mua tiền mã hóa</b>\n\nNhập số tiền JPY bạn muốn chi.\n\nVí dụ: <code>10000</code> hoặc <code>5万</code>\n\nTối thiểu: ¥1,000 / Tối đa: ¥1,000,000',
    rates_title: '📊 <b>Tỷ giá hiện tại (Thời gian thực)</b>\n\n',
    help_title: '📖 <b>Cách sử dụng BK Pay</b>',
    lang_title: '🌐 <b>Cài đặt ngôn ngữ</b>\n\nHiện tại: Tiếng Việt\n\nChọn ngôn ngữ:',
    lang_set: '✅ Đã đặt ngôn ngữ thành Tiếng Việt.',
    buy_btn: '💰 Mua USDT',
    sell_btn: '💱 Bán Crypto',
    rates_btn: '📊 Xem tỷ giá',
    status_btn: '🔍 Tra cứu đơn',
    history_btn: '📋 Lịch sử đơn',
    calc_btn: '🧮 Tính toán',
    alert_btn: '⏰ Cảnh báo giá',
    notify_btn: '🔔 Thông báo',
    help_btn: '📖 Hướng dẫn',
    open_btn: '🌐 Mở BK Pay',
    mypage_btn: '📊 Trang cá nhân',
  },
};

function getBotLang(chatId: number): string {
  return userLanguages.get(chatId) || 'ja';
}

function bt(chatId: number, key: string): string {
  const lang = getBotLang(chatId);
  return botTranslations[lang]?.[key] || botTranslations['ja']?.[key] || key;
}

async function handleLang(chatId: number) {
  const lang = getBotLang(chatId);
  const titles: Record<string, string> = {
    ja: '🌐 <b>言語設定 / Language</b>\n\n現在: 日本語',
    en: '🌐 <b>Language Settings</b>\n\nCurrent: English',
    zh: '🌐 <b>语言设置</b>\n\n当前: 中文',
    vi: '🌐 <b>Cài đặt ngôn ngữ</b>\n\nHiện tại: Tiếng Việt',
  };
  await sendMessage(chatId, titles[lang] || titles['ja'], {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🇯🇵 日本語', callback_data: 'lang_ja' },
          { text: '🇬🇧 English', callback_data: 'lang_en' },
        ],
        [
          { text: '🇨🇳 中文', callback_data: 'lang_zh' },
          { text: '🇻🇳 Tiếng Việt', callback_data: 'lang_vi' },
        ],
      ],
    },
  });
}

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
  // 通知設定を自動登録（デフォルトON）
  getNotificationPreferences(chatId);
  await sendMessage(chatId,
    `━━━━━━━━━━━━━━\n` +
    bt(chatId, 'welcome') +
    `\n━━━━━━━━━━━━━━`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💰 USDT購入', callback_data: 'cb_buy' },
            { text: bt(chatId, 'sell_btn'), callback_data: 'cb_sell' },
          ],
          [
            { text: bt(chatId, 'rates_btn'), callback_data: 'cb_rates' },
          ],
          [
            { text: bt(chatId, 'status_btn'), callback_data: 'cb_status' },
            { text: bt(chatId, 'history_btn'), callback_data: 'cb_history' },
          ],
          [
            { text: bt(chatId, 'calc_btn'), callback_data: 'cb_calc' },
            { text: bt(chatId, 'alert_btn'), callback_data: 'cb_alert' },
          ],
          [
            { text: bt(chatId, 'notify_btn'), callback_data: 'cb_notify' },
            { text: bt(chatId, 'help_btn'), callback_data: 'cb_help' },
          ],
          [{ text: bt(chatId, 'open_btn'), web_app: { url: MINIAPP_URL } }],
          [{ text: bt(chatId, 'mypage_btn'), web_app: { url: MYPAGE_URL } }],
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

    // Track customer volume and referral rewards
    processReferralReward(chatId, order.id, amount).catch(e => console.error('[TelegramBot] Referral tracking error:', e));
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
    `/alert — アラート設定
/notify — 通知設定\n` +
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


// ━━━━━━━━━━━━━━━━━━ Sell Handlers ━━━━━━━━━━━━━━━━━━

async function handleSell(chatId: number) {
  conversations.set(chatId, { state: 'sell_awaiting_crypto' });
  await sendMessage(chatId,
    '💱 <b>暗号通貨売却（暗号通貨→日本円）</b>\n\n' +
    '売却する通貨を選択してください:',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'USDT', callback_data: 'sell_crypto_USDT' },
            { text: 'BTC', callback_data: 'sell_crypto_BTC' },
            { text: 'ETH', callback_data: 'sell_crypto_ETH' },
          ],
        ],
      },
    }
  );
}

async function handleSellAmount(chatId: number, text: string) {
  const chat = getState(chatId);
  const amount = parseFloat(text);
  if (!amount || amount <= 0) {
    await sendMessage(chatId, '⚠️ 有効な数量を入力してください（例: 100, 0.5）');
    return;
  }
  chat.data = { ...chat.data, cryptoAmount: amount };
  chat.state = 'sell_awaiting_bank';
  conversations.set(chatId, chat);
  await sendMessage(chatId,
    '🏦 <b>振込先銀行情報を入力してください</b>\n\n' +
    '以下の形式でカンマ区切りで入力:\n' +
    '<code>銀行名, 口座番号, 名義</code>\n\n' +
    '例: <code>三菱UFJ銀行, 1234567, タナカ タロウ</code>'
  );
}

async function handleSellBank(chatId: number, text: string) {
  const chat = getState(chatId);
  const parts = text.split(/[,，]/).map(s => s.trim());
  if (parts.length < 3) {
    await sendMessage(chatId, '⚠️ 「銀行名, 口座番号, 名義」の形式で入力してください');
    return;
  }
  let bankInfo: any;
  if (parts.length >= 4) {
    bankInfo = { bankName: parts[0], branchName: parts[1], accountNumber: parts[2], accountHolder: parts[3] };
  } else {
    bankInfo = { bankName: parts[0], branchName: '', accountNumber: parts[1], accountHolder: parts[2] };
  }
  chat.data = { ...chat.data, customerBankInfo: bankInfo };
  chat.state = 'sell_confirm';
  conversations.set(chatId, chat);

  let estimatedJpy = 0;
  let sellRate = 0;
  try {
    const rateData = await fetchCurrentRates();
    const d = (rateData as any)[chat.data.crypto.toLowerCase()];
    if (d?.bestSell) {
      sellRate = Number(d.bestSell.price);
      estimatedJpy = Math.floor(chat.data.cryptoAmount * sellRate);
    }
  } catch {}

  let depositAddr = '（未設定）';
  try {
    const res = await fetch(API_BASE + '/api/wallet');
    const data = await res.json();
    if (data.success && data.wallet?.address) depositAddr = data.wallet.address;
  } catch {}

  await sendMessage(chatId,
    '📋 <b>売却注文確認</b>\n\n' +
    '売却通貨: ' + chat.data.crypto + '\n' +
    '売却数量: ' + chat.data.cryptoAmount + '\n' +
    '売却レート: ¥' + sellRate.toLocaleString() + '\n' +
    '受取予定額: <b>¥' + estimatedJpy.toLocaleString() + '</b>\n\n' +
    '🏦 振込先:\n' +
    '銀行: ' + bankInfo.bankName + '\n' +
    '口座番号: ' + bankInfo.accountNumber + '\n' +
    '名義: ' + bankInfo.accountHolder + '\n\n' +
    '📥 入金先アドレス (TRC-20):\n<code>' + depositAddr + '</code>\n\n' +
    '上記の内容でよろしいですか？',
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ 確定する', callback_data: 'sell_confirm_yes' }],
          [{ text: '❌ キャンセル', callback_data: 'sell_confirm_no' }],
        ],
      },
    }
  );
}

async function handleSellConfirm(chatId: number) {
  const chat = getState(chatId);
  conversations.set(chatId, { state: 'idle' });

  await sendMessage(chatId, '⏳ 売却注文を作成中...');

  try {
    const res = await fetch(API_BASE + '/api/orders/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cryptoAmount: chat.data.cryptoAmount,
        crypto: chat.data.crypto,
        customerBankInfo: chat.data.customerBankInfo,
      }),
    });
    const data = await res.json();

    if (!data.success || !data.order) {
      await sendMessage(chatId, '❌ 注文作成に失敗しました: ' + (data.error || '不明なエラー'));
      return;
    }

    const order = data.order;
    await sendMessage(chatId,
      '✅ <b>売却注文が作成されました</b>\n\n' +
      '📋 注文ID: <code>' + order.id + '</code>\n' +
      '💱 売却: ' + order.cryptoAmount + ' ' + order.crypto + '\n' +
      '💴 受取予定: ¥' + (order.jpyAmount || 0).toLocaleString() + '\n' +
      '📊 レート: ¥' + (order.rate || 0).toLocaleString() + '\n\n' +
      '📥 <b>以下のアドレスに' + order.crypto + 'を送金してください:</b>\n' +
      '<code>' + (order.depositAddress || '') + '</code>\n' +
      'ネットワーク: ' + (order.depositNetwork || 'TRC-20') + '\n\n' +
      '⏰ 30分以内に送金してください。\n' +
      '入金確認後、指定口座へ日本円をお振込みします。',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 注文状況確認', callback_data: 'status_' + order.id }],
          ],
        },
      }
    );
  } catch (e) {
    console.error('[TelegramBot] Sell order error:', e);
    await sendMessage(chatId, '❌ サーバーに接続できませんでした。');
  }
}


async function handleNotify(chatId: number) {
  const prefs = getNotificationPreferences(chatId);
  const check = (v: boolean) => v ? '✅' : '❌';

  await sendMessage(chatId,
    `🔔 <b>通知設定</b>\n\n` +
    `現在の設定:\n` +
    `${check(prefs.daily_summary)} 毎朝レートサマリー（9:00）\n` +
    `${check(prefs.spike_alerts)} レート急変動アラート\n` +
    `${check(prefs.weekly_summary)} 週間レポート（月曜9:00）\n\n` +
    `タップして切り替え:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: `${check(prefs.daily_summary)} 朝のサマリー`, callback_data: 'notify_toggle_daily' }],
          [{ text: `${check(prefs.spike_alerts)} 急変動`, callback_data: 'notify_toggle_spike' }],
          [{ text: `${check(prefs.weekly_summary)} 週間`, callback_data: 'notify_toggle_weekly' }],
        ],
      },
    }
  );
}


// Referral & VIP Handlers

const VIP_LABELS: Record<string, string> = {
  bronze: 'ブロンズ', silver: 'シルバー', gold: 'ゴールド', platinum: 'プラチナ',
};
const VIP_THRESHOLDS: Record<string, number> = {
  bronze: 1_000_000, silver: 5_000_000, gold: 20_000_000, platinum: Infinity,
};
const VIP_DISCOUNTS: Record<string, string> = {
  bronze: '標準', silver: '-0.3%', gold: '-0.5%', platinum: '-1.0%',
};

async function handleReferral(chatId: number) {
  const telegramId = String(chatId);
  const customer = dbSvc.getOrCreateCustomer(telegramId);
  const stats = dbSvc.getReferralStats(telegramId);
  await sendMessage(chatId,
    `━━━━━━━━━━━━━━\n` +
    `紹介プログラム\n\n` +
    `あなたの紹介コード: <code>${customer.referral_code}</code>\n\n` +
    `友達にこのコードを共有してください。\n` +
    `友達が取引するたびに、取引額の0.5%が\n` +
    `あなたにリワードとして付与されます。\n\n` +
    `累計紹介: ${stats.referral_count}人\n` +
    `累計リワード: ￥${Math.floor(stats.total_rewards).toLocaleString()}\n` +
    `━━━━━━━━━━━━━━`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'コードをコピー', callback_data: 'cb_copy_referral' },
            { text: '友達に送る', url: `https://t.me/share/url?url=${encodeURIComponent('BK Payで暗号通貨を購入！紹介コード: ' + customer.referral_code)}` },
          ],
          [{ text: '← メニューに戻る', callback_data: 'cb_menu' }],
        ],
      },
    }
  );
}

async function handleMypage(chatId: number) {
  const telegramId = String(chatId);
  const stats = dbSvc.getCustomerStats(telegramId);
  const rank = stats.vip_rank || 'bronze';
  const rankLabel = VIP_LABELS[rank] || 'ブロンズ';
  const nextThreshold = VIP_THRESHOLDS[rank];
  const discount = VIP_DISCOUNTS[rank];
  const volume = stats.total_volume_jpy || 0;
  const orders = stats.total_orders || 0;
  const nextRankName = rank === 'bronze' ? 'シルバー' : rank === 'silver' ? 'ゴールド' : rank === 'gold' ? 'プラチナ' : '';
  let nextLine = '';
  if (nextThreshold !== Infinity) {
    nextLine = `次のランク(${nextRankName})まで: ￥${(nextThreshold - volume).toLocaleString()}`;
  } else {
    nextLine = '最高ランク達成！';
  }
  await sendMessage(chatId,
    `━━━━━━━━━━━━━━\n` +
    `マイページ\n\n` +
    `━━ VIPランク ━━\n` +
    `${rankLabel}会員\n` +
    `累計取引額: ￥${Math.floor(volume).toLocaleString()}\n` +
    `${nextLine}\n\n` +
    `━━ 取引実績 ━━\n` +
    `総取引回数: ${orders}回\n\n` +
    `━━ 特典 ━━\n` +
    `レート優遍: ${discount}\n\n` +
    `━━ 紹介 ━━\n` +
    `紹介コード: <code>${stats.referral_code}</code>\n` +
    `紹介人数: ${stats.referral_count}人\n` +
    `累計リワード: ￥${Math.floor(stats.total_rewards).toLocaleString()}\n` +
    `━━━━━━━━━━━━━━`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '取引履歴', callback_data: 'cb_history' },
            { text: '紹介する', callback_data: 'cb_referral' },
          ],
          [{ text: '← メニューに戻る', callback_data: 'cb_menu' }],
        ],
      },
    }
  );
}

async function handleRegister(chatId: number, code: string) {
  if (!code) {
    await sendMessage(chatId, '使い方: /register 紹介コード\n例: <code>/register BK-ABC123</code>');
    return;
  }
  const telegramId = String(chatId);
  const result = dbSvc.applyReferralCode(telegramId, code.toUpperCase());
  if (result.success) {
    await sendMessage(chatId, '紹介コードを登録しました！取引するたびに紹介者にリワードが付与されます。');
  } else {
    await sendMessage(chatId, `紹介コード登録エラー: ${result.error}`);
  }
}

async function processReferralReward(chatId: number, orderId: string, amount: number) {
  const telegramId = String(chatId);
  dbSvc.updateCustomerVolume(telegramId, amount);
  const customer = dbSvc.getOrCreateCustomer(telegramId);
  if (customer.referred_by) {
    const referrer = dbSvc.getCustomerByReferralCode(customer.referred_by);
    if (referrer) {
      const reward = amount * 0.005;
      dbSvc.addReferralReward(referrer.telegram_id, telegramId, orderId, reward);
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
    if (data === 'cb_notify') return handleNotify(chatId);
    if (data.startsWith('lang_')) { const lang = data.slice(5); userLanguages.set(chatId, lang); const msgs: Record<string,string> = { ja: '✅ 日本語に設定しました', en: '✅ Language set to English', zh: '✅ 语言已设置为中文', vi: '✅ Đã đặt ngôn ngữ Tiếng Việt' }; await sendMessage(chatId, msgs[lang] || msgs['ja']); return handleStart(chatId); }
    if (data === 'cb_help') return handleHelp(chatId);
    if (data === 'cb_referral') return handleReferral(chatId);
    if (data === 'cb_mypage') return handleMypage(chatId);
    if (data === 'cb_menu') return handleStart(chatId);
    if (data === 'cb_copy_referral') {
      const cust = dbSvc.getOrCreateCustomer(String(chatId));
      await sendMessage(chatId, `<code>${cust.referral_code}</code>`);
      return;
    }
    if (data === 'cb_mypage') {
      await sendMessage(chatId, '📊 マイページを開く', { reply_markup: { inline_keyboard: [[{ text: '📊 マイページを開く', web_app: { url: MYPAGE_URL } }]] } });
      return;
    }
    if (data === 'cb_sell') return handleSell(chatId);

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

    // Sell flow callbacks
    if (data.startsWith('sell_crypto_')) {
      const crypto = data.replace('sell_crypto_', '');
      const chat = getState(chatId);
      chat.data = { crypto };
      chat.state = 'sell_awaiting_amount';
      conversations.set(chatId, chat);
      await sendMessage(chatId, '💰 売却する ' + crypto + ' の数量を入力してください:\n\n例: <code>100</code> (USDT) / <code>0.01</code> (BTC)');
      return;
    }
    if (data === 'sell_confirm_yes') return handleSellConfirm(chatId);
    if (data === 'sell_confirm_no') {
      conversations.set(chatId, { state: 'idle' });
      await sendMessage(chatId, '❌ 売却注文をキャンセルしました。');
      return;
    }

    // Alert off from button
    if (data === 'alert_off') {
      userAlerts.delete(chatId);
      await sendMessage(chatId, '✅ アラートを解除しました。');
      return;
    }

    // Notification toggle callbacks
    if (data.startsWith('notify_toggle_')) {
      const typeMap: Record<string, string> = {
        'notify_toggle_daily': 'daily_summary',
        'notify_toggle_spike': 'spike_alerts',
        'notify_toggle_weekly': 'weekly_summary',
      };
      const prefType = typeMap[data];
      if (prefType) {
        const prefs = getNotificationPreferences(chatId);
        const current = (prefs as any)[prefType];
        setNotificationPreference(chatId, prefType, !current);
        await handleNotify(chatId);
        return;
      }
    }


    // Support FAQ callbacks
    if (data === 'faq_not_reflected') return handleFaqNotReflected(chatId);
    if (data === 'faq_cancelled') return handleFaqCancelled(chatId);
    if (data === 'faq_rate_diff') return handleFaqRateDiff(chatId);
    if (data === 'faq_no_account') return handleFaqNoAccount(chatId);
    if (data === 'faq_no_usdt') return handleFaqNoUsdt(chatId);
    if (data === 'faq_other') return handleContactStaff(chatId);
    if (data === 'support_contact_staff') return handleContactStaff(chatId);
    if (data === 'support_input_order_id') return handleSupportInputOrderId(chatId);
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
  if (text === '/sell') return handleSell(chatId);
  if (text === '/rates') return handleRates(chatId);
  if (text === '/help') return handleHelp(chatId);
  if (text === '/mypage') {
    await sendMessage(chatId, '📊 マイページを開く', { reply_markup: { inline_keyboard: [[{ text: '📊 マイページを開く', web_app: { url: MYPAGE_URL } }]] } });
    return;
  }
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

  if (text === '/notify') return handleNotify(chatId);
  if (text === '/lang') return handleLang(chatId);
  if (text === '/support') return handleSupport(chatId);

  if (text === '/referral') return handleReferral(chatId);
  if (text === '/mypage') return handleMypage(chatId);
  if (text.startsWith('/register')) {
    const code = text.split(/\s+/)[1] || '';
    return handleRegister(chatId, code);
  }

  if (text.startsWith('/status')) {
    const id = text.split(/\s+/)[1];
    if (id) return handleStatus(chatId, id);
    conversations.set(chatId, { state: 'awaiting_order_id' });
    await sendMessage(chatId, '🔍 注文IDを入力してください:\n\n例: <code>ORD-xxxxx</code>');
    return;
  }


  // Support waiting states
  const supportState = supportWaiting.get(chatId);
  if (supportState === 'staff_message') {
    return handleStaffMessage(chatId, text, msg.from);
  }
  if (supportState === 'order_id_input') {
    return handleSupportOrderId(chatId, text);
  }
  // Conversation states
  if (chat.state === 'awaiting_amount') {
    return handleAmount(chatId, text);
  }

  if (chat.state === 'sell_awaiting_amount') return handleSellAmount(chatId, text);
  if (chat.state === 'sell_awaiting_bank') return handleSellBank(chatId, text);

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


// ━━━━━━━━━━━━━━━━━━ Customer Support Bot ━━━━━━━━━━━━━━━━━━

const STAFF_CHAT_ID = 5791086501;
const supportWaiting = new Map<number, string>(); // chatId -> context (e.g. 'staff_message', 'order_id_input')

async function handleSupport(chatId: number) {
  await sendMessage(chatId,
    `━━━━━━━━━━━━━━\n` +
    `カスタマーサポート\n\n` +
    `お困りの内容を選択してください:\n` +
    `━━━━━━━━━━━━━━`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '振込したのに反映されない', callback_data: 'faq_not_reflected' }],
          [{ text: '注文がキャンセルされた', callback_data: 'faq_cancelled' }],
          [{ text: 'レートが違う', callback_data: 'faq_rate_diff' }],
          [{ text: '銀行口座が表示されない', callback_data: 'faq_no_account' }],
          [{ text: 'USDTが届かない', callback_data: 'faq_no_usdt' }],
          [{ text: 'その他（スタッフに相談）', callback_data: 'faq_other' }],
        ],
      },
    }
  );
}

async function handleFaqNotReflected(chatId: number) {
  await sendMessage(chatId,
    `振込が反映されない場合\n\n` +
    `考えられる原因:\n` +
    `・振込後「振込完了」ボタンを押していない\n` +
    `・銀行の処理に時間がかかっている（通常5-10分）\n` +
    `・振込先の口座番号が間違っている\n\n` +
    `対処法:\n` +
    `1. 注文画面で「振込完了」ボタンを押してください\n` +
    `2. 15分以上経っても反映されない場合は\n` +
    `   注文IDをお知らせください`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '注文IDを入力する', callback_data: 'support_input_order_id' }],
          [{ text: 'スタッフに相談', callback_data: 'support_contact_staff' }],
        ],
      },
    }
  );
}

async function handleFaqCancelled(chatId: number) {
  await sendMessage(chatId,
    `注文がキャンセルされた場合\n\n` +
    `考えられる原因:\n` +
    `・15分以内に振込が完了しなかった\n` +
    `・システムの自動キャンセル\n\n` +
    `対処法:\n` +
    `・もう一度注文を作成してください\n` +
    `・既に振込済みの場合はスタッフにご連絡ください`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'もう一度注文する', callback_data: 'cb_buy' }],
          [{ text: 'スタッフに相談', callback_data: 'support_contact_staff' }],
        ],
      },
    }
  );
}

async function handleFaqRateDiff(chatId: number) {
  await sendMessage(chatId,
    `レートが違う場合\n\n` +
    `BK Payのレートはリアルタイムで変動します。\n\n` +
    `・注文作成時のレートが適用されます\n` +
    `・レート表示と注文作成の間に変動する場合があります\n` +
    `・大幅な差異がある場合はスタッフにご連絡ください`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '現在のレートを確認', callback_data: 'cb_rates' }],
          [{ text: 'スタッフに相談', callback_data: 'support_contact_staff' }],
        ],
      },
    }
  );
}

async function handleFaqNoAccount(chatId: number) {
  await sendMessage(chatId,
    `銀行口座が表示されない場合\n\n` +
    `考えられる原因:\n` +
    `・全ての口座が1日の限度額に達している\n` +
    `・システムメンテナンス中\n` +
    `・口座が一時休止中\n\n` +
    `対処法:\n` +
    `・しばらく時間をおいてから再度お試しください\n` +
    `・改善しない場合はスタッフにご連絡ください`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'スタッフに相談', callback_data: 'support_contact_staff' }],
        ],
      },
    }
  );
}

async function handleFaqNoUsdt(chatId: number) {
  await sendMessage(chatId,
    `USDTが届かない場合\n\n` +
    `考えられる原因:\n` +
    `・振込確認がまだ完了していない\n` +
    `・ブロックチェーンの処理に時間がかかっている\n` +
    `・ウォレットアドレスの確認が必要\n\n` +
    `対処法:\n` +
    `1. 注文ステータスを確認してください\n` +
    `2. 「完了」表示なのに届かない場合は\n` +
    `   TXIDと共にスタッフにご連絡ください`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '注文状況を確認', callback_data: 'cb_status' }],
          [{ text: 'スタッフに相談', callback_data: 'support_contact_staff' }],
        ],
      },
    }
  );
}

async function handleContactStaff(chatId: number) {
  supportWaiting.set(chatId, 'staff_message');
  await sendMessage(chatId,
    `スタッフに転送します。\n\nお困りの内容をメッセージで入力してください。`
  );
}

async function handleSupportInputOrderId(chatId: number) {
  supportWaiting.set(chatId, 'order_id_input');
  await sendMessage(chatId, '注文IDを入力してください:\n\n例: <code>ORD-xxxxx</code>');
}

async function handleStaffMessage(chatId: number, text: string, from: any) {
  supportWaiting.delete(chatId);
  const userName = from?.first_name || from?.username || 'Unknown';
  const userId = from?.id || chatId;

  // Forward to staff
  await sendMessage(STAFF_CHAT_ID,
    `━━ サポート問い合わせ ━━\n\n` +
    `From: ${userName} (ID: ${userId})\n` +
    `Chat: ${chatId}\n\n` +
    `${text}\n\n` +
    `━━━━━━━━━━━━━━`,
  );

  await sendMessage(chatId,
    `スタッフに転送しました。しばらくお待ちください。`
  );
}

async function handleSupportOrderId(chatId: number, text: string) {
  supportWaiting.delete(chatId);
  // Forward order ID concern to staff
  const userName = String(chatId);
  await sendMessage(STAFF_CHAT_ID,
    `━━ 振込反映の問い合わせ ━━\n\n` +
    `From: Chat ${chatId}\n` +
    `注文ID: ${text}\n\n` +
    `振込したが反映されないとのこと。確認をお願いします。\n` +
    `━━━━━━━━━━━━━━`,
  );
  await sendMessage(chatId,
    `注文ID <code>${text}</code> についてスタッフに連絡しました。\nしばらくお待ちください。`
  );
}
