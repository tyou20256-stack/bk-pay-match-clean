async function doRegister() {
  var name = document.getElementById('name').value.trim();
  var email = document.getElementById('email').value.trim();
  var password = document.getElementById('password').value;
  var paypayId = document.getElementById('paypayId').value.trim() || undefined;
  var linepayId = document.getElementById('linepayId').value.trim() || undefined;
  var aupayId = document.getElementById('aupayId').value.trim() || undefined;
  var minAmount = parseInt(document.getElementById('minAmount').value) || 1000;
  var maxAmount = parseInt(document.getElementById('maxAmount').value) || 500000;

  if (!name || !email || !password) { showMsg('error', '名前・メール・パスワードは必須です'); return; }
  if (password.length < 8) { showMsg('error', 'パスワードは8文字以上で設定してください'); return; }
  if (!paypayId && !linepayId && !aupayId) { showMsg('error', 'PayPay・LINE Pay・au PAY のいずれか1つを入力してください'); return; }

  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>送信中...';

  try {
    var payMethods = [];
    if (paypayId) payMethods.push('paypay');
    if (linepayId) payMethods.push('linepay');
    if (aupayId) payMethods.push('aupay');

    var res = await fetch('/api/p2p/sellers/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, email: email, password: password, paypayId: paypayId, linepayId: linepayId, aupayId: aupayId, minAmount: minAmount, maxAmount: maxAmount, payMethods: payMethods })
    });
    var d = await res.json();

    if (d.success) {
      document.getElementById('formCard').innerHTML =
        '<div style="text-align:center;padding:24px 0">'
        + '<div style="font-size:48px;margin-bottom:16px">OK</div>'
        + '<div style="font-size:18px;font-weight:700;margin-bottom:8px">申請完了</div>'
        + '<div style="color:var(--dim);font-size:14px;line-height:1.7">'
        + '登録申請を受け付けました。<br>管理者の承認後にご利用いただけます。<br><br>'
        + '<a href="/seller-dashboard.html" style="color:var(--green);text-decoration:none">ダッシュボードへ →</a>'
        + '</div></div>';
    } else {
      showMsg('error', d.error || '登録に失敗しました');
      btn.disabled = false;
      btn.textContent = '登録申請する';
    }
  } catch (e) {
    showMsg('error', '通信エラーが発生しました');
    btn.disabled = false;
    btn.textContent = '登録申請する';
  }
}

function showMsg(type, text) {
  var el = document.getElementById('msg');
  el.className = 'msg msg-' + type;
  el.textContent = text;
  el.style.display = 'block';
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('submitBtn').addEventListener('click', function() { doRegister(); });
});
