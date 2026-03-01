import { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/database.js';

export function authRequired(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token || !validateSession(token)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}
