/**
 * @file seoGenerator.ts — Programmatic SEO page generator
 * Generates keyword-targeted landing pages with live rate data.
 * Run on startup + daily via cron.
 */
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

interface SeoPage {
  slug: string;
  title: string;
  description: string;
  h1: string;
  keywords: string[];
  content: string; // HTML content for the page body
  lang: string;
  hreflang?: Record<string, string>;
}

const PAGES: SeoPage[] = [
  {
    slug: 'bybit-p2p-alternative',
    title: 'Bybit P2P撤退後のUSDT購入方法 | PayMatch',
    description: 'Bybit P2Pが日本から撤退。銀行振込でUSDTを購入する最安の方法をPayMatchで。KYC不要・即時マッチング。',
    h1: 'Bybit P2P撤退後、USDTはどこで買う？',
    keywords: ['Bybit P2P 代替', 'Bybit P2P 撤退', 'Bybit 日本 USDT'],
    lang: 'ja',
    content: `
      <section class="content-section">
        <h2 data-i18n="lp_bybit_p2p_alternative_h2_1">Bybit P2Pの日本撤退</h2>
        <p data-i18n="lp_bybit_p2p_alternative_p1">2025年、BybitはP2Pサービスを日本市場から撤退しました。これにより、銀行振込でUSDTを直接購入する手段が限られています。</p>
        <p data-i18n="lp_bybit_p2p_alternative_p2">PayMatchは、Bybit・Binance・OKXの3取引所のP2Pレートをリアルタイムで比較し、最安レートで銀行振込によるUSDT購入を提供します。</p>
      </section>
      <section class="content-section">
        <h2 data-i18n="lp_bybit_p2p_alternative_h2_2">PayMatch vs 他の選択肢</h2>
        <div id="rateCompare" class="rate-table">レートを読み込み中...</div>
      </section>
      <section class="content-section">
        <h2 data-i18n="lp_bybit_p2p_alternative_h2_3">3ステップで購入</h2>
        <ol>
          <li data-i18n="lp_bybit_p2p_alternative_li1"><strong>金額入力</strong> — JPY金額とTRONウォレットアドレスを入力</li>
          <li data-i18n="lp_bybit_p2p_alternative_li2"><strong>銀行振込</strong> — 表示された口座に振込</li>
          <li data-i18n="lp_bybit_p2p_alternative_li3"><strong>USDT受取</strong> — 着金確認後、自動でウォレットに送金</li>
        </ol>
      </section>
    `
  },
  {
    slug: 'usdt-jpy-rate',
    title: 'USDT/JPY リアルタイムレート比較 | 3取引所最安値 | PayMatch',
    description: 'USDT/JPYのリアルタイムP2Pレートを3取引所で比較。Bybit・Binance・OKXの最安購入レートを30秒更新。',
    h1: 'USDT/JPY リアルタイムレート比較',
    keywords: ['USDT JPY レート', 'USDT 日本円 レート', 'テザー 円 レート'],
    lang: 'ja',
    content: `
      <section class="content-section">
        <p data-i18n="lp_usdt_jpy_rate_p1">3つのP2P取引所（Bybit・Binance・OKX）のUSDT/JPYレートをリアルタイムで比較。30秒ごとに自動更新されます。</p>
        <div id="rateCompare" class="rate-table">レートを読み込み中...</div>
      </section>
      <section class="content-section">
        <h2 data-i18n="lp_usdt_jpy_rate_h2_1">PayMatchでUSDTを最安購入</h2>
        <p data-i18n="lp_usdt_jpy_rate_p2">PayMatchは3取引所の最安レートを自動マッチング。銀行振込のみ、KYC不要で購入できます。</p>
      </section>
    `
  },
  {
    slug: 'usdt-remittance-vietnam',
    title: 'ベトナムへの送金はUSDTが最安 | 銀行振込で購入 | PayMatch',
    description: '日本からベトナムへの送金コストを最小化。銀行振込でUSDTを購入し、ベトナムの家族に送金。手数料は銀行送金の1/10以下。',
    h1: 'ベトナムへの送金、銀行よりUSDTが安い',
    keywords: ['ベトナム 送金 USDT', 'ベトナム 送金 安い', '海外送金 仮想通貨'],
    lang: 'ja',
    content: `
      <section class="content-section">
        <h2 data-i18n="lp_usdt_remittance_vietnam_h2_1">銀行送金 vs USDT送金</h2>
        <table><thead><tr><th>項目</th><th>銀行送金</th><th>USDT送金</th></tr></thead>
        <tbody>
          <tr><td>手数料</td><td>3,000〜7,000円</td><td>約150円（1 USDT）</td></tr>
          <tr><td>到着時間</td><td>1〜3営業日</td><td>1〜5分</td></tr>
          <tr><td>為替レート</td><td>銀行レート（不利）</td><td>P2P市場レート（有利）</td></tr>
          <tr><td>KYC</td><td>必要</td><td>不要（PayMatch）</td></tr>
        </tbody></table>
      </section>
      <section class="content-section">
        <h2 data-i18n="lp_usdt_remittance_vietnam_h2_2">送金の流れ</h2>
        <ol>
          <li data-i18n="lp_usdt_remittance_vietnam_li1">PayMatchで銀行振込 → USDTを購入</li>
          <li data-i18n="lp_usdt_remittance_vietnam_li2">USDTをベトナムの家族のウォレットに送金（TRC-20、手数料約1 USDT）</li>
          <li data-i18n="lp_usdt_remittance_vietnam_li3">ベトナムでUSDTを現地通貨に交換</li>
        </ol>
      </section>
    `
  },
  {
    slug: 'usdt-no-kyc',
    title: 'KYC不要でUSDT購入 | 本人確認なし | PayMatch',
    description: 'KYC（本人確認）不要でUSDTを銀行振込で購入。アカウント登録不要、メールアドレス不要。即時マッチング。',
    h1: 'KYC不要でUSDTを購入する方法',
    keywords: ['USDT KYC不要', '仮想通貨 本人確認なし', 'USDT 匿名 購入'],
    lang: 'ja',
    content: `
      <section class="content-section">
        <h2 data-i18n="lp_usdt_no_kyc_h2_1">なぜKYC不要？</h2>
        <p data-i18n="lp_usdt_no_kyc_p1">PayMatchはP2Pマッチングプラットフォームです。取引所ではないため、本人確認（KYC）は不要です。</p>
        <ul>
          <li data-i18n="lp_usdt_no_kyc_li1">メールアドレス登録不要</li>
          <li data-i18n="lp_usdt_no_kyc_li2">パスワード設定不要</li>
          <li data-i18n="lp_usdt_no_kyc_li3">身分証明書の提出不要</li>
          <li data-i18n="lp_usdt_no_kyc_li4">必要なのは銀行口座とTRONウォレットアドレスのみ</li>
        </ul>
      </section>
      <section class="content-section">
        <h2 data-i18n="lp_usdt_no_kyc_h2_2">安全性は？</h2>
        <p data-i18n="lp_usdt_no_kyc_p2">KYC不要でも、エスクロー（第三者預託）保護により安全に取引できます。支払い確認まで USDTはロックされます。</p>
      </section>
    `
  },
  {
    slug: 'compare-p2p-exchanges',
    title: 'P2P取引所比較 2026年最新版 | Bybit vs Binance vs OKX | PayMatch',
    description: '日本で使えるP2P仮想通貨取引所を徹底比較。Bybit・Binance・OKXのレート・手数料・KYC要否を一覧。',
    h1: 'P2P取引所比較 — どこが最安？',
    keywords: ['P2P 取引所 比較', 'P2P 仮想通貨 日本', 'USDT P2P 比較'],
    lang: 'ja',
    content: `
      <section class="content-section">
        <div id="rateCompare" class="rate-table">レートを読み込み中...</div>
      </section>
      <section class="content-section">
        <h2 data-i18n="lp_compare_p2p_exchanges_h2_1">各取引所の特徴</h2>
        <p data-i18n="lp_compare_p2p_exchanges_p1">日本で使えるP2P取引所を徹底比較。手数料・KYC要否・対応通貨を一覧で確認。</p>
        <table><thead><tr><th>取引所</th><th>KYC</th><th>JPY対応</th><th>手数料</th><th>日本での利用</th></tr></thead>
        <tbody>
          <tr><td>Bybit P2P</td><td>必要</td><td>撤退</td><td>0%</td><td>利用不可</td></tr>
          <tr><td>Binance P2P</td><td>必要</td><td>あり</td><td>0%</td><td>制限あり</td></tr>
          <tr><td>OKX P2P</td><td>必要</td><td>あり</td><td>0%</td><td>利用可能</td></tr>
          <tr><td>PayMatch</td><td>不要</td><td>あり</td><td>0%</td><td>最安レート</td></tr>
        </tbody></table>
      </section>
    `
  }
];

function generatePageHtml(page: SeoPage): string {
  const faqSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": "USDTとは？", "acceptedAnswer": { "@type": "Answer", "text": "USDT（テザー）は米ドルに連動するステーブルコインです。1 USDT ≈ 1 USDの価値を維持します。" }},
      { "@type": "Question", "name": "PayMatchの手数料は？", "acceptedAnswer": { "@type": "Answer", "text": "PayMatchの利用手数料は0%です。表示レートがそのまま適用されます。" }},
      { "@type": "Question", "name": "KYCは必要ですか？", "acceptedAnswer": { "@type": "Answer", "text": "いいえ。PayMatchではKYC（本人確認）は不要です。銀行口座とTRONウォレットがあれば購入できます。" }}
    ]
  });

  return `<!DOCTYPE html>
<html lang="${page.lang}" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title}</title>
  <meta name="description" content="${page.description}">
  <meta name="keywords" content="${page.keywords.join(', ')}">
  <link rel="canonical" href="https://bkpay.app/lp/${page.slug}.html">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${page.title}">
  <meta property="og:description" content="${page.description}">
  <meta property="og:url" content="https://bkpay.app/lp/${page.slug}.html">
  <meta property="og:site_name" content="PayMatch">
  <meta property="og:image" content="https://bkpay.app/og-image.svg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${page.title}">
  <meta name="twitter:description" content="${page.description}">
  <meta name="theme-color" content="#34d399">
  <meta name="mobile-web-app-capable" content="yes">
  <link rel="manifest" href="/manifest.json">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <script type="application/ld+json">${faqSchema}</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"PayMatch","item":"https://bkpay.app/"},{"@type":"ListItem","position":2,"name":"${page.h1}","item":"https://bkpay.app/lp/${page.slug}.html"}]}</script>
  <link rel="alternate" hreflang="ja" href="https://bkpay.app/lp/${page.slug}.html">
  <link rel="alternate" hreflang="en" href="https://bkpay.app/lp/${page.slug}.html">
  <link rel="alternate" hreflang="zh" href="https://bkpay.app/lp/${page.slug}.html">
  <link rel="alternate" hreflang="vi" href="https://bkpay.app/lp/${page.slug}.html">
  <link rel="alternate" hreflang="x-default" href="https://bkpay.app/lp/${page.slug}.html">
  <link rel="stylesheet" href="/lp/lp.css">
</head>
<body>
  <nav role="navigation" aria-label="サイトナビゲーション" style="background:var(--card);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;justify-content:space-between;align-items:center;max-width:900px;margin:0 auto">
    <a href="/" style="color:var(--accent);text-decoration:none;font-weight:700">Pay<span style="color:var(--text)">Match</span></a>
    <div style="display:flex;gap:8px;font-size:12px">
      <a href="/buy-usdt.html" style="background:#10b981;color:#fff;padding:4px 12px;border-radius:6px;text-decoration:none;font-weight:600" data-i18n="p2p_title">USDT購入</a>
      <a href="/guide.html" style="color:var(--text2);text-decoration:none" data-i18n="ref_guide">ガイド</a>
    </div>
  </nav>
  <main role="main" style="max-width:900px;margin:0 auto;padding:24px 16px">
    <h1 style="font-size:24px;margin-bottom:16px">${page.h1}</h1>
    ${page.content}
    <div style="text-align:center;margin:32px 0">
      <a href="/buy-usdt.html?utm_source=seo&utm_medium=lp&utm_campaign=${page.slug}" style="display:inline-block;padding:14px 32px;background:var(--accent);color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px" aria-label="USDT購入ページへ" data-i18n="lp_cta">今すぐUSDTを購入</a>
    </div>
  </main>
  <footer style="text-align:center;padding:16px;font-size:10px;color:var(--dim);border-top:1px solid var(--border);max-width:900px;margin:0 auto">
    <a href="/terms.html" style="color:inherit">利用規約</a> · <a href="/privacy.html" style="color:inherit">プライバシー</a> · <a href="/guide.html" style="color:inherit">ガイド</a>
  </footer>
  <script>
    fetch('/api/rates/USDT').then(r=>r.json()).then(d=>{
      if(!d.success)return;var rates=d.data.rates||[];var el=document.getElementById('rateCompare');if(!el)return;
      var html='<table><thead><tr><th>取引所</th><th>購入レート</th><th>売却レート</th></tr></thead><tbody>';
      rates.forEach(function(r){html+='<tr><td>'+r.exchange+'</td><td>¥'+(r.buyRate||'-')+'</td><td>¥'+(r.sellRate||'-')+'</td></tr>';});
      html+='<tr style="background:var(--accent);color:#fff"><td>PayMatch</td><td colspan="2">最安レートで自動マッチング</td></tr>';
      html+='</tbody></table>';el.innerHTML=html;
    }).catch(function(){});
    setInterval(function(){fetch('/api/rates/USDT').then(r=>r.json()).then(d=>{if(d.success){var el=document.getElementById('rateCompare');if(el){var rates=d.data.rates||[];var html='<table><thead><tr><th>取引所</th><th>購入レート</th><th>売却レート</th></tr></thead><tbody>';rates.forEach(function(r){html+='<tr><td>'+r.exchange+'</td><td>¥'+(r.buyRate||'-')+'</td><td>¥'+(r.sellRate||'-')+'</td></tr>';});html+='<tr style="background:var(--accent);color:#fff"><td>PayMatch</td><td colspan="2">最安レートで自動マッチング</td></tr></tbody></table>';el.innerHTML=html;}}}).catch(function(){});},30000);
  </script>
  <script src="/i18n.js"></script>
</body>
</html>`;
}

export function generateSeoPages(): void {
  const lpDir = path.join(process.cwd(), 'public', 'lp');
  if (!fs.existsSync(lpDir)) fs.mkdirSync(lpDir, { recursive: true });

  let generated = 0;
  for (const page of PAGES) {
    const html = generatePageHtml(page);
    const filePath = path.join(lpDir, `${page.slug}.html`);
    fs.writeFileSync(filePath, html, 'utf-8');
    generated++;
  }
  logger.info('SEO pages generated', { count: generated });
}

export function getSeoPageSlugs(): string[] {
  return PAGES.map(p => p.slug);
}
