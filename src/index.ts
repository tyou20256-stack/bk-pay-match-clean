import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import apiRouter from './routes/api';
import { updateAllCryptos } from './services/aggregator';
import { CONFIG } from './config';
import { authRequired } from './middleware/auth';
import { authenticateUser, deleteSession, validateSession } from './services/database';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// Auth routes (no auth required)
app.post('/api/auth/login', (req, res) => {
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

// Public API routes (rates, pay orders)
app.use('/api', apiRouter);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
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

  app.listen(CONFIG.port, '0.0.0.0', () => {
    console.log(`\n✅ Dashboard: http://localhost:${CONFIG.port}`);
    console.log(`📊 API: http://localhost:${CONFIG.port}/api/rates`);
  });
}

start();
