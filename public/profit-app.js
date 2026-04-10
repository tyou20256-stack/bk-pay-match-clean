// profit-app.js — Profit dashboard logic (extracted from profit.html)
document.addEventListener('DOMContentLoaded', function() {

const API = '/api';
let token = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('bkpay_token='))?.split('=')[1] || '';
if (!token) { token = localStorage.getItem('bkpay_token') || ''; }

const headers = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token });

// Charts
let hourlyChart, trendChart, cryptoPieChart;
let heatmapYear, heatmapMonth;

async function apiFetch(path) {
  const r = await fetch(API + path, { headers: headers(), credentials: 'include' });
  if (r.status === 401) { window.location.href = '/admin.html'; return null; }
  const j = await r.json();
  return j.success ? j.data : null;
}

function fmt(n) { return '\u00a5' + (n||0).toLocaleString(); }

async function loadAll() {
  const [summary, daily, trend] = await Promise.all([
    apiFetch('/profit/summary'),
    apiFetch('/profit/daily'),
    apiFetch('/profit/trend'),
  ]);
  if (!summary) return;

  const goal = summary.goal || 50000;
  const todayP = summary.today.totalProfit;
  const pct = goal > 0 ? Math.round((todayP / goal) * 100) : 0;

  document.getElementById('todayProfit').textContent = fmt(todayP);
  document.getElementById('goalPct').textContent = pct + '%';
  document.getElementById('todayOrders').textContent = summary.today.orderCount + '\u4ef6';
  document.getElementById('avgProfit').textContent = fmt(summary.today.avgProfitPerOrder);
  document.getElementById('goalInput').value = goal;

  // Gauge
  const clampPct = Math.min(pct, 100);
  const offset = 534 - (534 * clampPct / 100);
  const gaugeFill = document.getElementById('gaugeFill');
  gaugeFill.style.strokeDashoffset = offset;
  gaugeFill.style.stroke = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
  document.getElementById('gaugePct').textContent = pct + '%';
  document.getElementById('gaugeSub').textContent = fmt(todayP) + ' / ' + fmt(goal);

  // Hourly chart
  if (daily && daily.hourly) {
    const labels = daily.hourly.map(h => h.hour + ':00');
    const profits = daily.hourly.map(h => h.totalProfit);
    let cum = 0;
    const cumulative = daily.hourly.map(h => { cum += h.totalProfit; return cum; });

    if (hourlyChart) hourlyChart.destroy();
    hourlyChart = new Chart(document.getElementById('hourlyChart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: '\u6642\u9593\u5225\u5229\u76ca', data: profits, backgroundColor: 'rgba(52,211,153,.5)', borderColor: 'var(--green)', borderWidth: 1, order: 2 },
          { label: '\u7d2f\u8a08\u5229\u76ca', data: cumulative, type: 'line', borderColor: 'var(--blue)', borderWidth: 2, pointRadius: 0, fill: false, order: 1 },
        ]
      },
      options: { responsive: true, plugins: { legend: { labels: { color: 'var(--text2)', font: { size: 10 } } } }, scales: { x: { ticks: { color: 'var(--dim)', font: { size: 9 } }, grid: { color: 'var(--border)' } }, y: { ticks: { color: 'var(--dim)', callback: v => '\u00a5' + v.toLocaleString() }, grid: { color: 'var(--border)' } } } }
    });
  }

  // 7-day trend
  if (trend) {
    const labels = trend.map(d => d.date.slice(5));
    const profits = trend.map(d => d.totalProfit);
    const up = profits.length >= 2 && profits[profits.length-1] >= profits[profits.length-2];
    document.getElementById('trendArrow').innerHTML = up ? '&#9650;' : '&#9660;';
    document.getElementById('trendArrow').className = 'trend-arrow ' + (up ? 'trend-up' : 'trend-down');

    if (trendChart) trendChart.destroy();
    trendChart = new Chart(document.getElementById('trendChart'), {
      type: 'line',
      data: { labels, datasets: [{ label: '\u65e5\u6b21\u5229\u76ca', data: profits, borderColor: 'var(--green)', backgroundColor: 'rgba(52,211,153,.1)', fill: true, tension: .3, pointRadius: 4, pointBackgroundColor: 'var(--green)' }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: 'var(--dim)' }, grid: { color: 'var(--border)' } }, y: { ticks: { color: 'var(--dim)', callback: v => '\u00a5' + v.toLocaleString() }, grid: { color: 'var(--border)' } } } }
    });
  }

  // Crypto pie
  const byCrypto = summary.byCrypto || [];
  if (cryptoPieChart) cryptoPieChart.destroy();
  const pieColors = ['var(--green)', 'var(--blue)', 'var(--purple)', 'var(--yellow)', 'var(--red)'];
  cryptoPieChart = new Chart(document.getElementById('cryptoPie'), {
    type: 'doughnut',
    data: {
      labels: byCrypto.length ? byCrypto.map(c => c.crypto) : ['\u30c7\u30fc\u30bf\u306a\u3057'],
      datasets: [{ data: byCrypto.length ? byCrypto.map(c => c.totalProfit) : [1], backgroundColor: byCrypto.length ? pieColors.slice(0, byCrypto.length) : ['var(--border)'] }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: 'var(--text2)', font: { size: 11 } } } } }
  });

  // Breakdown table
  const body = document.getElementById('breakdownBody');
  body.innerHTML = [
    { label: '\u672c\u65e5', d: summary.today },
    { label: '\u4eca\u9031', d: summary.thisWeek },
    { label: '\u4eca\u6708', d: summary.thisMonth },
    { label: '\u5168\u671f\u9593', d: summary.allTime },
  ].map(function(r) { return '<tr><td>' + r.label + '</td><td>' + fmt(r.d.spreadProfit) + '</td><td>' + fmt(r.d.feeProfit) + '</td><td style="font-weight:700">' + fmt(r.d.totalProfit) + '</td></tr>'; }).join('');
}

// Heatmap
async function loadHeatmap() {
  const data = await apiFetch('/profit/monthly?year=' + heatmapYear + '&month=' + heatmapMonth);
  document.getElementById('heatmapMonth').textContent = heatmapYear + '/' + String(heatmapMonth).padStart(2,'0');
  const el = document.getElementById('heatmap');
  const daysInMonth = new Date(heatmapYear, heatmapMonth, 0).getDate();
  const firstDow = new Date(heatmapYear, heatmapMonth - 1, 1).getDay();
  const profitMap = {};
  let maxP = 1;
  (data || []).forEach(d => { profitMap[d.date] = d.totalProfit; if (d.totalProfit > maxP) maxP = d.totalProfit; });

  const dayNames = ['\u65e5','\u6708','\u706b','\u6c34','\u6728','\u91d1','\u571f'];
  let html = dayNames.map(function(d) { return '<div class="heatmap-header">' + d + '</div>'; }).join('');
  for (let i = 0; i < firstDow; i++) html += '<div class="heatmap-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = heatmapYear + '-' + String(heatmapMonth).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const p = profitMap[dateStr] || 0;
    const intensity = p > 0 ? Math.max(0.15, Math.min(1, p / maxP)) : 0;
    const bg = p > 0 ? 'rgba(52,211,153,' + intensity + ')' : (p < 0 ? 'rgba(248,113,113,' + Math.max(0.15, Math.min(1, Math.abs(p)/maxP)) + ')' : 'var(--bg2)');
    html += '<div class="heatmap-cell" style="background:' + bg + '" data-date="' + dateStr + '" data-profit="' + p + '">' + d + '</div>';
  }
  el.innerHTML = html;
}

function changeMonth(delta) {
  heatmapMonth += delta;
  if (heatmapMonth > 12) { heatmapMonth = 1; heatmapYear++; }
  if (heatmapMonth < 1) { heatmapMonth = 12; heatmapYear--; }
  loadHeatmap();
}

function showTip(e, el) {
  const tip = document.getElementById('tooltip');
  tip.textContent = el.dataset.date + ': ' + fmt(parseInt(el.dataset.profit));
  tip.style.display = 'block';
  tip.style.left = e.clientX + 12 + 'px';
  tip.style.top = e.clientY - 30 + 'px';
}
function hideTip() { document.getElementById('tooltip').style.display = 'none'; }

// Event delegation for heatmap tooltip (replaces inline onmouseenter/onmouseleave)
const heatmapEl = document.getElementById('heatmap');
heatmapEl.addEventListener('mouseenter', function(e) {
  const cell = e.target.closest('.heatmap-cell');
  if (cell && cell.dataset.date) showTip(e, cell);
}, true);
heatmapEl.addEventListener('mouseleave', function(e) {
  const cell = e.target.closest('.heatmap-cell');
  if (cell && cell.dataset.date) hideTip();
}, true);
heatmapEl.addEventListener('mousemove', function(e) {
  const cell = e.target.closest('.heatmap-cell');
  if (cell && cell.dataset.date) {
    const tip = document.getElementById('tooltip');
    tip.style.left = e.clientX + 12 + 'px';
    tip.style.top = e.clientY - 30 + 'px';
  }
}, true);

async function saveGoal() {
  const amount = parseInt(document.getElementById('goalInput').value);
  if (!amount || amount <= 0) return;
  await fetch(API + '/profit/goal', { method: 'POST', headers: headers(), credentials: 'include', body: JSON.stringify({ amount }) });
  loadAll();
}

function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  document.getElementById('themeBtn').textContent = next === 'dark' ? 'D' : 'L';
  localStorage.setItem('theme', next);
}

// Bind event listeners (replaces inline onclick handlers)
document.getElementById('themeBtn').addEventListener('click', toggleTheme);
document.getElementById('saveGoalBtn').addEventListener('click', saveGoal);
document.getElementById('prevMonthBtn').addEventListener('click', function() { changeMonth(-1); });
document.getElementById('nextMonthBtn').addEventListener('click', function() { changeMonth(1); });

// Init
const now = new Date();
heatmapYear = now.getFullYear();
heatmapMonth = now.getMonth() + 1;

const savedTheme = localStorage.getItem('theme');
if (savedTheme) { document.documentElement.dataset.theme = savedTheme; document.getElementById('themeBtn').textContent = savedTheme === 'dark' ? 'D' : 'L'; }

loadAll();
loadHeatmap();
setInterval(function() { loadAll(); loadHeatmap(); }, 60000);

}); // end DOMContentLoaded
