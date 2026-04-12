/**
 * @file routes/pages.ts — HTMLページ配信ルート
 * @description CSP nonce注入付きHTMLページ配信、sitemap.xml、
 *   管理者/顧客ページのセッションチェックを含む。
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { validateSession, getSessionUserId } from '../services/database';
import { validateCustomerSession } from '../services/customerAccounts';
import { getSeoPageSlugs } from '../services/seoGenerator';

const router = Router();

/**
 * Serve an HTML file with CSP nonce injection.
 * Replaces bare <script> tags with nonce-bearing versions (skips ld+json
 * and already-nonced tags).
 */
function serveHtmlWithNonce(filePath: string) {
  return (_req: Request, res: Response) => {
    const nonce = res.locals.cspNonce || '';
    const fullPath = path.join(__dirname, '..', '..', 'public', filePath);
    let html = fs.readFileSync(fullPath, 'utf-8');
    // Inject nonce into <script> tags (skip type="application/ld+json", skip already-nonced)
    html = html.replace(/<script(?![^>]*nonce=)(?![^>]*type="application\/ld\+json)(\s|>)/g, `<script nonce="${nonce}"$1`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  };
}

// Root page
router.get('/', serveHtmlWithNonce('index.html'));

// Public pages (no auth) — served with nonce injection
router.get('/login.html', serveHtmlWithNonce('login.html'));
router.get('/pay.html', serveHtmlWithNonce('pay.html'));
router.get('/guide.html', serveHtmlWithNonce('guide.html'));
router.get('/customer-login.html', serveHtmlWithNonce('customer-login.html'));
router.get('/buy-usdt.html', serveHtmlWithNonce('buy-usdt.html'));
router.get('/manual.html', serveHtmlWithNonce('manual.html'));
router.get('/seller-register.html', serveHtmlWithNonce('seller-register.html'));
router.get('/seller-confirm.html', serveHtmlWithNonce('seller-confirm.html'));
router.get('/seller-dashboard.html', serveHtmlWithNonce('seller-dashboard.html'));
router.get('/paypay-convert.html', serveHtmlWithNonce('paypay-convert.html'));
router.get('/about.html', serveHtmlWithNonce('about.html'));
router.get('/terms.html', serveHtmlWithNonce('terms.html'));
router.get('/privacy.html', serveHtmlWithNonce('privacy.html'));
router.get('/referral.html', serveHtmlWithNonce('referral.html'));

// Protected admin page
router.get('/admin.html', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.redirect('/login.html');
  serveHtmlWithNonce('admin.html')(req, res);
});

// Analytics page (admin only)
router.get('/analytics.html', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_token;
  if (!token || !validateSession(token, req.ip)) return res.redirect('/login.html');
  serveHtmlWithNonce('analytics.html')(req, res);
});

// Admin-only pages (require admin session)
const adminPages = ['rules.html', 'simulator.html', 'prediction.html'];
adminPages.forEach(page => {
  router.get(`/${page}`, (req: Request, res: Response) => {
    const token = req.cookies?.bkpay_token;
    if (!token || !validateSession(token, req.ip)) return res.redirect('/login.html');
    serveHtmlWithNonce(page)(req, res);
  });
});

// Customer pages (require validated customer session)
router.get('/customer-dashboard.html', (req: Request, res: Response) => {
  const token = req.cookies?.bkpay_customer_token;
  if (!token) return res.redirect('/customer-login.html');
  const session = validateCustomerSession(token);
  if (!session.valid) return res.redirect('/customer-login.html');
  serveHtmlWithNonce('customer-dashboard.html')(req, res);
});

// Dynamic sitemap.xml (includes SEO landing pages)
router.get('/sitemap.xml', (_req: Request, res: Response) => {
  const slugs = getSeoPageSlugs();
  const staticPages = ['', 'buy-usdt.html', 'pay.html', 'guide.html', 'seller-register.html', 'terms.html', 'privacy.html', 'referral.html', 'paypay-convert.html', 'about.html'];
  const now = new Date().toISOString().split('T')[0];

  const langs = ['ja', 'en', 'zh', 'vi'];
  const hreflangBlock = (loc: string) => langs.map(l =>
    `    <xhtml:link rel="alternate" hreflang="${l}" href="${loc}"/>`
  ).join('\n') + `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${loc}"/>`;

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

  for (const p of staticPages) {
    const priority = p === '' ? '1.0' : p.includes('buy-usdt') ? '0.9' : '0.7';
    const loc = `https://bkpay.app/${p}`;
    xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${now}</lastmod>\n    <priority>${priority}</priority>\n${hreflangBlock(loc)}\n  </url>\n`;
  }

  // SEO LP pages
  const lpLoc = 'https://bkpay.app/lp/usdt-buy.html';
  xml += `  <url>\n    <loc>${lpLoc}</loc>\n    <lastmod>${now}</lastmod>\n    <priority>0.9</priority>\n${hreflangBlock(lpLoc)}\n  </url>\n`;
  for (const slug of slugs) {
    const loc = `https://bkpay.app/lp/${slug}.html`;
    xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${now}</lastmod>\n    <priority>0.8</priority>\n    <changefreq>daily</changefreq>\n${hreflangBlock(loc)}\n  </url>\n`;
  }

  // Rate report pages
  const ratesDir = path.join(process.cwd(), 'public', 'rates');
  if (fs.existsSync(ratesDir)) {
    const rateFiles = fs.readdirSync(ratesDir).filter(f => f.endsWith('.html') && f !== 'index.html').sort().reverse().slice(0, 30);
    xml += `  <url><loc>https://bkpay.app/rates/</loc><lastmod>${now}</lastmod><priority>0.7</priority><changefreq>daily</changefreq></url>\n`;
    for (const f of rateFiles) {
      xml += `  <url><loc>https://bkpay.app/rates/${f}</loc><lastmod>${f.replace('.html', '')}</lastmod><priority>0.6</priority></url>\n`;
    }
  }

  xml += '</urlset>';
  res.setHeader('Content-Type', 'application/xml');
  res.send(xml);
});

export default router;
