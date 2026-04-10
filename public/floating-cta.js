// floating-cta.js — always-visible bottom CTA bar
// Injects a fixed bottom bar with "USDT購入" and "PayPay変換" buttons on all included pages.
// Self-aware: dims the button matching the current page.
// i18n-aware: uses t() when available.
// Theme-aware: uses CSS variables (var(--accent), var(--card), var(--border), var(--text)).
// Chat-widget-aware: offsets buyer-chat widget upward to avoid overlap.
(function () {
  'use strict';

  var BAR_ID = 'fab-cta-bar';
  var BAR_HEIGHT = 56; // px
  var BODY_PADDING = 72; // px — slightly more than bar to give breathing room

  // Safe translator — falls back to Japanese defaults if i18n.js is not loaded.
  function tr(key, fallback) {
    if (typeof t === 'function') {
      var v = t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  }

  // Determine which button is "self" based on current path.
  function isCurrentPage(href) {
    var path = location.pathname.replace(/\/+$/, '') || '/';
    var target = href.replace(/\/+$/, '') || '/';
    return path === target;
  }

  function injectBar() {
    // Idempotent: remove existing bar if already present
    var existing = document.getElementById(BAR_ID);
    if (existing) existing.remove();

    var bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Quick actions');
    bar.style.cssText = [
      'position:fixed',
      'left:0',
      'right:0',
      'bottom:0',
      'z-index:9998',
      'display:flex',
      'height:' + BAR_HEIGHT + 'px',
      'background:var(--card,#1a1d27)',
      'border-top:1px solid var(--border,#2a2d3a)',
      'box-shadow:0 -2px 12px rgba(0,0,0,0.25)',
      'padding-bottom:env(safe-area-inset-bottom,0)',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');

    var buyHref = '/buy-usdt.html';
    var ppHref = '/paypay-convert.html';
    var buyIsSelf = isCurrentPage(buyHref);
    var ppIsSelf = isCurrentPage(ppHref);

    var baseBtn = [
      'flex:1',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'gap:6px',
      'text-decoration:none',
      'font-size:14px',
      'font-weight:700',
      'letter-spacing:.2px',
      'transition:opacity .15s,transform .1s',
      'user-select:none',
      '-webkit-tap-highlight-color:transparent'
    ].join(';');

    var buyBtn = document.createElement('a');
    buyBtn.href = buyHref;
    buyBtn.className = 'fab-cta-buy';
    buyBtn.setAttribute('data-i18n', 'nav_buy_usdt');
    buyBtn.style.cssText = baseBtn + ';' + [
      'background:var(--accent,#10b981)',
      'color:#fff',
      'border-right:1px solid rgba(0,0,0,0.15)',
      'opacity:' + (buyIsSelf ? '0.5' : '1')
    ].join(';');
    buyBtn.innerHTML = '<span style="font-size:16px">💎</span><span>' + tr('nav_buy_usdt', 'USDT購入') + '</span>';
    if (buyIsSelf) buyBtn.setAttribute('aria-current', 'page');

    var ppBtn = document.createElement('a');
    ppBtn.href = ppHref;
    ppBtn.className = 'fab-cta-pp';
    ppBtn.setAttribute('data-i18n', 'nav_paypay');
    ppBtn.style.cssText = baseBtn + ';' + [
      'background:var(--card,#1a1d27)',
      'color:var(--warn,#f59e0b)',
      'border-left:1px solid var(--border,#2a2d3a)',
      'opacity:' + (ppIsSelf ? '0.5' : '1')
    ].join(';');
    ppBtn.innerHTML = '<span style="font-size:16px">💴</span><span>' + tr('nav_paypay', 'PayPay変換') + '</span>';
    if (ppIsSelf) ppBtn.setAttribute('aria-current', 'page');

    // Tap feedback (mobile)
    [buyBtn, ppBtn].forEach(function (btn) {
      btn.addEventListener('touchstart', function () { btn.style.transform = 'scale(0.98)'; }, { passive: true });
      btn.addEventListener('touchend', function () { btn.style.transform = 'scale(1)'; }, { passive: true });
    });

    bar.appendChild(buyBtn);
    bar.appendChild(ppBtn);
    document.body.appendChild(bar);

    // Prevent content from being hidden under the bar
    var currentPad = parseInt(getComputedStyle(document.body).paddingBottom, 10) || 0;
    if (currentPad < BODY_PADDING) {
      document.body.style.paddingBottom = BODY_PADDING + 'px';
    }

    // Offset chat widget upward so it doesn't overlap the CTA bar
    adjustChatWidget();
  }

  // The buyer-chat widget typically uses fixed bottom:20px right:20px.
  // We raise it to bottom:80px (56 + 24 gap).
  function adjustChatWidget() {
    var selectors = [
      '#chat-widget', '#chat-widget-container', '#buyer-chat',
      '#buyer-chat-widget', '#chatWidget', '.chat-widget-fab'
    ];
    selectors.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el && getComputedStyle(el).position === 'fixed') {
        el.style.bottom = (BAR_HEIGHT + 24) + 'px';
      }
    });
  }

  // If buyer-chat.js injects its widget after us, re-adjust via MutationObserver
  function watchForChatWidget() {
    if (!('MutationObserver' in window)) return;
    var observer = new MutationObserver(function () { adjustChatWidget(); });
    observer.observe(document.body, { childList: true, subtree: true });
    // Stop watching after 10 seconds to avoid overhead
    setTimeout(function () { observer.disconnect(); }, 10000);
  }

  function init() {
    injectBar();
    watchForChatWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
