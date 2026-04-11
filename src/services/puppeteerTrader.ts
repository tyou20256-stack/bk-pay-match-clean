/**
 * @file puppeteerTrader.ts — Puppeteer自動P2P取引
 * @description ヘッドレスブラウザでBybit/BinanceにログインしP2P注文を自動作成。
 *   セッションCookie保存による再ログイン回避、エラー時スクリーンショット、
 *   人間的な遅延挿入を含む。
 */
import puppeteer, { Browser, Page } from 'puppeteer';
import { getExchangeCredsDecrypted } from './database.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import logger from './logger.js';

const COOKIE_DIR = path.resolve(process.cwd(), 'data/cookies');
const SCREENSHOT_PATH = '/tmp/puppeteer-error.png';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

interface TradeResult {
  success: boolean;
  orderId?: string;
  paymentInfo?: Record<string, string>;
  error?: string;
}

class P2PTrader {
  private browser: Browser | null = null;
  private pages: Map<string, Page> = new Map();
  private loggedIn: Map<string, boolean> = new Map();
  private lastActivity: Map<string, number> = new Map();
  private running = false;

  async init() {
    try {
      fs.mkdirSync(COOKIE_DIR, { recursive: true });
      this.browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      });
      this.running = true;
      logger.info('Browser launched');
    } catch (e: unknown) {
      logger.error('Failed to launch browser', { error: (e instanceof Error ? e.message : String(e)) });
    }
  }

  private async getPage(exchange: string): Promise<Page> {
    if (this.pages.has(exchange)) {
      const p = this.pages.get(exchange)!;
      try { await p.evaluate(() => true); return p; } catch { this.pages.delete(exchange); }
    }
    if (!this.browser) throw new Error('Browser not initialized');
    const page = await this.browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    this.pages.set(exchange, page);
    await this.loadCookies(page, exchange);
    return page;
  }

  private async saveCookies(page: Page, exchange: string): Promise<void> {
    try {
      const cookies = await page.cookies();
      const data = JSON.stringify(cookies);
      // Encrypt cookie data before saving to disk
      // (uses the top-level `crypto` import, no shadowing)
      const key = process.env.BK_ENC_KEY;
      if (!key || key === 'bkpay-default-key-change-me-32ch') {
        throw new Error('BK_ENC_KEY must be set to a secure value (no fallback)');
      }
      const derivedKey = crypto.pbkdf2Sync(key, 'bkpay-cookie-salt', 100000, 32, 'sha256');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
      let enc = cipher.update(data, 'utf8', 'hex');
      enc += cipher.final('hex');
      const authTag = cipher.getAuthTag().toString('hex');
      const encrypted = iv.toString('hex') + ':' + authTag + ':' + enc;
      fs.writeFileSync(path.join(COOKIE_DIR, `${exchange}.enc`), encrypted);
      // Remove old unencrypted file if exists
      const oldPath = path.join(COOKIE_DIR, `${exchange}.json`);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      logger.info('cookies saved (encrypted)', { exchange });
    } catch (e: unknown) {
      logger.warn('failed to save cookies', { exchange, error: (e instanceof Error ? e.message : String(e)) });
    }
  }

  private async loadCookies(page: Page, exchange: string): Promise<boolean> {
    const encPath = path.join(COOKIE_DIR, `${exchange}.enc`);
    const legacyPath = path.join(COOKIE_DIR, `${exchange}.json`);
    try {
      let cookieData: string | null = null;
      if (fs.existsSync(encPath)) {
        const encrypted = fs.readFileSync(encPath, 'utf-8');
        // (uses the top-level `crypto` import, no shadowing)
        const key = process.env.BK_ENC_KEY;
      if (!key || key === 'bkpay-default-key-change-me-32ch') {
        throw new Error('BK_ENC_KEY must be set to a secure value (no fallback)');
      }
        const derivedKey = crypto.pbkdf2Sync(key, 'bkpay-cookie-salt', 100000, 32, 'sha256');
        const parts = encrypted.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encHex = parts[2];
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
        decipher.setAuthTag(authTag);
        let dec = decipher.update(encHex, 'hex', 'utf8');
        dec += decipher.final('utf8');
        cookieData = dec;
      } else if (fs.existsSync(legacyPath)) {
        // Migrate: read unencrypted, will be re-encrypted on next save
        cookieData = fs.readFileSync(legacyPath, 'utf-8');
        logger.info('migrating unencrypted cookies', { exchange });
      }
      if (cookieData) {
        const cookies = JSON.parse(cookieData);
        await page.setCookie(...cookies);
        logger.info('cookies restored', { exchange });
        return true;
      }
    } catch (e: unknown) {
      logger.warn('failed to load cookies', { exchange, error: (e instanceof Error ? e.message : String(e)) });
    }
    return false;
  }

  private async takeErrorScreenshot(page: Page, label: string): Promise<void> {
    try {
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
      logger.info('error screenshot saved', { label, path: SCREENSHOT_PATH });
    } catch {}
  }

  // ====== LOGIN ======

  async login(exchange: 'Bybit' | 'Binance', email?: string, password?: string, totpSecret?: string): Promise<boolean> {
    logger.info('logging in', { exchange });
    try {
      if (!email || !password) {
        const creds = getExchangeCredsDecrypted(exchange);
        if (!creds || !creds.email || !creds.password) {
          logger.error('no credentials available', { exchange });
          return false;
        }
        email = creds.email;
        password = creds.password;
        totpSecret = totpSecret || creds.totpSecret;
      }

      const page = await this.getPage(exchange);

      if (exchange === 'Bybit') {
        return await this.loginBybit(page, email!, password!, totpSecret);
      } else if (exchange === 'Binance') {
        return await this.loginBinance(page, email!, password!, totpSecret);
      }
      return false;
    } catch (e: unknown) {
      logger.error('login error', { exchange, error: (e instanceof Error ? e.message : String(e)) });
      const page = this.pages.get(exchange);
      if (page) await this.takeErrorScreenshot(page, `${exchange}-login`);
      return false;
    }
  }

  private async loginBybit(page: Page, email: string, password: string, totpSecret?: string): Promise<boolean> {
    logger.info('Bybit: navigating to login page');
    await page.goto('https://www.bybit.com/login', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Check if already logged in
    if (!page.url().includes('/login')) {
      logger.info('Bybit: already logged in via cookies');
      this.loggedIn.set('Bybit', true);
      this.lastActivity.set('Bybit', Date.now());
      return true;
    }

    // Enter email
    logger.info('Bybit: entering email');
    try {
      await page.waitForSelector('input[name="email"], input[type="email"], input[placeholder*="email" i]', { timeout: 10000 });
      const emailInput = await page.$('input[name="email"]') || await page.$('input[type="email"]') || await page.$('input[placeholder*="email" i]');
      if (emailInput) { await emailInput.click({ clickCount: 3 }); await emailInput.type(email, { delay: 50 }); }
    } catch (e: unknown) {
      logger.error('Bybit: email input not found', { error: (e instanceof Error ? e.message : String(e)) });
      await this.takeErrorScreenshot(page, 'bybit-email');
      return false;
    }
    await sleep(1000);

    // Enter password
    logger.info('Bybit: entering password');
    try {
      const passInput = await page.$('input[type="password"]');
      if (passInput) { await passInput.click({ clickCount: 3 }); await passInput.type(password, { delay: 50 }); }
    } catch (e: unknown) {
      logger.error('Bybit: password input not found', { error: (e instanceof Error ? e.message : String(e)) });
      await this.takeErrorScreenshot(page, 'bybit-password');
      return false;
    }
    await sleep(1000);

    // Click login button
    logger.info('Bybit: clicking login button');
    try {
      const loginBtn = await page.$('button[type="submit"]');
      if (loginBtn) await loginBtn.click();
    } catch (e: unknown) {
      logger.error('Bybit: login button not found', { error: (e instanceof Error ? e.message : String(e)) });
      await this.takeErrorScreenshot(page, 'bybit-loginbtn');
      return false;
    }
    await sleep(3000);

    // Check for 2FA
    const pageContent = await page.content();
    if (pageContent.includes('2fa') || pageContent.includes('two-factor') || pageContent.includes('authenticator') || pageContent.includes('Google')) {
      logger.info('Bybit: 2FA page detected');
      if (!totpSecret) {
        logger.warn('Bybit: 2FA required but no TOTP secret provided');
        await this.takeErrorScreenshot(page, 'bybit-2fa');
        return false;
      }
      try {
        const totp = this.generateTOTP(totpSecret);
        logger.info('Bybit: entering 2FA code');
        const otpInputs = await page.$$('input[type="tel"], input[type="number"], input.otp-input');
        if (otpInputs.length >= 6) {
          for (let i = 0; i < 6; i++) await otpInputs[i].type(totp[i], { delay: 100 });
        } else if (otpInputs.length >= 1) {
          await otpInputs[0].type(totp, { delay: 50 });
        }
        await sleep(3000);
      } catch (e: unknown) {
        logger.error('Bybit: 2FA entry failed', { error: (e instanceof Error ? e.message : String(e)) });
        await this.takeErrorScreenshot(page, 'bybit-2fa-entry');
        return false;
      }
    }

    await sleep(2000);
    if (page.url().includes('/login')) {
      logger.error('Bybit: login failed - still on login page');
      await this.takeErrorScreenshot(page, 'bybit-loginfail');
      return false;
    }

    logger.info('Bybit: login successful');
    this.loggedIn.set('Bybit', true);
    this.lastActivity.set('Bybit', Date.now());
    await this.saveCookies(page, 'Bybit');
    return true;
  }

  private async loginBinance(page: Page, email: string, password: string, totpSecret?: string): Promise<boolean> {
    logger.info('Binance: navigating to login page');
    await page.goto('https://accounts.binance.com/en/login', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    if (!page.url().includes('/login')) {
      logger.info('Binance: already logged in via cookies');
      this.loggedIn.set('Binance', true);
      this.lastActivity.set('Binance', Date.now());
      return true;
    }

    logger.info('Binance: entering email');
    try {
      await page.waitForSelector('input[name="email"], input[id="click_login_email"], input[type="email"]', { timeout: 10000 });
      const emailInput = await page.$('input[name="email"]') || await page.$('input[id="click_login_email"]') || await page.$('input[type="email"]');
      if (emailInput) { await emailInput.click({ clickCount: 3 }); await emailInput.type(email, { delay: 50 }); }
    } catch (e: unknown) {
      logger.error('Binance: email input not found', { error: (e instanceof Error ? e.message : String(e)) });
      await this.takeErrorScreenshot(page, 'binance-email');
      return false;
    }
    await sleep(1000);

    logger.info('Binance: entering password');
    try {
      const passInput = await page.$('input[type="password"]');
      if (passInput) { await passInput.click({ clickCount: 3 }); await passInput.type(password, { delay: 50 }); }
    } catch (e: unknown) {
      logger.error('Binance: password input not found', { error: (e instanceof Error ? e.message : String(e)) });
      await this.takeErrorScreenshot(page, 'binance-password');
      return false;
    }
    await sleep(1000);

    logger.info('Binance: clicking login button');
    try {
      const loginBtn = await page.$('button[type="submit"]') || await page.$('#click_login_submit');
      if (loginBtn) await loginBtn.click();
    } catch (e: unknown) {
      logger.error('Binance: login button not found', { error: (e instanceof Error ? e.message : String(e)) });
      await this.takeErrorScreenshot(page, 'binance-loginbtn');
      return false;
    }
    await sleep(3000);

    const pageContent = await page.content();
    if (pageContent.includes('2fa') || pageContent.includes('authenticator') || pageContent.includes('security-verification')) {
      logger.info('Binance: 2FA page detected');
      if (!totpSecret) {
        logger.warn('Binance: 2FA required but no TOTP secret');
        await this.takeErrorScreenshot(page, 'binance-2fa');
        return false;
      }
      try {
        const totp = this.generateTOTP(totpSecret);
        logger.info('Binance: entering 2FA code');
        const otpInput = await page.$('input[placeholder*="code" i]') || await page.$('input.otp-input');
        if (otpInput) await otpInput.type(totp, { delay: 50 });
        const submitBtn = await page.$('button[type="submit"]');
        if (submitBtn) await submitBtn.click();
        await sleep(3000);
      } catch (e: unknown) {
        logger.error('Binance: 2FA entry failed', { error: (e instanceof Error ? e.message : String(e)) });
        await this.takeErrorScreenshot(page, 'binance-2fa-entry');
        return false;
      }
    }

    await sleep(2000);
    if (page.url().includes('/login')) {
      logger.error('Binance: login failed');
      await this.takeErrorScreenshot(page, 'binance-loginfail');
      return false;
    }

    logger.info('Binance: login successful');
    this.loggedIn.set('Binance', true);
    this.lastActivity.set('Binance', Date.now());
    await this.saveCookies(page, 'Binance');
    return true;
  }

  // ====== CREATE BUY ORDER ======

  async createBuyOrder(exchange: string, cryptoSymbol: string, amount: number, payMethod: string): Promise<TradeResult> {
    logger.info('creating buy order', { exchange, amount, cryptoSymbol, payMethod });
    if (!this.running || !this.browser) return { success: false, error: 'Browser not initialized' };
    if (!this.loggedIn.get(exchange)) {
      logger.info('not logged in, attempting login', { exchange });
      const ok = await this.login(exchange as 'Bybit' | 'Binance');
      if (!ok) return { success: false, error: `Login to ${exchange} failed` };
    }

    try {
      const page = await this.getPage(exchange);
      if (exchange === 'Bybit') return await this.createBybitBuyOrder(page, cryptoSymbol, amount, payMethod);
      if (exchange === 'Binance') return await this.createBinanceBuyOrder(page, cryptoSymbol, amount, payMethod);
      return { success: false, error: `Unsupported exchange: ${exchange}` };
    } catch (e: unknown) {
      logger.error('createBuyOrder error', { exchange, error: (e instanceof Error ? e.message : String(e)) });
      const page = this.pages.get(exchange);
      if (page) await this.takeErrorScreenshot(page, `${exchange}-buy-error`);
      return { success: false, error: (e instanceof Error ? e.message : String(e)) };
    }
  }

  private async createBybitBuyOrder(page: Page, cryptoSymbol: string, amount: number, payMethod: string): Promise<TradeResult> {
    logger.info('Bybit: navigating to P2P page');
    await page.goto(`https://www.bybit.com/fiat/trade/otc/?actionType=1&token=${cryptoSymbol}&fiat=JPY`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const payMethodMap: Record<string, string> = { bank: '銀行振込', paypay: 'PayPay', linepay: 'LINE Pay', aupay: 'au PAY' };
    const payLabel = payMethodMap[payMethod] || payMethod;

    // Payment filter
    try {
      logger.info('Bybit: selecting payment filter', { payLabel });
      const filterBtns = await page.$$('[class*="payment"] button, [class*="filter"] span');
      for (const btn of filterBtns) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && text.includes(payLabel)) { await btn.click(); await sleep(2000); break; }
      }
    } catch (e: unknown) { logger.warn('Bybit: payment filter failed', { error: (e instanceof Error ? e.message : String(e)) }); }

    // Enter amount
    try {
      logger.info('Bybit: entering amount', { amount });
      const amountInput = await page.$('input[placeholder*="金額" i]') || await page.$('input[placeholder*="amount" i]') || await page.$('input[type="number"]');
      if (amountInput) { await amountInput.click({ clickCount: 3 }); await amountInput.type(String(amount), { delay: 50 }); await sleep(2000); }
    } catch (e: unknown) { logger.warn('Bybit: amount input failed', { error: (e instanceof Error ? e.message : String(e)) }); }

    // Click buy button
    logger.info('Bybit: looking for buy button');
    try {
      const buyButtons = await page.$$('button');
      let clicked = false;
      for (const btn of buyButtons) {
        const text = await page.evaluate(el => el.textContent?.trim(), btn);
        if (text && (text === '購入' || text.toLowerCase() === 'buy' || text.includes('Buy USDT'))) {
          logger.info('Bybit: clicking button', { text });
          await btn.click(); clicked = true; break;
        }
      }
      if (!clicked) {
        await this.takeErrorScreenshot(page, 'bybit-no-buy-btn');
        return { success: false, error: 'No suitable P2P ad found' };
      }
    } catch (e: unknown) {
      await this.takeErrorScreenshot(page, 'bybit-buy-click');
      return { success: false, error: (e instanceof Error ? e.message : String(e)) };
    }
    await sleep(3000);

    // Order dialog amount
    try {
      const orderInput = await page.$('input[placeholder*="入力" i]') || await page.$('input[placeholder*="amount" i]');
      if (orderInput) { await orderInput.click({ clickCount: 3 }); await orderInput.type(String(amount), { delay: 50 }); await sleep(1000); }
    } catch (e: unknown) { logger.warn('Bybit: order amount input failed', { error: (e instanceof Error ? e.message : String(e)) }); }

    // Confirm
    logger.info('Bybit: confirming order');
    try {
      const confirmBtns = await page.$$('button');
      for (const btn of confirmBtns) {
        const text = await page.evaluate(el => el.textContent?.trim(), btn);
        if (text && (text.includes('確認') || text.includes('Confirm') || text.includes('Place Order'))) { await btn.click(); break; }
      }
    } catch (e: unknown) {
      await this.takeErrorScreenshot(page, 'bybit-confirm');
      return { success: false, error: 'Failed to confirm order' };
    }
    await sleep(3000);

    const orderId = await this.extractOrderId(page, 'Bybit');
    const paymentInfo = await this.extractPaymentInfo(page, 'Bybit');
    this.lastActivity.set('Bybit', Date.now());
    logger.info('Bybit: order created', { orderId: orderId || undefined });
    return { success: true, orderId: orderId || `bybit-${Date.now()}`, paymentInfo: paymentInfo || undefined };
  }

  private async createBinanceBuyOrder(page: Page, cryptoSymbol: string, amount: number, _payMethod: string): Promise<TradeResult> {
    logger.info('Binance: navigating to P2P page');
    await page.goto(`https://p2p.binance.com/trade/buy/${cryptoSymbol}?fiat=JPY&payment=all-payments`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    try {
      const amountInput = await page.$('input[placeholder*="Amount" i]') || await page.$('input[placeholder*="金額" i]');
      if (amountInput) { await amountInput.click({ clickCount: 3 }); await amountInput.type(String(amount), { delay: 50 }); await sleep(2000); }
    } catch (e: unknown) { logger.warn('Binance: amount input failed', { error: (e instanceof Error ? e.message : String(e)) }); }

    logger.info('Binance: looking for buy button');
    try {
      const buyButtons = await page.$$('button');
      let clicked = false;
      for (const btn of buyButtons) {
        const text = await page.evaluate(el => el.textContent?.trim(), btn);
        if (text && (text.includes('Buy') || text === '購入')) { await btn.click(); clicked = true; break; }
      }
      if (!clicked) {
        await this.takeErrorScreenshot(page, 'binance-no-buy-btn');
        return { success: false, error: 'No suitable P2P ad found on Binance' };
      }
    } catch (e: unknown) {
      await this.takeErrorScreenshot(page, 'binance-buy-click');
      return { success: false, error: (e instanceof Error ? e.message : String(e)) };
    }
    await sleep(3000);

    try {
      const orderInput = await page.$('input[placeholder*="amount" i]') || await page.$('input[type="number"]');
      if (orderInput) { await orderInput.click({ clickCount: 3 }); await orderInput.type(String(amount), { delay: 50 }); await sleep(1000); }
      const confirmBtns = await page.$$('button');
      for (const btn of confirmBtns) {
        const text = await page.evaluate(el => el.textContent?.trim(), btn);
        if (text && (text.includes('Confirm') || text.includes('Buy') || text.includes('確認'))) { await btn.click(); break; }
      }
    } catch (e: unknown) {
      await this.takeErrorScreenshot(page, 'binance-confirm');
      return { success: false, error: 'Failed to confirm order on Binance' };
    }
    await sleep(3000);

    const orderId = await this.extractOrderId(page, 'Binance');
    const paymentInfo = await this.extractPaymentInfo(page, 'Binance');
    this.lastActivity.set('Binance', Date.now());
    logger.info('Binance: order created', { orderId: orderId || undefined });
    return { success: true, orderId: orderId || `binance-${Date.now()}`, paymentInfo: paymentInfo || undefined };
  }

  // ====== CONFIRM PAYMENT ======

  async confirmPayment(exchange: string, orderId: string): Promise<boolean> {
    logger.info('confirming payment', { exchange, orderId });
    try {
      const page = await this.getPage(exchange);
      if (exchange === 'Bybit') {
        await page.goto(`https://www.bybit.com/fiat/trade/otc/order-detail?orderId=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
      } else if (exchange === 'Binance') {
        await page.goto(`https://p2p.binance.com/myOrder?orderNo=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
      }
      await sleep(3000);

      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent?.trim(), btn);
        if (text && (text.includes('支払い済み') || text.includes('Paid') || text.includes('I have paid') || text.includes('Transfer'))) {
          logger.info('clicking button', { exchange, text });
          await btn.click(); await sleep(2000); break;
        }
      }

      // Confirm dialog
      const confirmBtns = await page.$$('button');
      for (const btn of confirmBtns) {
        const text = await page.evaluate(el => el.textContent?.trim(), btn);
        if (text && (text.includes('確認') || text.includes('Confirm') || text.includes('Yes'))) { await btn.click(); await sleep(2000); break; }
      }

      this.lastActivity.set(exchange, Date.now());
      logger.info('payment confirmed', { exchange, orderId });
      return true;
    } catch (e: unknown) {
      logger.error('confirmPayment error', { exchange, error: (e instanceof Error ? e.message : String(e)) });
      const page = this.pages.get(exchange);
      if (page) await this.takeErrorScreenshot(page, `${exchange}-confirm-pay`);
      return false;
    }
  }

  // ====== CHECK ORDER STATUS ======

  async checkOrderStatus(exchange: string, orderId: string): Promise<string> {
    logger.info('checking order status', { exchange, orderId });
    try {
      const page = await this.getPage(exchange);
      if (exchange === 'Bybit') {
        await page.goto(`https://www.bybit.com/fiat/trade/otc/order-detail?orderId=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
      } else if (exchange === 'Binance') {
        await page.goto(`https://p2p.binance.com/myOrder?orderNo=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
      }
      await sleep(3000);

      const content = await page.content();
      if (content.includes('完了') || content.includes('Completed') || content.includes('Released')) return 'completed';
      if (content.includes('キャンセル') || content.includes('Cancelled') || content.includes('Canceled')) return 'cancelled';
      if (content.includes('支払い済み') || content.includes('Paid')) return 'paid';
      if (content.includes('支払い待ち') || content.includes('Pending') || content.includes('Waiting')) return 'pending';

      this.lastActivity.set(exchange, Date.now());
      return 'unknown';
    } catch (e: unknown) {
      logger.error('checkOrderStatus error', { exchange, error: (e instanceof Error ? e.message : String(e)) });
      return 'error';
    }
  }

  // ====== RELEASE CRYPTO ======

  async releaseCrypto(exchange: string, orderId: string): Promise<boolean> {
    logger.info('releasing crypto', { exchange, orderId });
    try {
      const page = await this.getPage(exchange);
      if (exchange === 'Bybit') {
        await page.goto(`https://www.bybit.com/fiat/trade/otc/order-detail?orderId=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
      } else if (exchange === 'Binance') {
        await page.goto(`https://p2p.binance.com/myOrder?orderNo=${orderId}`, { waitUntil: 'networkidle2', timeout: 30000 });
      }
      await sleep(3000);

      const buttons = await page.$$('button');
      for (const btn of buttons) {
        const text = await page.evaluate(el => el.textContent?.trim(), btn);
        if (text && (text.includes('リリース') || text.includes('Release') || text.includes('Confirm Release'))) {
          logger.info('clicking release button', { exchange, text });
          await btn.click(); await sleep(2000); break;
        }
      }

      const confirmBtns = await page.$$('button');
      for (const btn of confirmBtns) {
        const text = await page.evaluate(el => el.textContent?.trim(), btn);
        if (text && (text.includes('確認') || text.includes('Confirm') || text.includes('Yes'))) { await btn.click(); await sleep(2000); break; }
      }

      this.lastActivity.set(exchange, Date.now());
      logger.info('crypto released', { exchange, orderId });
      return true;
    } catch (e: unknown) {
      logger.error('releaseCrypto error', { exchange, error: (e instanceof Error ? e.message : String(e)) });
      const page = this.pages.get(exchange);
      if (page) await this.takeErrorScreenshot(page, `${exchange}-release`);
      return false;
    }
  }

  // ====== PAYMENT INFO EXTRACTION ======

  private async extractPaymentInfo(page: Page, exchange: string): Promise<Record<string, string> | null> {
    try {
      await sleep(3000);
      const content = await page.content();

      // Try to extract bank transfer info from the order detail page
      const info: Record<string, string> = { type: 'bank' };

      // Common patterns across exchanges: look for bank name, account number, holder name
      const bankPatterns = [
        /銀行[名：:\s]*([^\n<]+)/,
        /Bank[：:\s]*([^\n<]+)/i,
        /bank[_\s]?name['"：:\s]*['"]?([^\n<'"]+)/i,
      ];
      const accountPatterns = [
        /口座番号[：:\s]*([0-9\-]+)/,
        /Account\s*(?:No|Number)[.：:\s]*([0-9\-]+)/i,
        /account[_\s]?number['"：:\s]*['"]?([0-9\-]+)/i,
      ];
      const holderPatterns = [
        /口座名義[：:\s]*([^\n<]+)/,
        /名義[：:\s]*([^\n<]+)/,
        /Account\s*(?:Holder|Name)[：:\s]*([^\n<]+)/i,
        /account[_\s]?holder['"：:\s]*['"]?([^\n<'"]+)/i,
      ];
      const branchPatterns = [
        /支店[名：:\s]*([^\n<]+)/,
        /Branch[：:\s]*([^\n<]+)/i,
      ];

      for (const p of bankPatterns) { const m = content.match(p); if (m) { info.bankName = m[1].trim(); break; } }
      for (const p of accountPatterns) { const m = content.match(p); if (m) { info.accountNumber = m[1].trim(); break; } }
      for (const p of holderPatterns) { const m = content.match(p); if (m) { info.accountHolder = m[1].trim(); break; } }
      for (const p of branchPatterns) { const m = content.match(p); if (m) { info.branchName = m[1].trim(); break; } }

      // Also try to extract from structured elements
      const textContent = await page.evaluate(`
        (() => {
          const els = document.querySelectorAll('[class*="payment"], [class*="bank"], [class*="account"], [class*="order-detail"]');
          return Array.from(els).map(el => el.textContent || '').join('\\n');
        })()
      `) as string;

      if (textContent && !info.bankName) {
        for (const p of bankPatterns) { const m = textContent.match(p); if (m) { info.bankName = m[1].trim(); break; } }
        for (const p of accountPatterns) { const m = textContent.match(p); if (m) { info.accountNumber = m[1].trim(); break; } }
        for (const p of holderPatterns) { const m = textContent.match(p); if (m) { info.accountHolder = m[1].trim(); break; } }
      }

      if (info.bankName || info.accountNumber || info.accountHolder) {
        logger.info('extracted payment info', { exchange, info });
        return info;
      }

      logger.info('could not extract payment info from page', { exchange });
      return null;
    } catch (e: unknown) {
      logger.warn('extractPaymentInfo error', { exchange, error: (e instanceof Error ? e.message : String(e)) });
      return null;
    }
  }

  // ====== HELPERS ======

  private async extractOrderId(page: Page, _exchange: string): Promise<string | null> {
    try {
      const url = page.url();
      const urlObj = new URL(url);
      const id = urlObj.searchParams.get('orderId') || urlObj.searchParams.get('orderNo') || urlObj.searchParams.get('id');
      if (id) return id;
      const content = await page.content();
      const match = content.match(/order[_\-]?(?:id|no|number)['":\s]+['"]?([A-Za-z0-9\-]+)/i);
      if (match) return match[1];
    } catch {}
    return null;
  }

  private generateTOTP(secret: string): string {
    try {
      const base32Decode = (s: string): Buffer => {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = '';
        for (const c of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
          bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
        }
        const bytes = [];
        for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substring(i, i + 8), 2));
        return Buffer.from(bytes);
      };
      const key = base32Decode(secret);
      const time = Math.floor(Date.now() / 30000);
      const timeBuffer = Buffer.alloc(8);
      timeBuffer.writeBigInt64BE(BigInt(time));
      const hmac = crypto.createHmac('sha1', key);
      hmac.update(timeBuffer);
      const hash = hmac.digest();
      const offset = hash[hash.length - 1] & 0x0f;
      const code = ((hash[offset] & 0x7f) << 24 | hash[offset + 1] << 16 | hash[offset + 2] << 8 | hash[offset + 3]) % 1000000;
      return code.toString().padStart(6, '0');
    } catch (e: unknown) {
      logger.error('TOTP generation failed', { error: (e instanceof Error ? e.message : String(e)) });
      return '000000';
    }
  }

  // ====== STATUS & LIFECYCLE ======

  getStatus() {
    const exchanges = ['Bybit', 'Binance'];
    const loginStatus: Record<string, { loggedIn: boolean; lastActivity: number | null }> = {};
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

  getScreenshotPath(): string | null {
    try { if (fs.existsSync(SCREENSHOT_PATH)) return SCREENSHOT_PATH; } catch {}
    return null;
  }

  setCredentials(creds: { exchange: string; email?: string; password?: string; apiKey?: string; apiSecret?: string; totpSecret?: string }) {
    // Lazy require to avoid circular dependency with database.ts
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { saveExchangeCreds } = require('./database.js');
    saveExchangeCreds(creds.exchange, creds);
    logger.info('Credentials saved', { exchange: creds.exchange });
  }

  async close() {
    logger.info('Shutting down');
    for (const [, page] of this.pages) { try { await page.close(); } catch {} }
    this.pages.clear();
    if (this.browser) { await this.browser.close(); this.browser = null; }
    this.running = false;
    this.loggedIn.clear();
    logger.info('Browser closed');
  }
}

export const trader = new P2PTrader();
export default trader;
