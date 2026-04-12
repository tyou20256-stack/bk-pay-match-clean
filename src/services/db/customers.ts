/**
 * @file customers.ts — Customers, referrals, VIP
 */
import crypto from 'crypto';
import logger from '../logger.js';
import { db } from './connection.js';
import type { CustomerRow, ReferralStatsRow, ReferralRewardRow } from './connection.js';

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return 'BK-' + code;
}

function calculateVipRank(totalVolume: number): string {
  if (totalVolume >= 20_000_000) return 'platinum';
  if (totalVolume >= 5_000_000) return 'gold';
  if (totalVolume >= 1_000_000) return 'silver';
  return 'bronze';
}

export function getVipDiscount(rank: string): number {
  switch (rank) {
    case 'platinum': return 1.0;
    case 'gold': return 0.5;
    case 'silver': return 0.3;
    default: return 0;
  }
}

export function getOrCreateCustomer(telegramId: string): CustomerRow {
  let customer = db.prepare('SELECT * FROM customers WHERE telegram_id = ?').get(telegramId) as CustomerRow | undefined;
  if (!customer) {
    const code = generateReferralCode();
    db.prepare('INSERT INTO customers (telegram_id, referral_code) VALUES (?, ?)').run(telegramId, code);
    customer = db.prepare('SELECT * FROM customers WHERE telegram_id = ?').get(telegramId) as CustomerRow | undefined;
  }
  return customer!;
}

export function applyReferralCode(telegramId: string, code: string): { success: boolean; error?: string } {
  const customer = getOrCreateCustomer(telegramId);
  if (customer.referred_by) return { success: false, error: '既に紹介コードを登録済みです' };
  const referrer = db.prepare('SELECT * FROM customers WHERE referral_code = ?').get(code) as CustomerRow | undefined;
  if (!referrer) return { success: false, error: '無効な紹介コードです' };
  if (referrer.telegram_id === telegramId) return { success: false, error: '自分のコードは使用できません' };
  db.prepare("UPDATE customers SET referred_by = ?, updated_at = datetime('now') WHERE telegram_id = ?").run(code, telegramId);
  return { success: true };
}

export function addReferralReward(referrerId: string, referredId: string, orderId: string, rewardJpy: number): void {
  db.prepare('INSERT INTO referral_rewards (referrer_telegram_id, referred_telegram_id, order_id, reward_jpy) VALUES (?, ?, ?, ?)').run(referrerId, referredId, orderId, rewardJpy);
}

export function updateCustomerVolume(telegramId: string, jpyAmount: number): void {
  const customer = getOrCreateCustomer(telegramId);
  const newVolume = (customer.total_volume_jpy || 0) + jpyAmount;
  const newOrders = (customer.total_orders || 0) + 1;
  const newRank = calculateVipRank(newVolume);
  db.prepare("UPDATE customers SET total_volume_jpy = ?, total_orders = ?, vip_rank = ?, updated_at = datetime('now') WHERE telegram_id = ?").run(newVolume, newOrders, newRank, telegramId);
}

export function getCustomerStats(telegramId: string): CustomerRow & { referral_count: number; total_rewards: number } {
  const customer = getOrCreateCustomer(telegramId);
  const referralStats = getReferralStats(telegramId);
  return { ...customer, ...referralStats };
}

export function getReferralStats(telegramId: string): { referral_count: number; total_rewards: number } {
  const row = db.prepare('SELECT COUNT(*) as referral_count, COALESCE(SUM(reward_jpy), 0) as total_rewards FROM referral_rewards WHERE referrer_telegram_id = ?').get(telegramId) as ReferralStatsRow;
  return { referral_count: row.referral_count, total_rewards: row.total_rewards };
}

export function getAllCustomers(): CustomerRow[] {
  return db.prepare('SELECT * FROM customers ORDER BY total_volume_jpy DESC').all() as CustomerRow[];
}

export function getAllReferralRewards(): ReferralRewardRow[] {
  return db.prepare('SELECT * FROM referral_rewards ORDER BY created_at DESC').all() as ReferralRewardRow[];
}

export function getCustomerByReferralCode(code: string): CustomerRow | undefined {
  return db.prepare('SELECT * FROM customers WHERE referral_code = ?').get(code) as CustomerRow | undefined;
}

// === P2P Buy Referral Program ===

export function createReferralCode(referrerId: string, referrerType: string, parentCode?: string): string {
  const code = 'PM' + crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('INSERT INTO referrals (referrer_code, referrer_type, referrer_id, parent_code, created_at) VALUES (?, ?, ?, ?, ?)').run(code, referrerType, referrerId, parentCode || null, Date.now());
  return code;
}

export function getReferralByCode(code: string): { referrer_code: string; referrer_id: string; total_referrals: number; total_volume_jpy: number; total_reward_usdt: number } | undefined {
  return db.prepare("SELECT * FROM referrals WHERE referrer_code = ? AND status = 'active'").get(code) as { referrer_code: string; referrer_id: string; total_referrals: number; total_volume_jpy: number; total_reward_usdt: number } | undefined;
}

export function recordReferralConversion(code: string, buyerId: string, matchId: number, amountJpy: number): void {
  const TIER1_RATE = 0.0015; // 0.15%
  const TIER2_RATE = 0.0005; // 0.05%
  const rewardUsdt = amountJpy * TIER1_RATE;

  db.prepare('INSERT INTO referral_conversions (referral_code, buyer_id, match_id, amount_jpy, reward_usdt, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(code, buyerId, matchId, amountJpy, rewardUsdt, 'confirmed', Date.now());
  db.prepare('UPDATE referrals SET total_referrals = total_referrals + 1, total_volume_jpy = total_volume_jpy + ?, total_reward_usdt = total_reward_usdt + ? WHERE referrer_code = ?').run(amountJpy, rewardUsdt, code);

  // Tier 2: reward parent referrer
  const ref = db.prepare("SELECT parent_code FROM referrals WHERE referrer_code = ?").get(code) as { parent_code: string | null } | undefined;
  if (ref?.parent_code) {
    const tier2Reward = amountJpy * TIER2_RATE;
    db.prepare('UPDATE referrals SET tier2_reward_usdt = tier2_reward_usdt + ? WHERE referrer_code = ?').run(tier2Reward, ref.parent_code);
    logger.info('Tier2 referral reward', { parentCode: ref.parent_code, reward: tier2Reward });
  }
}

export function getP2pReferralStats(code: string): { conversions: number; volume: number; rewards: number } {
  const ref = db.prepare("SELECT total_referrals, total_volume_jpy, total_reward_usdt FROM referrals WHERE referrer_code = ?").get(code) as { total_referrals: number; total_volume_jpy: number; total_reward_usdt: number } | undefined;
  if (!ref) return { conversions: 0, volume: 0, rewards: 0 };
  return { conversions: ref.total_referrals, volume: ref.total_volume_jpy, rewards: ref.total_reward_usdt };
}
