/**
 * @file p2pSellerService.ts — P2P セラー管理・マッチング・残高管理・支払い確認
 * @description USDTを売りたいセラーと、JPYを支払ってUSDTを買いたいバイヤーをP2Pマッチングする。
 *   セラーはあらかじめUSDTをbk-pay-matchウォレットにデポジット。
 *   バイヤーがJPYをセラーのPayPayに送金後、セラーが確認ページで承認すると
 *   bk-pay-matchウォレットからバイヤーにUSDTが自動送金される。
 */
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { P2PSellerRow } from './database.js';
import {
  createP2PSeller,
  getP2PSeller,
  getP2PSellerByEmail,
  getP2PSellerByToken,
  listActiveP2PSellers,
  listActiveP2PSellersAnyMethod,
  lockP2PSellerBalance,
  releaseP2PSellerBalance,
  deductP2PSellerBalance,
  creditP2PSellerBalance,
  confirmOrderBySeller,
  getOrder,
  getOrdersBySellerId,
} from './database.js';
import orderManager from './orderManager.js';
import walletService from './walletService.js';

export interface P2PSeller {
  id: number;
  name: string;
  email: string;
  paypayId: string | null;
  linepayId: string | null;
  aupayId: string | null;
  usdtBalance: number;
  usdtLocked: number;
  usdtAvailable: number;
  minAmount: number;
  maxAmount: number;
  payMethods: string[];
  status: string;
  confirmToken: string;
  telegramChatId: string | null;
  totalTrades: number;
  createdAt: number;
}

function rowToSeller(row: P2PSellerRow): P2PSeller {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    paypayId: row.paypay_id || null,
    linepayId: row.linepay_id || null,
    aupayId: row.aupay_id || null,
    usdtBalance: row.usdt_balance || 0,
    usdtLocked: row.usdt_locked || 0,
    usdtAvailable: (row.usdt_balance || 0) - (row.usdt_locked || 0),
    minAmount: row.min_amount || 1000,
    maxAmount: row.max_amount || 500000,
    payMethods: (() => { try { return JSON.parse(row.pay_methods || '[]'); } catch { return []; } })(),
    status: row.status,
    confirmToken: row.confirm_token,
    telegramChatId: row.telegram_chat_id || null,
    totalTrades: row.total_trades || 0,
    createdAt: row.created_at,
  };
}

// ── セラー登録 ─────────────────────────────────────────────────
export async function registerSeller(data: {
  name: string;
  email: string;
  password: string;
  paypayId?: string;
  linepayId?: string;
  aupayId?: string;
  minAmount?: number;
  maxAmount?: number;
  payMethods?: string[];
}): Promise<{ success: boolean; sellerId?: number; confirmToken?: string; error?: string }> {
  if (!data.name || !data.email || !data.password) {
    return { success: false, error: '名前・メール・パスワードは必須です' };
  }
  if (data.password.length < 8) {
    return { success: false, error: 'パスワードは8文字以上で設定してください' };
  }
  const existing = getP2PSellerByEmail(data.email);
  if (existing) {
    return { success: false, error: 'このメールアドレスはすでに登録されています' };
  }
  if (!data.paypayId && !data.linepayId && !data.aupayId) {
    return { success: false, error: 'PayPay・LINE Pay・au PAY のいずれか1つを登録してください' };
  }

  const passwordHash = bcrypt.hashSync(data.password, 10);
  const confirmToken = crypto.randomUUID();

  const sellerId = createP2PSeller({
    name: data.name,
    email: data.email,
    passwordHash,
    confirmToken,
    paypayId: data.paypayId,
    linepayId: data.linepayId,
    aupayId: data.aupayId,
    minAmount: data.minAmount,
    maxAmount: data.maxAmount,
    payMethods: data.payMethods,
  });

  return { success: true, sellerId, confirmToken };
}

// ── USDT供給セラー検索（出金三角マッチング用・payMethod無関係）───
export function findSellerForUsdtSupply(requiredUsdt: number): P2PSeller | null {
  const sellers = listActiveP2PSellersAnyMethod(requiredUsdt);
  if (!sellers.length) return null;
  // 取引数順(DESC)でソート済み → 先頭を返す
  return rowToSeller(sellers[0]);
}

// ── マッチング ─────────────────────────────────────────────────
export function findMatchingSeller(amount: number, payMethod: string, requiredUsdt: number): P2PSeller | null {
  const sellers = listActiveP2PSellers(payMethod, amount, amount);
  // 利用可能残高が足りているセラーを絞り込み
  const eligible = sellers.filter(s => (s.usdt_balance - s.usdt_locked) >= requiredUsdt);
  if (!eligible.length) return null;
  // 完了率が高い順・ランダムで選択
  eligible.sort((a, b) => (b.total_trades || 0) - (a.total_trades || 0));
  return rowToSeller(eligible[0]);
}

// ── 残高操作 ───────────────────────────────────────────────────
export function lockBalance(sellerId: number, usdtAmount: number): boolean {
  return lockP2PSellerBalance(sellerId, usdtAmount);
}

export function releaseBalance(sellerId: number, usdtAmount: number): void {
  releaseP2PSellerBalance(sellerId, usdtAmount);
}

export function deductBalance(sellerId: number, usdtAmount: number): void {
  deductP2PSellerBalance(sellerId, usdtAmount);
}

export function creditBalance(sellerId: number, usdtAmount: number): void {
  creditP2PSellerBalance(sellerId, usdtAmount);
}

// ── セラー確認（支払い確認ページから呼ばれる）──────────────────
export async function confirmPayment(
  orderId: string,
  sellerToken: string
): Promise<{ success: boolean; error?: string; txId?: string }> {
  // トークン認証
  const sellerRow = getP2PSellerByToken(sellerToken);
  if (!sellerRow) return { success: false, error: '無効なトークンです' };

  const seller = rowToSeller(sellerRow);

  // 注文確認
  const order = getOrder(orderId);
  if (!order) return { success: false, error: '注文が見つかりません' };
  if (order.sellerId !== seller.id) return { success: false, error: 'この注文はあなたの担当ではありません' };
  if (order.status !== 'confirming') {
    return { success: false, error: `注文ステータスが不正です: ${order.status}` };
  }

  // 入金確認 → payment_verified
  const verified = orderManager.adminVerifyPayment(orderId);
  if (!verified) return { success: false, error: '入金確認処理に失敗しました' };

  // DB に確認記録
  confirmOrderBySeller(orderId, seller.id);

  // USDT 自動送金
  const sendResult = await walletService.processCryptoSend(orderId);
  if (!sendResult.success) {
    return { success: false, error: `USDT送金に失敗しました: ${sendResult.error || '不明なエラー'}` };
  }

  // セラー残高を減算
  deductBalance(seller.id, order.cryptoAmount);

  return { success: true, txId: sendResult.txId };
}

// ── セラー情報取得 ─────────────────────────────────────────────
export function getSellerById(id: number): P2PSeller | null {
  const row = getP2PSeller(id);
  return row ? rowToSeller(row) : null;
}

export function getSellerByToken(token: string): P2PSeller | null {
  const row = getP2PSellerByToken(token);
  return row ? rowToSeller(row) : null;
}

// ── セラーログイン ──────────────────────────────────────────────
export function loginSeller(email: string, password: string): {
  success: boolean; token?: string; seller?: P2PSeller; error?: string;
} {
  const row = getP2PSellerByEmail(email);
  if (!row) return { success: false, error: 'メールアドレスまたはパスワードが正しくありません' };
  if (!bcrypt.compareSync(password, row.password_hash)) {
    return { success: false, error: 'メールアドレスまたはパスワードが正しくありません' };
  }
  if (row.status === 'suspended') {
    return { success: false, error: 'このアカウントは停止されています' };
  }
  const seller = rowToSeller(row);
  return { success: true, token: seller.confirmToken, seller };
}

// ── セラーの注文履歴 ────────────────────────────────────────────
export function getSellerOrders(sellerId: number): Record<string, unknown>[] {
  return getOrdersBySellerId(sellerId);
}

export default {
  registerSeller,
  findSellerForUsdtSupply,
  findMatchingSeller,
  lockBalance,
  releaseBalance,
  deductBalance,
  creditBalance,
  confirmPayment,
  getSellerById,
  getSellerByToken,
  loginSeller,
  getSellerOrders,
};
