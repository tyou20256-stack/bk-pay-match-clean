"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordOrderResult = recordOrderResult;
exports.markTransferFailed = markTransferFailed;
exports.checkAccountHealth = checkAccountHealth;
exports.getHealthDashboard = getHealthDashboard;
exports.autoRestUnhealthyAccounts = autoRestUnhealthyAccounts;
exports.initFreezeDetector = initFreezeDetector;
/**
 * @file freezeDetector.ts — 口座凍結自動検知サービス
 * @description 銀行口座の健全性を監視し、問題のある口座を自動的に休止・凍結する。
 */
const database_js_1 = __importDefault(require("./database.js"));
const dbSvc = __importStar(require("./database.js"));
// === Schema ===
database_js_1.default.exec(`
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
function today() {
    return new Date().toISOString().slice(0, 10);
}
function getOrCreateHealthRow(accountId, date) {
    let row = database_js_1.default.prepare('SELECT * FROM account_health WHERE account_id = ? AND date = ?').get(accountId, date);
    if (!row) {
        const prev = database_js_1.default.prepare('SELECT consecutive_fails FROM account_health WHERE account_id = ? ORDER BY date DESC LIMIT 1').get(accountId);
        const prevFails = prev?.consecutive_fails || 0;
        database_js_1.default.prepare('INSERT INTO account_health (account_id, date, success_count, fail_count, consecutive_fails, health_score) VALUES (?, ?, 0, 0, ?, 100)').run(accountId, date, prevFails);
        row = database_js_1.default.prepare('SELECT * FROM account_health WHERE account_id = ? AND date = ?').get(accountId, date);
    }
    return row;
}
function computeHealthScore(successCount, failCount, consecutiveFails) {
    const total = successCount + failCount;
    if (total === 0)
        return 100;
    const successRate = successCount / total;
    let score = Math.round(successRate * 100);
    score -= consecutiveFails * 15;
    return Math.max(0, Math.min(100, score));
}
function computeRecommendation(healthScore, consecutiveFails) {
    if (consecutiveFails >= 5)
        return 'frozen';
    if (consecutiveFails >= 3)
        return 'rest';
    if (healthScore < 50)
        return 'investigate';
    if (healthScore < 80)
        return 'rest';
    return 'active';
}
function recordOrderResult(accountId, success) {
    const d = today();
    getOrCreateHealthRow(accountId, d);
    if (success) {
        database_js_1.default.prepare('UPDATE account_health SET success_count = success_count + 1, consecutive_fails = 0 WHERE account_id = ? AND date = ?').run(accountId, d);
    }
    else {
        database_js_1.default.prepare('UPDATE account_health SET fail_count = fail_count + 1, consecutive_fails = consecutive_fails + 1 WHERE account_id = ? AND date = ?').run(accountId, d);
    }
    const updated = getOrCreateHealthRow(accountId, d);
    const score = computeHealthScore(updated.success_count, updated.fail_count, updated.consecutive_fails);
    database_js_1.default.prepare('UPDATE account_health SET health_score = ? WHERE account_id = ? AND date = ?').run(score, accountId, d);
}
function markTransferFailed(accountId) {
    recordOrderResult(accountId, false);
    dbSvc.updateBankAccount(accountId, { status: 'frozen' });
    console.log(`[FreezeDetector] Account ${accountId} frozen due to transfer failure`);
}
function checkAccountHealth(accountId) {
    const accounts = dbSvc.getBankAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account)
        return null;
    const d = today();
    const row = getOrCreateHealthRow(accountId, d);
    const score = computeHealthScore(row.success_count, row.fail_count, row.consecutive_fails);
    const recommendation = computeRecommendation(score, row.consecutive_fails);
    return {
        accountId, bankName: account.bank_name, consecutiveFailures: row.consecutive_fails,
        todaySuccess: row.success_count, todayFail: row.fail_count, healthScore: score, recommendation,
    };
}
function getHealthDashboard() {
    const accounts = dbSvc.getBankAccounts();
    return accounts.map((a) => {
        const health = checkAccountHealth(a.id);
        return health || {
            accountId: a.id, bankName: a.bank_name, consecutiveFailures: 0,
            todaySuccess: 0, todayFail: 0, healthScore: 100, recommendation: 'active',
        };
    });
}
function autoRestUnhealthyAccounts() {
    const dashboard = getHealthDashboard();
    let rested = 0, frozen = 0;
    for (const health of dashboard) {
        if (health.recommendation === 'frozen' && health.consecutiveFailures >= 5) {
            dbSvc.updateBankAccount(health.accountId, { status: 'frozen' });
            frozen++;
            console.log(`[FreezeDetector] Auto-frozen account ${health.accountId} (${health.bankName})`);
        }
        else if (health.recommendation === 'rest' && health.consecutiveFailures >= 3) {
            dbSvc.updateBankAccount(health.accountId, { status: 'rest' });
            rested++;
            console.log(`[FreezeDetector] Auto-rested account ${health.accountId} (${health.bankName})`);
        }
    }
    return { rested, frozen };
}
function initFreezeDetector() {
    console.log('[FreezeDetector] Initialized');
    setInterval(() => {
        const result = autoRestUnhealthyAccounts();
        if (result.rested > 0 || result.frozen > 0) {
            console.log(`[FreezeDetector] Auto-check: ${result.rested} rested, ${result.frozen} frozen`);
        }
    }, 10 * 60 * 1000);
}
