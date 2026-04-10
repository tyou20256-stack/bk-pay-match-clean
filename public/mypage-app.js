// mypage-app.js — Mypage logic (extracted from mypage.html)
document.addEventListener('DOMContentLoaded', function() {

var tgApp = window.Telegram && window.Telegram.WebApp;
if (tgApp) {
  tgApp.ready();
  tgApp.expand();
  var tc = tgApp.themeParams;
  if (tc) {
    if (tc.bg_color) document.documentElement.style.setProperty('--bg', tc.bg_color);
    if (tc.secondary_bg_color) document.documentElement.style.setProperty('--secondary-bg', tc.secondary_bg_color);
    if (tc.text_color) document.documentElement.style.setProperty('--text', tc.text_color);
    if (tc.hint_color) document.documentElement.style.setProperty('--hint', tc.hint_color);
    if (tc.button_color) document.documentElement.style.setProperty('--btn', tc.button_color);
    if (tc.button_text_color) document.documentElement.style.setProperty('--btn-text', tc.button_text_color);
  }
}

var TIERS = [
  { name: 'Bronze', nameJa: '\u30d6\u30ed\u30f3\u30ba', min: 0, discount: '\u6a19\u6e96', cls: 'bronze' },
  { name: 'Silver', nameJa: '\u30b7\u30eb\u30d0\u30fc', min: 1000000, discount: '-0.3%', cls: 'silver' },
  { name: 'Gold', nameJa: '\u30b4\u30fc\u30eb\u30c9', min: 5000000, discount: '-0.5%', cls: 'gold' },
  { name: 'Platinum', nameJa: '\u30d7\u30e9\u30c1\u30ca', min: 20000000, discount: '-1.0%', cls: 'platinum' },
];

function formatJpy(n) {
  if (n >= 10000) return '\u00a5' + (n / 10000).toFixed(n % 10000 === 0 ? 0 : 1) + '\u4e07';
  return '\u00a5' + n.toLocaleString();
}
function getTelegramId() { try { return tgApp && tgApp.initDataUnsafe && tgApp.initDataUnsafe.user && tgApp.initDataUnsafe.user.id; } catch(e) { return null; } }
function getCurrentTier(v) { var t = TIERS[0]; for (var i = 0; i < TIERS.length; i++) { if (v >= TIERS[i].min) t = TIERS[i]; } return t; }
function getNextTier(v) { for (var i = 0; i < TIERS.length; i++) { if (v < TIERS[i].min) return TIERS[i]; } return null; }

function renderTiers(cur) {
  var el = document.getElementById('tierList');
  el.innerHTML = TIERS.map(function(t) {
    var ic = t.name === cur;
    return '<div class="tier-row' + (ic ? ' current' : '') + '">' +
      '<span class="tier-name ' + t.cls + '">' + t.nameJa + (ic ? '<span class="tier-current-badge">\u73fe\u5728</span>' : '') + '</span>' +
      '<span class="tier-req">' + (t.min === 0 ? '\u00a50~' : '\u00a5' + (t.min/10000) + '\u4e07~') + '</span>' +
      '<span class="tier-benefit">' + t.discount + '</span></div>';
  }).join('');
}

function renderTransactions(txs) {
  var el = document.getElementById('txList');
  if (!txs || !txs.length) { el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--hint);font-size:12px">\u53d6\u5f15\u5c65\u6b74\u304c\u3042\u308a\u307e\u305b\u3093</div>'; return; }
  el.innerHTML = txs.slice(0, 10).map(function(tx) {
    var d = new Date(tx.date || tx.createdAt);
    var ds = (d.getMonth()+1) + '/' + d.getDate();
    var sc = tx.status === 'completed' ? 'completed' : tx.status === 'cancelled' ? 'cancelled' : 'pending';
    var sl = tx.status === 'completed' ? '\u5b8c\u4e86' : tx.status === 'cancelled' ? '\u53d6\u6d88' : '\u51e6\u7406\u4e2d';
    return '<div class="tx-item"><span class="tx-date">' + ds + '</span><span class="tx-detail">\u00a5' + Number(tx.amount).toLocaleString() + ' \u2192 ' + tx.cryptoAmount + ' ' + (tx.crypto||'USDT') + '</span><span class="tx-status ' + sc + '">' + sl + '</span></div>';
  }).join('');
}

function renderData(data) {
  var s = data.stats || data;
  var user = tgApp && tgApp.initDataUnsafe && tgApp.initDataUnsafe.user;
  if (user) document.getElementById('userName').textContent = (user.first_name || '') + ' ' + (user.last_name || '');

  var totalVolume = s.totalVolume || 0;
  var tier = getCurrentTier(totalVolume);
  var next = getNextTier(totalVolume);
  var rankEl = document.getElementById('vipRankName');
  rankEl.textContent = tier.nameJa;
  rankEl.className = 'vip-rank-name ' + tier.cls;

  var pct = 100;
  if (next) pct = Math.min(100, Math.round((totalVolume - tier.min) / (next.min - tier.min) * 100));
  document.getElementById('vipPercent').textContent = pct + '%';
  document.getElementById('totalVolume').textContent = formatJpy(totalVolume);
  document.getElementById('nextRankAmount').textContent = next ? formatJpy(next.min) : '\u6700\u9ad8\u30e9\u30f3\u30af';
  requestAnimationFrame(function() { document.getElementById('progressBar').style.width = pct + '%'; });

  document.getElementById('totalTrades').textContent = (s.totalTrades || 0) + '\u56de';
  document.getElementById('monthVolume').textContent = formatJpy(s.monthVolume || 0);
  document.getElementById('discountRate').textContent = s.discountRate || tier.discount;
  document.getElementById('referralCount').textContent = (s.referralCount || 0) + '\u4eba';
  renderTransactions(s.recentTransactions || []);
  document.getElementById('referralCode').textContent = s.referralCode || '---';
  document.getElementById('referralReward').textContent = formatJpy(s.referralReward || 0);
  renderTiers(tier.name);

  document.getElementById('loading').style.display = 'none';
  document.getElementById('content').style.display = 'block';
}

function showDemo() {
  renderData({ stats: { totalVolume: 8500000, totalTrades: 42, monthVolume: 1200000, discountRate: '-0.5%', referralCount: 5, referralCode: 'BK-DEMO01', referralReward: 12500, recentTransactions: [
    { date: '2026-03-01', amount: 50000, cryptoAmount: '322.58', crypto: 'USDT', status: 'completed' },
    { date: '2026-03-01', amount: 10000, cryptoAmount: '64.52', crypto: 'USDT', status: 'completed' },
    { date: '2026-02-28', amount: 30000, cryptoAmount: '193.55', crypto: 'USDT', status: 'completed' },
  ]}});
}

async function loadData() {
  document.getElementById('loading').style.display = 'block';
  document.getElementById('content').style.display = 'none';
  document.getElementById('errorState').style.display = 'none';
  var tid = getTelegramId();
  if (!tid) { showDemo(); return; }
  try {
    var res = await fetch('/api/customer/' + tid + '/stats');
    if (!res.ok) throw new Error('API error');
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    renderData(data);
  } catch(e) {
    console.error('Load error:', e);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
  }
}

function copyReferral() {
  var code = document.getElementById('referralCode').textContent;
  if (!code || code === '---') return;
  navigator.clipboard.writeText(code).then(function() {
    if (tgApp && tgApp.HapticFeedback) tgApp.HapticFeedback.notificationOccurred('success');
    var btn = document.getElementById('copyReferralBtn');
    btn.textContent = '\u30b3\u30d4\u30fc\u6e08';
    setTimeout(function() { btn.textContent = '\u30b3\u30d4\u30fc'; }, 2000);
  });
}

// Bind inline handler replacements
document.getElementById('copyReferralBtn').addEventListener('click', copyReferral);
document.getElementById('retryBtn').addEventListener('click', loadData);

// Pull-to-refresh
var ptrStartY = 0, ptrActive = false;
document.addEventListener('touchstart', function(e) { if (window.scrollY === 0) ptrStartY = e.touches[0].clientY; });
document.addEventListener('touchmove', function(e) {
  if (ptrStartY && e.touches[0].clientY - ptrStartY > 80 && window.scrollY === 0) {
    document.getElementById('ptrIndicator').classList.add('active'); ptrActive = true;
  }
});
document.addEventListener('touchend', function() {
  if (ptrActive) { document.getElementById('ptrIndicator').classList.remove('active'); ptrActive = false; loadData(); }
  ptrStartY = 0;
});

loadData();
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(function() {}); }

}); // end DOMContentLoaded
