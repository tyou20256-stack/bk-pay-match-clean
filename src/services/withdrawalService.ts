/**
 * @file withdrawalService.ts — 出金(三角マッチング)中核ロジック
 * @description 外部APIから受けた出金リクエストの作成・確認・キャンセルを管理。
 *   confirmWithdrawalPayment() が三角マッチングの最終フェーズ:
 *   JPY受取確認 → USDT送金(B→バイヤー) → セラー残高減算 → 完了通知。
 */
import crypto from 'crypto';
import * as dbSvc from './database.js';
import { getMerchantApiKeyById } from './database.js';
import orderManager from './orderManager.js';
import walletService from './walletService.js';
import { deductBalance, releaseBalance } from './p2pSellerService.js';
import { notifyWithdrawalEvent } from './merchantApiService.js';
import logger from './logger.js';

// ── 出金リクエスト作成 ──────────────────────────────────────────
export async function createWithdrawal(params: {
  merchantApiKeyId?: number;
  externalRef?: string;
  amount: number;
  payMethod: string;
  bankName?: string;
  branchName?: string;
  accountType?: string;
  accountNumber?: string;
  accountHolder?: string;
  paypayId?: string;
  webhookUrl?: string;
  expiresInMs?: number;
}): Promise<{ success: boolean; withdrawal?: dbSvc.WithdrawalData | null; error?: string }> {
  // バリデーション
  if (!params.amount || params.amount < 500) {
    return { success: false, error: '金額は500円以上で指定してください' };
  }
  if (params.payMethod === 'bank') {
    if (!params.bankName || !params.accountNumber || !params.accountHolder) {
      return { success: false, error: '銀行名・口座番号・名義は必須です' };
    }
  } else if (params.payMethod === 'paypay') {
    if (!params.paypayId) {
      return { success: false, error: 'PayPay ID は必須です' };
    }
  }

  // 重複チェック (externalRef)
  if (params.externalRef) {
    const existing = dbSvc.getWithdrawalByExternalRef(params.externalRef);
    if (existing) {
      return { success: false, error: `外部参照 '${params.externalRef}' は既に登録されています` };
    }
  }

  const trackingToken = crypto.randomUUID();
  const expiresAt = Date.now() + (params.expiresInMs || 24 * 60 * 60 * 1000); // default 24h

  const id = dbSvc.createWithdrawal({
    trackingToken,
    merchantApiKeyId: params.merchantApiKeyId,
    externalRef: params.externalRef,
    amount: Math.round(params.amount),
    payMethod: params.payMethod,
    bankName: params.bankName,
    branchName: params.branchName,
    accountType: params.accountType,
    accountNumber: params.accountNumber,
    accountHolder: params.accountHolder,
    paypayId: params.paypayId,
    webhookUrl: params.webhookUrl,
    expiresAt,
  });

  const withdrawal = dbSvc.getWithdrawal(id);
  return { success: true, withdrawal };
}

// ── merchant 所有権チェック付き取得 ─────────────────────────────
export function getWithdrawalForMerchant(id: number, merchantApiKeyId: number): dbSvc.WithdrawalData | null {
  const w = dbSvc.getWithdrawal(id);
  if (!w) return null;
  if (w.merchantApiKeyId !== merchantApiKeyId) return null;
  return w;
}

// ── キャンセル ──────────────────────────────────────────────────
export async function cancelWithdrawal(
  id: number,
  merchantApiKeyId: number
): Promise<{ success: boolean; error?: string }> {
  const w = dbSvc.getWithdrawal(id);
  if (!w) return { success: false, error: '出金リクエストが見つかりません' };
  if (w.merchantApiKeyId !== merchantApiKeyId) return { success: false, error: '権限がありません' };
  if (w.status === 'completed' || w.status === 'cancelled') {
    return { success: false, error: `ステータスが ${w.status} のため変更できません` };
  }

  // matched の場合、セラーの lockBalance を release
  if (w.status === 'matched' && w.matchedSellerId && w.matchedOrderId) {
    const order = dbSvc.getOrder(w.matchedOrderId);
    if (order && order.cryptoAmount > 0) {
      releaseBalance(w.matchedSellerId, order.cryptoAmount);
    }
    // 紐づいた注文もキャンセル
    orderManager.cancelOrder(w.matchedOrderId);
  }

  dbSvc.updateWithdrawalStatus(id, 'cancelled');

  // Webhook通知
  const updated = dbSvc.getWithdrawal(id);
  if (updated?.webhookUrl) {
    const keyRow = updated.merchantApiKeyId ? getMerchantApiKeyById(updated.merchantApiKeyId) : null;
    notifyWithdrawalEvent(updated, keyRow?.webhook_secret || null, 'withdrawal.cancelled').catch(() => {});
  }

  return { success: true };
}

// ── JPY受取確認 → USDT送金 → 完了 ──────────────────────────────
export async function confirmWithdrawalPayment(
  id: number,
  merchantApiKeyId: number
): Promise<{ success: boolean; txId?: string; error?: string }> {
  const w = dbSvc.getWithdrawal(id);
  if (!w) return { success: false, error: '出金リクエストが見つかりません' };
  if (w.merchantApiKeyId !== merchantApiKeyId) return { success: false, error: '権限がありません' };
  if (w.status !== 'matched') {
    return { success: false, error: `ステータスが '${w.status}' のため確認できません (matched のみ可)` };
  }
  if (!w.matchedOrderId || !w.matchedSellerId) {
    return { success: false, error: 'マッチング情報が不完全です' };
  }

  // 1. 注文の入金確認 → payment_verified
  const verified = orderManager.adminVerifyPayment(w.matchedOrderId);
  if (!verified) {
    return { success: false, error: '注文の入金確認に失敗しました' };
  }

  // 2. USDT送金 (ホットウォレット → バイヤーB)
  const sendResult = await walletService.processCryptoSend(w.matchedOrderId);
  if (!sendResult.success) {
    return { success: false, error: `USDT送金に失敗しました: ${sendResult.error || '不明なエラー'}` };
  }

  // 3. セラーC 残高減算 (atomic guard: 残高不足で失敗しても USDT は既に
  //    送金済みなので、reconciliation のために error log に残す)
  const order = dbSvc.getOrder(w.matchedOrderId);
  if (order && order.cryptoAmount > 0) {
    const deducted = deductBalance(w.matchedSellerId, order.cryptoAmount);
    if (!deducted) {
      logger.error('Seller deductBalance failed AFTER USDT send', {
        withdrawalId: id,
        sellerId: w.matchedSellerId,
        orderId: w.matchedOrderId,
        amount: order.cryptoAmount,
        txId: sendResult.txId,
      });
    }
  }

  // 4. 出金ステータス → completed
  dbSvc.updateWithdrawalStatus(id, 'completed', { completedAt: Date.now() });

  // 5. Webhook通知
  const completed = dbSvc.getWithdrawal(id);
  if (completed?.webhookUrl) {
    const keyRow = completed.merchantApiKeyId ? getMerchantApiKeyById(completed.merchantApiKeyId) : null;
    notifyWithdrawalEvent(
      completed,
      keyRow?.webhook_secret || null,
      'withdrawal.completed',
      { orderId: w.matchedOrderId, txId: sendResult.txId }
    ).catch(() => {});
  }

  return { success: true, txId: sendResult.txId };
}

export default {
  createWithdrawal,
  getWithdrawalForMerchant,
  cancelWithdrawal,
  confirmWithdrawalPayment,
};
