/**
 * @file alertService.ts — レートアラートサービス
 * @description レートを60秒ごとに監視し、重要な変動をスタッフにTelegram通知。
 */
export declare function startAlerts(): void;
export declare function stopAlerts(): void;
