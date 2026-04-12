/**
 * @file _shared.ts — Shared utilities for route modules
 * @description Common helpers, constants, and re-exports used across all route files.
 */
import { Response } from 'express';
import { AppError } from '../errors.js';
import logger from '../services/logger.js';

export const TRON_ADDR_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
export const VALID_PAY_METHODS = ['bank', 'paypay', 'linepay', 'aupay'];
export const VALID_CRYPTOS = ['USDT', 'BTC', 'ETH'];

/**
 * Sanitize error messages — never expose internal details to clients.
 */
export function safeError(e: unknown, fallback = 'Internal server error'): string {
  // Structured errors are always safe to return
  if (e instanceof AppError) return e.message;
  // Only return known safe messages; log the real error
  const err = e instanceof Error ? e : null;
  if (err?.message) {
    logger.error('API error', { error: err.message });
  }
  // Allow specific user-facing error messages
  const safeMessages = [
    'Minimum amount is ¥500',
    '金額の上限は1,000万円です',
    '暗号通貨の数量を指定してください',
    '銀行情報（銀行名、口座番号、名義）は必須です',
    '売却レートを取得できませんでした',
    'exchange required',
    'username and password required',
    'role required',
    'newPassword required',
    'scope required',
    'totalAmountJpy required',
    'crypto required',
    'telegramId and referralCode required',
    'email and password required',
    'documentType and filePath required',
    'status must be approved or rejected',
    '有効な金額を指定してください',
    '日付形式が不正です (YYYY-MM-DD)',
    '既に紹介コードを登録済みです',
    '無効な紹介コードです',
    '自分のコードは使用できません',
    'Wallet not configured (TRON_WALLET_PRIVATE_KEY not set)',
    'Order not found',
    'Order not found or invalid status transition',
    '金額と入金日は必須です',
    'CSVデータが必要です',
  ];
  if (err?.message && safeMessages.includes(err.message)) return err.message;
  return fallback;
}

/**
 * Send CSV response with BOM for Excel compatibility.
 */
export function sendCSV(res: Response, csv: string, filename: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
}
