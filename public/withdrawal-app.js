var token = new URLSearchParams(location.search).get('token');
if (!token) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('error').style.display = 'block';
  document.getElementById('error').textContent = 'トークンが指定されていません';
} else {
  fetchStatus();
}

var pollTimer = null;

async function fetchStatus() {
  try {
    var r = await fetch('/api/withdrawals/by-token/' + encodeURIComponent(token));
    var d = await r.json();
    if (!d.success) {
      document.getElementById('loading').style.display = 'none';
      document.getElementById('error').style.display = 'block';
      document.getElementById('error').textContent = '出金リクエストが見つかりません';
      return;
    }
    render(d.withdrawal);
    if (['pending', 'matched'].includes(d.withdrawal.status)) {
      if (!pollTimer) pollTimer = setInterval(fetchStatus, 10000);
    } else {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
  } catch (e) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').textContent = '通信エラーが発生しました';
  }
}

function render(w) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'block';

  document.getElementById('wdAmount').textContent = '\u00a5' + Number(w.amount).toLocaleString();

  var statusMap = {
    pending: ['受付中', 'pending'],
    matched: ['マッチ済', 'matched'],
    completed: ['完了', 'completed'],
    cancelled: ['キャンセル', 'cancelled'],
    expired: ['期限切れ', 'expired'],
  };
  var s = statusMap[w.status] || [w.status, 'expired'];
  document.getElementById('wdStatus').innerHTML = '<span class="status-badge status-' + s[1] + '">' + s[0] + '</span>';

  var methodMap = { bank: '銀行振込', paypay: 'PayPay' };
  document.getElementById('wdMethod').textContent = methodMap[w.payMethod] || w.payMethod;
  document.getElementById('wdCreated').textContent = fmtDate(w.createdAt);
  document.getElementById('wdExpires').textContent = fmtDate(w.expiresAt);

  if (w.completedAt) {
    document.getElementById('rowCompleted').style.display = 'flex';
    document.getElementById('wdCompleted').textContent = fmtDate(w.completedAt);
  }

  var stepDefs = [
    { label: '出金リクエスト受付', done: true },
    { label: 'バイヤーとマッチング', done: ['matched','completed'].includes(w.status) },
    { label: 'JPY振込完了', done: w.status === 'completed' },
    { label: '完了', done: w.status === 'completed' },
  ];
  if (w.status === 'cancelled' || w.status === 'expired') {
    stepDefs = [{ label: w.status === 'cancelled' ? 'キャンセル済み' : '期限切れ', done: true }];
  }
  var html = '';
  var activeFound = false;
  for (var i = 0; i < stepDefs.length; i++) {
    var isDone = stepDefs[i].done;
    var isActive = !isDone && !activeFound;
    if (isActive) activeFound = true;
    var dotClass = isDone ? 'done' : (isActive ? 'active' : '');
    var labelClass = isDone || isActive ? 'active' : '';
    var icon = isDone ? '\u2713' : (i + 1);
    html += '<div class="step"><div class="step-dot ' + dotClass + '">' + icon + '</div><span class="step-label ' + labelClass + '">' + stepDefs[i].label + '</span></div>';
  }
  document.getElementById('steps').innerHTML = html;
}

function fmtDate(ts) {
  if (!ts) return '-';
  var d = new Date(ts);
  return d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
