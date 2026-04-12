/**
 * chat-widget.js — BK Pay Match AIチャットウィジェット
 * 管理画面の全ページに埋め込む浮きチャットUI。
 * 使い方・操作手順をその場でAIに質問できる。
 */
(function () {
  'use strict';

  // ── スタイル注入 ─────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #bk-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9000;
      width: 52px; height: 52px; border-radius: 50%;
      background: #34d399; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(52,211,153,.45);
      display: flex; align-items: center; justify-content: center;
      transition: transform .2s, box-shadow .2s;
      font-size: 22px;
    }
    #bk-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(52,211,153,.6); }
    #bk-chat-btn.open { background: #5a6a85; box-shadow: none; }

    #bk-chat-panel {
      position: fixed; bottom: 88px; right: 24px; z-index: 9000;
      width: 360px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 120px);
      border-radius: 14px;
      background: var(--card, #1a2233);
      border: 1px solid var(--border, #243049);
      box-shadow: 0 8px 40px rgba(0,0,0,.45);
      display: none; flex-direction: column; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Segoe UI', sans-serif;
    }
    #bk-chat-panel.visible { display: flex; }

    #bk-chat-header {
      padding: 12px 16px; background: var(--card, #1a2233);
      border-bottom: 1px solid var(--border, #243049);
      display: flex; align-items: center; gap: 10px; flex-shrink: 0;
    }
    #bk-chat-header .avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: linear-gradient(135deg, #34d399, #60a5fa);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; flex-shrink: 0;
    }
    #bk-chat-header .info { flex: 1; min-width: 0; }
    #bk-chat-header .name {
      font-size: 13px; font-weight: 700;
      color: var(--text, #edf0f7);
    }
    #bk-chat-header .status {
      font-size: 10px; color: var(--green, #34d399);
      display: flex; align-items: center; gap: 4px;
    }
    #bk-chat-header .status::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%;
      background: var(--green, #34d399); flex-shrink: 0;
    }
    #bk-chat-close {
      width: 28px; height: 28px; border-radius: 6px;
      border: 1px solid var(--border, #243049);
      background: none; color: var(--text2, #a0aec0);
      cursor: pointer; font-size: 16px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      transition: all .15s;
    }
    #bk-chat-close:hover { border-color: var(--text2, #a0aec0); color: var(--text, #edf0f7); }

    #bk-chat-messages {
      flex: 1; overflow-y: auto; padding: 14px 12px;
      display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin; scrollbar-color: var(--border, #243049) transparent;
    }
    #bk-chat-messages::-webkit-scrollbar { width: 4px; }
    #bk-chat-messages::-webkit-scrollbar-thumb { background: var(--border, #243049); border-radius: 2px; }

    .bk-msg { display: flex; gap: 8px; max-width: 100%; }
    .bk-msg.user { flex-direction: row-reverse; }
    .bk-msg .bubble {
      padding: 9px 12px; border-radius: 12px; font-size: 12px;
      line-height: 1.55; max-width: 82%; word-break: break-word;
      white-space: pre-wrap;
    }
    .bk-msg.user .bubble {
      background: var(--green, #34d399); color: #0c1017;
      border-bottom-right-radius: 4px;
    }
    .bk-msg.ai .bubble {
      background: var(--card2, #1e2a3d);
      color: var(--text, #edf0f7);
      border: 1px solid var(--border, #243049);
      border-bottom-left-radius: 4px;
    }
    .bk-msg .msg-avatar {
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #34d399, #60a5fa);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; align-self: flex-end;
    }

    .bk-typing {
      display: flex; gap: 4px; align-items: center;
      padding: 10px 12px; background: var(--card2, #1e2a3d);
      border: 1px solid var(--border, #243049);
      border-radius: 12px; border-bottom-left-radius: 4px;
      width: fit-content;
    }
    .bk-typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--dim, #5a6a85);
      animation: bk-bounce 1.2s infinite;
    }
    .bk-typing span:nth-child(2) { animation-delay: .2s; }
    .bk-typing span:nth-child(3) { animation-delay: .4s; }
    @keyframes bk-bounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-5px); background: var(--green, #34d399); }
    }

    #bk-chat-suggestions {
      padding: 0 12px 8px; display: flex; flex-wrap: wrap; gap: 5px; flex-shrink: 0;
    }
    .bk-suggestion {
      padding: 4px 10px; border-radius: 20px; font-size: 10px;
      border: 1px solid var(--border, #243049);
      background: none; color: var(--text2, #a0aec0);
      cursor: pointer; transition: all .15s; font-family: inherit;
    }
    .bk-suggestion:hover {
      border-color: var(--green, #34d399);
      color: var(--green, #34d399);
      background: rgba(52,211,153,.08);
    }

    #bk-chat-footer {
      padding: 10px 12px; border-top: 1px solid var(--border, #243049);
      display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
    }
    #bk-chat-input {
      flex: 1; padding: 8px 10px; border-radius: 8px;
      border: 1px solid var(--border, #243049);
      background: var(--input-bg, #0f1520);
      color: var(--text, #edf0f7); font-size: 12px;
      font-family: inherit; resize: none; outline: none;
      line-height: 1.4; max-height: 80px;
      transition: border-color .15s;
    }
    #bk-chat-input:focus { border-color: var(--green, #34d399); }
    #bk-chat-input::placeholder { color: var(--dim, #5a6a85); }
    #bk-chat-send {
      width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
      background: var(--green, #34d399); border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: opacity .15s;
    }
    #bk-chat-send:hover { opacity: .85; }
    #bk-chat-send:disabled { opacity: .4; cursor: not-allowed; }
    #bk-chat-send svg { width: 16px; height: 16px; fill: #0c1017; }

    #bk-chat-clear {
      font-size: 9px; color: var(--dim, #5a6a85);
      background: none; border: none; cursor: pointer;
      padding: 2px 6px; font-family: inherit;
      transition: color .15s;
    }
    #bk-chat-clear:hover { color: var(--text2, #a0aec0); }
  `;
  document.head.appendChild(style);

  // ── DOM構築 ──────────────────────────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'bk-chat-btn';
  btn.title = 'AIアシスタントに質問する';
  btn.innerHTML = '💬';

  const panel = document.createElement('div');
  panel.id = 'bk-chat-panel';
  panel.innerHTML = `
    <div id="bk-chat-header">
      <div class="avatar">🤖</div>
      <div class="info">
        <div class="name">BK Pay AIアシスタント</div>
        <div class="status">オンライン</div>
      </div>
      <button id="bk-chat-close" title="閉じる">✕</button>
    </div>
    <div id="bk-chat-messages"></div>
    <div id="bk-chat-suggestions">
      <button class="bk-suggestion">注文の確認方法は？</button>
      <button class="bk-suggestion">入金確認のやり方</button>
      <button class="bk-suggestion">銀行口座の追加</button>
      <button class="bk-suggestion">送金が失敗した時</button>
      <button class="bk-suggestion">オートマッチングとは</button>
    </div>
    <div id="bk-chat-footer">
      <textarea id="bk-chat-input" rows="1" placeholder="質問を入力… (Enter で送信)"></textarea>
      <button id="bk-chat-send" title="送信">
        <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
      </button>
    </div>
    <div style="text-align:center;padding-bottom:6px">
      <button id="bk-chat-clear">履歴をクリア</button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  // ── 状態 ──────────────────────────────────────────────────────
  let history = [];
  let loading = false;

  const messagesEl = document.getElementById('bk-chat-messages');
  const inputEl = document.getElementById('bk-chat-input');
  const sendBtn = document.getElementById('bk-chat-send');

  // ── ウィジェット開閉 ─────────────────────────────────────────
  function openPanel() {
    panel.classList.add('visible');
    btn.classList.add('open');
    btn.innerHTML = '✕';
    if (history.length === 0) showWelcome();
    inputEl.focus();
  }

  function closePanel() {
    panel.classList.remove('visible');
    btn.classList.remove('open');
    btn.innerHTML = '💬';
  }

  btn.addEventListener('click', () => {
    panel.classList.contains('visible') ? closePanel() : openPanel();
  });

  document.getElementById('bk-chat-close').addEventListener('click', closePanel);

  // ── メッセージ表示 ───────────────────────────────────────────
  function showWelcome() {
    appendAI('こんにちは！BK Pay Match の管理画面についてご質問があればお気軽にどうぞ。\n下のボタンからよくある質問を選ぶこともできます。');
  }

  function appendUser(text) {
    const msg = document.createElement('div');
    msg.className = 'bk-msg user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    msg.appendChild(bubble);
    messagesEl.appendChild(msg);
    scrollToBottom();
    return msg;
  }

  function appendAI(text) {
    const msg = document.createElement('div');
    msg.className = 'bk-msg ai';
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = '\uD83E\uDD16';
    msg.appendChild(avatar);
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    // AI text is escaped inside formatAI before markdown is applied
    bubble.innerHTML = formatAI(text);
    msg.appendChild(bubble);
    messagesEl.appendChild(msg);
    scrollToBottom();
    return msg;
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'bk-msg ai';
    el.id = 'bk-typing';
    el.innerHTML = `<div class="msg-avatar">🤖</div>
      <div class="bk-typing"><span></span><span></span><span></span></div>`;
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function removeTyping() {
    const el = document.getElementById('bk-typing');
    if (el) el.remove();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── テキスト整形 ─────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatAI(text) {
    // Markdown lite: **bold**, `code`, numbered lists, bullet points
    return escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:rgba(96,165,250,.15);padding:1px 5px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/^(\d+\.\s)/gm, '<span style="color:var(--green,#34d399);font-weight:700">$1</span>')
      .replace(/^([•\-]\s)/gm, '<span style="color:var(--green,#34d399)">• </span>');
  }

  // ── 送信処理 ─────────────────────────────────────────────────
  async function sendMessage(text) {
    text = text.trim();
    if (!text || loading) return;

    loading = true;
    sendBtn.disabled = true;
    inputEl.value = '';
    autoResize();

    appendUser(text);
    hideSuggestions();
    showTyping();

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: text, history }),
      });
      const data = await resp.json();
      removeTyping();

      if (data.success) {
        appendAI(data.reply);
        history.push({ role: 'user', content: text });
        history.push({ role: 'assistant', content: data.reply });
        if (history.length > 20) history = history.slice(-20);
      } else {
        appendAI('⚠️ エラー: ' + (data.error || '不明なエラーが発生しました。'));
      }
    } catch (e) {
      removeTyping();
      appendAI('⚠️ サーバーへの接続に失敗しました。ページをリロードしてお試しください。');
    }

    loading = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }

  // ── サジェスト ───────────────────────────────────────────────
  function hideSuggestions() {
    const el = document.getElementById('bk-chat-suggestions');
    if (el) el.style.display = 'none';
  }

  document.querySelectorAll('.bk-suggestion').forEach(btn => {
    btn.addEventListener('click', () => sendMessage(btn.textContent));
  });

  // ── テキストエリア自動リサイズ ────────────────────────────────
  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px';
  }

  inputEl.addEventListener('input', autoResize);
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  sendBtn.addEventListener('click', () => sendMessage(inputEl.value));

  // ── 履歴クリア ───────────────────────────────────────────────
  document.getElementById('bk-chat-clear').addEventListener('click', () => {
    history = [];
    messagesEl.innerHTML = '';
    const sugEl = document.getElementById('bk-chat-suggestions');
    if (sugEl) sugEl.style.display = '';
    showWelcome();
  });

})();
