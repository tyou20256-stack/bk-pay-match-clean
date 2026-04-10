/* ───── Seller Dashboard App (CSP-safe external JS) ───── */
document.addEventListener('DOMContentLoaded', function() {

  var TOKEN_KEY = 'seller_token';
  var sellerToken = localStorage.getItem(TOKEN_KEY);
  var sellerData = null;

  var statusLabel = {
    pending_payment: '支払待ち', confirming: '入金確認中',
    payment_verified: '入金確認済', sending_crypto: '送金中',
    completed: '完了', cancelled: 'キャンセル', expired: '期限切れ'
  };
  var statusClass = {
    completed: 'badge-completed', confirming: 'badge-confirming',
    pending_payment: 'badge-pending', payment_verified: 'badge-pending',
    sending_crypto: 'badge-pending', cancelled: 'badge-cancelled',
    expired: 'badge-expired'
  };

  async function doLogin() {
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;
    if (!email || !password) { showLoginMsg('メール・パスワードを入力してください'); return; }
    var btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>ログイン中...';
    try {
      var res = await fetch('/api/p2p/sellers/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      });
      var d = await res.json();
      if (d.success && d.token) {
        localStorage.setItem(TOKEN_KEY, d.token);
        sellerToken = d.token;
        showDashboard();
      } else {
        showLoginMsg(d.error || 'ログインに失敗しました');
        btn.disabled = false;
        btn.textContent = 'ログイン';
      }
    } catch (e) {
      showLoginMsg('通信エラーが発生しました');
      btn.disabled = false;
      btn.textContent = 'ログイン';
    }
  }

  function showLoginMsg(msg) {
    var el = document.getElementById('loginMsg');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function doLogout() {
    localStorage.removeItem(TOKEN_KEY);
    sellerToken = null;
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('loginView').style.display = 'flex';
  }

  async function showDashboard() {
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('dashboardView').style.display = 'block';
    await loadDashboard();
  }

  async function loadDashboard() {
    try {
      var res = await fetch('/api/p2p/sellers/me?token=' + encodeURIComponent(sellerToken));
      var d = await res.json();
      if (!d.success) { doLogout(); return; }
      sellerData = d.seller;
      var s = d.seller;
      document.getElementById('sellerName').textContent = s.name;
      var avail = ((s.usdtBalance || 0) - (s.usdtLocked || 0)).toFixed(2);
      document.getElementById('statAvail').textContent = avail;
      document.getElementById('statLocked').textContent = (s.usdtLocked || 0).toFixed(2);
      document.getElementById('statTrades').textContent = s.totalTrades || 0;
      var statusText = s.status === 'active' ? '✅ 有効'
        : s.status === 'pending' ? '⏳ 承認待ち'
        : '🚫 停止中';
      document.getElementById('statStatus').textContent = statusText;
      var baseUrl = location.origin + '/seller-confirm.html?orderId=ORDER_ID&token=' + s.confirmToken;
      document.getElementById('confirmUrlBox').textContent = baseUrl;
    } catch (e) {}

    try {
      var res2 = await fetch('/api/p2p/sellers/me/orders?token=' + encodeURIComponent(sellerToken));
      var d2 = await res2.json();
      var tbody = document.getElementById('ordersBody');
      if (!d2.success || !d2.orders || !d2.orders.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">取引履歴なし</td></tr>';
        return;
      }
      tbody.innerHTML = d2.orders.map(function(o) {
        var dt = new Date(o.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        var sc = statusClass[o.status] || 'badge-other';
        var sl = statusLabel[o.status] || o.status;
        return '<tr>'
          + '<td style="font-family:monospace;font-size:11px">' + escHtml(o.id) + '</td>'
          + '<td>¥' + (o.amount || 0).toLocaleString() + '</td>'
          + '<td>' + (o.cryptoAmount || 0) + ' USDT</td>'
          + '<td>' + escHtml(o.payMethod || '--') + '</td>'
          + '<td><span class="badge ' + sc + '">' + sl + '</span></td>'
          + '<td style="font-size:12px">' + dt + '</td>'
          + '</tr>';
      }).join('');
    } catch (e) {}
  }

  function copyConfirmUrl() {
    var url = document.getElementById('confirmUrlBox').textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function() {
        alert('確認 URL をコピーしました。\n※ ORDER_ID 部分を実際の注文 ID に置換してください。');
      }).catch(function() { prompt('URLをコピーしてください:', url); });
    } else {
      prompt('URLをコピーしてください:', url);
    }
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ───── Bind event listeners (replacing inline handlers) ───── */

  // Login password Enter key
  document.getElementById('loginPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });

  // Login button click
  document.getElementById('loginBtn').addEventListener('click', function() {
    doLogin();
  });

  // Logout button click
  document.getElementById('logoutBtn').addEventListener('click', function() {
    doLogout();
  });

  // Copy confirm URL button
  document.getElementById('copyUrlBtn').addEventListener('click', function() {
    copyConfirmUrl();
  });

  // Refresh dashboard button
  document.getElementById('refreshBtn').addEventListener('click', function() {
    loadDashboard();
  });

  // Init
  if (sellerToken) {
    showDashboard();
  }
});
