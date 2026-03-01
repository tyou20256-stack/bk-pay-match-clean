/**
 * @file auth.ts — 認証ミドルウェア
 * @description Cookie(bkpay_token)またはAuthorization Bearerヘッダーから
 *   セッショントークンを取得し、sessionsテーブルで有効性を検証。
 *   無効な場合は401 Unauthorizedを返却。
 */
import { Request, Response, NextFunction } from 'express';
export declare function authRequired(req: Request, res: Response, next: NextFunction): Response<any, Record<string, any>> | undefined;
