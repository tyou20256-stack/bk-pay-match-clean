/**
 * @file rateReportGenerator.ts — Daily rate report page generator
 * Generates daily USDT/JPY rate report pages for SEO.
 * Creates /public/rates/YYYY-MM-DD.html with that day's rate snapshot.
 */
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { getCachedRates } from './aggregator.js';
import { ExchangeRates, AggregatedRates } from '../types.js';

export function generateDailyReport(): void {
  try {
    const rates = getCachedRates('USDT') as AggregatedRates;
    if (!rates?.rates?.length) return;

    const today = new Date().toISOString().split('T')[0];
    const dir = path.join(process.cwd(), 'public', 'rates');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let bestBuy = Infinity, bestBuyEx = '';
    let bestSell = 0, bestSellEx = '';
    const rows: string[] = [];

    for (const ex of rates.rates) {
      if (ex.bestBuy && ex.bestBuy < bestBuy) { bestBuy = ex.bestBuy; bestBuyEx = ex.exchange; }
      if (ex.bestSell && ex.bestSell > bestSell) { bestSell = ex.bestSell; bestSellEx = ex.exchange; }
      rows.push(`<tr><td>${ex.exchange}</td><td>¥${ex.bestBuy?.toFixed(2) || '-'}</td><td>¥${ex.bestSell?.toFixed(2) || '-'}</td></tr>`);
    }

    const spread = bestSell > 0 && bestBuy < Infinity ? ((bestSell - bestBuy) / bestBuy * 100).toFixed(2) : '0';

    const html = `<!DOCTYPE html>
<html lang="ja" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>USDT/JPYレート ${today} | PayMatch日次レポート</title>
  <meta name="description" content="${today}のUSDT/JPY P2Pレート。最安購入¥${bestBuy.toFixed(0)}(${bestBuyEx})、最高売却¥${bestSell.toFixed(0)}(${bestSellEx})、スプレッド${spread}%。">
  <link rel="canonical" href="https://bkpay.app/rates/${today}.html">
  <meta property="og:title" content="USDT/JPYレート ${today}">
  <meta property="og:description" content="最安購入¥${bestBuy.toFixed(0)} | 最高売却¥${bestSell.toFixed(0)} | スプレッド${spread}%">
  <meta property="og:url" content="https://bkpay.app/rates/${today}.html">
  <meta property="og:site_name" content="PayMatch">
  <meta name="theme-color" content="#34d399">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"USDT/JPYレート ${today}","datePublished":"${today}","author":{"@type":"Organization","name":"PayMatch"}}</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"PayMatch","item":"https://bkpay.app/"},{"@type":"ListItem","position":2,"name":"レート","item":"https://bkpay.app/rates/"},{"@type":"ListItem","position":3,"name":"${today}","item":"https://bkpay.app/rates/${today}.html"}]}</script>
  <link rel="stylesheet" href="/lp/lp.css">
</head>
<body>
  <nav role="navigation" style="background:var(--card);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;justify-content:space-between;align-items:center;max-width:900px;margin:0 auto">
    <a href="/" style="color:var(--accent);text-decoration:none;font-weight:700">Pay<span style="color:var(--text)">Match</span></a>
    <a href="/buy-usdt.html" style="background:#10b981;color:#fff;padding:4px 12px;border-radius:6px;text-decoration:none;font-weight:600;font-size:12px">USDT購入</a>
  </nav>
  <main role="main" style="max-width:900px;margin:0 auto;padding:24px 16px">
    <h1 style="font-size:22px">USDT/JPY P2Pレート — ${today}</h1>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin:16px 0">
      <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;flex:1;min-width:120px">
        <div style="font-size:10px;color:var(--dim)">最安購入</div>
        <div style="font-size:20px;font-weight:700;color:var(--accent)">¥${bestBuy.toFixed(2)}</div>
        <div style="font-size:10px;color:var(--dim)">${bestBuyEx}</div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;flex:1;min-width:120px">
        <div style="font-size:10px;color:var(--dim)">最高売却</div>
        <div style="font-size:20px;font-weight:700">¥${bestSell.toFixed(2)}</div>
        <div style="font-size:10px;color:var(--dim)">${bestSellEx}</div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;flex:1;min-width:120px">
        <div style="font-size:10px;color:var(--dim)">スプレッド</div>
        <div style="font-size:20px;font-weight:700">${spread}%</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <thead><tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:8px;font-size:12px">取引所</th><th style="text-align:left;padding:8px;font-size:12px">購入レート</th><th style="text-align:left;padding:8px;font-size:12px">売却レート</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <div style="text-align:center;margin:24px 0">
      <a href="/buy-usdt.html?utm_source=rate_report&utm_campaign=${today}" style="display:inline-block;padding:12px 28px;background:var(--accent);color:#fff;border-radius:8px;text-decoration:none;font-weight:700">今すぐUSDTを購入</a>
    </div>
    <p style="font-size:11px;color:var(--dim);text-align:center">レートは取得時点の値です。最新レートは<a href="/" style="color:var(--accent)">ダッシュボード</a>で確認してください。</p>
  </main>
  <footer style="text-align:center;padding:16px;font-size:10px;color:var(--dim);border-top:1px solid var(--border);max-width:900px;margin:0 auto">
    <a href="/terms.html" style="color:inherit">利用規約</a> · <a href="/privacy.html" style="color:inherit">プライバシー</a> · <a href="/guide.html" style="color:inherit">ガイド</a>
  </footer>
</body>
</html>`;

    const filePath = path.join(dir, `${today}.html`);
    fs.writeFileSync(filePath, html, 'utf-8');

    // Generate index page listing recent reports
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'index.html').sort().reverse().slice(0, 30);
    const indexHtml = `<!DOCTYPE html>
<html lang="ja" data-theme="dark">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>USDT/JPYレート履歴 | PayMatch</title>
  <meta name="description" content="USDT/JPYのP2Pレート日次レポート一覧。過去30日分のレート推移を確認できます。">
  <link rel="canonical" href="https://bkpay.app/rates/">
  <meta name="theme-color" content="#34d399">
  <link rel="stylesheet" href="/lp/lp.css">
</head>
<body>
  <nav role="navigation" style="background:var(--card);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;justify-content:space-between;align-items:center;max-width:900px;margin:0 auto">
    <a href="/" style="color:var(--accent);text-decoration:none;font-weight:700">Pay<span style="color:var(--text)">Match</span></a>
    <a href="/buy-usdt.html" style="background:#10b981;color:#fff;padding:4px 12px;border-radius:6px;text-decoration:none;font-weight:600;font-size:12px">USDT購入</a>
  </nav>
  <main role="main" style="max-width:900px;margin:0 auto;padding:24px 16px">
    <h1 style="font-size:22px">USDT/JPY レート履歴</h1>
    <ul style="list-style:none;padding:0">${files.map(f => {
      const date = f.replace('.html', '');
      return `<li style="padding:8px 0;border-bottom:1px solid var(--border)"><a href="/rates/${f}" style="color:var(--accent);text-decoration:none">${date}</a></li>`;
    }).join('')}</ul>
  </main>
</body>
</html>`;
    fs.writeFileSync(path.join(dir, 'index.html'), indexHtml, 'utf-8');

    logger.info('Daily rate report generated', { date: today, bestBuy, bestSell });
  } catch (e) {
    logger.error('Rate report generation failed', { error: e instanceof Error ? e.message : String(e) });
  }
}
