    const API = '';
    let buyerId = null;
    let buyerToken = null;
    let currentMatchId = null;
    let pollInterval = null;
    let timerInterval = null;
    var pollFailCount = 0;

    // Referral code from URL params
    var refCode = new URLSearchParams(window.location.search).get('ref') || '';
    if (refCode) localStorage.setItem('pm_ref', refCode);

    // Restore saved wallet address for repeat users
    (function() {
      var savedWallet = localStorage.getItem('pm_wallet');
      var walletInput = document.getElementById('walletInput');
      if (savedWallet && walletInput && !walletInput.value) {
        walletInput.value = savedWallet;
        if (typeof checkForm === 'function') checkForm();
      }
    })();

    const getEl = id => document.getElementById(id);
    const $ = getEl;
    const panels = ['panel-input', 'panel-waiting', 'panel-matched', 'panel-complete'];

    // Language switcher (CSP-safe — no inline onclick)
    document.querySelectorAll('.lang-btn[data-lang]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (typeof setLanguage === 'function') setLanguage(this.getAttribute('data-lang'));
        document.querySelectorAll('.lang-btn').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
      });
    });
    // Set active lang button on load
    (function() {
      var lang = localStorage.getItem('lang') || localStorage.getItem('bkpay_lang') || 'ja';
      var btn = document.querySelector('.lang-btn[data-lang="' + lang + '"]');
      if (btn) btn.classList.add('active');
    })();
    // Theme toggle (CSP-safe)
    var themeBtn = document.getElementById('themeToggleBuy');
    if (themeBtn) {
      themeBtn.addEventListener('click', function() {
        var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem('theme', t);
        this.textContent = t === 'dark' ? '\u263E' : '\u2600';
      });
    }

    // Conversion funnel tracking
    function trackEvent(event, data) {
      try {
        var events = JSON.parse(localStorage.getItem('pm_events') || '[]');
        events.push({ event: event, data: data || {}, ts: Date.now(), ref: localStorage.getItem('pm_ref') || '' });
        if (events.length > 100) events = events.slice(-100);
        localStorage.setItem('pm_events', JSON.stringify(events));
        fetch(API + '/api/p2p-buy/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: event, data: data || {}, ref: localStorage.getItem('pm_ref') || '' })
        }).catch(function(){});
      } catch(e) {}
    }
    trackEvent('page_view');

    // Toast notification (replaces alert())
    function showToast(msg, type) {
      var existing = document.getElementById('toast');
      if (existing) existing.remove();
      var toast = document.createElement('div');
      toast.id = 'toast';
      toast.setAttribute('role', 'alert');
      toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);max-width:90%;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;text-align:center;' +
        (type === 'error' ? 'background:#ef4444;color:#fff' : 'background:var(--accent,#34d399);color:#fff');
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(function() { toast.remove(); }, 5000);
    }

    // Custom modal (replaces confirm())
    function showModal(title, message, onConfirm, onCancel) {
      var overlay = document.createElement('div');
      overlay.id = 'pmModal';
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';

      var box = document.createElement('div');
      box.style.cssText = 'background:var(--card,#1a1d27);border:1px solid var(--border,#2a2d3a);border-radius:12px;padding:24px;max-width:360px;width:100%;text-align:center';
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', title);

      box.innerHTML = '<div style="font-size:15px;font-weight:700;color:var(--text,#edf0f7);margin-bottom:8px">' + title + '</div>' +
        '<div style="font-size:12px;color:var(--text2,#c0c8d8);margin-bottom:20px;line-height:1.6">' + message + '</div>' +
        '<div style="display:flex;gap:8px;justify-content:center">' +
          '<button id="pmModalCancel" style="padding:8px 20px;background:var(--card2,#1e2538);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:12px;cursor:pointer">戻る</button>' +
          '<button id="pmModalConfirm" style="padding:8px 20px;background:#ef4444;border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:600;cursor:pointer">' + title + '</button>' +
        '</div>';

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      // Focus trap
      var confirmBtn = document.getElementById('pmModalConfirm');
      var cancelBtn = document.getElementById('pmModalCancel');
      confirmBtn.focus();

      function close() { overlay.remove(); }
      cancelBtn.onclick = function() { close(); if (onCancel) onCancel(); };
      confirmBtn.onclick = function() { close(); if (onConfirm) onConfirm(); };
      overlay.onclick = function(e) { if (e.target === overlay) { close(); if (onCancel) onCancel(); } };
      // Escape key
      document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', handler); if (onCancel) onCancel(); }
      });
    }

    // Debounced rate update for input handlers
    let rateDebounceTimer = null;
    function debouncedUpdateRate() {
      if (rateDebounceTimer) clearTimeout(rateDebounceTimer);
      rateDebounceTimer = setTimeout(updateRate, 400);
    }

    // Add amount hint element if not exists
    (function() {
      var amountInput = document.getElementById('amountInput');
      if (amountInput && !document.getElementById('amountHint')) {
        var hint = document.createElement('div');
        hint.id = 'amountHint';
        hint.style.cssText = 'font-size:10px;color:var(--text2);margin-top:2px';
        hint.textContent = '\u00a510,000\u301c\u00a510,000,000';
        amountInput.parentNode.insertBefore(hint, amountInput.nextSibling);
      }
    })();

    // localStorage state persistence
    function saveState() {
      if (buyerId && currentMatchId) {
        localStorage.setItem('pm_buyer', JSON.stringify({ buyerId: buyerId, buyerToken: buyerToken, matchId: currentMatchId, ts: Date.now() }));
      }
    }
    function clearState() {
      localStorage.removeItem('pm_buyer');
    }
    function restoreState() {
      try {
        var saved = JSON.parse(localStorage.getItem('pm_buyer') || 'null');
        if (!saved || !saved.buyerId) return;
        // Only restore if less than 30 minutes old
        if (Date.now() - saved.ts > 30 * 60 * 1000) { clearState(); return; }
        buyerId = saved.buyerId;
        buyerToken = saved.buyerToken || null;
        currentMatchId = saved.matchId;
        // Resume polling
        if (currentMatchId) {
          showPanel('panel-matched', 2);
          pollInterval = setInterval(function() { pollMatchStatus(currentMatchId); }, 10000);
          pollMatchStatus(currentMatchId);
        } else {
          showPanel('panel-waiting', 1);
          startPolling();
        }
      } catch(e) { clearState(); }
    }

    function showPanel(name, stepIdx) {
      panels.forEach(p => $(p).classList.add('hidden'));
      $(name).classList.remove('hidden');
      document.querySelectorAll('.step').forEach((s, i) => {
        s.classList.toggle('active', i === stepIdx);
      });
      // Focus management for accessibility
      var newPanel = document.getElementById(name);
      if (newPanel) {
        var focusTarget = newPanel.querySelector('.card-title, h2, [tabindex="-1"]');
        if (focusTarget) {
          focusTarget.setAttribute('tabindex', '-1');
          focusTarget.focus();
        }
        newPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    // Quick amount buttons (immediate updateRate, no debounce)
    document.querySelectorAll('[data-amt]').forEach(btn => {
      btn.onclick = function() {
        getEl('amountInput').value = this.getAttribute('data-amt');
        document.querySelectorAll('[data-amt]').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        updateRate();
        checkForm();
      };
    });

    getEl('amountInput').oninput = function() { debouncedUpdateRate(); checkForm(); trackEvent('form_start', { amount: this.value }); };
    getEl('walletInput').oninput = function() { checkForm(); };

    function checkForm() {
      const rawAmount = $('amountInput').value.replace(/[,、\s]/g, '');
      const amount = parseInt(rawAmount) || 0;
      const wallet = $('walletInput').value.trim();
      const amountOk = amount >= 10000 && amount <= 10000000;
      const walletOk = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet);
      $('btnSubmit').disabled = !(amountOk && walletOk);
      // Show validation hints
      $('amountInput').style.borderColor = (!rawAmount || amountOk) ? '' : '#ef4444';
      $('walletInput').style.borderColor = (!wallet || walletOk) ? '' : '#ef4444';

      // Show/hide validation messages
      var amountHint = document.getElementById('amountHint');
      var walletHint = document.getElementById('walletHint');
      if (amountHint) {
        if (rawAmount && !amountOk) {
          amountHint.textContent = amount < 10000 ? '最低金額: \u00a510,000' : '最大金額: \u00a510,000,000';
          amountHint.style.color = '#ef4444';
        } else {
          amountHint.textContent = '\u00a510,000\u301c\u00a510,000,000';
          amountHint.style.color = '';
        }
      }
      if (walletHint) {
        if (wallet && !walletOk) {
          walletHint.textContent = (typeof t === 'function' ? t('p2p_wallet_hint_error') : null) || 'Tで始まる34文字のTRONアドレスを入力してください';
          walletHint.style.color = '#ef4444';
        } else {
          walletHint.textContent = (typeof t === 'function' ? t('p2p_wallet_hint') : null) || 'Tで始まる34文字のTRONアドレス';
          walletHint.style.color = '';
        }
      }
    }

    async function updateRate() {
      const amount = parseInt($('amountInput').value.replace(/[,、\s]/g, '')) || 0;
      if (!amount || amount < 1000) { $('rateBox').classList.add('hidden'); return; }
      try {
        const res = await fetch(API + '/api/rates/USDT');
        const data = await res.json();
        if (data.success && data.data?.bestBuyExchange?.price) {
          const rate = data.data.bestBuyExchange.price;
          $('rateDisplay').textContent = '\u00a5' + rate.toFixed(2);
          $('usdtDisplay').textContent = (amount / rate).toFixed(2) + ' USDT';
          $('rateBox').classList.remove('hidden');
        }
      } catch(e) {
        console.warn('Rate fetch failed:', e);
        var rateBox = document.getElementById('rateBox');
        if (rateBox) rateBox.style.display = 'none';
        showToast('レートの取得に失敗しました。再試行中...', 'error');
      }
    }

    // Submit
    $('btnSubmit').addEventListener('click', async () => {
      const amount = parseInt($('amountInput').value.replace(/[,、\s]/g, '')) || 0;
      const wallet = $('walletInput').value.trim();
      $('btnSubmit').disabled = true;
      $('btnSubmit').textContent = '送信中...';
      trackEvent('submit', { amount: amount });

      try {
        const res = await fetch(API + '/api/p2p-buy/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: wallet, minAmountJpy: 0, maxAmountJpy: amount, refCode: localStorage.getItem('pm_ref') || '' }),
        });
        const data = await res.json();
        if (data.success) {
          buyerId = data.buyerId;
          buyerToken = data.buyerToken || null;
          localStorage.setItem('pm_wallet', document.getElementById('walletInput').value);
          saveState();
          $('waitingBuyerId').textContent = 'ID: ' + buyerId;
          showPanel('panel-waiting', 1);
          startPolling();
        } else {
          showToast(data.error || 'エラーが発生しました', 'error');
          $('btnSubmit').disabled = false;
          $('btnSubmit').textContent = 'マッチング開始';
        }
      } catch (e) {
        showToast('ネットワークエラー。再度お試しください。', 'error');
        $('btnSubmit').disabled = false;
        $('btnSubmit').textContent = 'マッチング開始';
      }
    });

    // Cancel
    $('btnCancel').addEventListener('click', function() {
      showModal('キャンセル', 'マッチングをキャンセルしますか？<br><br>※ 既に振込済みの場合、返金処理が必要になります。', function() {
        // onConfirm: execute cancel logic
        if (buyerId) {
          fetch(API + '/api/p2p-buy/cancel/' + buyerId, { method: 'DELETE' }).catch(function(){});
        }
        stopPolling();
        buyerId = null;
        buyerToken = null;
        clearState();
        showPanel('panel-input', 0);
        $('btnSubmit').disabled = false;
        $('btnSubmit').textContent = 'マッチング開始';
      });
      return; // prevent immediate execution
    });

    // Poll for match (exponential backoff: 5s → 10s → 20s → 30s cap)
    var basePollMs = 5000;
    function getPollInterval() {
      if (pollFailCount <= 0) return basePollMs;
      return Math.min(basePollMs * Math.pow(2, pollFailCount), 30000);
    }
    function startPolling() {
      pollFailCount = 0;
      scheduleNextPoll();
      checkMatch();
    }
    function scheduleNextPoll() {
      if (pollInterval) clearTimeout(pollInterval);
      pollInterval = setTimeout(function() { checkMatch(); scheduleNextPoll(); }, getPollInterval());
    }
    function stopPolling() {
      if (pollInterval) { clearTimeout(pollInterval); pollInterval = null; }
    }

    async function checkMatch() {
      if (!buyerId) return;
      try {
        const res = await fetch(API + '/api/p2p-buy/match/' + buyerId);
        const data = await res.json();
        if (!data.success) return;
        pollFailCount = 0;

        if (data.status === 'waiting_transfer' && data.match && data.bankInfo) {
          stopPolling();
          currentMatchId = data.match.id;
          saveState();
          showMatchInfo(data.match, data.bankInfo);
          showPanel('panel-matched', 2);
          trackEvent('match_found', { matchId: data.match.id });
          startTimer(data.match.timeoutAt);
          // Continue polling for status changes
          // Continue polling with backoff for status changes
          basePollMs = 10000;
          pollFailCount = 0;
          scheduleNextPoll();
          (function pollStatus() { pollMatchStatus(data.match.id); })();
        } else if (data.status === 'usdt_sent' || data.status === 'completed') {
          stopPolling();
          showComplete(data.match);
        }
      } catch(e) {
        pollFailCount++;
        console.warn('Match check failed, attempt', pollFailCount);
        if (pollFailCount >= 3) {
          showToast('接続が不安定です。自動的に再試行しています...', 'error');
        }
      }
    }

    function showMatchInfo(match, bank) {
      $('bankName').textContent = bank.bankName;
      $('branchName').textContent = bank.branchName || '-';
      $('accountNumber').textContent = bank.accountNumber;
      $('accountName').textContent = bank.accountName;
      $('transferAmount').textContent = '\u00a5' + match.amountJpy.toLocaleString();
      $('matchUsdt').textContent = match.amountUsdt.toFixed(2) + ' USDT';
      $('matchRate').textContent = '\u00a5' + match.rate.toFixed(2);
      // withdrawalId removed from buyer view
    }

    function startTimer(timeoutAt) {
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        const remaining = timeoutAt - Date.now();
        if (remaining <= 0) {
          $('timerDisplay').textContent = 'EXPIRED';
          $('timerDisplay').style.color = 'var(--danger)';
          clearInterval(timerInterval);
          // Show recovery options
          var recoveryDiv = document.createElement('div');
          recoveryDiv.style.cssText = 'text-align:center;margin-top:12px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px';
          recoveryDiv.innerHTML = '<p style="font-size:12px;color:var(--text2);margin-bottom:8px">制限時間を超過しました</p>' +
            '<p style="font-size:11px;color:var(--text2);margin-bottom:12px">振込済みの場合はサポートにお問い合わせください。<br>未振込の場合は再度お申し込みください。</p>' +
            '<button onclick="location.reload()" style="padding:8px 20px;background:var(--accent,#34d399);color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">再度申し込む</button>';
          var matchedPanel = document.getElementById('panel-matched');
          if (matchedPanel) matchedPanel.appendChild(recoveryDiv);
          return;
        }
        const min = Math.floor(remaining / 60000);
        const sec = Math.floor((remaining % 60000) / 1000);
        $('timerDisplay').textContent = min + ':' + String(sec).padStart(2, '0');
      }, 1000);
    }

    async function pollMatchStatus(matchId) {
      if (!buyerId) return;
      try {
        const res = await fetch(API + '/api/p2p-buy/match/' + buyerId);
        const data = await res.json();
        if (!data.success || !data.match) return;
        if (data.match.status === 'usdt_sent' || data.match.status === 'completed') {
          stopPolling();
          if (timerInterval) clearInterval(timerInterval);
          showComplete(data.match);
        } else if (data.match.status === 'buyer_paid') {
          getEl('matchStatusBadge').textContent = '振込報告済み';
          getEl('matchStatusBadge').className = 'status-badge status-waiting';
          getEl('btnPaid').disabled = true;
          getEl('btnPaid').textContent = '着金確認待ち...';
        } else if (data.match.status === 'transfer_confirmed') {
          getEl('matchStatusBadge').textContent = '着金確認済み';
          getEl('matchStatusBadge').className = 'status-badge status-confirmed';
          getEl('btnPaid').disabled = true;
          getEl('btnPaid').textContent = 'USDT送金中...';
        }
      } catch(e) { console.warn('Status poll failed'); }
    }

    // Proof image preview
    getEl('proofInput').onchange = function() {
      var file = this.files[0];
      if (file) {
        var reader = new FileReader();
        reader.onload = function(e) {
          getEl('proofImg').src = e.target.result;
          getEl('proofPreview').style.display = 'block';
        };
        reader.readAsDataURL(file);
      } else {
        getEl('proofPreview').style.display = 'none';
      }
    };

    // Report paid (proof image required)
    getEl('btnPaid').onclick = async function() {
      if (!currentMatchId) return;
      var proofFile = getEl('proofInput').files[0];
      if (!proofFile) {
        showToast('振込明細のスクリーンショットを添付してください', 'error');
        getEl('proofInput').style.borderColor = '#ef4444';
        return;
      }
      getEl('btnPaid').disabled = true;
      getEl('btnPaid').textContent = 'AI解析中...';
      try {
        var ref = getEl('refInput').value.trim() || '';
        var formData = new FormData();
        formData.append('referenceNumber', ref);
        formData.append('buyerId', buyerId || '');
        formData.append('buyerToken', buyerToken || '');
        formData.append('proof', proofFile);

        var res = await fetch(API + '/api/p2p-buy/paid/' + currentMatchId, {
          method: 'POST',
          body: formData,
        });
        var data = await res.json();
        if (data.success) {
          trackEvent('paid_reported');
          getEl('matchStatusBadge').textContent = '振込報告済み・AI解析中';
          getEl('matchStatusBadge').className = 'status-badge status-waiting';
          getEl('btnPaid').textContent = '着金確認待ち...';
        } else {
          showToast(data.error || '確認に失敗しました', 'error');
          getEl('btnPaid').disabled = false;
          getEl('btnPaid').textContent = '振込完了を報告';
        }
      } catch(e) {
        showToast('ネットワークエラー。再度お試しください。', 'error');
        getEl('btnPaid').disabled = false;
        getEl('btnPaid').textContent = '振込完了を報告';
      }
    };

    function showComplete(match) {
      clearState();
      $('completeUsdt').textContent = match.amountUsdt.toFixed(2) + ' USDT';
      $('completeTx').textContent = match.txHash || '-';
      showPanel('panel-complete', 3);

      trackEvent('completed', { usdt: match.amountUsdt });

      // Save to transaction history
      (function() {
        try {
          var txHash = match.txHash || '';
          var history = JSON.parse(localStorage.getItem('pm_history') || '[]');
          history.unshift({
            date: new Date().toISOString(),
            amountJpy: document.getElementById('matchAmount')?.textContent || '',
            amountUsdt: document.getElementById('matchUsdt')?.textContent || '',
            rate: document.getElementById('matchRate')?.textContent || '',
            txHash: txHash
          });
          if (history.length > 20) history = history.slice(0, 20);
          localStorage.setItem('pm_history', JSON.stringify(history));
        } catch(e) {}
      })();

      // Push notification on completion
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('PayMatch', { body: 'USDT送金が完了しました！', icon: '/icon-192.svg' });
      }

      // Social share + referral
      var shareDiv = document.createElement('div');
      shareDiv.style.cssText = 'margin-top:16px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;text-align:center';

      var shareText = 'PayMatchでUSDTを最安レートで購入しました！銀行振込だけでOK。';
      var shareUrl = window.location.origin + '/buy-usdt.html';

      // Generate referral link if we have buyerId
      var refShareUrl = shareUrl;
      if (buyerId) {
        fetch(API + '/api/p2p-buy/referral/generate', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({referrerId: buyerId, type: 'web'})
        }).then(function(r){return r.json()}).then(function(d){
          if (d.success && d.shareUrl) {
            refShareUrl = d.shareUrl;
            var refLink = shareDiv.querySelector('#refLink');
            if (refLink) refLink.textContent = d.shareUrl;
            var refCode = shareDiv.querySelector('#refCodeDisplay');
            if (refCode) refCode.textContent = d.code;
          }
        }).catch(function(){});
      }

      shareDiv.innerHTML =
        '<div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--accent)">友達に紹介して報酬を獲得</div>' +
        '<div id="refCodeDisplay" style="font-size:11px;color:var(--text2);margin-bottom:8px">コード生成中...</div>' +
        '<div id="refLink" style="font-size:10px;color:var(--dim);word-break:break-all;margin-bottom:10px">' + shareUrl + '</div>' +
        '<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">' +
          '<button onclick="navigator.clipboard.writeText(document.getElementById(\'refLink\').textContent).then(function(){this.textContent=\'Copied!\';setTimeout(function(){this.textContent=\'リンクをコピー\'},2000)}.bind(this))" style="padding:6px 14px;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;cursor:pointer">リンクをコピー</button>' +
          '<a href="https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(shareUrl) + '" target="_blank" style="padding:6px 14px;background:#1DA1F2;color:#fff;border-radius:6px;font-size:11px;text-decoration:none">X/Twitter</a>' +
          '<a href="https://t.me/share/url?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(shareText) + '" target="_blank" style="padding:6px 14px;background:#0088cc;color:#fff;border-radius:6px;font-size:11px;text-decoration:none">Telegram</a>' +
        '</div>';

      var completePanel = document.getElementById('panel-complete');
      if (completePanel) completePanel.appendChild(shareDiv);
    }

    function copyText(id) {
      const text = $(id).textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = $(id).parentElement.querySelector('.copy-btn');
        if (btn) { btn.textContent = 'OK!'; setTimeout(() => btn.textContent = 'COPY', 1500); }
      });
    }

    // Copy button (CSP-safe)
    var copyBtn = document.getElementById('copyBtn');
    if (copyBtn) copyBtn.addEventListener('click', function() { copyText('accountNumber'); });

    // Buy again button (CSP-safe)
    var buyAgainBtn = document.getElementById('btnBuyAgain');
    if (buyAgainBtn) buyAgainBtn.addEventListener('click', function() { location.reload(); });

    // Social proof counter
    (function() {
      fetch(API + '/api/rates/USDT').then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
          var el = document.getElementById('socialProof');
          if (el) el.textContent = '3取引所のリアルタイムレートを比較中';
        }
      }).catch(function(){});
    })();

    // A/B test: CTA button text
    (function() {
      var variant = localStorage.getItem('pm_ab_buy') || (Math.random() > 0.5 ? 'A' : 'B');
      localStorage.setItem('pm_ab_buy', variant);
      var btn = document.getElementById('btnSubmit');
      if (btn && variant === 'B') {
        btn.textContent = '最安レートで購入する';
        btn.style.fontSize = '14px';
      }
      trackEvent('ab_variant', { variant: variant, page: 'buy-usdt' });
    })();

    // Show transaction history if available
    (function() {
      var history = JSON.parse(localStorage.getItem('pm_history') || '[]');
      if (history.length > 0) {
        var link = document.createElement('div');
        link.style.cssText = 'text-align:center;margin-top:8px;font-size:10px';
        link.innerHTML = '<a href="#" id="showHistoryLink" style="color:var(--dim);text-decoration:none">過去の取引 (' + history.length + '件)</a>';
        var container = document.querySelector('.container');
        if (container) container.insertBefore(link, container.querySelector('.step-indicator'));
        var histLink = document.getElementById('showHistoryLink');
        if (histLink) histLink.addEventListener('click', function(e) { e.preventDefault(); showHistory(); });
      }
    })();

    function showHistory() {
      var history = JSON.parse(localStorage.getItem('pm_history') || '[]');
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
      var box = document.createElement('div');
      box.style.cssText = 'background:var(--card,#1a1d27);border-radius:12px;padding:20px;max-width:400px;width:100%;max-height:80vh;overflow-y:auto';
      var html = '<div style="font-size:14px;font-weight:700;margin-bottom:12px">取引履歴</div>';
      history.forEach(function(tx) {
        html += '<div style="border-bottom:1px solid var(--border,#2a2d3a);padding:8px 0;font-size:11px">' +
          '<div style="color:var(--dim)">' + new Date(tx.date).toLocaleDateString('ja-JP') + '</div>' +
          '<div>' + (tx.amountJpy || '') + ' → ' + (tx.amountUsdt || '') + '</div>' +
          (tx.txHash ? '<div style="font-size:9px;color:var(--dim);word-break:break-all">TX: ' + tx.txHash + '</div>' : '') +
        '</div>';
      });
      html += '<button id="closeHistoryBtn" style="width:100%;margin-top:12px;padding:8px;background:var(--card2,#1e2538);border:1px solid var(--border);border-radius:6px;color:var(--text);cursor:pointer">閉じる</button>';
      box.innerHTML = html;
      overlay.appendChild(box);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
      var closeBtn = document.getElementById('closeHistoryBtn');
      if (closeBtn) closeBtn.addEventListener('click', function() { overlay.remove(); });
    }

    // Restore state from localStorage on load
    restoreState();
