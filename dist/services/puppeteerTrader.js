"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trader = void 0;
/**
 * @file puppeteerTrader.ts — Puppeteer自動P2P取引
 * @description ヘッドレスブラウザでBybit/BinanceにログインしP2P注文を自動作成。
 *   セッションCookie保存による再ログイン回避、エラー時スクリーンショット、
 *   人間的な遅延挿入を含む。
 */
const puppeteer_1 = __importDefault(require("puppeteer"));
const database_js_1 = require("./database.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const COOKIE_DIR = path_1.default.resolve(process.cwd(), 'data/cookies');
const SCREENSHOT_PATH = '/tmp/puppeteer-error.png';
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
class P2PTrader {
    browser = null;
    pages = new Map();
    loggedIn = new Map();
    lastActivity = new Map();
    running = false;
    async init() {
        try {
            fs_1.default.mkdirSync(COOKIE_DIR, { recursive: true });
            this.browser = await puppeteer_1.default.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
            });
            this.running = true;
            console.log('[Puppeteer] Browser launched');
        }
        catch (e) {
            console.error('[Puppeteer] Failed to launch browser:', e.message);
        }
    }
    async getPage(exchange) {
        if (this.pages.has(exchange)) {
            const p = this.pages.get(exchange);
            try {
                await p.evaluate(() => true);
                return p;
            }
            catch {
                this.pages.delete(exchange);
            }
        }
        if (!this.browser)
            throw new Error('Browser not initialized');
        const page = await this.browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });
        this.pages.set(exchange, page);
        await this.loadCookies(page, exchange);
        return page;
    }
    async saveCookies(page, exchange) {
        try {
            const cookies = await page.cookies();
            fs_1.default.writeFileSync(path_1.default.join(COOKIE_DIR, `${exchange}.json`), JSON.stringify(cookies, null, 2));
            console.log(`[Puppeteer] ${exchange}: cookies saved`);
        }
        catch (e) {
            console.warn(`[Puppeteer] ${exchange}: failed to save cookies:`, e.message);
        }
    }
    async loadCookies(page, exchange) {
        const cookiePath = path_1.default.join(COOKIE_DIR, `${exchange}.json`);
        try {
            if (fs_1.default.existsSync(cookiePath)) {
                const cookies = JSON.parse(fs_1.default.readFileSync(cookiePath, 'utf-8'));
                await page.setCookie(...cookies);
                console.log(`[Puppeteer] ${exchange}: cookies restored`);
                return true;
            }
        }
        catch (e) {
            console.warn(`[Puppeteer] ${exchange}: failed to load cookies:`, e.message);
        }
        return false;
    }
    async takeErrorScreenshot(page, label) {
        try {
            await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
            console.log(`[Puppeteer] ${label}: error screenshot saved to ${SCREENSHOT_PATH}`);
        }
        catch { }
    }
    // ====== LOGIN ======
    async login(exchange, email, password, totpSecret) {
        console.log(`[Puppeteer] ${exchange}: logging in...`);
        try {
            if (!email || !password) {
                const creds = (0, database_js_1.getExchangeCredsDecrypted)(exchange);
                if (!creds || !creds.email || !creds.password) {
                    console.error(`[Puppeteer] ${exchange}: no credentials available`);
                    return false;
                }
                email = creds.email;
                password = creds.password;
                totpSecret = totpSecret || creds.totpSecret;
            }
            const page = await this.getPage(exchange);
            if (exchange === 'Bybit') {
                return await this.loginBybit(page, email, password, totpSecret);
            }
            else if (exchange === 'Binance') {
                return await this.loginBinance(page, email, password, totpSecret);
            }
            return false;
        }
        catch (e) {
            console.error(`[Puppeteer] ${exchange}: login error:`, e.message);
            const page = this.pages.get(exchange);
            if (page)
                await this.takeErrorScreenshot(page, `${exchange}-login`);
            return false;
        }
    }
    async loginBybit(page, email, password, totpSecret) {
        console.log('[Puppeteer] Bybit: navigating to login page...');
        await page.goto('https://www.bybit.com/login', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);
        // Check if already logged in
        if (!page.url().includes('/login')) {
            console.log('[Puppeteer] Bybit: already logged in via cookies');
            this.loggedIn.set('Bybit', true);
            this.lastActivity.set('Bybit', Date.now());
            return true;
        }
        // Enter email
        console.log('[Puppeteer] Bybit: entering email...');
        try {
            await page.waitForSelector('input[name="email"], input[type="email"], input[placeholder*="email" i]', { timeout: 10000 });
            const emailInput = await page.$('input[name="email"]') || await page.$('input[type="email"]') || await page.$('input[placeholder*="email" i]');
            if (emailInput) {
                await emailInput.click({ clickCount: 3 });
                await emailInput.type(email, { delay: 50 });
            }
        }
        catch (e) {
            console.error('[Puppeteer] Bybit: email input not found:', e.message);
            await this.takeErrorScreenshot(page, 'bybit-email');
            return false;
        }
        await sleep(1000);
        // Enter password
        console.log('[Puppeteer] Bybit: entering password...');
        try {
            const passInput = await page.$('input[type="password"]');
            if (passInput) {
                await passInput.click({ clickCount: 3 });
                await passInput.type(password, { delay: 50 });
            }
        }
        catch (e) {
            console.error('[Puppeteer] Bybit: password input not found:', e.message);
            await this.takeErrorScreenshot(page, 'bybit-password');
            return false;
        }
        await sleep(1000);
        // Click login button
        console.log('[Puppeteer] Bybit: clicking login button...');
        try {
            const loginBtn = await page.$('button[type="submit"]');
            if (loginBtn)
                await loginBtn.click();
        }
        catch (e) {
            console.error('[Puppeteer] Bybit: login button not found:', e.message);
            await this.takeErrorScreenshot(page, 'bybit-loginbtn');
            return false;
        }
        await sleep(3000);
        // Check for 2FA
        const pageContent = await page.content();
        if (pageContent.includes('2fa') || pageContent.includes('two-factor') || pageContent.includes('authenticator') || pageContent.includes('Google')) {
            console.log('[Puppeteer] Bybit: 2FA page detected');
            if (!totpSecret) {
                console.warn('[Puppeteer] Bybit: 2FA required but no TOTP secret provided');
                await this.takeErrorScreenshot(page, 'bybit-2fa');
                return false;
            }
            try {
                const totp = this.generateTOTP(totpSecret);
                console.log('[Puppeteer] Bybit: entering 2FA code...');
                const otpInputs = await page.$$('input[type="tel"], input[type="number"], input.otp-input');
                if (otpInputs.length >= 6) {
                    for (let i = 0; i < 6; i++)
                        await otpInputs[i].type(totp[i], { delay: 100 });
                }
                else if (otpInputs.length >= 1) {
                    await otpInputs[0].type(totp, { delay: 50 });
                }
                await sleep(3000);
            }
            catch (e) {
                console.error('[Puppeteer] Bybit: 2FA entry failed:', e.message);
                await this.takeErrorScreenshot(page, 'bybit-2fa-entry');
                return false;
            }
        }
        await sleep(2000);
        if (page.url().includes('/login')) {
            console.error('[Puppeteer] Bybit: login failed - still on login page');
            await this.takeErrorScreenshot(page, 'bybit-loginfail');
            return false;
        }
        console.log('[Puppeteer] Bybit: login successful');
        this.loggedIn.set('Bybit', true);
        this.lastActivity.set('Bybit', Date.now());
        await this.saveCookies(page, 'Bybit');
        return true;
    }
    async loginBinance(page, email, password, totpSecret) {
        console.log('[Puppeteer] Binance: navigating to login page...');
        await page.goto('https://accounts.binance.com/en/login', { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(2000);
        if (!page.url().includes('/login')) {
            console.log('[Puppeteer] Binance: already logged in via cookies');
            this.loggedIn.set('Binance', true);
            this.lastActivity.set('Binance', Date.now());
            return true;
        }
        console.log('[Puppeteer] Binance: entering email...');
        try {
            await page.waitForSelector('input[name="email"], input[id="click_login_email"], input[type="email"]', { timeout: 10000 });
            const emailInput = await page.$('input[name="email"]') || await page.$('input[id="click_login_email"]') || await page.$('input[type="email"]');
            if (emailInput) {
                await emailInput.click({ clickCount: 3 });
                await emailInput.type(email, { delay: 50 });
            }
        }
        catch (e) {
            console.error('[Puppeteer] Binance: email input not found:', e.message);
            await this.takeErrorScreenshot(page, 'binance-email');
            return false;
        }
        await sleep(1000);
        console.log('[Puppeteer] Binance: entering password...');
        try {
            const passInput = await page.$('input[type="password"]');
            if (passInput) {
                await passInput.click({ clickCount: 3 });
                await passInput.type(password, { delay: 50 });
            }
        }
        catch (e) {
            console.error('[Puppeteer] Binance: password input not found:', e.message);
            await this.takeErrorScreenshot(page, 'binance-password');
            return false;
        }
        await sleep(1000);
        console.log('[Puppeteer] Binance: clicking login button...');
        try {
            const loginBtn = await page.$('button[type="submit"]') || await page.$('#click_login_submit');
            if (loginBtn)
                await loginBtn.click();
        }
        catch (e) {
            console.error('[Puppeteer] Binance: login button not found:', e.message);
            await this.takeErrorScreenshot(page, 'binance-loginbtn');
            return false;
        }
        await sleep(3000);
        const pageContent = await page.content();
        if (pageContent.includes('2fa') || pageContent.includes('authenticator') || pageContent.includes('security-verification')) {
            console.log('[Puppeteer] Binance: 2FA page detected');
            if (!totpSecret) {
                console.warn('[Puppeteer] Binance: 2FA required but no TOTP secret');
                await this.takeErrorScreenshot(page, 'binance-2fa');
                return false;
            }
            try {
                const totp = this.generateTOTP(totpSecret);
                console.log('[Puppeteer] Binance: entering 2FA code...');
                const otpInput = await page.$('input[placeholder*="code" i]') || await page.$('input.otp-input');
                if (otpInput)
                    await otpInput.type(totp, { delay: 50 });
                const submitBtn = await page.$('button[type="submit"]');
                if (submitBtn)
                    await submitBtn.click();
                await sleep(3000);
            }
            catch (e) {
                console.error('[Puppeteer] Binance: 2FA entry failed:', e.message);
                await this.takeErrorScreenshot(page, 'binance-2fa-entry');
                return false;
            }
        }
        await sleep(2000);
        if (page.url().includes('/login')) {
            console.error('[Puppeteer] Binance: login failed');
            await this.takeErrorScreenshot(page, 'binance-loginfail');
            return false;
        }
        console.log('[Puppeteer] Binance: login successful');
        this.loggedIn.set('Binance', true);
        this.lastActivity.set('Binance', Date.now());
        await this.saveCookies(page, 'Binance');
        return true;
    }
    // ====== CREATE BUY ORDER ======
    async createBuyOrder(exchange, cryptoSymbol, amount, payMethod) {
        console.log(`[Puppeteer] ${exchange}: creating buy order - ${amount} JPY for ${cryptoSymbol} via ${payMethod}`);
        if (!this.running || !this.browser)
            return { success: false, error: 'Browser not initialized' };
        if (!this.loggedIn.get(exchange)) {
            console.log(`[Puppeteer] ${exchange}: not logged in, attempting login...`);
            const ok = await this.login(exchange);
            if (!ok)
                return { success: false, error: `Login to ${exchange} failed` };
        }
        try {
            const page = await this.getPage(exchange);
            if (exchange === 'Bybit')
                return await this.createBybitBuyOrder(page, cryptoSymbol, amount, payMethod);
            if (exchange === 'Binance')
                return await this.createBinanceBuyOrder(page, cryptoSymbol, amount, payMethod);
            return { success: false, error: `Unsupported exchange: ${exchange}` };
        }
        catch (e) {
            console.error(`[Puppeteer] ${exchange}: createBuyOrder error:`, e.message);
            const page = this.pages.get(exchange);
            if (page)
                await this.takeErrorScreenshot(page, `${exchange}-buy-error`);
            return { success: false, error: e.message };
        }
    }
    async createBybitBuyOrder(page, cryptoSymbol, amount, payMethod) {
        console.log('[Puppeteer] Bybit: navigating to P2P page...');
        await page.goto(`https://www.bybit.com/fiat/trade/otc/?actionType=1&token=${cryptoSymbol}&fiat=JPY`, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);
        const payMethodMap = { bank: '銀行振込', paypay: 'PayPay', linepay: 'LINE Pay', aupay: 'au PAY' };
        const payLabel = payMethodMap[payMethod] || payMethod;
        // Payment filter
        try {
            console.log(`[Puppeteer] Bybit: selecting payment filter: ${payLabel}`);
            const filterBtns = await page.$$('[class*="payment"] button, [class*="filter"] span');
            for (const btn of filterBtns) {
                const text = await page.evaluate(el => el.textContent, btn);
                if (text && text.includes(payLabel)) {
                    await btn.click();
                    await sleep(2000);
                    break;
                }
            }
        }
        catch (e) {
            console.warn('[Puppeteer] Bybit: payment filter failed:', e.message);
        }
        // Enter amount
        try {
            console.log(`[Puppeteer] Bybit: entering amount: ${amount}`);
            const amountInput = await page.$('input[placeholder*="金額" i]') || await page.$('input[placeholder*="amount" i]') || await page.$('input[type="number"]');
            if (amountInput) {
                await amountInput.click({ clickCount: 3 });
                await amountInput.type(String(amount), { delay: 50 });
                await sleep(2000);
            }
        }
        catch (e) {
            console.warn('[Puppeteer] Bybit: amount input failed:', e.message);
        }
        // Click buy button
        console.log('[Puppeteer] Bybit: looking for buy button...');
        try {
            const buyButtons = await page.$$('button');
            let clicked = false;
            for (const btn of buyButtons) {
                const text = await page.evaluate(el => el.textContent?.trim(), btn);
                if (text && (text === '購入' || text.toLowerCase() === 'buy' || text.includes('Buy USDT'))) {
                    console.log(`[Puppeteer] Bybit: clicking: "${text}"`);
                    await btn.click();
                    clicked = true;
                    break;
                }
            }
            if (!clicked) {
                await this.takeErrorScreenshot(page, 'bybit-no-buy-btn');
                return { success: false, error: 'No suitable P2P ad found' };
            }
        }
        catch (e) {
            await this.takeErrorScreenshot(page, 'bybit-buy-click');
            return { success: false, error: e.message };
        }
        await sleep(3000);
        // Order dialog amount
        try {
            const orderInput = await page.$('input[placeholder*="入力" i]') || await page.$('input[placeholder*="amount" i]');
            if (orderInput) {
                await orderInput.click({ clickCount: 3 });
                await orderInput.type(String(amount), { delay: 50 });
                await sleep(1000);
            }
        }
        catch (e) {
            console.warn('[Puppeteer] Bybit: order amount input failed:', e.message);
        }
        // Confirm
        console.log('[Puppeteer] Bybit: confirming order...');
        try {
            const confirmBtns = await page.$$('button');
            for (const btn of confirmBtns) {
                const text = await page.evaluate(el => el.textContent?.trim(), btn);
                if (text && (text.includes('確認') || text.includes('Confirm') || text.includes('Place Order'))) {
                    await btn.click();
                    break;
                }
            }
        }
        catch (e) {
            await this.takeErrorScreenshot(page, 'bybit-confirm');
            return { success: false, error: 'Failed to confirm order' };
        }
        await sleep(3000);
        const orderId = await this.extractOrderId(page, 'Bybit');
        this.lastActivity.set('Bybit', Date.now());
        console.log(`[Puppeteer] Bybit: order created${orderId ? ` (ID: ${orderId})` : ''}`);
        return { success: true, orderId: orderId || `bybit-${Date.now()}` };
    }
    async createBinanceBuyOrder(page, cryptoSymbol, amount, payMethod) {
        console.log('[Puppeteer] Binance: navigating to P2P page...');
        await page.goto(`https://p2p.binance.com/trade/buy/${cryptoSymbol}?fiat=JPY&payment=all-payments`, { waitUntil: 'networkidle2', timeout: 30000 });
        await sleep(3000);
        try {
            const amountInput = await page.$('input[placeholder*="Amount" i]') || await page.$('input[placeholder*="金額" i]');
            if (amountInput) {
                await amountInput.click({ clickCount: 3 });
                await amountInput.type(String(amount), { delay: 50 });
                await sleep(2000);
            }
        }
        catch (e) {
            console.warn('[Puppeteer] Binance: amount input failed:', e.message);
        }
        console.log('[Puppeteer] Binance: looking for buy button...');
        try {
            const buyButtons = await page.$$('button');
            let clicked = false;
            for (const btn of buyButtons) {
                const text = await page.evaluate(el => el.textContent?.trim(), btn);
                if (text && (text.includes('Buy') || text === '購入')) {
                    await btn.click();
                    clicked = true;
                    break;
                }
            }
            if (!clicked) {
                await this.takeErrorScreenshot(page, 'binance-no-buy-btn');
                return { success: false, error: 'No suitable P2P ad found on Binance' };
            }
        }
        catch (e) {
            await this.takeErrorScreenshot(page, 'binance-buy-click');
            return { success: false, error: e.message };
        }
        await sleep(3000);
        try {
            const orderInput = await page.$('input[placeholder*="amount" i]') || await page.$('input[type="number"]');
            if (orderInput) {
                await orderInput.click({ clickCount: 3 });
                await orderInput.type(String(amount), { delay: 50 });
                await sleep(1000);
            }
            const confirmBtns = await page.$$('button');
            for (const btn of confirmBtns) {
                const text = await page.evaluate(el => el.textContent?.trim(), btn);
                if (text && (text.includes('Confirm') || text.includes('Buy') || text.includes('確認'))) {
                    await btn.click();
                    break;
                }
            }
        }
        catch (e) {
            await this.takeErrorScreenshot(page, 'binance-confirm');
            return { success: false, error: 'Failed to confirm order on Binance' };
        }
        await sleep(3000);
        const orderId = await this.extractOrderId(page, 'Binance');
        this.lastActivity.set('Binance', Date.now());
        console.log(`[Puppeteer] Binance: order created${orderId ? ` (ID: ${orderId})` : ''}`);
        return { success: true, orderId: orderId || `binance-${Date.now()}` };
    }
    // ====== CONFIRM PAYMENT ======
    async confirmPayment(exchange, orderId) {
        console.log(`[Puppeteer] ${exchange}: confirming payment for order ${orderId}...`);
        try {
            const page = await this.getPage(exchange);
            if (exchange === 'Bybit') {
                await page.goto(`https://www.bybit.com/fiat/trade/otc/order-detail?orderId=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
            }
            else if (exchange === 'Binance') {
                await page.goto(`https://p2p.binance.com/myOrder?orderNo=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
            }
            await sleep(3000);
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent?.trim(), btn);
                if (text && (text.includes('支払い済み') || text.includes('Paid') || text.includes('I have paid') || text.includes('Transfer'))) {
                    console.log(`[Puppeteer] ${exchange}: clicking: "${text}"`);
                    await btn.click();
                    await sleep(2000);
                    break;
                }
            }
            // Confirm dialog
            const confirmBtns = await page.$$('button');
            for (const btn of confirmBtns) {
                const text = await page.evaluate(el => el.textContent?.trim(), btn);
                if (text && (text.includes('確認') || text.includes('Confirm') || text.includes('Yes'))) {
                    await btn.click();
                    await sleep(2000);
                    break;
                }
            }
            this.lastActivity.set(exchange, Date.now());
            console.log(`[Puppeteer] ${exchange}: payment confirmed for ${orderId}`);
            return true;
        }
        catch (e) {
            console.error(`[Puppeteer] ${exchange}: confirmPayment error:`, e.message);
            const page = this.pages.get(exchange);
            if (page)
                await this.takeErrorScreenshot(page, `${exchange}-confirm-pay`);
            return false;
        }
    }
    // ====== CHECK ORDER STATUS ======
    async checkOrderStatus(exchange, orderId) {
        console.log(`[Puppeteer] ${exchange}: checking status for ${orderId}...`);
        try {
            const page = await this.getPage(exchange);
            if (exchange === 'Bybit') {
                await page.goto(`https://www.bybit.com/fiat/trade/otc/order-detail?orderId=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
            }
            else if (exchange === 'Binance') {
                await page.goto(`https://p2p.binance.com/myOrder?orderNo=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
            }
            await sleep(3000);
            const content = await page.content();
            if (content.includes('完了') || content.includes('Completed') || content.includes('Released'))
                return 'completed';
            if (content.includes('キャンセル') || content.includes('Cancelled') || content.includes('Canceled'))
                return 'cancelled';
            if (content.includes('支払い済み') || content.includes('Paid'))
                return 'paid';
            if (content.includes('支払い待ち') || content.includes('Pending') || content.includes('Waiting'))
                return 'pending';
            this.lastActivity.set(exchange, Date.now());
            return 'unknown';
        }
        catch (e) {
            console.error(`[Puppeteer] ${exchange}: checkOrderStatus error:`, e.message);
            return 'error';
        }
    }
    // ====== RELEASE CRYPTO ======
    async releaseCrypto(exchange, orderId) {
        console.log(`[Puppeteer] ${exchange}: releasing crypto for ${orderId}...`);
        try {
            const page = await this.getPage(exchange);
            if (exchange === 'Bybit') {
                await page.goto(`https://www.bybit.com/fiat/trade/otc/order-detail?orderId=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
            }
            else if (exchange === 'Binance') {
                await page.goto(`https://p2p.binance.com/myOrder?orderNo=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
            }
            await sleep(3000);
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent?.trim(), btn);
                if (text && (text.includes('リリース') || text.includes('Release') || text.includes('Confirm Release'))) {
                    console.log(`[Puppeteer] ${exchange}: clicking: "${text}"`);
                    await btn.click();
                    await sleep(2000);
                    break;
                }
            }
            const confirmBtns = await page.$$('button');
            for (const btn of confirmBtns) {
                const text = await page.evaluate(el => el.textContent?.trim(), btn);
                if (text && (text.includes('確認') || text.includes('Confirm') || text.includes('Yes'))) {
                    await btn.click();
                    await sleep(2000);
                    break;
                }
            }
            this.lastActivity.set(exchange, Date.now());
            console.log(`[Puppeteer] ${exchange}: crypto released for ${orderId}`);
            return true;
        }
        catch (e) {
            console.error(`[Puppeteer] ${exchange}: releaseCrypto error:`, e.message);
            const page = this.pages.get(exchange);
            if (page)
                await this.takeErrorScreenshot(page, `${exchange}-release`);
            return false;
        }
    }
    // ====== HELPERS ======
    async extractOrderId(page, exchange) {
        try {
            const url = page.url();
            const urlObj = new URL(url);
            const id = urlObj.searchParams.get('orderId') || urlObj.searchParams.get('orderNo') || urlObj.searchParams.get('id');
            if (id)
                return id;
            const content = await page.content();
            const match = content.match(/order[_\-]?(?:id|no|number)['":\s]+['"]?([A-Za-z0-9\-]+)/i);
            if (match)
                return match[1];
        }
        catch { }
        return null;
    }
    generateTOTP(secret) {
        try {
            const base32Decode = (s) => {
                const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
                let bits = '';
                for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
                    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
                }
                const bytes = [];
                for (let i = 0; i + 8 <= bits.length; i += 8)
                    bytes.push(parseInt(bits.substring(i, i + 8), 2));
                return Buffer.from(bytes);
            };
            const key = base32Decode(secret);
            const time = Math.floor(Date.now() / 30000);
            const timeBuffer = Buffer.alloc(8);
            timeBuffer.writeBigInt64BE(BigInt(time));
            const hmac = crypto_1.default.createHmac('sha1', key);
            hmac.update(timeBuffer);
            const hash = hmac.digest();
            const offset = hash[hash.length - 1] & 0x0f;
            const code = ((hash[offset] & 0x7f) << 24 | hash[offset + 1] << 16 | hash[offset + 2] << 8 | hash[offset + 3]) % 1000000;
            return code.toString().padStart(6, '0');
        }
        catch (e) {
            console.error('[Puppeteer] TOTP generation failed:', e.message);
            return '000000';
        }
    }
    // ====== STATUS & LIFECYCLE ======
    getStatus() {
        const exchanges = ['Bybit', 'Binance'];
        const loginStatus = {};
        for (const ex of exchanges) {
            loginStatus[ex] = { loggedIn: this.loggedIn.get(ex) || false, lastActivity: this.lastActivity.get(ex) || null };
        }
        return {
            browserReady: this.running,
            configuredExchanges: Array.from(this.loggedIn.entries()).filter(([, v]) => v).map(([k]) => k),
            supported: exchanges,
            loginStatus,
        };
    }
    getScreenshotPath() {
        try {
            if (fs_1.default.existsSync(SCREENSHOT_PATH))
                return SCREENSHOT_PATH;
        }
        catch { }
        return null;
    }
    async close() {
        console.log('[Puppeteer] Shutting down...');
        for (const [, page] of this.pages) {
            try {
                await page.close();
            }
            catch { }
        }
        this.pages.clear();
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        this.running = false;
        this.loggedIn.clear();
        console.log('[Puppeteer] Browser closed');
    }
}
exports.trader = new P2PTrader();
exports.default = exports.trader;
