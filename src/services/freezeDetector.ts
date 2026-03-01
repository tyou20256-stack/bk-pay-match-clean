/**
 * @file freezeDetector.ts — 口座凍結自動検知サービス
 * @description 銀行口座の健全性を監視し、問題のある口座を自動的に休止・凍結する。
 */
import db from './database.js';
import * as dbSvc from './database.js';

// === Schema ===
(db as any).exec(`
  CREATE TABLE IF NOT EXISTS account_health (
    account_id INTEGER,
    date TEXT,
    success_count INTEGER DEFAULT 0,
    fail_count INTEGER DEFAULT 0,
    consecutive_fails INTEGER DEFAULT 0,
    health_score INTEGER DEFAULT 100,
    UNIQUE(account_id, date)
  );
`);

export interface AccountHealth {
  accountId: number;
  bankName: string;
  consecutiveFailures: number;
  todaySuccess: number;
  todayFail: number;
  healthScore: number;
  recommendation: 'active' | 'rest' | 'investigate' | 'frozen';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateHealthRow(accountId: number, date: string): any {
  let row = (db as any).prepare('SELECT * FROM account_health WHERE account_id = ? AND date = ?').get(accountId, date);
  if (!row) {
    const prev = (db as any).prepare('SELECT consecutive_fails FROM account_health WHERE account_id = ? ORDER BY date DESC LIMIT 1').get(accountId);
    const prevFails = prev?.consecutive_fails || 0;
    (db as any).prepare('INSERT INTO account_health (account_id, date, success_count, fail_count, consecutive_fails, health_score) VALUES (?, ?, 0, 0, ?, 100)').run(accountId, date, prevFails);
    row = (db as any).prepare('SELECT * FROM account_health WHERE account_id = ? AND date = ?').get(accountId, date);
  }
  return row;
}

function computeHealthScore(successCount: number, failCount: number, consecutiveFails: number): number {
  const total = successCount + failCount;
  if (total === 0) return 100;
  const successRate = successCount / total;
  let score = Math.round(successRate * 100);
  score -= consecutiveFails * 15;
  return Math.max(0, Math.min(100, score));
}

function computeRecommendation(healthScore: number, consecutiveFails: number): AccountHealth['recommendation'] {
  if (consecutiveFails >= 5) return 'frozen';
  if (consecutiveFails >= 3) return 'rest';
  if (healthScore < 50) return 'investigate';
  if (healthScore < 80) return 'rest';
  return 'active';
}

export function recordOrderResult(accountId: number, success: boolean): void {
  const d = today();
  getOrCreateHealthRow(accountId, d);
  if (success) {
    (db as any).prepare('UPDATE account_health SET success_count = success_count + 1, consecutive_fails = 0 WHERE account_id = ? AND date = ?').run(accountId, d);
  } else {
    (db as any).prepare('UPDATE account_health SET fail_count = fail_count + 1, consecutive_fails = consecutive_fails + 1 WHERE account_id = ? AND date = ?').run(accountId, d);
  }
  const updated = getOrCreateHealthRow(accountId, d);
  const score = computeHealthScore(updated.success_count, updated.fail_count, updated.consecutive_fails);
  (db as any).prepare('UPDATE account_health SET health_score = ? WHERE account_id = ? AND date = ?').run(score, accountId, d);
}

export function markTransferFailed(accountId: number): void {
  recordOrderResult(accountId, false);
  dbSvc.updateBankAccount(accountId, { status: 'frozen' });
  console.log(`[FreezeDetector] Account ${accountId} frozen due to transfer failure`);
}

export function checkAccountHealth(accountId: number): AccountHealth | null {
  const accounts = dbSvc.getBankAccounts();
  const account = accounts.find((a: any) => a.id === accountId);
  if (!account) return null;
  const d = today();
  const row = getOrCreateHealthRow(accountId, d);
  const score = computeHealthScore(row.success_count, row.fail_count, row.consecutive_fails);
  const recommendation = computeRecommendation(score, row.consecutive_fails);
  return {
    accountId, bankName: account.bank_name, consecutiveFailures: row.consecutive_fails,
    todaySuccess: row.success_count, todayFail: row.fail_count, healthScore: score, recommendation,
  };
}

export function getHealthDashboard(): AccountHealth[] {
  const accounts = dbSvc.getBankAccounts();
  return accounts.map((a: any) => {
    const health = checkAccountHealth(a.id);
    return health || {
      accountId: a.id, bankName: a.bank_name, consecutiveFailures: 0,
      todaySuccess: 0, todayFail: 0, healthScore: 100, recommendation: 'active' as const,
    };
  });
}

export function autoRestUnhealthyAccounts(): { rested: number; frozen: number } {
  const dashboard = getHealthDashboard();
  let rested = 0, frozen = 0;
  for (const health of dashboard) {
    if (health.recommendation === 'frozen' && health.consecutiveFailures >= 5) {
      dbSvc.updateBankAccount(health.accountId, { status: 'frozen' });
      frozen++;
      console.log(`[FreezeDetector] Auto-frozen account ${health.accountId} (${health.bankName})`);
    } else if (health.recommendation === 'rest' && health.consecutiveFailures >= 3) {
      dbSvc.updateBankAccount(health.accountId, { status: 'rest' });
      rested++;
      console.log(`[FreezeDetector] Auto-rested account ${health.accountId} (${health.bankName})`);
    }
  }
  return { rested, frozen };
}

export function initFreezeDetector(): void {
  console.log('[FreezeDetector] Initialized');
  setInterval(() => {
    const result = autoRestUnhealthyAccounts();
    if (result.rested > 0 || result.frozen > 0) {
      console.log(`[FreezeDetector] Auto-check: ${result.rested} rested, ${result.frozen} frozen`);
    }
  }, 10 * 60 * 1000);
}
