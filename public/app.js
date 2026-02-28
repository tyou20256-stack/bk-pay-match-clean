let currentCrypto = 'USDT';
let countdown = 30;
let timer = null;
let rawData = null;

let filters = {
  payments: new Set(),
  exchanges: new Set(),
  amount: 0,
  completionRate: 95,
  minAvail: 0,
  onlineOnly: false,
};

let allPaymentMethods = new Set();
let allExchanges = new Set();

// Theme
function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  document.getElementById('themeToggle').textContent = next === 'dark' ? 'Light' : 'Dark';
  localStorage.setItem('theme', next);
}
(function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = saved === 'dark' ? 'Light' : 'Dark';
})();

// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCrypto = tab.dataset.crypto;
    document.querySelectorAll('.current-crypto').forEach(el => el.textContent = currentCrypto);
    loadData();
  });
});

// Filter listeners
document.getElementById('filterAmount').addEventListener('input', e => { filters.amount = parseFloat(e.target.value) || 0; applyFiltersAndRender(); });
document.getElementById('filterCompletion').addEventListener('change', e => { filters.completionRate = parseFloat(e.target.value); applyFiltersAndRender(); });
document.getElementById('filterMinAvail').addEventListener('change', e => { filters.minAvail = parseFloat(e.target.value); applyFiltersAndRender(); });
document.getElementById('filterOnline').addEventListener('change', e => { filters.onlineOnly = e.target.value === 'online'; applyFiltersAndRender(); });

function resetFilters() {
  filters = { payments: new Set(), exchanges: new Set(), amount: 0, completionRate: 95, minAvail: 0, onlineOnly: false };
  document.getElementById('filterAmount').value = '';
  document.getElementById('filterCompletion').value = '95';
  document.getElementById('filterMinAvail').value = '0';
  document.getElementById('filterOnline').value = 'all';
  buildFilterChips();
  applyFiltersAndRender();
}

function toggleFilter(type, value) {
  const set = type === 'payment' ? filters.payments : filters.exchanges;
  if (set.has(value)) set.delete(value); else set.add(value);
  buildFilterChips();
  applyFiltersAndRender();
}

function buildFilterChips() {
  const payEl = document.getElementById('paymentFilters');
  payEl.innerHTML = [...allPaymentMethods].sort().map(m =>
    `<span class="filter-chip ${filters.payments.has(m) ? 'active' : ''}" onclick="toggleFilter('payment','${m.replace(/'/g,"\\'")}')">${m}</span>`
  ).join('');
  const exEl = document.getElementById('exchangeFilters');
  exEl.innerHTML = [...allExchanges].sort().map(ex =>
    `<span class="filter-chip ${filters.exchanges.has(ex) ? 'active' : ''}" onclick="toggleFilter('exchange','${ex}')">${ex}</span>`
  ).join('');
}

function filterOrder(o) {
  if (filters.payments.size > 0 && !o.paymentMethods.some(m => filters.payments.has(m))) return false;
  if (filters.exchanges.size > 0 && !filters.exchanges.has(o.exchange)) return false;
  if (filters.amount > 0 && (o.minLimit > filters.amount || (o.maxLimit > 0 && o.maxLimit < filters.amount))) return false;
  if (filters.completionRate > 0 && o.merchant.completionRate < filters.completionRate) return false;
  if (filters.minAvail > 0 && o.available < filters.minAvail) return false;
  if (filters.onlineOnly && !o.merchant.isOnline) return false;
  return true;
}

function applyFiltersAndRender() { if (rawData) renderData(rawData); }

function fmt(n, d=1) {
  if (n === null || n === undefined) return '--';
  return Number(n).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtInt(n) {
  if (n === null || n === undefined) return '--';
  return Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 0 });
}

async function loadData() {
  try {
    const res = await fetch(`/api/rates/${currentCrypto}`);
    const json = await res.json();
    if (!json.success) return;
    rawData = json.data;
    allPaymentMethods.clear();
    allExchanges.clear();
    rawData.rates.forEach(r => {
      allExchanges.add(r.exchange);
      [...r.buyOrders, ...r.sellOrders].forEach(o => {
        o.paymentMethods.forEach(m => { if (m) allPaymentMethods.add(m); });
      });
    });
    buildFilterChips();
    renderData(rawData);
  } catch (err) { console.error('Fetch error:', err); }
}

function renderData(data) {
  const spotEl = document.getElementById('spotPrices');
  const spotPrice = data.spotPrices?.[currentCrypto];
  spotEl.innerHTML = spotPrice ? `<div class="spot-item">Spot: <span class="spot-val">${fmt(spotPrice)}</span></div>` : '';

  let allBuyFiltered = [];
  let allSellFiltered = [];
  data.rates.forEach(r => {
    allBuyFiltered.push(...r.buyOrders.filter(filterOrder));
    allSellFiltered.push(...r.sellOrders.filter(filterOrder));
  });

  if (allBuyFiltered.length) {
    const best = allBuyFiltered.reduce((a, b) => a.price < b.price ? a : b);
    document.getElementById('bestBuyPrice').textContent = fmt(best.price);
    document.getElementById('bestBuyExchange').textContent = best.exchange;
  } else {
    document.getElementById('bestBuyPrice').textContent = '--';
    document.getElementById('bestBuyExchange').textContent = '--';
  }
  if (allSellFiltered.length) {
    const best = allSellFiltered.reduce((a, b) => a.price > b.price ? a : b);
    document.getElementById('bestSellPrice').textContent = fmt(best.price);
    document.getElementById('bestSellExchange').textContent = best.exchange;
  } else {
    document.getElementById('bestSellPrice').textContent = '--';
    document.getElementById('bestSellExchange').textContent = '--';
  }

  if (allBuyFiltered.length && allSellFiltered.length) {
    const minBuy = Math.min(...allBuyFiltered.map(o => o.price));
    const maxSell = Math.max(...allSellFiltered.map(o => o.price));
    document.getElementById('bestSpread').textContent = fmt(maxSell - minBuy);
  }

  const arbAlert = document.getElementById('arbAlert');
  const arbContent = document.getElementById('arbContent');
  if (data.arbitrageOpportunities?.length > 0) {
    const best = data.arbitrageOpportunities[0];
    arbAlert.classList.remove('hidden');
    arbContent.innerHTML = `
      <div><span class="arb-profit">+${fmt(best.profitPercent, 2)}%</span></div>
      <div style="color:var(--dim);font-size:11px;margin-top:4px">
        Buy at ${best.buyExchange} (${fmt(best.buyPrice)}) &rarr; Sell at ${best.sellExchange} (${fmt(best.sellPrice)}) = 
        <span style="color:var(--green)">+${fmt(best.profitPerUnit)} / unit</span>
      </div>`;
  } else { arbAlert.classList.add('hidden'); }

  const spreadBars = document.getElementById('spreadBars');
  const maxSpreadVal = Math.max(...data.rates.map(r => Math.abs(r.spread || 0)), 1);
  spreadBars.innerHTML = data.rates.map(r => {
    const w = r.spread ? Math.abs(r.spread) / maxSpreadVal * 100 : 0;
    const color = r.spread && r.spread > 0 ? 'var(--red)' : 'var(--green)';
    const premStr = r.buyPremium !== null ? `Premium: ${r.buyPremium > 0 ? '+' : ''}${fmt(r.buyPremium, 2)}%` : '';
    return `<div class="spread-bar">
      <div class="ex-name">${r.exchange}</div>
      <div class="bar-wrap"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>
      <div class="spread-val" style="color:${color}">${fmt(r.spread)}</div>
      <div class="spread-detail">Buy: ${fmt(r.bestBuy)} / Sell: ${fmt(r.bestSell)} ${premStr ? '| ' + premStr : ''}</div>
    </div>`;
  }).join('');

  const totalAll = data.rates.reduce((s, r) => s + r.buyOrders.length + r.sellOrders.length, 0);
  document.getElementById('filterCount').textContent = `${allBuyFiltered.length + allSellFiltered.length} / ${totalAll}`;

  renderOrderTable('buyTable', 'buyCount', allBuyFiltered, 'buy', spotPrice);
  renderOrderTable('sellTable', 'sellCount', allSellFiltered, 'sell', spotPrice);
}

function renderOrderTable(tableId, countId, orders, side, spotPrice) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (side === 'buy') orders.sort((a, b) => a.price - b.price);
  else orders.sort((a, b) => b.price - a.price);
  const display = orders.slice(0, 50);
  document.getElementById(countId).textContent = `(${orders.length})`;

  if (display.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">No matching orders</td></tr>';
    return;
  }

  tbody.innerHTML = display.map((o, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : '';
    const premium = spotPrice ? ((o.price - spotPrice) / spotPrice * 100) : null;
    const premClass = premium > 0 ? 'premium-positive' : 'premium-negative';
    const compClass = o.merchant.completionRate >= 95 ? 'completion-high' : o.merchant.completionRate >= 80 ? 'completion-mid' : 'completion-low';
    const payments = o.paymentMethods.slice(0, 4).map(p => {
      const isActive = filters.payments.size > 0 && filters.payments.has(p);
      return `<span class="payment-tag ${isActive ? 'payment-active' : ''}">${p}</span>`;
    }).join('');
    return `<tr>
      <td><span class="rank ${rankClass}">${rank}</span></td>
      <td><span class="exchange-badge exchange-${o.exchange}">${o.exchange}</span></td>
      <td class="price-cell">${fmt(o.price)}</td>
      <td><span class="${premClass}">${premium !== null ? (premium > 0 ? '+' : '') + fmt(premium, 2) + '%' : '--'}</span></td>
      <td>${fmtInt(o.available)} ${o.crypto}</td>
      <td style="font-size:11px">${fmtInt(o.minLimit)} - ${fmtInt(o.maxLimit)}</td>
      <td><span class="online-dot ${o.merchant.isOnline ? 'on' : 'off'}"></span>${o.merchant.name}</td>
      <td class="${compClass}">${fmt(o.merchant.completionRate, 1)}%<br><span style="color:var(--dim);font-size:10px">${o.merchant.orderCount}</span></td>
      <td>${payments}</td>
    </tr>`;
  }).join('');
}

async function refresh() {
  document.getElementById('refreshBtn').textContent = '...';
  await loadData();
  document.getElementById('refreshBtn').textContent = 'Refresh';
  countdown = 30;
}

function startCountdown() {
  timer = setInterval(() => {
    countdown--;
    document.getElementById('countdown').textContent = countdown;
    if (countdown <= 0) { countdown = 30; loadData(); }
  }, 1000);
}

loadData();
startCountdown();
