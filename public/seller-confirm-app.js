var params = new URLSearchParams(location.search);
var orderId = params.get('orderId');
var token = params.get('token');

async function loadOrder() {
  if (!orderId || !token) return showError('URLが不正です');
  try {
    var res = await fetch('/api/p2p/orders/' + orderId + '?token=' + encodeURIComponent(token));
    var d = await res.json();
    if (!d.success) return showError(d.error || '注文を取得できませんでした');
    renderOrder(d.order);
  } catch(e) {
    showError('通信エラーが発生しました');
  }
}

var PAY_LABELS = { paypay: 'PayPay', linepay: 'LINE Pay', aupay: 'au PAY', bank: '銀行振込' };

function renderOrder(order) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('orderCard').style.display = 'block';
  document.getElementById('orderId').textContent = order.id;
  document.getElementById('orderAmount').textContent = '\u00a5' + Number(order.amount).toLocaleString();
  document.getElementById('orderCrypto').textContent = order.cryptoAmount + ' ' + order.crypto + ' を送金予定';
  document.getElementById('orderPayMethod').textContent = PAY_LABELS[order.payMethod] || order.payMethod;
  document.getElementById('orderPayId').textContent = order.payId || '-';
  document.getElementById('orderExpiry').textContent = new Date(order.expiresAt).toLocaleString('ja-JP');

  var statusEl = document.getElementById('orderStatus');
  if (order.status === 'confirming') {
    statusEl.textContent = '振込済み（確認待ち）';
    statusEl.className = 'status-badge status-confirming';
  } else if (order.status === 'completed') {
    statusEl.textContent = '完了';
    statusEl.className = 'status-badge status-completed';
    document.getElementById('confirmBtn').disabled = true;
    showMsg('この注文はすでに完了しています', 'success');
  } else {
    statusEl.textContent = order.status;
    statusEl.className = 'status-badge status-other';
    document.getElementById('confirmBtn').disabled = true;
  }
}

async function confirmPayment() {
  var btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>処理中...';
  try {
    var res = await fetch('/api/p2p/orders/' + orderId + '/confirm?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    var d = await res.json();
    if (d.success) {
      btn.style.display = 'none';
      var txInfo = d.txId ? '<div class="txid">TX: ' + d.txId + '</div>' : '';
      showMsg('入金確認完了！バイヤーへ USDT を自動送金しました。' + txInfo, 'success');
      document.getElementById('orderStatus').textContent = '完了';
      document.getElementById('orderStatus').className = 'status-badge status-completed';
    } else {
      btn.disabled = false;
      btn.textContent = '入金確認（USDT を送金する）';
      showMsg('エラー: ' + (d.error || '処理に失敗しました'), 'error');
    }
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '入金確認（USDT を送金する）';
    showMsg('通信エラーが発生しました', 'error');
  }
}

function showMsg(text, type) {
  var el = document.getElementById('msg');
  el.style.display = 'block';
  el.className = 'msg msg-' + type;
  el.innerHTML = text;
}

function showError(msg) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('errorCard').style.display = 'block';
  document.getElementById('errorMsg').textContent = msg;
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('confirmBtn').addEventListener('click', function() { confirmPayment(); });
});

loadOrder();
