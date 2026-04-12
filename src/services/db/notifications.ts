/**
 * @file notifications.ts — Notification prefs, rate alerts, funnel events
 */
import { db } from './connection.js';
import type { NotificationPrefRow, TelegramIdRow } from './connection.js';

// === Notification Preferences ===

export function getNotificationSubscribers(type: string): number[] {
  const col = type === 'daily_summary' ? 'daily_summary' : type === 'spike_alerts' ? 'spike_alerts' : 'weekly_summary';
  const rows = db.prepare(`SELECT telegram_id FROM notification_preferences WHERE ${col} = 1`).all() as TelegramIdRow[];
  return rows.map(r => r.telegram_id);
}

export function setNotificationPreference(telegramId: number, type: string, enabled: boolean): void {
  const col = type === 'daily_summary' ? 'daily_summary' : type === 'spike_alerts' ? 'spike_alerts' : 'weekly_summary';
  db.prepare(`INSERT INTO notification_preferences (telegram_id, ${col}) VALUES (?, ?) ON CONFLICT(telegram_id) DO UPDATE SET ${col} = ?`).run(telegramId, enabled ? 1 : 0, enabled ? 1 : 0);
}

export function getNotificationPreferences(telegramId: number): { daily_summary: boolean; spike_alerts: boolean; weekly_summary: boolean } {
  const row = db.prepare('SELECT * FROM notification_preferences WHERE telegram_id = ?').get(telegramId) as NotificationPrefRow | undefined;
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO notification_preferences (telegram_id) VALUES (?)').run(telegramId);
    return { daily_summary: true, spike_alerts: true, weekly_summary: true };
  }
  return { daily_summary: !!row.daily_summary, spike_alerts: !!row.spike_alerts, weekly_summary: !!row.weekly_summary };
}

export function setAlertThreshold(telegramId: number, crypto: string, threshold: number): void {
  db.prepare(`INSERT INTO notification_preferences (telegram_id, alert_crypto, alert_threshold) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET alert_crypto = ?, alert_threshold = ?`).run(telegramId, crypto, threshold, crypto, threshold);
}

// === Rate Alerts ===

export function createRateAlert(chatId: number, targetRate: number, direction: string = 'below'): number {
  const result = db.prepare('INSERT INTO rate_alerts (chat_id, target_rate, direction, crypto, active, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(chatId, targetRate, direction, 'USDT', Date.now());
  return Number(result.lastInsertRowid);
}

export function getActiveRateAlerts(): Array<{ id: number; chat_id: number; target_rate: number; direction: string }> {
  return db.prepare("SELECT id, chat_id, target_rate, direction FROM rate_alerts WHERE active = 1").all() as Array<{ id: number; chat_id: number; target_rate: number; direction: string }>;
}

export function triggerRateAlert(id: number): void {
  db.prepare('UPDATE rate_alerts SET active = 0, triggered_at = ? WHERE id = ?').run(Date.now(), id);
}

// === Funnel Events ===

export function insertFunnelEvent(event: string, data: string, refCode: string, ip: string, userAgent: string): void {
  db.prepare('INSERT INTO funnel_events (event, data, ref_code, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(event, data, refCode, ip, userAgent, Date.now());
}
