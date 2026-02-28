let currentCrypto = 'USDT';
let countdown = 30;
let timer = null;

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCrypto = tab.dataset.crypto;
    document.querySelectorAll('.current-crypto').forEach(el => el.textContent = currentCrypto);
    loadData();
  });
});

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
    renderData(json.data);
  } catch (err) {
    console.error('Fetch error:', err);
  }
}

function renderData(data) {
  // Spot prices
  const spotEl = document.getElementById('spotPrices');
  const spotPrice = data.spotPrices?.[currentCrypto];
  spotEl.innerHTML = spotPrice 
    ? `<div class="spot-item"><span class="spot-label">Spot:</span> <span class="spot-val">¥${fmt(spotPrice)}</span></div>` 
    : '';

  // Best prices
  if (data.bestBuyExchange) {
    document.getElementById('bestBuyPrice').textContent = `¥${fmt(data.bestBuyExchange.price)}`;
    document.getElementById('bestBuyExchange').textContent = data.bestBuyExchange.exchange;
  }
  if (data.bestSellExchange) {
    document.getElementById('bestSellPrice').textContent = `¥${fmt(data.bestSellExchange.price)}`;
    document.getElementById('bestSellExchange').textContent = data.bestSellExchange.exchange;
  }
  
  // Best spread
  const allBuys = data.rates.filter(r => r.bestBuy).map(r => r.bestBuy);
  const allSells = data.rates.filter(r => r.bestSell).map(r => r.bestSell);
  if (allBuys.length && allSells.length) {
    const maxSpread = Math.max(...allSells) - Math.min(...allBuys);
    document.getElementById('bestSpread').textContent = `¥${fmt(maxSpread)}`;
  }

  // Arbitrage alert
  const arbAlert = document.getElementById('arbAlert');
  const arbContent = document.getElementById('arbContent');
  if (data.arbitrageOpportunities?.length > 0) {
    const best = data.arbitrageOpportunities[0];
    arbAlert.classList.remove('hidden');
    arbContent.innerHTML = `
      <div>裁定機会検出! <span class="arb-profit">+${fmt(best.profitPercent, 2)}%</span></div>
      <div style="color:var(--dim);font-size:11px;margin-top:4px">
        ${best.buyExchange}で買い(¥${fmt(best.buyPrice)}) → ${best.sellExchange}で売り(¥${fmt(best.sellPrice)}) = 
        <span style="color:var(--green)">+¥${fmt(best.profitPerUnit)}/枚</span>
      </div>`;
  } else {
    arbAlert.classList.add('hidden');
  }

  // Spread bars
  const spreadBars = document.getElementById('spreadBars');
  const maxSpreadVal = Math.max(...data.rates.map(r => Math.abs(r.spread || 0)), 1);
  spreadBars.innerHTML = data.rates.map(r => {
    const w = r.spread ? Math.abs(r.spread) / maxSpreadVal * 100 : 0;
    const color = r.spread && r.spread > 0 ? 'var(--red)' : 'var(--green)';
    const premStr = r.buyPremium !== null ? `買プレミアム: ${r.buyPremium > 0 ? '+' : ''}${fmt(r.buyPremium, 2)}%` : '';
    return `<div class="spread-bar">
      <div class="ex-name">${r.exchange}</div>
      <div class="bar-wrap"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>
      <div class="spread-val" style="color:${color}">¥${fmt(r.spread)}</div>
      <div class="spread-detail">買: ¥${fmt(r.bestBuy)} / 売: ¥${fmt(r.bestSell)} ${premStr ? '| ' + premStr : ''}</div>
    </div>`;
  }).join('');

  // Order tables
  renderOrderTable('buyTable', data.rates, 'buy', spotPrice);
  renderOrderTable('sellTable', data.rates, 'sell', spotPrice);
}

function renderOrderTable(tableId, rates, side, spotPrice) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  let allOrders = [];
  rates.forEach(r => {
    const orders = side === 'buy' ? r.buyOrders : r.sellOrders;
    allOrders.push(...orders);
  });
  
  if (side === 'buy') allOrders.sort((a, b) => a.price - b.price);
  else allOrders.sort((a, b) => b.price - a.price);

  allOrders = allOrders.slice(0, 30);

  if (allOrders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="loading">データ取得中...</td></tr>';
    return;
  }

  tbody.innerHTML = allOrders.map((o, i) => {
    const rank = i + 1;
    const rankClass = rank <= 3 ? `rank-${rank}` : '';
    const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
    const premium = spotPrice ? ((o.price - spotPrice) / spotPrice * 100) : null;
    const premClass = premium > 0 ? 'premium-positive' : 'premium-negative';
    const compClass = o.merchant.completionRate >= 95 ? 'completion-high' : o.merchant.completionRate >= 80 ? 'completion-mid' : 'completion-low';
    const payments = o.paymentMethods.slice(0, 3).map(p => `<span class="payment-tag">${p}</span>`).join('');
    
    return `<tr>
      <td><span class="rank ${rankClass}">${rankEmoji}</span></td>
      <td><span class="exchange-badge exchange-${o.exchange}">${o.exchange}</span></td>
      <td class="price-cell">¥${fmt(o.price)}</td>
      <td><span class="${premClass}">${premium !== null ? (premium > 0 ? '+' : '') + fmt(premium, 2) + '%' : '--'}</span></td>
      <td>${fmtInt(o.available)} ${o.crypto}</td>
      <td style="font-size:11px">¥${fmtInt(o.minLimit)} - ¥${fmtInt(o.maxLimit)}</td>
      <td><span class="online-dot ${o.merchant.isOnline ? 'on' : 'off'}"></span>${o.merchant.name}</td>
      <td class="${compClass}">${fmt(o.merchant.completionRate, 1)}%<br><span style="color:var(--dim);font-size:10px">${o.merchant.orderCount}件</span></td>
      <td>${payments}</td>
    </tr>`;
  }).join('');
}

async function refresh() {
  document.getElementById('refreshBtn').textContent = '⏳';
  await loadData();
  document.getElementById('refreshBtn').textContent = '🔄';
  countdown = 30;
}

function startCountdown() {
  timer = setInterval(() => {
    countdown--;
    document.getElementById('countdown').textContent = countdown;
    if (countdown <= 0) {
      countdown = 30;
      loadData();
    }
  }, 1000);
}

// Init
loadData();
startCountdown();
