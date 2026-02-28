let currentCrypto='USDT',countdown=30,rawData=null;
let filters={payments:new Set(),exchanges:new Set(),amount:0,completionRate:95,minAvail:0,onlineOnly:false};
let allPaymentMethods=new Set(),allExchanges=new Set();
let arbTab='active';

function toggleTheme(){const n=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);document.getElementById('themeToggle').textContent=n==='dark'?'Light':'Dark';localStorage.setItem('theme',n);}
(function(){const s=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',s);const b=document.getElementById('themeToggle');if(b)b.textContent=s==='dark'?'Light':'Dark';})();

document.querySelectorAll('.tab').forEach(tab=>{tab.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');currentCrypto=tab.dataset.crypto;document.querySelectorAll('.current-crypto').forEach(el=>el.textContent=currentCrypto);loadData();});});
document.getElementById('filterAmount').addEventListener('input',e=>{filters.amount=parseFloat(e.target.value)||0;render();});
document.getElementById('filterCompletion').addEventListener('change',e=>{filters.completionRate=parseFloat(e.target.value);render();});
document.getElementById('filterMinAvail').addEventListener('change',e=>{filters.minAvail=parseFloat(e.target.value);render();});
document.getElementById('filterOnline').addEventListener('change',e=>{filters.onlineOnly=e.target.value==='online';render();});

function resetFilters(){filters={payments:new Set(),exchanges:new Set(),amount:0,completionRate:95,minAvail:0,onlineOnly:false};document.getElementById('filterAmount').value='';document.getElementById('filterCompletion').value='95';document.getElementById('filterMinAvail').value='0';document.getElementById('filterOnline').value='all';buildChips();render();}
function toggleFilter(type,value){const set=type==='payment'?filters.payments:filters.exchanges;set.has(value)?set.delete(value):set.add(value);buildChips();render();}
function buildChips(){document.getElementById('paymentFilters').innerHTML=[...allPaymentMethods].sort().map(m=>`<span class="filter-chip ${filters.payments.has(m)?'active':''}" onclick="toggleFilter('payment','${m.replace(/'/g,"\\'")}')">${m}</span>`).join('');document.getElementById('exchangeFilters').innerHTML=[...allExchanges].sort().map(ex=>`<span class="filter-chip ${filters.exchanges.has(ex)?'active':''}" onclick="toggleFilter('exchange','${ex}')">${ex}</span>`).join('');}
function pass(o){if(filters.payments.size>0&&!o.paymentMethods.some(m=>filters.payments.has(m)))return false;if(filters.exchanges.size>0&&!filters.exchanges.has(o.exchange))return false;if(filters.amount>0&&(o.minLimit>filters.amount||(o.maxLimit>0&&o.maxLimit<filters.amount)))return false;if(filters.completionRate>0&&o.merchant.completionRate<filters.completionRate)return false;if(filters.minAvail>0&&o.available<filters.minAvail)return false;if(filters.onlineOnly&&!o.merchant.isOnline)return false;return true;}
function render(){if(rawData)renderData(rawData);}
function fmt(n,d=1){return n==null?'--':Number(n).toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d});}
function fmtInt(n){return n==null?'--':Number(n).toLocaleString('ja-JP',{maximumFractionDigits:0});}

function fmtDuration(ms){
  const s=Math.floor(ms/1000);if(s<60)return `${s}s`;
  const m=Math.floor(s/60);if(m<60)return `${m}m${s%60}s`;
  const h=Math.floor(m/60);return `${h}h${m%60}m`;
}
function fmtTime(ts){return new Date(ts).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}
function fmtTimeAgo(ts){const d=Date.now()-ts;if(d<60000)return `${Math.floor(d/1000)}s ${t('arb_ago')}`;if(d<3600000)return `${Math.floor(d/60000)}m ${t('arb_ago')}`;return `${Math.floor(d/3600000)}h ${t('arb_ago')}`;}

// Arbitrage tab switching
function switchArbTab(tab){
  arbTab=tab;
  document.getElementById('arbTabActive').classList.toggle('active',tab==='active');
  document.getElementById('arbTabHistory').classList.toggle('active',tab==='history');
  document.getElementById('arbActivePanel').style.display=tab==='active'?'block':'none';
  document.getElementById('arbHistoryPanel').style.display=tab==='history'?'block':'none';
}

async function loadArbitrage(){
  try{
    const res=await fetch('/api/arbitrage');
    const json=await res.json();
    if(!json.success)return;
    renderArbitrage(json.data);
  }catch(e){console.error(e);}
}

function renderSparkline(snapshots){
  if(!snapshots||snapshots.length<2)return '';
  const max=Math.max(...snapshots.map(s=>s.profit));
  const min=Math.min(...snapshots.map(s=>s.profit));
  const range=max-min||1;
  return `<div class="arb-spark">${snapshots.map(s=>{
    const h=Math.max(2,((s.profit-min)/range)*18);
    return `<div class="arb-spark-bar" style="height:${h}px"></div>`;
  }).join('')}</div>`;
}

function renderArbCard(w,isLive){
  const statusClass=isLive?'live':'closed';
  const statusText=isLive?t('arb_status_open'):t('arb_status_closed');
  const minLimit=Math.max(w.buyMinLimit||0, w.sellMinLimit||0);
  const maxLimit=Math.min(w.buyMaxLimit||Infinity, w.sellMaxLimit||Infinity);
  const limitStr=maxLimit<Infinity?`¥${fmtInt(minLimit)} - ¥${fmtInt(maxLimit)}`:'--';
  return `<div class="arb-card ${statusClass}">
    <div class="arb-route">
      <span class="arb-exchange exchange-badge exchange-${w.buyExchange}">${w.buyExchange}</span>
      <span class="arb-arrow">&rarr;</span>
      <span class="arb-exchange exchange-badge exchange-${w.sellExchange}">${w.sellExchange}</span>
      <div style="font-size:10px;color:var(--dim);margin-top:4px">${w.crypto}/JPY</div>
    </div>
    <div class="arb-prices">
      <div><span class="label">${t('arb_buy_at')}</span> <span style="color:var(--green)">¥${fmt(w.buyPrice)}</span></div>
      <div><span class="label">${t('arb_sell_at')}</span> <span style="color:var(--red)">¥${fmt(w.sellPrice)}</span></div>
      <div><span class="label">${t('arb_per_unit')}</span> +¥${fmt(w.profitPerUnit)}</div>
    </div>
    <div class="arb-volume-cell">
      <div class="arb-volume-row"><span class="label">${t('arb_volume')}</span> <span>${fmtInt(w.maxVolume)} ${w.crypto}</span></div>
      <div class="arb-volume-row"><span class="label">${t('arb_max_profit')}</span> <span class="arb-max-profit">¥${fmtInt(w.maxProfitJPY)}</span></div>
      <div class="arb-volume-row"><span class="label">${t('arb_buy_limit')}</span> <span>¥${fmtInt(w.buyMinLimit)}-¥${fmtInt(w.buyMaxLimit)}</span></div>
      <div class="arb-volume-row"><span class="label">${t('arb_sell_limit')}</span> <span>¥${fmtInt(w.sellMinLimit)}-¥${fmtInt(w.sellMaxLimit)}</span></div>
    </div>
    <div class="arb-profit-cell">
      <div class="arb-profit-big">+${fmt(w.profitPercent,2)}%</div>
      <div style="font-size:10px;color:var(--dim)">${t('arb_peak')}: +${fmt(w.peakProfit,2)}%</div>
      ${renderSparkline(w.snapshots)}
    </div>
    <div class="arb-timing">
      <div><span class="arb-status ${statusClass}">${statusText}</span></div>
      <div class="arb-duration-val">${fmtDuration(w.durationMs||0)}</div>
      <div style="font-size:10px">${t('arb_opened')}: ${fmtTime(w.openedAt)}</div>
      ${w.closedAt?`<div style="font-size:10px">${t('arb_closed')}: ${fmtTime(w.closedAt)}</div>`:`<div style="font-size:10px;color:var(--green)">${t('arb_now')}</div>`}
    </div>
  </div>`;
}

function renderArbitrage(data){
  const activeEl=document.getElementById('arbActiveList');
  const historyEl=document.getElementById('arbHistoryList');
  const badge=document.getElementById('arbActiveBadge');
  
  badge.textContent=data.active.length;
  badge.classList.toggle('zero',data.active.length===0);
  
  if(data.active.length>0){
    activeEl.innerHTML=data.active.map(w=>renderArbCard(w,true)).join('');
  }else{
    activeEl.innerHTML=`<div class="arb-empty">${t('arb_none_active')}</div>`;
  }
  
  if(data.history.length>0){
    historyEl.innerHTML=data.history.map(w=>renderArbCard(w,false)).join('');
  }else{
    historyEl.innerHTML=`<div class="arb-empty">${t('arb_none_history')}</div>`;
  }
}

async function loadData(){
  try{
    const res=await fetch(`/api/rates/${currentCrypto}`);
    const json=await res.json();
    if(!json.success)return;
    rawData=json.data;
    allPaymentMethods.clear();allExchanges.clear();
    rawData.rates.forEach(r=>{allExchanges.add(r.exchange);[...r.buyOrders,...r.sellOrders].forEach(o=>o.paymentMethods.forEach(m=>{if(m)allPaymentMethods.add(m);}));});
    buildChips();renderData(rawData);
    loadArbitrage();
  }catch(e){console.error(e);}
}

function renderData(data){
  const spot=data.spotPrices?.[currentCrypto];
  document.getElementById('spotPrices').innerHTML=spot?`<div class="spot-item">Spot: <span class="spot-val">${fmt(spot)}</span></div>`:'';
  document.getElementById('buyTitle').innerHTML=tf('buy_title',currentCrypto);
  document.getElementById('sellTitle').innerHTML=tf('sell_title',currentCrypto);
  document.getElementById('buyDesc').textContent=t('buy_desc');
  document.getElementById('sellDesc').textContent=t('sell_desc');
  let buys=[],sells=[];
  data.rates.forEach(r=>{buys.push(...r.buyOrders.filter(pass));sells.push(...r.sellOrders.filter(pass));});
  if(buys.length){const b=buys.reduce((a,b)=>a.price<b.price?a:b);document.getElementById('bestBuyPrice').textContent=fmt(b.price);document.getElementById('bestBuyExchange').textContent=b.exchange;}
  else{document.getElementById('bestBuyPrice').textContent='--';document.getElementById('bestBuyExchange').textContent='--';}
  if(sells.length){const s=sells.reduce((a,b)=>a.price>b.price?a:b);document.getElementById('bestSellPrice').textContent=fmt(s.price);document.getElementById('bestSellExchange').textContent=s.exchange;}
  else{document.getElementById('bestSellPrice').textContent='--';document.getElementById('bestSellExchange').textContent='--';}
  const arbEl=document.getElementById('arbAlert');if(arbEl)arbEl.remove();
  const bars=document.getElementById('spreadBars');
  const maxS=Math.max(...data.rates.map(r=>Math.abs(r.spread||0)),1);
  bars.innerHTML=data.rates.map(r=>{const w=r.spread?Math.abs(r.spread)/maxS*100:0;const c=r.spread&&r.spread>0?'var(--red)':'var(--green)';const prem=r.buyPremium!=null?`${r.buyPremium>0?'+':''}${fmt(r.buyPremium,2)}%`:'';return `<div class="spread-row"><span class="ex-label">${r.exchange}</span><div class="bar-wrap"><div class="bar-fill" style="width:${w}%;background:${c}"></div></div><span class="spread-val" style="color:${c}">${fmt(r.spread)}</span><span class="spread-prem">${prem}</span></div>`;}).join('');
  const total=data.rates.reduce((s,r)=>s+r.buyOrders.length+r.sellOrders.length,0);
  document.getElementById('filterCount').textContent=`${buys.length+sells.length} / ${total}`;
  renderTable('buyTable','buyCount',buys,'buy',spot);
  renderTable('sellTable','sellCount',sells,'sell',spot);
}

function renderTable(tid,cid,orders,side,spot){
  const tbody=document.querySelector(`#${tid} tbody`);
  if(side==='buy')orders.sort((a,b)=>a.price-b.price);else orders.sort((a,b)=>b.price-a.price);
  const show=orders.slice(0,40);
  document.getElementById(cid).textContent=`${orders.length}`;
  if(!show.length){tbody.innerHTML=`<tr><td colspan="9" class="loading">${t('no_orders')}</td></tr>`;return;}
  tbody.innerHTML=show.map((o,i)=>{
    const r=i+1,rc=r<=3?`rank-${r}`:'';
    const prem=spot?((o.price-spot)/spot*100):null;
    const pc=prem>0?'premium-positive':'premium-negative';
    const cc=o.merchant.completionRate>=95?'completion-high':o.merchant.completionRate>=80?'completion-mid':'completion-low';
    const pays=o.paymentMethods.slice(0,3).map(p=>`<span class="payment-tag ${filters.payments.size&&filters.payments.has(p)?'payment-active':''}">${p}</span>`).join('');
    return `<tr><td><span class="rank ${rc}">${r}</span></td><td><span class="exchange-badge exchange-${o.exchange}">${o.exchange}</span></td><td class="price-cell">${fmt(o.price)}</td><td><span class="${pc}">${prem!=null?(prem>0?'+':'')+fmt(prem,2)+'%':'--'}</span></td><td>${fmtInt(o.available)}</td><td style="font-size:10px">${fmtInt(o.minLimit)}-${fmtInt(o.maxLimit)}</td><td><span class="online-dot ${o.merchant.isOnline?'on':'off'}"></span>${o.merchant.name}</td><td class="${cc}">${fmt(o.merchant.completionRate,0)}%</td><td>${pays}</td></tr>`;
  }).join('');
}

async function refresh(){document.getElementById('refreshBtn').textContent='...';await loadData();document.getElementById('refreshBtn').textContent=t('refresh');countdown=30;}
setInterval(()=>{countdown--;document.getElementById('countdown').textContent=countdown;if(countdown<=0){countdown=30;loadData();}},1000);
loadData();

function toggleArbPanel(){
  const p=document.getElementById('arbPanel');
  const btn=document.getElementById('arbHeaderBtn');
  p.classList.toggle('collapsed');
  btn.classList.toggle('active',!p.classList.contains('collapsed'));
  if(!p.classList.contains('collapsed')) loadArbitrage();
}
