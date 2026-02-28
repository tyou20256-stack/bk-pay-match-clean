var volThreshold=5.0;
function adjustThreshold(d){volThreshold=Math.max(0.5,Math.min(20,volThreshold+d));document.getElementById('volThresholdVal').textContent=volThreshold.toFixed(1);render();}
let currentCrypto='USDT',countdown=30,rawData=null,arbTab='active';
let filters={payments:new Set(),exchanges:new Set(),amount:0,completionRate:95,minAvail:0,onlineOnly:false};
let allPaymentMethods=new Set(),allExchanges=new Set();

// Theme
function toggleTheme(){const n=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);document.getElementById('themeToggle').innerHTML=n==='dark'?'&#x263E;':'&#x2600;';localStorage.setItem('theme',n);}
(function(){const s=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',s);})();

// Crypto tabs
document.querySelectorAll('.crypto-btn').forEach(btn=>{btn.addEventListener('click',()=>{document.querySelectorAll('.crypto-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');currentCrypto=btn.dataset.crypto;document.querySelectorAll('.current-crypto').forEach(el=>el.textContent=currentCrypto);loadData();});});

// Filters
document.getElementById('filterAmount').addEventListener('input',e=>{filters.amount=parseFloat(e.target.value)||0;render();});
document.getElementById('filterCompletion').addEventListener('change',e=>{filters.completionRate=parseFloat(e.target.value);render();});
document.getElementById('filterMinAvail').addEventListener('change',e=>{filters.minAvail=parseFloat(e.target.value);render();});
document.getElementById('filterOnline').addEventListener('change',e=>{filters.onlineOnly=e.target.value==='online';render();});
function resetFilters(){filters={payments:new Set(),exchanges:new Set(),amount:0,completionRate:95,minAvail:0,onlineOnly:false};document.getElementById('filterAmount').value='';document.getElementById('filterCompletion').value='95';document.getElementById('filterMinAvail').value='0';document.getElementById('filterOnline').value='all';buildChips();render();}
function toggleFilter(type,val){const s=type==='payment'?filters.payments:filters.exchanges;s.has(val)?s.delete(val):s.add(val);buildChips();render();}
function clearFilter(type){if(type==='payment')filters.payments.clear();else filters.exchanges.clear();buildChips();render();}
function buildChips(){
  var ph=document.getElementById('paymentFilters');
  var eh=document.getElementById('exchangeFilters');
  var pArr=['<span class="filter-chip '+(filters.payments.size===0?'active':'')+'" onclick="clearFilter(\'payment\')">全て</span>'];
  allPaymentMethods.forEach(function(m){var a=filters.payments.has(m)?'active':'';pArr.push('<span class="filter-chip '+a+'" onclick="toggleFilter(\'payment\',\''+m.replace(/'/g,"\\'")+'\')">'+m+'</span>');});
  ph.innerHTML=pArr.join('');
  var eArr=['<span class="filter-chip '+(filters.exchanges.size===0?'active':'')+'" onclick="clearFilter(\'exchange\')">全て</span>'];
  allExchanges.forEach(function(ex){var a=filters.exchanges.has(ex)?'active':'';eArr.push('<span class="filter-chip '+a+'" onclick="toggleFilter(\'exchange\',\''+ex+'\')">'+ex+'</span>');});
  eh.innerHTML=eArr.join('');
}
function pass(o){if(filters.payments.size>0&&!o.paymentMethods.some(m=>filters.payments.has(m)))return false;if(filters.exchanges.size>0&&!filters.exchanges.has(o.exchange))return false;if(filters.amount>0&&(o.minLimit>filters.amount||(o.maxLimit>0&&o.maxLimit<filters.amount)))return false;if(filters.completionRate>0&&o.merchant.completionRate<filters.completionRate)return false;if(filters.minAvail>0&&o.available<filters.minAvail)return false;if(filters.onlineOnly&&!o.merchant.isOnline)return false;return true;}
function render(){if(rawData)renderData(rawData);}

// Formatting
function fmt(n,d=1){return n==null?'--':Number(n).toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d});}
function fmtInt(n){return n==null?'--':Number(n).toLocaleString('ja-JP',{maximumFractionDigits:0});}
function fmtDuration(ms){const s=Math.floor(ms/1000);if(s<60)return`${s}s`;const m=Math.floor(s/60);if(m<60)return`${m}m${s%60}s`;return`${Math.floor(m/60)}h${m%60}m`;}
function fmtTime(ts){return new Date(ts).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'});}

// Arb panel
function toggleArbPanel(){const p=document.getElementById('arbPanel'),b=document.getElementById('arbHeaderBtn');p.classList.toggle('collapsed');b.classList.toggle('active',!p.classList.contains('collapsed'));if(!p.classList.contains('collapsed'))loadArbitrage();}
function switchArbTab(tab){arbTab=tab;document.getElementById('arbTabActive').classList.toggle('active',tab==='active');document.getElementById('arbTabHistory').classList.toggle('active',tab==='history');document.getElementById('arbActivePanel').style.display=tab==='active'?'block':'none';document.getElementById('arbHistoryPanel').style.display=tab==='history'?'block':'none';}

async function loadArbitrage(){try{const r=await fetch('/api/arbitrage');const j=await r.json();if(j.success)renderArbitrage(j.data);}catch(e){}}
function renderSparkline(snaps){if(!snaps||snaps.length<2)return '';const mx=Math.max(...snaps.map(s=>s.profit)),mn=Math.min(...snaps.map(s=>s.profit)),rng=mx-mn||1;return`<div class="arb-spark">${snaps.map(s=>`<div class="arb-spark-bar" style="height:${Math.max(2,((s.profit-mn)/rng)*18)}px"></div>`).join('')}</div>`;}
function renderArbCard(w,live){const sc=live?'live':'closed',st=live?t('arb_status_open'):t('arb_status_closed');return`<div class="arb-card ${sc}"><div class="arb-route"><span class="arb-exchange exchange-badge exchange-${w.buyExchange}">${w.buyExchange}</span><span class="arb-arrow"> → </span><span class="arb-exchange exchange-badge exchange-${w.sellExchange}">${w.sellExchange}</span><div style="font-size:10px;color:var(--dim);margin-top:4px">${w.crypto}/JPY</div></div><div class="arb-prices"><div><span class="label">${t('arb_buy_at')}</span> <span style="color:var(--green)">¥${fmt(w.buyPrice)}</span></div><div><span class="label">${t('arb_sell_at')}</span> <span style="color:var(--red)">¥${fmt(w.sellPrice)}</span></div><div><span class="label">${t('arb_per_unit')}</span> +¥${fmt(w.profitPerUnit)}</div></div><div class="arb-volume-cell"><div class="arb-volume-row"><span class="label">${t('arb_volume')}</span> ${fmtInt(w.maxVolume)} ${w.crypto}</div><div class="arb-volume-row"><span class="label">${t('arb_max_profit')}</span> <span class="arb-max-profit">¥${fmtInt(w.maxProfitJPY)}</span></div><div class="arb-volume-row"><span class="label">${t('arb_buy_limit')}</span> ¥${fmtInt(w.buyMinLimit)}-¥${fmtInt(w.buyMaxLimit)}</div><div class="arb-volume-row"><span class="label">${t('arb_sell_limit')}</span> ¥${fmtInt(w.sellMinLimit)}-¥${fmtInt(w.sellMaxLimit)}</div></div><div class="arb-profit-cell"><div class="arb-profit-big">+${fmt(w.profitPercent,2)}%</div><div style="font-size:10px;color:var(--dim)">${t('arb_peak')}: +${fmt(w.peakProfit,2)}%</div>${renderSparkline(w.snapshots)}</div><div class="arb-timing"><div><span class="arb-status ${sc}">${st}</span></div><div class="arb-duration-val">${fmtDuration(w.durationMs||0)}</div><div style="font-size:10px">${t('arb_opened')}: ${fmtTime(w.openedAt)}</div>${w.closedAt?`<div style="font-size:10px">${t('arb_closed')}: ${fmtTime(w.closedAt)}</div>`:`<div style="font-size:10px;color:var(--green)">${t('arb_now')}</div>`}</div></div>`;}
function renderArbitrage(data){const aEl=document.getElementById('arbActiveList'),hEl=document.getElementById('arbHistoryList'),badge=document.getElementById('arbActiveBadge');badge.textContent=data.active.length;badge.classList.toggle('zero',data.active.length===0);aEl.innerHTML=data.active.length?data.active.map(w=>renderArbCard(w,true)).join(''):`<div class="arb-empty">${t('arb_none_active')}</div>`;hEl.innerHTML=data.history.length?data.history.map(w=>renderArbCard(w,false)).join(''):`<div class="arb-empty">${t('arb_none_history')}</div>`;}

// Data
async function loadData(){try{const r=await fetch(`/api/rates/${currentCrypto}`);const j=await r.json();if(!j.success)return;rawData=j.data;allPaymentMethods.clear();allExchanges.clear();rawData.rates.forEach(r=>{allExchanges.add(r.exchange);[...r.buyOrders,...r.sellOrders].forEach(o=>o.paymentMethods.forEach(m=>{if(m)allPaymentMethods.add(m);}));});buildChips();renderData(rawData);loadArbitrage();}catch(e){console.error(e);}}

function renderData(data){
  const spot=data.spotPrices?.[currentCrypto];
  document.getElementById('spotPrices').textContent=spot?`Spot: ¥${fmt(spot)}`:'';
  document.getElementById('buyTitle').textContent=tf('buy_title',currentCrypto);
  document.getElementById('sellTitle').textContent=tf('sell_title',currentCrypto);
  document.getElementById('buyDesc').textContent=t('buy_desc');
  document.getElementById('sellDesc').textContent=t('sell_desc');

  let buys=[],sells=[];
  data.rates.forEach(r=>{buys.push(...r.buyOrders.filter(pass));sells.push(...r.sellOrders.filter(pass));});

  // Hero
  if(buys.length){var avgB=buys.reduce((s,o)=>s+o.price,0)/buys.length;document.getElementById('bestBuyPrice').textContent='¥'+fmt(avgB);document.getElementById('bestBuyExchange').textContent=buys.length+' orders';}
  else{document.getElementById('bestBuyPrice').textContent='--';document.getElementById('bestBuyExchange').textContent='--';}
  if(sells.length){var avgS=sells.reduce((s,o)=>s+o.price,0)/sells.length;document.getElementById('bestSellPrice').textContent='¥'+fmt(avgS);document.getElementById('bestSellExchange').textContent=sells.length+' orders';}
  else{document.getElementById('bestSellPrice').textContent='--';document.getElementById('bestSellExchange').textContent='--';}
  if(buys.length&&sells.length){document.getElementById('bestSpread').textContent='¥'+fmt(sells.reduce((s,o)=>s+o.price,0)/sells.length-buys.reduce((s,o)=>s+o.price,0)/buys.length);}

  // Volume within threshold% of spot
  var th=volThreshold/100;
  if(spot&&buys.length){var buyVol=0;buys.forEach(function(o){if(o.price<=spot*(1+th)){buyVol+=o.available*o.price;}});document.getElementById('volBuy5').textContent='¥'+fmtInt(buyVol);}
  else{document.getElementById('volBuy5').textContent='--';}
  if(spot&&sells.length){var sellVol=0;sells.forEach(function(o){if(o.price>=spot*(1-th)){sellVol+=o.available*o.price;}});document.getElementById('volSell5').textContent='¥'+fmtInt(sellVol);}
  else{document.getElementById('volSell5').textContent='--';}

  // Filter count
  const total=data.rates.reduce((s,r)=>s+r.buyOrders.length+r.sellOrders.length,0);
  document.getElementById('filterCount').textContent=`${buys.length+sells.length} / ${total}`;

  renderTable('buyTable','buyCount',buys,'buy',spot);
  renderTable('sellTable','sellCount',sells,'sell',spot);
}

function renderTable(tid,cid,orders,side,spot){
  const tbody=document.querySelector(`#${tid} tbody`);
  if(side==='buy')orders.sort((a,b)=>a.price-b.price);else orders.sort((a,b)=>b.price-a.price);
  const show=orders.slice(0,40);
  document.getElementById(cid).textContent=orders.length;
  if(!show.length){tbody.innerHTML=`<tr><td colspan="9" class="loading">${t('no_orders')}</td></tr>`;return;}
  tbody.innerHTML=show.map((o,i)=>{
    const r=i+1,rc=r<=3?`rank-${r}`:'';
    const prem=spot?((o.price-spot)/spot*100):null;
    const pc=prem>0?'premium-positive':'premium-negative';
    const compVal=o.merchant.completionRate;
    const cc=compVal>=95?'completion-high':compVal>=80?'completion-mid':'completion-low';
    const pays=o.paymentMethods.slice(0,3).map(p=>`<span class="payment-tag ${filters.payments.size&&filters.payments.has(p)?'payment-active':''}">${p}</span>`).join('');
    return`<tr><td><span class="rank ${rc}">${r}</span></td><td><span class="exchange-badge exchange-${o.exchange}">${o.exchange}</span></td><td class="price-cell">${fmt(o.price)}</td><td><span class="${pc}">${prem!=null?(prem>0?'+':'')+fmt(prem,2)+'%':'--'}</span></td><td>${fmtInt(o.available)}</td><td style="font-size:10px">${fmtInt(o.minLimit)}-${fmtInt(o.maxLimit)}</td><td><span class="online-dot ${o.merchant.isOnline?'on':'off'}"></span>${o.merchant.name}</td><td class="${cc}"><div class="completion-bar"><div class="completion-fill" style="width:${Math.min(compVal,100)}%"></div></div>${fmt(compVal,0)}%</td><td>${pays}</td></tr>`;
  }).join('');
}

async function refresh(){document.getElementById('refreshBtn').innerHTML='&#x23F3;';await loadData();document.getElementById('refreshBtn').innerHTML='&#x21bb;';countdown=30;}
setInterval(()=>{countdown--;document.getElementById('countdown').textContent=countdown;if(countdown<=0){countdown=30;loadData();}},1000);
loadData();
