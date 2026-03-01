/**
 * @file index.ts — エントリーポイント
 * @description Expressサーバーの初期化、認証ルート、ミドルウェア設定、
 *   レート更新スケジューラー、TronMonitorの起動を行う。
 *   公開/保護ルートの境界もここで定義。
 */
import express from 'express';
import http from 'http';
import path from 'path';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { startMonitor } from './services/tronMonitor.js';
import { startTelegramBot } from './services/telegramBot.js';
import { startAlerts } from './services/alertService.js';
import apiRouter from './routes/api';
import { updateAllCryptos } from './services/aggregator';
import { CONFIG } from './config';
import { authRequired } from './middleware/auth';
import { authenticateUser, deleteSession, validateSession, changePassword } from './services/database';
import { initWebSocket } from './services/websocket';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// A5: Rate limiting
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { success: false, error: 'Too many login attempts. Try again later.' } });
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { success: false, error: 'Too many requests. Please wait.' } });


// Auth routes (no auth required)
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const result = authenticateUser(username, password);
  if (!result) return res.json({ success: false, error: 'Invalid credentials' });
  res.cookie('bkpay_token', result.token, { httpOnly: true, maxAge: 24*60*60*1000, sameSite: 'lax' });
  res.json({ success: true, token: result.token });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (token) deleteSession(token);
  res.clearCookie('bkpay_token');
  res.json({ success: true });
});

// A4: Password change
app.post('/api/auth/change-password', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.json({ success: false, error: 'Both passwords required' });
  if (newPassword.length < 6) return res.json({ success: false, error: 'Password must be at least 6 characters' });
  // Get user from session
  const changed = changePassword(token, currentPassword, newPassword);
  if (!changed) return res.json({ success: false, error: 'Current password incorrect' });
  res.json({ success: true, message: 'Password changed successfully' });
});

app.get('/api/auth/check', (req, res) => {
  const token = req.cookies?.bkpay_token;
  res.json({ success: !!(token && validateSession(token)) });
});

// Public pages (no auth)
app.use('/login.html', express.static(path.join(__dirname, '..', 'public', 'login.html')));
app.use('/pay.html', express.static(path.join(__dirname, '..', 'public', 'pay.html')));
app.use('/guide.html', express.static(path.join(__dirname, '..', 'public', 'guide.html')));

// Protected admin page
app.get('/admin.html', (req, res) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token)) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Public static (CSS, JS, images)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Protected API routes - orders: only GET list needs auth, POST is public (customer)
app.get('/api/orders', authRequired);
// POST /api/orders (create) is public for pay.html
// GET /api/orders/:id is public (customer checks status)
// POST /api/orders/:id/paid is public (customer marks paid)
// POST /api/orders/:id/cancel is public
app.use('/api/accounts', authRequired);
app.use('/api/epay', authRequired);
app.use('/api/trader', authRequired);
app.use('/api/wallet', authRequired);
app.use('/api/settings', authRequired);
app.use('/api/reports', authRequired);

// Public API routes (rates, pay orders)
app.use('/api/orders', orderLimiter);
app.use('/api', apiRouter);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

async function start() {
  console.log('🚀 BK P2P Aggregator starting...');
  console.log(`📡 Exchanges: Bybit, Binance, OKX`);
  console.log(`💱 Cryptos: ${CONFIG.cryptos.join(', ')}`);
  console.log(`🔄 Update interval: ${CONFIG.updateIntervalMs / 1000}s`);

  // Initial fetch
  await updateAllCryptos().catch(err => console.error('Initial fetch error:', err.message));

  // Schedule updates
  setInterval(() => {
    updateAllCryptos().catch(err => console.error('Update error:', err.message));
  }, CONFIG.updateIntervalMs);

  // A3: Start USDT deposit monitor
  startMonitor();

  // Telegram Bot
  const ENABLE_TELEGRAM_BOT = process.env.ENABLE_TELEGRAM_BOT === 'true';
  if (ENABLE_TELEGRAM_BOT) {
    try { startTelegramBot(); } catch (e) { console.error('[TelegramBot] Failed to start:', e); }
  } else {
    console.log('[TelegramBot] Disabled (set ENABLE_TELEGRAM_BOT=true to enable)');
  }

  // Rate Alert Service
  const ENABLE_ALERTS = process.env.ENABLE_ALERTS === 'true';
  if (ENABLE_ALERTS) {
    try { startAlerts(); } catch (e) { console.error('[AlertService] Failed to start:', e); }
  } else {
    console.log('[AlertService] Disabled (set ENABLE_ALERTS=true to enable)');
  }

  const server = http.createServer(app);
  initWebSocket(server);
  server.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`\n✅ Dashboard: http://localhost:${CONFIG.port}`);
    console.log(`📊 API: http://localhost:${CONFIG.port}/api/rates`);
  });
}

start();
