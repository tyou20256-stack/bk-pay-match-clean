let currentCrypto = 'USDT';
let countdown = 30;
let timer = null;
let rawData = null;

let filters = { payments: new Set(), exchanges: new Set(), amount: 0, completionRate: 95, minAvail: 0, onlineOnly: false };
let allPaymentMethods = new Set();
let allExchanges = new Set();

function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  document.getElementById('themeToggle').textContent = next === 'dark' ? 'Light' : 'Dark';
  localStorage.setItem('theme', next);
}
(function() {
  const s = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', s);
  const b = document.getElementById('themeToggle');
  if (b) b.textContent = s === 'dark' ? 'Light' : 'Dark';
})();

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCrypto = tab.dataset.crypto;
    document.querySelectorAll('.current-crypto').forEach(el => el.textContent = currentCrypto);
    loadData();
  });
});

document.getElementById('filterAmount').addEventListener('input', e => { filters.amount = parseFloat(e.target.value) || 0; render(); });
document.getElementById('filterCompletion').addEventListener('change', e => { filters.completionRate = parseFloat(e.target.value); render(); });
document.getElementById('filterMinAvail').addEventListener('change', e => { filters.minAvail = parseFloat(e.target.value); render(); });
document.getElementById('filterOnline').addEventListener('change', e => { filters.onlineOnly = e.target.value === 'online'; render(); });

function resetFilters() {
  filters = { payments: new Set(), exchanges: new Set(), amount: 0, completionRate: 95, minAvail: 0, onlineOnly: false };
  document.getElementById('filterAmount').value = '';
  document.getElementById('filterCompletion').value = '95';
  document.getElementById('filterMinAvail').value = '0';
  document.getElementById('filterOnline').value = 'all';
  buildChips(); render();
}

function toggleFilter(type, value) {
  const set = type === 'payment' ? filters.payments : filters.exchanges;
  set.has(value) ? set.delete(value) : set.add(value);
  buildChips(); render();
}

function buildChips() {
  document.getElementById('paymentFilters').innerHTML = [...allPaymentMethods].sort().map(m =>
    `<span class="filter-chip ${filters.payments.has(m)?'active':''}" onclick="toggleFilter('payment','${m.replace(/'/g,"\\'")}')">${m}</span>`).join('');
  document.getElementById('exchangeFilters').innerHTML = [...allExchanges].sort().map(ex =>
    `<span class="filter-chip ${filters.exchanges.has(ex)?'active':''}" onclick="toggleFilter('exchange','${ex}')">${ex}</span>`).join('');
}

function pass(o) {
  if (filters.payments.size > 0 && !o.paymentMethods.some(m => filters.payments.has(m))) return false;
  if (filters.exchanges.size > 0 && !filters.exchanges.has(o.exchange)) return false;
  if (filters.amount > 0 && (o.minLimit > filters.amount || (o.maxLimit > 0 && o.maxLimit < filters.amount))) return false;
  if (filters.completionRate > 0 && o.merchant.completionRate < filters.completionRate) return false;
  if (filters.minAvail > 0 && o.available < filters.minAvail) return false;
  if (filters.onlineOnly && !o.merchant.isOnline) return false;
  return true;
}

function render() { if (rawData) renderData(rawData); }

function fmt(n,d=1) { return n==null?'--':Number(n).toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fmtInt(n) { return n==null?'--':Number(n).toLocaleString('ja-JP',{maximumFractionDigits:0}); }

async function loadData() {
  try {
    const res = await fetch(`/api/rates/${currentCrypto}`);
    const json = await res.json();
    if (!json.success) return;
    rawData = json.data;
    allPaymentMethods.clear(); allExchanges.clear();
    rawData.rates.forEach(r => {
      allExchanges.add(r.exchange);
      [...r.buyOrders,...r.sellOrders].forEach(o => o.paymentMethods.forEach(m => { if(m) allPaymentMethods.add(m); }));
    });
    buildChips(); renderData(rawData);
  } catch(e) { console.error(e); }
}

function renderData(data) {
  const spot = data.spotPrices?.[currentCrypto];
  document.getElementById('spotPrices').innerHTML = spot ? `<div class="spot-item">Spot: <span class="spot-val">${fmt(spot)}</span></div>` : '';

  let buys=[], sells=[];
  data.rates.forEach(r => { buys.push(...r.buyOrders.filter(pass)); sells.push(...r.sellOrders.filter(pass)); });

  // Best buy/sell
  if (buys.length) { const b=buys.reduce((a,b)=>a.price<b.price?a:b); document.getElementById('bestBuyPrice').textContent=fmt(b.price); document.getElementById('bestBuyExchange').textContent=b.exchange; }
  else { document.getElementById('bestBuyPrice').textContent='--'; document.getElementById('bestBuyExchange').textContent='--'; }
  if (sells.length) { const s=sells.reduce((a,b)=>a.price>b.price?a:b); document.getElementById('bestSellPrice').textContent=fmt(s.price); document.getElementById('bestSellExchange').textContent=s.exchange; }
  else { document.getElementById('bestSellPrice').textContent='--'; document.getElementById('bestSellExchange').textContent='--'; }

  // Arbitrage
  const arbEl=document.getElementById('arbAlert'), arbC=document.getElementById('arbContent');
  if (data.arbitrageOpportunities?.length) {
    const a=data.arbitrageOpportunities[0]; arbEl.classList.remove('hidden');
    arbC.innerHTML=`<span class="arb-profit">+${fmt(a.profitPercent,2)}%</span> <span style="color:var(--dim);font-size:11px">Buy ${a.buyExchange} (${fmt(a.buyPrice)}) &rarr; Sell ${a.sellExchange} (${fmt(a.sellPrice)}) = +${fmt(a.profitPerUnit)}/unit</span>`;
  } else arbEl.classList.add('hidden');

  // Spread bars (center card)
  const bars=document.getElementById('spreadBars');
  const maxS=Math.max(...data.rates.map(r=>Math.abs(r.spread||0)),1);
  bars.innerHTML=data.rates.map(r => {
    const w=r.spread?Math.abs(r.spread)/maxS*100:0;
    const c=r.spread&&r.spread>0?'var(--red)':'var(--green)';
    const prem=r.buyPremium!=null?`${r.buyPremium>0?'+':''}${fmt(r.buyPremium,2)}%`:'';
    return `<div class="spread-row">
      <span class="ex-label">${r.exchange}</span>
      <div class="bar-wrap"><div class="bar-fill" style="width:${w}%;background:${c}"></div></div>
      <span class="spread-val" style="color:${c}">${fmt(r.spread)}</span>
      <span class="spread-prem">${prem}</span>
    </div>`;
  }).join('');

  const total=data.rates.reduce((s,r)=>s+r.buyOrders.length+r.sellOrders.length,0);
  document.getElementById('filterCount').textContent=`${buys.length+sells.length} / ${total}`;

  renderTable('buyTable','buyCount',buys,'buy',spot);
  renderTable('sellTable','sellCount',sells,'sell',spot);
}

function renderTable(tid,cid,orders,side,spot) {
  const tbody=document.querySelector(`#${tid} tbody`);
  if(side==='buy') orders.sort((a,b)=>a.price-b.price); else orders.sort((a,b)=>b.price-a.price);
  const show=orders.slice(0,40);
  document.getElementById(cid).textContent=`${orders.length}`;
  if(!show.length){ tbody.innerHTML='<tr><td colspan="9" class="loading">No orders</td></tr>'; return; }
  tbody.innerHTML=show.map((o,i)=>{
    const r=i+1, rc=r<=3?`rank-${r}`:'';
    const prem=spot?((o.price-spot)/spot*100):null;
    const pc=prem>0?'premium-positive':'premium-negative';
    const cc=o.merchant.completionRate>=95?'completion-high':o.merchant.completionRate>=80?'completion-mid':'completion-low';
    const pays=o.paymentMethods.slice(0,3).map(p=>`<span class="payment-tag ${filters.payments.size&&filters.payments.has(p)?'payment-active':''}">${p}</span>`).join('');
    return `<tr>
      <td><span class="rank ${rc}">${r}</span></td>
      <td><span class="exchange-badge exchange-${o.exchange}">${o.exchange}</span></td>
      <td class="price-cell">${fmt(o.price)}</td>
      <td><span class="${pc}">${prem!=null?(prem>0?'+':'')+fmt(prem,2)+'%':'--'}</span></td>
      <td>${fmtInt(o.available)}</td>
      <td style="font-size:10px">${fmtInt(o.minLimit)}-${fmtInt(o.maxLimit)}</td>
      <td><span class="online-dot ${o.merchant.isOnline?'on':'off'}"></span>${o.merchant.name}</td>
      <td class="${cc}">${fmt(o.merchant.completionRate,0)}%</td>
      <td>${pays}</td>
    </tr>`;
  }).join('');
}

async function refresh() { document.getElementById('refreshBtn').textContent='...'; await loadData(); document.getElementById('refreshBtn').textContent='Refresh'; countdown=30; }
setInterval(()=>{ countdown--; document.getElementById('countdown').textContent=countdown; if(countdown<=0){countdown=30;loadData();} },1000);
loadData();
