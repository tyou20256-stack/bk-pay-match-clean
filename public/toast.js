// toast.js — minimal toast notification replacement for alert()
// Zero dependencies, ~2KB, CSP-safe (no inline styles except dynamically created elements).
// Usage: toast.error('message'), toast.success('message'), toast.info('message'), toast.warn('message')
(function () {
  'use strict';

  var CONTAINER_ID = 'bk-toast-container';
  var MAX_TOASTS = 4;

  function ensureContainer() {
    var c = document.getElementById(CONTAINER_ID);
    if (c) return c;
    c = document.createElement('div');
    c.id = CONTAINER_ID;
    c.setAttribute('role', 'region');
    c.setAttribute('aria-label', 'Notifications');
    c.setAttribute('aria-live', 'polite');
    c.style.cssText = [
      'position:fixed',
      'top:20px',
      'right:20px',
      'left:20px',
      'z-index:10000',
      'pointer-events:none',
      'display:flex',
      'flex-direction:column',
      'align-items:flex-end',
      'gap:8px',
      'max-width:360px',
      'margin-left:auto',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');
    document.body.appendChild(c);
    return c;
  }

  var COLORS = {
    success: { bg: '#10b981', fg: '#ffffff', icon: '✓' },
    error:   { bg: '#ef4444', fg: '#ffffff', icon: '✕' },
    warn:    { bg: '#f59e0b', fg: '#ffffff', icon: '⚠' },
    info:    { bg: '#3b82f6', fg: '#ffffff', icon: 'ℹ' }
  };

  function show(type, message, opts) {
    opts = opts || {};
    var duration = opts.duration || 4000;
    var c = ensureContainer();

    // Enforce max toasts
    while (c.children.length >= MAX_TOASTS) {
      c.removeChild(c.firstChild);
    }

    var scheme = COLORS[type] || COLORS.info;
    var toast = document.createElement('div');
    toast.setAttribute('role', type === 'error' || type === 'warn' ? 'alert' : 'status');
    toast.style.cssText = [
      'background:' + scheme.bg,
      'color:' + scheme.fg,
      'padding:12px 16px',
      'border-radius:8px',
      'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'font-size:13px',
      'font-weight:500',
      'line-height:1.4',
      'max-width:100%',
      'pointer-events:auto',
      'cursor:pointer',
      'opacity:0',
      'transform:translateX(20px)',
      'transition:opacity .2s,transform .2s',
      'word-break:break-word'
    ].join(';');

    var iconSpan = document.createElement('span');
    iconSpan.textContent = scheme.icon;
    iconSpan.style.cssText = 'font-size:16px;flex-shrink:0;font-weight:700';
    toast.appendChild(iconSpan);

    var text = document.createElement('span');
    text.textContent = String(message == null ? '' : message);
    text.style.cssText = 'flex:1';
    toast.appendChild(text);

    c.appendChild(toast);

    // Enter animation
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });

    var dismissed = false;
    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 250);
    }

    toast.addEventListener('click', dismiss);
    if (duration > 0) setTimeout(dismiss, duration);

    return dismiss;
  }

  window.toast = {
    success: function (m, o) { return show('success', m, o); },
    error:   function (m, o) { return show('error', m, o); },
    warn:    function (m, o) { return show('warn', m, o); },
    info:    function (m, o) { return show('info', m, o); }
  };
})();
