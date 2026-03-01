"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @file index.ts — エントリーポイント
 * @description Expressサーバーの初期化、認証ルート、ミドルウェア設定、
 *   レート更新スケジューラー、TronMonitorの起動を行う。
 *   公開/保護ルートの境界もここで定義。
 */
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const tronMonitor_js_1 = require("./services/tronMonitor.js");
const telegramBot_js_1 = require("./services/telegramBot.js");
const alertService_js_1 = require("./services/alertService.js");
const priceNotifier_js_1 = require("./services/priceNotifier.js");
const api_1 = __importDefault(require("./routes/api"));
const aggregator_1 = require("./services/aggregator");
const config_1 = require("./config");
const auth_1 = require("./middleware/auth");
const database_1 = require("./services/database");
const websocket_1 = require("./services/websocket");
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '5mb' }));
app.use((0, cookie_parser_1.default)());
// A5: Rate limiting
const loginLimiter = (0, express_rate_limit_1.default)({ windowMs: 15 * 60 * 1000, max: 10, message: { success: false, error: 'Too many login attempts. Try again later.' } });
const orderLimiter = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, max: 30, message: { success: false, error: 'Too many requests. Please wait.' } });
// Auth routes (no auth required)
app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    const result = (0, database_1.authenticateUser)(username, password);
    if (!result)
        return res.json({ success: false, error: 'Invalid credentials' });
    res.cookie('bkpay_token', result.token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.json({ success: true, token: result.token });
});
app.post('/api/auth/logout', (req, res) => {
    const token = req.cookies?.bkpay_token;
    if (token)
        (0, database_1.deleteSession)(token);
    res.clearCookie('bkpay_token');
    res.json({ success: true });
});
// A4: Password change
app.post('/api/auth/change-password', (req, res) => {
    const token = req.cookies?.bkpay_token;
    if (!token || !(0, database_1.validateSession)(token))
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
        return res.json({ success: false, error: 'Both passwords required' });
    if (newPassword.length < 6)
        return res.json({ success: false, error: 'Password must be at least 6 characters' });
    // Get user from session
    const changed = (0, database_1.changePassword)(token, currentPassword, newPassword);
    if (!changed)
        return res.json({ success: false, error: 'Current password incorrect' });
    res.json({ success: true, message: 'Password changed successfully' });
});
app.get('/api/auth/check', (req, res) => {
    const token = req.cookies?.bkpay_token;
    res.json({ success: !!(token && (0, database_1.validateSession)(token)) });
});
// Public pages (no auth)
app.use('/login.html', express_1.default.static(path_1.default.join(__dirname, '..', 'public', 'login.html')));
app.use('/pay.html', express_1.default.static(path_1.default.join(__dirname, '..', 'public', 'pay.html')));
app.use('/guide.html', express_1.default.static(path_1.default.join(__dirname, '..', 'public', 'guide.html')));
// Protected admin page
app.get('/admin.html', (req, res) => {
    const token = req.cookies?.bkpay_token;
    if (!token || !(0, database_1.validateSession)(token))
        return res.redirect('/login.html');
    res.sendFile(path_1.default.join(__dirname, '..', 'public', 'admin.html'));
});
// Public static (CSS, JS, images)
app.use(express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
// Protected API routes - orders: only GET list needs auth, POST is public (customer)
app.get('/api/orders', auth_1.authRequired);
// POST /api/orders (create) is public for pay.html
// GET /api/orders/:id is public (customer checks status)
// POST /api/orders/:id/paid is public (customer marks paid)
// POST /api/orders/:id/cancel is public
app.use('/api/accounts', auth_1.authRequired);
app.use('/api/epay', auth_1.authRequired);
app.use('/api/trader', auth_1.authRequired);
app.use('/api/wallet', auth_1.authRequired);
app.use('/api/settings', auth_1.authRequired);
app.use('/api/reports', auth_1.authRequired);
// Public API routes (rates, pay orders)
app.use('/api/orders', orderLimiter);
app.use('/api', api_1.default);
app.get('/', (_req, res) => {
    res.sendFile(path_1.default.join(__dirname, '..', 'public', 'index.html'));
});
// Global error handler
app.use((err, req, res, next) => {
    console.error('[Error]', err.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
});
async function start() {
    console.log('🚀 BK P2P Aggregator starting...');
    console.log(`📡 Exchanges: Bybit, Binance, OKX`);
    console.log(`💱 Cryptos: ${config_1.CONFIG.cryptos.join(', ')}`);
    console.log(`🔄 Update interval: ${config_1.CONFIG.updateIntervalMs / 1000}s`);
    // Initial fetch
    await (0, aggregator_1.updateAllCryptos)().catch(err => console.error('Initial fetch error:', err.message));
    // Schedule updates
    setInterval(() => {
        (0, aggregator_1.updateAllCryptos)().catch(err => console.error('Update error:', err.message));
    }, config_1.CONFIG.updateIntervalMs);
    // A3: Start USDT deposit monitor
    (0, tronMonitor_js_1.startMonitor)();
    // Telegram Bot
    const ENABLE_TELEGRAM_BOT = process.env.ENABLE_TELEGRAM_BOT === 'true';
    if (ENABLE_TELEGRAM_BOT) {
        try {
            (0, telegramBot_js_1.startTelegramBot)();
        }
        catch (e) {
            console.error('[TelegramBot] Failed to start:', e);
        }
    }
    else {
        console.log('[TelegramBot] Disabled (set ENABLE_TELEGRAM_BOT=true to enable)');
    }
    // Rate Alert Service
    const ENABLE_ALERTS = process.env.ENABLE_ALERTS === 'true';
    if (ENABLE_ALERTS) {
        try {
            (0, alertService_js_1.startAlerts)();
        }
        catch (e) {
            console.error('[AlertService] Failed to start:', e);
        }
    }
    else {
        console.log('[AlertService] Disabled (set ENABLE_ALERTS=true to enable)');
    }
    // Price Notifications (Daily/Spike/Weekly)
    const ENABLE_NOTIFICATIONS = process.env.ENABLE_NOTIFICATIONS === 'true';
    if (ENABLE_NOTIFICATIONS) {
        try {
            (0, priceNotifier_js_1.startPriceNotifier)();
        }
        catch (e) {
            console.error('[PriceNotifier] Failed to start:', e);
        }
    }
    else {
        console.log('[PriceNotifier] Disabled (set ENABLE_NOTIFICATIONS=true to enable)');
    }
    const server = http_1.default.createServer(app);
    (0, websocket_1.initWebSocket)(server);
    server.listen(config_1.CONFIG.port, '0.0.0.0', () => {
        console.log(`\n✅ Dashboard: http://localhost:${config_1.CONFIG.port}`);
        console.log(`📊 API: http://localhost:${config_1.CONFIG.port}/api/rates`);
    });
}
start();
