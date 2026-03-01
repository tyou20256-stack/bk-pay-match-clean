/**
 * @file auth.ts — 認証ミドルウェア
 * @description Cookie(bkpay_token)またはAuthorization Bearerヘッダーから
 *   セッショントークンを取得し、sessionsテーブルで有効性を検証。
 *   無効な場合は401 Unauthorizedを返却。
 */
import { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/database.js';

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token || !validateSession(token)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}
