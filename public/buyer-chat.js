/**
 * buyer-chat.js — 購入者向けAIサポートチャットウィジェット
 */
(function() {
  'use strict';

  var chatLang = localStorage.getItem('lang') || document.documentElement.getAttribute('data-lang') || 'ja';
  var chatStrings = {
    ja: { title: 'PayMatch サポート', subtitle: 'AI自動対応', placeholder: '質問を入力...', hint: '質問がありますか？AIサポートがお手伝いします', s1: '使い方を教えて', s2: 'ウォレットの作り方', s3: '着金までの時間は？', s4: '手数料について', welcome: 'PayMatchサポートへようこそ！\nUSDT購入に関するご質問にお答えします。', ariaLabel: 'サポートチャット', errGeneric: '申し訳ございません。エラーが発生しました。もう一度お試しください。', errConnection: '接続エラーが発生しました。ページをリロードしてお試しください。' },
    en: { title: 'PayMatch Support', subtitle: 'AI Assistant', placeholder: 'Ask a question...', hint: 'Need help? Our AI support is here.', s1: 'How to use', s2: 'Create a wallet', s3: 'How long to receive?', s4: 'About fees', welcome: 'Welcome to PayMatch Support!\nAsk any question about buying USDT.', ariaLabel: 'Support chat', errGeneric: 'Sorry, an error occurred. Please try again.', errConnection: 'Connection error. Please reload the page.' },
    zh: { title: 'PayMatch 客服', subtitle: 'AI自动应答', placeholder: '输入问题...', hint: '有问题吗？AI客服为您服务', s1: '如何使用', s2: '创建钱包', s3: '多久到账？', s4: '关于手续费', welcome: '欢迎来到PayMatch客服！\n关于购买USDT的任何问题都可以问。', ariaLabel: '客服聊天', errGeneric: '抱歉，发生了错误。请重试。', errConnection: '连接错误。请重新加载页面。' },
    vi: { title: 'PayMatch Hỗ trợ', subtitle: 'Trợ lý AI', placeholder: 'Nhập câu hỏi...', hint: 'Cần giúp đỡ? AI hỗ trợ của chúng tôi sẵn sàng.', s1: 'Cách sử dụng', s2: 'Tạo ví', s3: 'Bao lâu nhận được?', s4: 'Về phí', welcome: 'Chào mừng đến PayMatch!\nHãy hỏi bất kỳ câu hỏi nào về mua USDT.', ariaLabel: 'Hỗ trợ trò chuyện', errGeneric: 'Xin lỗi, đã xảy ra lỗi. Vui lòng thử lại.', errConnection: 'Lỗi kết nối. Vui lòng tải lại trang.' }
  };
  var cs = chatStrings[chatLang] || chatStrings.ja;

  var style = document.createElement('style');
  style.textContent = [
    '#bc-btn{position:fixed;bottom:20px;right:20px;z-index:9000;width:50px;height:50px;border-radius:50%;background:#10b981;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(16,185,129,.4);display:flex;align-items:center;justify-content:center;font-size:20px;transition:transform .2s}',
    '#bc-btn:hover{transform:scale(1.08)}#bc-btn.open{background:#6b7280;box-shadow:none}',
    '#bc-panel{position:fixed;bottom:80px;right:20px;z-index:9000;width:340px;max-width:calc(100vw - 24px);height:460px;max-height:calc(100vh - 100px);border-radius:14px;background:var(--card,#1a1d27);border:1px solid var(--border,#2a2d3a);box-shadow:0 8px 40px rgba(0,0,0,.5);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,sans-serif}',
    '#bc-panel.vis{display:flex}',
    '#bc-hdr{padding:10px 14px;border-bottom:1px solid var(--border,#2a2d3a);display:flex;align-items:center;gap:8px;flex-shrink:0}',
    '#bc-hdr .av{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#34d399,#60a5fa);display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}',
    '#bc-hdr .nm{font-size:13px;font-weight:700;color:var(--text,#e4e4e7)}',
    '#bc-hdr .st{font-size:10px;color:#34d399}',
    '#bc-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}',
    '.bc-m{display:flex;gap:8px;align-items:flex-start;max-width:92%}',
    '.bc-m.usr{align-self:flex-end;flex-direction:row-reverse}',
    '.bc-m .av{width:24px;height:24px;border-radius:50%;background:var(--border,#2a2d3a);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}',
    '.bc-m.usr .av{background:#10b981}',
    '.bc-m .bb{padding:8px 12px;border-radius:12px;font-size:12px;line-height:1.6;color:var(--text,#e4e4e7);max-width:100%;word-wrap:break-word}',
    '.bc-m.ai .bb{background:var(--bg,#0f1117);border:1px solid var(--border,#2a2d3a);border-radius:4px 12px 12px 12px}',
    '.bc-m.usr .bb{background:#10b981;color:#fff;border-radius:12px 4px 12px 12px}',
    '#bc-sug{padding:8px 12px;display:flex;flex-wrap:wrap;gap:4px;border-top:1px solid var(--border,#2a2d3a)}',
    '.bc-sq{padding:4px 10px;border:1px solid var(--border,#2a2d3a);border-radius:12px;background:none;color:var(--text2,#9ca3af);font-size:10px;cursor:pointer}',
    '.bc-sq:hover{border-color:#34d399;color:#34d399}',
    '#bc-inp-wrap{padding:8px 12px;border-top:1px solid var(--border,#2a2d3a);display:flex;gap:6px;align-items:flex-end}',
    '#bc-inp{flex:1;resize:none;border:1px solid var(--border,#2a2d3a);background:var(--bg,#0f1117);color:var(--text,#e4e4e7);border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.4;min-height:36px;max-height:72px;outline:none;font-family:inherit}',
    '#bc-inp:focus{border-color:#34d399}',
    '#bc-send{width:36px;height:36px;border-radius:8px;border:none;background:#10b981;color:#fff;cursor:pointer;font-size:14px;flex-shrink:0}',
    '#bc-send:disabled{opacity:.4;cursor:not-allowed}',
    '.bc-typ{display:flex;gap:4px;padding:4px 0}.bc-typ span{width:6px;height:6px;border-radius:50%;background:#8a9ab5;animation:bc-dot .8s infinite}',
    '.bc-typ span:nth-child(2){animation-delay:.15s}.bc-typ span:nth-child(3){animation-delay:.3s}',
    '@keyframes bc-dot{0%,80%{opacity:.3}40%{opacity:1}}'
  ].join('\n');
  document.head.appendChild(style);

  // Create elements
  var btn = document.createElement('button');
  btn.id = 'bc-btn';
  btn.innerHTML = '💬';
  btn.setAttribute('aria-label', cs.ariaLabel);
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.id = 'bc-panel';
  panel.innerHTML =
    '<div id="bc-hdr"><div class="av">🤖</div><div><div class="nm">' + cs.title + '</div><div class="st">' + cs.subtitle + '</div></div></div>' +
    '<div id="bc-msgs"></div>' +
    '<div id="bc-sug">' +
      '<button class="bc-sq">' + cs.s1 + '</button>' +
      '<button class="bc-sq">' + cs.s2 + '</button>' +
      '<button class="bc-sq">' + cs.s3 + '</button>' +
      '<button class="bc-sq">' + cs.s4 + '</button>' +
    '</div>' +
    '<div id="bc-inp-wrap"><textarea id="bc-inp" placeholder="' + cs.placeholder + '" rows="1"></textarea><button id="bc-send" disabled>➤</button></div>';
  document.body.appendChild(panel);

  // Show hint bubble on first visit
  if (!localStorage.getItem('pm_chat_seen')) {
    var hint = document.createElement('div');
    hint.style.cssText = 'position:fixed;bottom:76px;right:20px;z-index:9000;background:var(--card,#1a1d27);border:1px solid var(--border,#2a2d3a);border-radius:8px;padding:8px 12px;font-size:11px;color:var(--text,#e4e4e7);box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:180px';
    hint.textContent = cs.hint;
    hint.id = 'bc-hint';
    document.body.appendChild(hint);
    setTimeout(function() { if (document.getElementById('bc-hint')) document.getElementById('bc-hint').remove(); }, 8000);
    localStorage.setItem('pm_chat_seen', '1');
  }

  var msgs = document.getElementById('bc-msgs');
  var inp = document.getElementById('bc-inp');
  var sendBtn = document.getElementById('bc-send');
  var sugBox = document.getElementById('bc-sug');
  var history = [];
  var loading = false;

  // Toggle
  btn.onclick = function() {
    var open = panel.classList.toggle('vis');
    btn.classList.toggle('open', open);
    btn.innerHTML = open ? '✕' : '💬';
    if (open && msgs.children.length === 0) {
      addMsg('ai', cs.welcome);
    }
    if (open) inp.focus();
  };

  function addMsg(type, text) {
    var el = document.createElement('div');
    el.className = 'bc-m ' + (type === 'ai' ? 'ai' : 'usr');
    var avDiv = document.createElement('div');
    avDiv.className = 'av';
    avDiv.textContent = type === 'ai' ? '\uD83E\uDD16' : '\uD83D\uDC64';
    el.appendChild(avDiv);
    var bbDiv = document.createElement('div');
    bbDiv.className = 'bb';
    if (type === 'ai') {
      // AI messages may contain safe markdown formatting (escapeHtml is called inside formatText)
      bbDiv.innerHTML = formatText(text);
    } else {
      bbDiv.textContent = text;
    }
    el.appendChild(bbDiv);
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function formatText(t) {
    return escapeHtml(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'bc-m ai';
    el.id = 'bc-typing';
    el.innerHTML = '<div class="av">🤖</div><div class="bc-typ"><span></span><span></span><span></span></div>';
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    var el = document.getElementById('bc-typing');
    if (el) el.remove();
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || loading) return;
    loading = true;
    sendBtn.disabled = true;
    inp.value = '';
    addMsg('usr', text);
    if (sugBox) sugBox.style.display = 'none';
    showTyping();

    try {
      var res = await fetch('/api/p2p-buy/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history }),
      });
      var data = await res.json();
      removeTyping();
      if (data.success && data.reply) {
        addMsg('ai', data.reply);
        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: data.reply });
        if (history.length > 20) history = history.slice(-20);
      } else {
        addMsg('ai', cs.errGeneric);
      }
    } catch(e) {
      removeTyping();
      addMsg('ai', cs.errConnection);
    }
    loading = false;
    sendBtn.disabled = false;
    inp.focus();
  }

  // Input handling
  inp.oninput = function() {
    sendBtn.disabled = !inp.value.trim();
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 72) + 'px';
  };
  inp.onkeydown = function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(inp.value); }
  };
  sendBtn.onclick = function() { send(inp.value); };

  // Suggestions
  document.querySelectorAll('.bc-sq').forEach(function(b) {
    b.onclick = function() { send(b.textContent); };
  });
})();
