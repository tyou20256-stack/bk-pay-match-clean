/**
 * @file notifier.ts — Telegram通知サービス
 * @description 注文イベント（新規/振込完了/完了/キャンセル/期限切れ）を
 *   Telegram botでスタッフに即時通知。
 *   ENABLED = false で無効化可能。
 *   使用bot: @BKnewsmanagerbot
 */
// Telegram notification service for Pay Match
import logger from './logger.js';

const ENABLED = process.env.ENABLE_NOTIFIER === 'true';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const STAFF_CHAT_ID = process.env.TELEGRAM_STAFF_CHAT_ID || '';

async function sendTelegramTo(chatId: string, text: string, replyMarkup?: unknown): Promise<void> {
  if (!ENABLED || !chatId) return;
  try {
    const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    logger.error('Telegram send failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

function sendTelegram(text: string, replyMarkup?: unknown): Promise<void> {
  return sendTelegramTo(STAFF_CHAT_ID, text, replyMarkup);
}

interface NotifyOrder {
  id: string;
  amount: number;
  cryptoAmount: number;
  rate: number;
  payMethod: string;
  mode?: string;
  exchange?: string | null;
  confirmUrl?: string;
  [key: string]: unknown;
}

export function notifyNewOrder(order: NotifyOrder): void {
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

export function notifyPaid(order: NotifyOrder): void {
  sendTelegram(
    `💰 <b>振込完了報告</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `金額: ¥${order.amount.toLocaleString()}\n` +
    `⚠️ 入金確認してください`
  );
}

export function notifyCompleted(order: NotifyOrder): void {
  sendTelegram(
    `✅ <b>注文完了</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `¥${order.amount.toLocaleString()} → ${order.cryptoAmount} USDT`
  );
}

export function notifyCancelled(order: NotifyOrder): void {
  sendTelegram(
    `❌ <b>注文キャンセル</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `金額: ¥${order.amount.toLocaleString()}`
  );
}

export function notifyExpired(order: NotifyOrder): void {
  sendTelegram(
    `⏰ <b>注文期限切れ</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `金額: ¥${order.amount.toLocaleString()}`
  );
}

export function notifyPaymentVerified(order: NotifyOrder): void {
  sendTelegram(
    `🏦 <b>入金確認済み</b>\n` +
    `ID: <code>${order.id}</code>\n` +
    `金額: ¥${order.amount.toLocaleString()}\n` +
    `→ USDT送金を開始してください`
  );
}

export function notifySendFailed(orderId: string, error: string): void {
  sendTelegram(
    `⚠️ <b>USDT送金失敗</b>\n` +
    `ID: <code>${orderId}</code>\n` +
    `エラー: ${error}\n` +
    `→ 手動で対応してください`
  );
}

export function notifySellerPaid(sellerChatId: string, order: NotifyOrder): void {
  sendTelegramTo(sellerChatId,
    `💰 <b>入金確認依頼</b>\n` +
    `注文 ID: <code>${order.id}</code>\n` +
    `金額: ¥${order.amount.toLocaleString()}\n` +
    `バイヤーが振込完了を報告しました。確認をお願いします。\n` +
    `<a href="${order.confirmUrl}">確認ページを開く</a>`
  );
}

export function notifySweepAlert(currentBalance: number, threshold: number, excessAmount: number, coldAddress: string): void {
  sendTelegram(
    `🔔 <b>SWEEP ALERT: Hot Wallet残高超過</b>\n` +
    `残高: ${currentBalance.toFixed(2)} USDT\n` +
    `閾値: ${threshold.toFixed(2)} USDT\n` +
    `超過額: ${excessAmount.toFixed(2)} USDT\n` +
    `Cold Wallet: <code>${coldAddress || '未設定'}</code>\n` +
    `→ コールドウォレットへの移動を検討してください`
  );
}

export function notifySweepCompleted(amount: number, coldAddress: string, txId: string): void {
  sendTelegram(
    `✅ <b>Sweep完了</b>\n` +
    `送金額: ${amount.toFixed(2)} USDT\n` +
    `Cold Wallet: <code>${coldAddress}</code>\n` +
    `TX: <code>${txId}</code>`
  );
}

// === TruPay Notifications ===

const notifiedWithdrawals = new Map<number, number>(); // id -> timestamp

// Cleanup: every 1 hour, remove entries older than 48h
setInterval(() => {
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  for (const [id, ts] of notifiedWithdrawals) {
    if (ts < cutoff) notifiedWithdrawals.delete(id);
  }
}, 60 * 60 * 1000);

export function notifyTruPayNewWithdrawal(withdrawal: { id: number; trupay_id: number; transaction_id: string; amount_jpy: number; bank_name: string; account_name: string }): void {
  const wid = withdrawal.trupay_id;
  if (notifiedWithdrawals.has(wid)) return;
  notifiedWithdrawals.set(wid, Date.now());
  sendTelegram(
    `🏦 <b>TruPay出金キュー</b>\n` +
    `WID: <code>${withdrawal.transaction_id}</code>\n` +
    `金額: ¥${withdrawal.amount_jpy.toLocaleString()}\n` +
    `銀行: ${withdrawal.bank_name}\n` +
    `名義: ${withdrawal.account_name}\n` +
    `→ 購入者マッチング待ち`,
    {
      inline_keyboard: [
        [{ text: '✅ セトル済み（キューから除外）', callback_data: `settle_${withdrawal.id}` }]
      ]
    }
  );
}

export function notifyTruPayMatchCreated(data: {
  matchId: number;
  withdrawalId?: number;
  transactionId?: string;
  buyerId: string;
  amountJpy: number;
  amountUsdt: number;
  rate: number;
  bankName: string;
  branchName: string;
  accountNumber: string;
  accountName: string;
  timeoutAt: number;
}): void {
  const deadline = new Date(data.timeoutAt).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' });
  sendTelegram(
    `🤝 <b>マッチング成立</b>\n` +
    (data.transactionId ? `WID: <code>${data.transactionId}</code>\n` : '') +
    `金額: ¥${data.amountJpy.toLocaleString()} → ${data.amountUsdt.toFixed(2)} USDT\n` +
    `レート: ¥${data.rate.toFixed(2)}\n` +
    `━━━ 振込先 ━━━\n` +
    `銀行: ${data.bankName}\n` +
    `支店: ${data.branchName || '-'}\n` +
    `口座: ${data.accountNumber}\n` +
    `名義: ${data.accountName}\n` +
    `━━━━━━━━━━\n` +
    `期限: ${deadline}`
  );
}

export function notifyTruPayTransferConfirmed(match: { id: number; amount_jpy: number; amount_usdt: number }, withdrawal: { bank_name: string }): void {
  sendTelegram(
    `✅ <b>TruPay着金確認</b>\n` +
    `Match #${match.id}\n` +
    `¥${match.amount_jpy.toLocaleString()} (${withdrawal.bank_name})\n` +
    `→ ${match.amount_usdt.toFixed(2)} USDT送金開始`
  );
}

export function notifyTruPayUsdtSent(match: { id: number; amount_usdt: number; buyer_wallet: string }, txHash: string): void {
  sendTelegram(
    `💎 <b>TruPay USDT送金完了</b>\n` +
    `Match #${match.id}\n` +
    `送金量: ${match.amount_usdt.toFixed(2)} USDT\n` +
    `宛先: <code>${match.buyer_wallet}</code>\n` +
    `TX: <code>${txHash}</code>`
  );
}

export function notifyTruPayTimeout(match: { id: number; amount_jpy: number; buyer_id: string }): void {
  sendTelegram(
    `⏰ <b>TruPayタイムアウト</b>\n` +
    `Match #${match.id}\n` +
    `金額: ¥${match.amount_jpy.toLocaleString()}\n` +
    `購入者: ${match.buyer_id}\n` +
    `→ 出金をキューに戻しました`
  );
}

export function notifyTruPaySendFailed(matchId: number, error: string): void {
  sendTelegram(
    `⚠️ <b>TruPay USDT送金失敗</b>\n` +
    `Match #${matchId}\n` +
    `エラー: ${error}\n` +
    `→ 手動対応してください`
  );
}

// === Proof Review Notification (image + inline keyboard) ===

import fs from 'fs';
import path from 'path';
import type { ProofAnalysisResult } from './proofAnalyzer.js';

export async function notifyProofReview(matchId: number, amountJpy: number, analysis: ProofAnalysisResult, proofFilename: string): Promise<void> {
  if (!BOT_TOKEN || !STAFF_CHAT_ID) return;

  const proofPath = path.join(process.cwd(), 'data', 'proofs', proofFilename);

  // Send image with caption
  try {
    const caption =
      `🔍 <b>振込明細 要確認</b>\n` +
      `Match #${matchId} / ¥${amountJpy.toLocaleString()}\n\n` +
      `📊 スコア: <b>${analysis.score}/100</b> (${analysis.confidence})\n` +
      `${analysis.matchDetails.bankNameMatch ? '✅' : '❌'} 銀行名: ${analysis.extractedData.bankName || '不明'}\n` +
      `${analysis.matchDetails.accountNumberMatch ? '✅' : '❌'} 口座番号: ${analysis.extractedData.accountNumber || '不明'}\n` +
      `${analysis.matchDetails.accountNameMatch ? '✅' : '❌'} 名義: ${analysis.extractedData.accountName || '不明'}\n` +
      `${analysis.matchDetails.amountMatch ? '✅' : '❌'} 金額: ${analysis.extractedData.amount ? '¥' + analysis.extractedData.amount.toLocaleString() : '不明'}\n` +
      (analysis.extractedData.fee ? `💳 手数料: ¥${analysis.extractedData.fee.toLocaleString()}\n` : '') +
      (analysis.extractedData.transferTime ? `🕐 振込時間: ${analysis.extractedData.transferTime}\n` : '') +
      `\n📝 ${analysis.reason}`;

    if (fs.existsSync(proofPath)) {
      // Send photo with caption + approve/reject buttons
      const formData = new FormData();
      const photoBlob = new Blob([fs.readFileSync(proofPath)]);
      formData.append('chat_id', STAFF_CHAT_ID);
      formData.append('photo', photoBlob, proofFilename);
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');
      formData.append('reply_markup', JSON.stringify({
        inline_keyboard: [
          [
            { text: '✅ 承認', callback_data: `proof_approve_${matchId}` },
            { text: '❌ 却下', callback_data: `proof_reject_${matchId}` },
          ],
        ],
      }));

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        body: formData,
      });
    } else {
      // No file, send text only
      await sendTelegramTo(STAFF_CHAT_ID, caption);
    }
  } catch (e) {
    logger.error('Proof review notification failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function notifyProofAutoApproved(matchId: number, amountJpy: number, score: number): Promise<void> {
  sendTelegram(
    `✅ <b>振込明細 自動承認</b>\n` +
    `Match #${matchId} / ¥${amountJpy.toLocaleString()}\n` +
    `スコア: ${score}/100\n` +
    `→ 着金確認待ちに移行`
  );
}

export default {
  notifyNewOrder, notifyPaid, notifyCompleted, notifyCancelled, notifyExpired,
  notifyPaymentVerified, notifySendFailed, notifySellerPaid, notifySweepAlert, notifySweepCompleted,
  notifyTruPayNewWithdrawal, notifyTruPayMatchCreated, notifyTruPayTransferConfirmed,
  notifyTruPayUsdtSent, notifyTruPayTimeout, notifyTruPaySendFailed,
  notifyProofReview, notifyProofAutoApproved,
  notifyPayPayMatch, notifyPayPayCompleted,
};

export function notifyPayPayMatch(data: { conversionId: number; amount: number; feeAmount: number; payoutAmount: number; type: string }): void {
  sendTelegram(
    `💴 <b>PayPay変換マッチング</b>\n` +
    `ID: #${data.conversionId}\n` +
    `タイプ: ${{ lite_to_money: 'ライト→マネー', money_to_lite: 'マネー→ライト', money_to_usdt: 'マネー→USDT', lite_to_usdt: 'ライト→USDT', usdt_to_money: 'USDT→マネー', usdt_to_lite: 'USDT→ライト' }[data.type] || data.type}\n` +
    `金額: ¥${data.amount.toLocaleString()}\n` +
    `手数料: ¥${data.feeAmount.toLocaleString()}\n` +
    `受取額: ¥${data.payoutAmount.toLocaleString()}`
  );
}

export function notifyPayPayCompleted(conversionId: number, amount: number): void {
  sendTelegram(`✅ <b>PayPay変換完了</b>\nID: #${conversionId}\n金額: ¥${amount.toLocaleString()}`);
}
