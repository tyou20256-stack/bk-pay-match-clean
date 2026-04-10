/**
 * @file bankVerifier.ts — 銀行振込自動検証 (Phase C)
 * @description confirming状態の注文と、登録された銀行入金記録を照合し、
 *   金額一致時に自動でpayment_verifiedへ遷移させる。
 *
 *   入金記録の登録方法:
 *   1. 管理者が手動で個別入金を登録 (POST /api/bank-transfers)
 *   2. 銀行明細CSVの一括インポート (POST /api/bank-transfers/import)
 *   3. (将来) 銀行APIポーリング
 *
 *   マッチング条件:
 *   - 金額完全一致（±tolerance円）
 *   - 入金日が注文作成後
 *   - 同一口座への入金（paymentInfo.accountNumberとbank_account_idの照合）
 */
import * as dbSvc from './database.js';
import * as orderManager from './orderManager.js';
import notifier from './notifier.js';
import { broadcast } from './websocket.js';
import logger from './logger.js';

const CHECK_INTERVAL = 15_000; // 15 seconds
const AMOUNT_TOLERANCE = 0; // Exact match by default (configurable)

let verifierInterval: ReturnType<typeof setInterval> | null = null;
let enabled = true;
// Guard against concurrent processMatches calls (single-process lock)
let processingLock = false;

interface MatchResult {
  transferId: number;
  orderId: string;
  amount: number;
  confidence: number; // 0-100
}

/**
 * 未マッチの入金記録とconfirming状態の注文を照合
 */
export function matchTransfers(): MatchResult[] {
  if (!enabled) return [];

  const unmatchedTransfers = dbSvc.getUnmatchedBankTransfers();
  const confirmingOrders = dbSvc.getConfirmingOrders();

  if (!unmatchedTransfers.length || !confirmingOrders.length) return [];

  const results: MatchResult[] = [];
  const matchedOrderIds = new Set<string>();

  for (const transfer of unmatchedTransfers) {
    for (const order of confirmingOrders) {
      if (matchedOrderIds.has(order.id)) continue;

      // Amount match (exact or within tolerance)
      const diff = Math.abs(transfer.amount - order.amount);
      if (diff > AMOUNT_TOLERANCE) continue;

      // Date check: transfer should be after order creation.
      // Parse as local-time midnight to avoid UTC offset shifting the date by a day.
      const [y, m, d] = transfer.transfer_date.split('-').map(Number);
      const transferDate = new Date(y, m - 1, d).getTime(); // local midnight
      if (transferDate < order.createdAt - 24 * 60 * 60 * 1000) continue; // Allow 1 day before

      // Bank account match (if payment info has account number)
      let accountMatch = true;
      if (order.paymentInfo && transfer.bank_account_id) {
        let pi: Record<string, unknown>;
        try {
          pi = typeof order.paymentInfo === 'string'
            ? JSON.parse(order.paymentInfo) : order.paymentInfo;
        } catch {
          pi = {};
        }
        if (pi.accountNumber && transfer.bank_account_id) {
          // Verify the transfer is to the same bank account assigned to this order
          const accounts = dbSvc.getBankAccounts() as { id: number; account_number: string }[];
          const matchedAccount = accounts.find((a) => a.id === transfer.bank_account_id);
          if (matchedAccount && pi.accountNumber !== matchedAccount.account_number) {
            accountMatch = false;
          }
        }
      }

      if (!accountMatch) continue;

      // Calculate confidence
      let confidence = 80; // Base confidence for amount match
      if (diff === 0) confidence += 10; // Exact amount
      if (accountMatch && transfer.bank_account_id) confidence += 10; // Account verified

      results.push({
        transferId: transfer.id,
        orderId: order.id,
        amount: transfer.amount,
        confidence,
      });
      matchedOrderIds.add(order.id);
      break; // One transfer per order
    }
  }

  return results;
}

/**
 * マッチした入金を自動検証して注文ステータスを更新
 */
export function processMatches(): number {
  // Prevent concurrent execution within the same process
  if (processingLock) {
    logger.warn('processMatches already running, skipping');
    return 0;
  }
  processingLock = true;
  let verified = 0;

  try {
    const matches = matchTransfers();

    for (const match of matches) {
      try {
        // Auto-verify the order
        const order = orderManager.adminVerifyPayment(match.orderId);
        if (!order) continue;

        // Update the bank transfer record
        dbSvc.updateBankTransfer(match.transferId, {
          orderId: match.orderId,
          status: 'matched',
          matchedAt: Date.now(),
        });

        logger.info('Auto-verified order', { orderId: match.orderId, amount: match.amount, confidence: match.confidence });
        verified++;
      } catch (e: unknown) {
        logger.error('Failed to verify order', { orderId: match.orderId, error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    processingLock = false;
  }

  return verified;
}

/**
 * 単一入金記録を登録（手動入力）
 */
export function registerTransfer(data: {
  amount: number;
  transferDate: string;
  senderName?: string;
  bankAccountId?: number;
  reference?: string;
}): { id: number; autoMatched: boolean; matchedOrderId?: string } {
  if (!Number.isFinite(data.amount) || data.amount <= 0) {
    throw new Error('有効な金額を指定してください');
  }
  // Validate date format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.transferDate)) {
    throw new Error('日付形式が不正です (YYYY-MM-DD)');
  }
  const id = dbSvc.recordBankTransfer({
    amount: data.amount,
    transferDate: data.transferDate,
    senderName: data.senderName,
    bankAccountId: data.bankAccountId,
    reference: data.reference,
    verificationMethod: 'manual',
    status: 'unmatched',
  });

  // Immediately try to match
  const matches = matchTransfers();
  const thisMatch = matches.find(m => m.transferId === id);
  if (thisMatch) {
    const order = orderManager.adminVerifyPayment(thisMatch.orderId);
    if (order) {
      dbSvc.updateBankTransfer(id, {
        orderId: thisMatch.orderId,
        status: 'matched',
        matchedAt: Date.now(),
      });
      logger.info('Instant match', { transferId: id, orderId: thisMatch.orderId });
      return { id, autoMatched: true, matchedOrderId: thisMatch.orderId };
    }
  }

  return { id, autoMatched: false };
}

/**
 * CSV明細から一括インポート
 * CSV形式: 日付,振込人名,金額,摘要（ヘッダー行あり/なし対応）
 */
export function importCSV(csvText: string): {
  imported: number;
  matched: number;
  errors: string[];
  details: Array<{ line: number; amount: number; matched: boolean; orderId?: string }>;
} {
  const lines = csvText.trim().split('\n');
  const errors: string[] = [];
  const details: Array<{ line: number; amount: number; matched: boolean; orderId?: string }> = [];
  let imported = 0;
  let matched = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVLine(line);
    if (cols.length < 3) {
      // Skip header or invalid lines
      if (i === 0) continue;
      errors.push(`行${i + 1}: カラム不足 (${cols.length}列)`);
      continue;
    }

    // Try to parse: date, sender, amount, reference
    const dateStr = cols[0].trim();
    const senderName = cols[1].trim();
    const amountStr = cols[2].replace(/[,¥￥\s]/g, '').trim();
    const reference = cols[3]?.trim() || '';

    // Validate date
    const dateMatch = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!dateMatch) {
      if (i === 0) continue; // Likely header
      errors.push(`行${i + 1}: 日付形式不正 "${dateStr}"`);
      continue;
    }
    const transferDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;

    // Validate amount
    const amount = parseInt(amountStr, 10);
    if (isNaN(amount) || amount <= 0) {
      if (i === 0) continue; // Likely header
      errors.push(`行${i + 1}: 金額不正 "${amountStr}"`);
      continue;
    }

    // Record the transfer
    const result = registerTransfer({
      amount,
      transferDate,
      senderName: senderName || undefined,
      reference: reference || undefined,
    });

    imported++;
    if (result.autoMatched) {
      matched++;
      details.push({ line: i + 1, amount, matched: true, orderId: result.matchedOrderId });
    } else {
      details.push({ line: i + 1, amount, matched: false });
    }
  }

  return { imported, matched, errors, details };
}

/**
 * シンプルなCSVパーサー（カンマ区切り、ダブルクォート対応）
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * バックグラウンドポーリング開始
 */
export function startVerifier(): void {
  if (verifierInterval) return;
  logger.info('Auto-verification started', { intervalSec: CHECK_INTERVAL / 1000 });
  verifierInterval = setInterval(() => {
    try {
      processMatches();
    } catch (e: unknown) {
      logger.error('Polling error', { error: e instanceof Error ? e.message : String(e) });
    }
  }, CHECK_INTERVAL);
}

/**
 * ポーリング停止
 */
export function stopVerifier(): void {
  if (verifierInterval) {
    clearInterval(verifierInterval);
    verifierInterval = null;
    logger.info('Auto-verification stopped');
  }
}

/**
 * 有効/無効切替
 */
export function setEnabled(flag: boolean): void {
  enabled = flag;
  logger.info(flag ? 'Enabled' : 'Disabled');
}

export function isEnabled(): boolean {
  return enabled;
}

/**
 * ステータス取得
 */
export function getStatus(): {
  enabled: boolean;
  running: boolean;
  unmatchedTransfers: number;
  confirmingOrders: number;
} {
  return {
    enabled,
    running: verifierInterval !== null,
    unmatchedTransfers: dbSvc.getUnmatchedBankTransfers().length,
    confirmingOrders: dbSvc.getConfirmingOrders().length,
  };
}

export default {
  startVerifier, stopVerifier, setEnabled, isEnabled,
  matchTransfers, processMatches,
  registerTransfer, importCSV, getStatus,
};
