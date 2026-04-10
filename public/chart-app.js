// chart-app.js — Chart page logic (extracted from chart.html)
document.addEventListener('DOMContentLoaded', function() {

const COLORS = {Bybit:'#f59e0b',Binance:'#f0b90b',OKX:'#00c6fb',HTX:'#2962ff'};
const LINE_STYLES = {buy:'solid',sell:'dashed',spot:'dotted'};

let crypto = 'USDT', hours = 24, chart = null, timer = null, countdown = 60;
let enabledExchanges = new Set();
let rawData = [];

function initBtnGroup(id, cb) {
  const el = document.getElementById(id);
  el.querySelectorAll('button').forEach(function(b) {
    b.addEventListener('click', function() {
      el.querySelector('.active')?.classList.remove('active');
      b.classList.add('active');
      cb(b.dataset.v);
    });
  });
}

initBtnGroup('cryptoSel', function(v) { crypto = v; fetchData(); });
initBtnGroup('rangeSel', function(v) { hours = +v; fetchData(); });

async function fetchData() {
  try {
    const r = await fetch('/api/history/' + crypto + '?hours=' + hours);
    const j = await r.json();
    if (j.success) { rawData = j.data; updateExchangeToggles(); renderChart(); }
    document.getElementById('dataInfo').textContent = rawData.length + ' data points | ' + crypto + ' | ' + hours + 'h';
  } catch(e) { document.getElementById('dataInfo').textContent = 'Error loading data'; }
}

function updateExchangeToggles() {
  const exchanges = [...new Set(rawData.map(function(d) { return d.exchange; }))];
  if (enabledExchanges.size === 0) exchanges.forEach(function(e) { enabledExchanges.add(e); });
  const container = document.getElementById('exToggles');
  container.innerHTML = '';
  exchanges.forEach(function(ex) {
    const label = document.createElement('label');
    label.className = enabledExchanges.has(ex) ? 'checked' : '';
    const color = COLORS[ex] || '#888';
    label.innerHTML = '<span class="dot" style="background:' + color + '"></span><input type="checkbox" ' + (enabledExchanges.has(ex)?'checked':'') + '>' + ex;
    label.querySelector('input').addEventListener('change', function(e) {
      if (e.target.checked) enabledExchanges.add(ex); else enabledExchanges.delete(ex);
      label.className = e.target.checked ? 'checked' : '';
      renderChart();
    });
    container.appendChild(label);
  });
}

function renderChart() {
  const filtered = rawData.filter(function(d) { return enabledExchanges.has(d.exchange); });
  const exchanges = [...new Set(filtered.map(function(d) { return d.exchange; }))];
  const datasets = [];

  exchanges.forEach(function(ex) {
    const exData = filtered.filter(function(d) { return d.exchange === ex; });
    const color = COLORS[ex] || '#888';
    // Buy line
    datasets.push({
      label: ex + ' Buy',
      data: exData.filter(function(d){return d.bestBuy;}).map(function(d) { return {x: d.timestamp, y: d.bestBuy}; }),
      borderColor: color, backgroundColor: color+'22',
      borderWidth: 2, pointRadius: 0, tension: 0.3, borderDash: []
    });
    // Sell line
    datasets.push({
      label: ex + ' Sell',
      data: exData.filter(function(d){return d.bestSell;}).map(function(d) { return {x: d.timestamp, y: d.bestSell}; }),
      borderColor: color, backgroundColor: 'transparent',
      borderWidth: 1.5, pointRadius: 0, tension: 0.3, borderDash: [5,3]
    });
  });

  // Spot price (from first exchange that has it)
  const spotData = filtered.filter(function(d) { return d.spot; });
  if (spotData.length > 0) {
    const seen = new Set();
    const uniqueSpot = spotData.filter(function(d) { const k=d.timestamp; if(seen.has(k))return false; seen.add(k); return true; });
    datasets.push({
      label: 'Spot',
      data: uniqueSpot.map(function(d) { return {x: d.timestamp, y: d.spot}; }),
      borderColor: '#a78bfa', backgroundColor: 'transparent',
      borderWidth: 2, pointRadius: 0, tension: 0.3, borderDash: [2,4]
    });
  }

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById('priceChart'), {
    type: 'line',
    data: { datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#8899aa', usePointStyle: true, pointStyle: 'line', padding: 16, font: {size: 11} }},
        tooltip: { backgroundColor: '#1a2233ee', titleColor: '#edf0f7', bodyColor: '#ccc', borderColor: '#2a3a4f', borderWidth: 1,
          callbacks: { label: function(ctx) { return ctx.dataset.label + ': \u00a5' + (ctx.parsed.y != null ? ctx.parsed.y.toLocaleString() : ''); } }
        }
      },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'MM/dd HH:mm' }, grid: { color: '#1f2937' }, ticks: { color: '#667', maxTicksLimit: 8 }},
        y: { grid: { color: '#1f2937' }, ticks: { color: '#667', callback: function(v) { return '\u00a5'+v.toLocaleString(); } }}
      }
    }
  });
  document.getElementById('priceChart').parentElement.style.height = Math.max(400, window.innerHeight - 200) + 'px';
}

// Auto-refresh
function startCountdown() {
  clearInterval(timer);
  countdown = 60;
  timer = setInterval(function() {
    countdown--;
    document.getElementById('nextUpdate').textContent = 'Auto-refresh: ' + countdown + 's';
    if (countdown <= 0) { fetchData(); countdown = 60; }
  }, 1000);
}

// === Spread Analysis ===
var spreadChart = null;

function renderSpreadAnalysis() {
  const filtered = rawData.filter(function(d) { return enabledExchanges.has(d.exchange) && d.bestBuy && d.bestSell; });
  if (!filtered.length) { document.getElementById('spreadStats').innerHTML = '<span style="color:var(--text2)">No data</span>'; return; }

  // Calculate spread per timestamp per exchange
  const exchanges = [...new Set(filtered.map(function(d) { return d.exchange; }))];
  const datasets = [];

  exchanges.forEach(function(ex) {
    const exData = filtered.filter(function(d) { return d.exchange === ex; });
    const color = COLORS[ex] || '#888';
    datasets.push({
      label: ex + ' Spread',
      data: exData.map(function(d) { return { x: d.timestamp, y: Number(d.bestBuy) - Number(d.bestSell) }; }),
      borderColor: color, backgroundColor: color + '22',
      borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true
    });
  });

  if (spreadChart) spreadChart.destroy();
  spreadChart = new Chart(document.getElementById('spreadChart'), {
    type: 'line',
    data: { datasets: datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#8899aa', font: { size: 10 } } },
        tooltip: { callbacks: { label: function(ctx) { return ctx.dataset.label + ': \u00a5' + (ctx.parsed.y||0).toFixed(1); } } }
      },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'MM/dd HH:mm' }, grid: { color: '#1f2937' }, ticks: { color: '#667', maxTicksLimit: 6 } },
        y: { grid: { color: '#1f2937' }, ticks: { color: '#667', callback: function(v) { return '\u00a5' + v.toFixed(0); } } }
      }
    }
  });
  document.getElementById('spreadChart').parentElement.style.height = '250px';

  // Stats summary
  const allSpreads = filtered.map(function(d) { return Number(d.bestBuy) - Number(d.bestSell); });
  const avgSpread = allSpreads.reduce(function(s, v) { return s + v; }, 0) / allSpreads.length;
  const minSpread = Math.min.apply(null, allSpreads);
  const maxSpread = Math.max.apply(null, allSpreads);
  const avgBuy = filtered.reduce(function(s, d) { return s + Number(d.bestBuy); }, 0) / filtered.length;
  const spreadPct = avgBuy > 0 ? (avgSpread / avgBuy * 100).toFixed(3) : '--';

  document.getElementById('spreadStats').innerHTML = [
    { label: 'Avg Spread', val: '\u00a5' + avgSpread.toFixed(1), color: 'var(--blue)' },
    { label: 'Min Spread', val: '\u00a5' + minSpread.toFixed(1), color: 'var(--green)' },
    { label: 'Max Spread', val: '\u00a5' + maxSpread.toFixed(1), color: 'var(--red)' },
    { label: 'Spread %', val: spreadPct + '%', color: 'var(--yellow)' },
  ].map(function(s) { return '<div class="spread-stat"><div class="spread-stat-val" style="color:' + s.color + '">' + s.val + '</div><div class="spread-stat-label">' + s.label + '</div></div>'; }).join('');
}

// === Exchange Ranking ===
function renderExchangeRanking() {
  const filtered = rawData.filter(function(d) { return d.bestBuy && d.bestSell; });
  if (!filtered.length) return;
  const exchanges = [...new Set(filtered.map(function(d) { return d.exchange; }))];

  const stats = exchanges.map(function(ex) {
    const exData = filtered.filter(function(d) { return d.exchange === ex; });
    const buys = exData.map(function(d) { return Number(d.bestBuy); });
    const sells = exData.map(function(d) { return Number(d.bestSell); });
    const avgBuy = buys.reduce(function(s, v) { return s + v; }, 0) / buys.length;
    const avgSell = sells.reduce(function(s, v) { return s + v; }, 0) / sells.length;
    const avgSpread = avgBuy - avgSell;
    const bestBuy = Math.min.apply(null, buys);
    const bestSell = Math.max.apply(null, sells);
    // Score: lower spread = better, more data = better
    const spreadScore = avgSpread > 0 ? Math.max(0, 100 - avgSpread * 10) : 100;
    const dataScore = Math.min(100, exData.length / (filtered.length / exchanges.length) * 100);
    const score = Math.round(spreadScore * 0.7 + dataScore * 0.3);
    return { exchange: ex, bestBuy: bestBuy, avgBuy: avgBuy, bestSell: bestSell, avgSell: avgSell, avgSpread: avgSpread, dataPoints: exData.length, score: score };
  });

  stats.sort(function(a, b) { return b.score - a.score; });

  const tbody = document.getElementById('rankingBody');
  tbody.innerHTML = stats.map(function(s, i) {
    const rankCls = i < 3 ? 'rank-' + (i + 1) : 'rank-other';
    const color = COLORS[s.exchange] || '#888';
    const barW = Math.max(10, s.score);
    return '<tr>'
      + '<td><span class="rank-badge ' + rankCls + '">' + (i + 1) + '</span></td>'
      + '<td><span class="dot" style="background:' + color + ';margin-right:6px"></span>' + s.exchange + '</td>'
      + '<td>\u00a5' + s.bestBuy.toLocaleString() + '</td>'
      + '<td>\u00a5' + s.bestSell.toLocaleString() + '</td>'
      + '<td style="color:' + (s.avgSpread < 1 ? 'var(--green)' : s.avgSpread < 3 ? 'var(--yellow)' : 'var(--red)') + '">\u00a5' + s.avgSpread.toFixed(1) + '</td>'
      + '<td>' + s.dataPoints + '</td>'
      + '<td><span class="score-bar" style="width:' + barW + 'px"></span>' + s.score + '</td>'
      + '</tr>';
  }).join('');
}

// === Liquidity Heatmap ===
async function renderLiquidityHeatmap() {
  try {
    const r = await fetch('/api/rates/' + crypto);
    const j = await r.json();
    if (!j.success || !j.data || !j.data.rates) return;

    const exchanges = j.data.rates;
    const el = document.getElementById('liquidityHeatmap');

    // Build heatmap: exchanges vs price ranges
    const allBuys = [];
    const allSells = [];
    exchanges.forEach(function(ex) {
      (ex.buyOrders || []).forEach(function(o) { allBuys.push({ exchange: ex.exchange, price: Number(o.price), amount: Number(o.availableAmount || o.amount || 0), merchant: o.merchant?.name || '' }); });
      (ex.sellOrders || []).forEach(function(o) { allSells.push({ exchange: ex.exchange, price: Number(o.price), amount: Number(o.availableAmount || o.amount || 0) }); });
    });

    if (!allBuys.length && !allSells.length) {
      el.innerHTML = '<div style="text-align:center;color:var(--text2);padding:20px">No liquidity data available</div>';
      return;
    }

    const exNames = [...new Set(exchanges.map(function(e) { return e.exchange; }))];
    const maxAmt = Math.max.apply(null, allBuys.map(function(b) { return b.amount; }).concat(allSells.map(function(s) { return s.amount; })).concat([1]));

    var html = '<table class="liq-table"><thead><tr><th>Exchange</th><th>Buy Orders</th><th>Best Buy</th><th>Avg Amount</th><th>Sell Orders</th><th>Best Sell</th><th>Depth</th></tr></thead><tbody>';

    exNames.forEach(function(ex) {
      const exBuys = allBuys.filter(function(b) { return b.exchange === ex; });
      const exSells = allSells.filter(function(s) { return s.exchange === ex; });
      const bestBuy = exBuys.length ? Math.min.apply(null, exBuys.map(function(b) { return b.price; })) : null;
      const bestSell = exSells.length ? Math.max.apply(null, exSells.map(function(s) { return s.price; })) : null;
      const avgBuyAmt = exBuys.length ? exBuys.reduce(function(s, b) { return s + b.amount; }, 0) / exBuys.length : 0;
      const totalDepth = exBuys.reduce(function(s, b) { return s + b.amount; }, 0) + exSells.reduce(function(s, b) { return s + b.amount; }, 0);
      const depthPct = maxAmt > 0 ? Math.min(100, totalDepth / maxAmt * 50) : 0;
      const color = COLORS[ex] || '#888';

      html += '<tr>'
        + '<td><span class="dot" style="background:' + color + ';margin-right:6px"></span>' + ex + '</td>'
        + '<td><span class="liq-cell" style="background:rgba(52,211,153,' + (exBuys.length > 0 ? Math.min(0.5, exBuys.length / 20) : 0) + ')">' + exBuys.length + '</span></td>'
        + '<td>' + (bestBuy ? '\u00a5' + bestBuy.toLocaleString() : '--') + '</td>'
        + '<td>' + (avgBuyAmt > 0 ? avgBuyAmt.toFixed(crypto === 'USDT' ? 0 : 4) : '--') + '</td>'
        + '<td><span class="liq-cell" style="background:rgba(96,165,250,' + (exSells.length > 0 ? Math.min(0.5, exSells.length / 20) : 0) + ')">' + exSells.length + '</span></td>'
        + '<td>' + (bestSell ? '\u00a5' + bestSell.toLocaleString() : '--') + '</td>'
        + '<td><div style="display:flex;align-items:center;gap:6px"><div style="width:' + Math.max(4, depthPct) + 'px;height:10px;background:' + color + ';border-radius:4px;opacity:.7"></div><span style="font-size:10px;color:var(--text2)">' + totalDepth.toFixed(crypto === 'USDT' ? 0 : 4) + '</span></div></td>'
        + '</tr>';
    });

    html += '</tbody></table>';
    el.innerHTML = html;
  } catch (e) {
    document.getElementById('liquidityHeatmap').innerHTML = '<div style="text-align:center;color:var(--text2)">Error loading liquidity data</div>';
  }
}

// Override fetchData to also update analysis panels
var _origFetchData = fetchData;
fetchData = async function() {
  await _origFetchData();
  renderSpreadAnalysis();
  renderExchangeRanking();
  renderLiquidityHeatmap();
};

fetchData();
startCountdown();

}); // end DOMContentLoaded
