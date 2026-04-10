/* simulator-app.js — External JS for simulator.html (CSP compliant, no inline scripts) */

document.addEventListener('DOMContentLoaded', function() {

  /* ==============================
     Theme toggle
     ============================== */
  function toggleTheme() {
    var html = document.documentElement;
    var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('bkpay_theme', next);
    var btn = document.getElementById('themeBtn');
    btn.textContent = next === 'dark' ? 'D' : 'L';
  }

  (function initTheme() {
    var saved = localStorage.getItem('bkpay_theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
      var btn = document.getElementById('themeBtn');
      if (btn) btn.textContent = saved === 'dark' ? 'D' : 'L';
    }
  })();

  /* ==============================
     Number formatting helpers
     ============================== */
  function formatJPY(n) {
    if (n == null || isNaN(n)) return '--';
    return '\u00a5' + Math.round(n).toLocaleString('ja-JP');
  }

  function formatCrypto(n, crypto) {
    if (n == null || isNaN(n)) return '--';
    var decimals = crypto === 'BTC' ? 8 : crypto === 'ETH' ? 6 : 2;
    return parseFloat(n).toFixed(decimals) + ' ' + crypto;
  }

  function formatRate(n) {
    if (n == null || isNaN(n)) return '--';
    return '\u00a5' + parseFloat(n).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPct(n) {
    if (n == null || isNaN(n)) return '--';
    return parseFloat(n).toFixed(2) + '%';
  }

  function parseAmount(str) {
    if (!str) return 0;
    return parseInt(String(str).replace(/[,\s\u00a5]/g, ''), 10) || 0;
  }

  /* ==============================
     Input formatting (auto commas)
     ============================== */
  function setupAmountInput(inputEl) {
    inputEl.addEventListener('input', function() {
      var raw = this.value.replace(/[^\d]/g, '');
      if (raw === '') { this.value = ''; return; }
      this.value = parseInt(raw, 10).toLocaleString('ja-JP');
    });
  }

  setupAmountInput(document.getElementById('totalAmount'));
  setupAmountInput(document.getElementById('maxPerOrder'));

  /* ==============================
     Toast
     ============================== */
  function showToast(msg, type) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + (type || '');
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(function() { el.classList.remove('show'); }, 3000);
  }

  /* ==============================
     Exchange colors
     ============================== */
  var EXCHANGE_COLORS = {
    'Bybit':   '#f7a600',
    'Binance': '#f3ba2f',
    'OKX':     '#00c6fb',
    'HTX':     '#2962ff',
    'KuCoin':  '#23af91',
    'Gate.io': '#eb4d4b',
    'MEXC':    '#1772f8',
    'Huobi':   '#2962ff'
  };

  function getExchangeColor(name) {
    return EXCHANGE_COLORS[name] || '#' + (name.split('').reduce(function(h, c) { return ((h << 5) - h + c.charCodeAt(0)) | 0; }, 0) & 0xFFFFFF).toString(16).padStart(6, '0');
  }

  /* ==============================
     Simulate: POST /api/simulator/bulk
     ============================== */
  async function runSimulation() {
    var totalAmountJpy = parseAmount(document.getElementById('totalAmount').value);
    var crypto = document.getElementById('cryptoSelect').value;
    var maxPerOrderRaw = parseAmount(document.getElementById('maxPerOrder').value);
    var maxPerOrder = maxPerOrderRaw > 0 ? maxPerOrderRaw : undefined;

    if (!totalAmountJpy || totalAmountJpy < 1000) {
      showToast('\u5408\u8a08\u91d1\u984d\u30921,000\u5186\u4ee5\u4e0a\u3067\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', 'error');
      return;
    }

    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('optimizationSection').classList.add('hidden');
    document.getElementById('simulateBtn').disabled = true;
    document.getElementById('optimizeBtn').disabled = true;

    try {
      var resp = await fetch('/api/simulator/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalAmountJpy: totalAmountJpy, crypto: crypto, maxPerOrder: maxPerOrder })
      });

      if (!resp.ok) throw new Error('API error: ' + resp.status);
      var data = await resp.json();

      renderResults(data, crypto);
      showToast('\u30b7\u30df\u30e5\u30ec\u30fc\u30b7\u30e7\u30f3\u5b8c\u4e86', 'success');
    } catch (err) {
      console.error('Simulation error:', err);
      showToast('\u30b7\u30df\u30e5\u30ec\u30fc\u30b7\u30e7\u30f3\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ' + err.message, 'error');

      renderResults(generateMockBulkData(totalAmountJpy, crypto, maxPerOrder), crypto);
    } finally {
      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('simulateBtn').disabled = false;
      document.getElementById('optimizeBtn').disabled = false;
    }
  }

  /* ==============================
     Render simulation results
     ============================== */
  function renderResults(data, crypto) {
    var section = document.getElementById('resultsSection');
    section.classList.remove('hidden');

    document.getElementById('totalCrypto').textContent = formatCrypto(data.totalCryptoAmount, crypto);
    document.getElementById('effectiveRate').textContent = formatRate(data.effectiveRate);
    document.getElementById('savings').textContent = formatJPY(data.savingsVsSingle);
    document.getElementById('orderCount').textContent = (data.orders || []).length;

    var tbody = document.getElementById('ordersBody');
    var orders = data.orders || [];

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">\u8a72\u5f53\u3059\u308b\u6ce8\u6587\u306f\u3042\u308a\u307e\u305b\u3093</td></tr>';
    } else {
      tbody.innerHTML = orders.map(function(o, i) {
        var compClass = o.completionRate >= 95 ? 'completion-high' : o.completionRate >= 80 ? 'completion-mid' : 'completion-low';
        var exchangeClass = 'exchange-' + (o.exchange || '').replace(/[^a-zA-Z]/g, '');
        return '<tr>' +
          '<td style="font-weight:700;color:var(--dim)">' + (i + 1) + '</td>' +
          '<td><span class="exchange-badge ' + exchangeClass + '">' + escapeHtml(o.exchange) + '</span></td>' +
          '<td style="font-weight:600">' + escapeHtml(o.merchant || '--') + '</td>' +
          '<td style="font-weight:700">' + formatJPY(o.amountJpy) + '</td>' +
          '<td>' + formatRate(o.rate) + '</td>' +
          '<td style="font-weight:700;color:var(--primary)">' + formatCrypto(o.cryptoAmount, crypto) + '</td>' +
          '<td>' +
            '<span class="' + compClass + '">' +
              '<span class="completion-bar"><span class="completion-fill" style="width:' + Math.min(100, o.completionRate || 0) + '%"></span></span>' +
              formatPct(o.completionRate) +
            '</span>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    renderBarChart(orders, crypto);
  }

  /* ==============================
     Bar chart - distribution by exchange
     ============================== */
  function renderBarChart(orders, crypto) {
    var container = document.getElementById('barChart');
    var legend = document.getElementById('chartLegend');

    var exchangeMap = {};
    orders.forEach(function(o) {
      var ex = o.exchange || 'Unknown';
      if (!exchangeMap[ex]) exchangeMap[ex] = { jpy: 0, crypto: 0, count: 0 };
      exchangeMap[ex].jpy += (o.amountJpy || 0);
      exchangeMap[ex].crypto += (o.cryptoAmount || 0);
      exchangeMap[ex].count += 1;
    });

    var exchanges = Object.keys(exchangeMap);
    if (exchanges.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128202;</div>\u30c7\u30fc\u30bf\u306a\u3057</div>';
      legend.innerHTML = '';
      return;
    }

    var maxJpy = Math.max.apply(null, exchanges.map(function(e) { return exchangeMap[e].jpy; }));

    container.innerHTML = exchanges.map(function(ex) {
      var d = exchangeMap[ex];
      var heightPct = maxJpy > 0 ? (d.jpy / maxJpy) * 100 : 0;
      var color = getExchangeColor(ex);

      return '<div class="bar-group">' +
        '<div class="bar-value">' + formatJPY(d.jpy) + '</div>' +
        '<div class="bar-stack">' +
          '<div class="bar-segment" style="height:' + Math.max(4, heightPct) + '%;background:' + color + '">' +
            '<div class="bar-tooltip">' +
              '<strong>' + escapeHtml(ex) + '</strong><br>' +
              formatJPY(d.jpy) + '<br>' +
              formatCrypto(d.crypto, crypto) + '<br>' +
              d.count + '\u4ef6' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bar-label">' + escapeHtml(ex) + '</div>' +
      '</div>';
    }).join('');

    legend.innerHTML = exchanges.map(function(ex) {
      var color = getExchangeColor(ex);
      return '<div class="legend-item">' +
        '<div class="legend-dot" style="background:' + color + '"></div>' +
        escapeHtml(ex) + ' (' + exchangeMap[ex].count + '\u4ef6)' +
      '</div>';
    }).join('');
  }

  /* ==============================
     Optimize: POST /api/simulator/optimize
     ============================== */
  async function runOptimization() {
    var totalAmountJpy = parseAmount(document.getElementById('totalAmount').value);
    var crypto = document.getElementById('cryptoSelect').value;

    if (!totalAmountJpy || totalAmountJpy < 1000) {
      showToast('\u5408\u8a08\u91d1\u984d\u30921,000\u5186\u4ee5\u4e0a\u3067\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044', 'error');
      return;
    }

    document.getElementById('loadingState').classList.remove('hidden');
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('optimizationSection').classList.add('hidden');
    document.getElementById('simulateBtn').disabled = true;
    document.getElementById('optimizeBtn').disabled = true;

    try {
      var resp = await fetch('/api/simulator/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalAmountJpy: totalAmountJpy, crypto: crypto })
      });

      if (!resp.ok) throw new Error('API error: ' + resp.status);
      var data = await resp.json();

      renderOptimization(data, crypto, totalAmountJpy);
      showToast('\u6700\u9069\u5316\u5b8c\u4e86', 'success');
    } catch (err) {
      console.error('Optimization error:', err);
      showToast('\u6700\u9069\u5316\u306b\u5931\u6557\u3057\u307e\u3057\u305f - \u30c7\u30e2\u30c7\u30fc\u30bf\u3092\u8868\u793a', 'error');

      renderOptimization(generateMockOptData(totalAmountJpy, crypto), crypto, totalAmountJpy);
    } finally {
      document.getElementById('loadingState').classList.add('hidden');
      document.getElementById('simulateBtn').disabled = false;
      document.getElementById('optimizeBtn').disabled = false;
    }
  }

  /* ==============================
     Render optimization comparison
     ============================== */
  function renderOptimization(data, crypto, totalAmountJpy) {
    var section = document.getElementById('optimizationSection');
    section.classList.remove('hidden');

    var strategies = data.strategies || [];
    var grid = document.getElementById('optGrid');

    var strategyMeta = {
      conservative: {
        name: '\u5b89\u5168\u91cd\u8996',
        nameEn: 'Conservative',
        desc: '\u5b8c\u4e86\u7387\u304c\u9ad8\u3044\u696d\u8005\u3092\u512a\u5148\u3002\u5c11\u6570\u306e\u4fe1\u983c\u6027\u9ad8\u3044\u6ce8\u6587\u306b\u5206\u5272\u3002',
        descEn: 'Prioritizes high completion rate merchants with fewer orders.',
        icon: '&#128737;'
      },
      balanced: {
        name: '\u30d0\u30e9\u30f3\u30b9\u578b',
        nameEn: 'Balanced',
        desc: '\u30ec\u30fc\u30c8\u3068\u5b8c\u4e86\u7387\u306e\u30d0\u30e9\u30f3\u30b9\u3092\u8003\u616e\u3057\u305f\u6700\u9069\u5206\u5272\u3002',
        descEn: 'Balances rate optimization with completion reliability.',
        icon: '&#9878;'
      },
      aggressive: {
        name: '\u30ec\u30fc\u30c8\u91cd\u8996',
        nameEn: 'Aggressive',
        desc: '\u6700\u5b89\u30ec\u30fc\u30c8\u3092\u8ffd\u6c42\u3002\u591a\u6570\u306e\u6ce8\u6587\u306b\u7d30\u5206\u5316\u3002',
        descEn: 'Pursues the best rates with more granular order splitting.',
        icon: '&#9889;'
      }
    };

    grid.innerHTML = strategies.map(function(s, idx) {
      var meta = strategyMeta[s.strategy] || { name: s.strategy, desc: '', icon: '&#9733;' };
      var isRecommended = s.recommended || s.strategy === 'balanced';

      var savingsColor = (s.savingsVsSingle || 0) > 0 ? 'green' : 'red';
      var rateColor = 'blue';
      var completionColor = (s.avgCompletionRate || 0) >= 95 ? 'green' : (s.avgCompletionRate || 0) >= 80 ? 'yellow' : 'red';

      return '<div class="opt-card ' + (isRecommended ? 'recommended' : '') + '">' +
        '<div class="opt-header">' +
          '<div class="opt-name">' + meta.icon + ' ' + meta.name + '</div>' +
          '<div class="opt-desc">' + meta.desc + '</div>' +
        '</div>' +
        '<div class="opt-metrics">' +
          '<div class="opt-metric">' +
            '<span class="opt-metric-label" data-i18n="sim_total_crypto">\u5408\u8a08\u6697\u53f7\u901a\u8ca8</span>' +
            '<span class="opt-metric-val ' + rateColor + '">' + formatCrypto(s.totalCryptoAmount, crypto) + '</span>' +
          '</div>' +
          '<div class="opt-metric">' +
            '<span class="opt-metric-label" data-i18n="sim_effective_rate">\u5b9f\u52b9\u30ec\u30fc\u30c8</span>' +
            '<span class="opt-metric-val">' + formatRate(s.effectiveRate) + '</span>' +
          '</div>' +
          '<div class="opt-metric">' +
            '<span class="opt-metric-label" data-i18n="sim_savings">\u7bc0\u7d04\u984d</span>' +
            '<span class="opt-metric-val ' + savingsColor + '">' + formatJPY(s.savingsVsSingle) + '</span>' +
          '</div>' +
          '<div class="opt-metric">' +
            '<span class="opt-metric-label" data-i18n="sim_order_count">\u6ce8\u6587\u6570</span>' +
            '<span class="opt-metric-val">' + (s.orderCount || (s.orders || []).length || '--') + '</span>' +
          '</div>' +
          '<div class="opt-metric">' +
            '<span class="opt-metric-label" data-i18n="sim_avg_completion">\u5e73\u5747\u5b8c\u4e86\u7387</span>' +
            '<span class="opt-metric-val ' + completionColor + '">' + formatPct(s.avgCompletionRate) + '</span>' +
          '</div>' +
          '<div class="opt-metric">' +
            '<span class="opt-metric-label" data-i18n="sim_est_time">\u63a8\u5b9a\u6240\u8981\u6642\u9593</span>' +
            '<span class="opt-metric-val">' + (s.estimatedMinutes ? s.estimatedMinutes + '\u5206' : '--') + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="opt-select-btn" data-action="apply-strategy" data-strategy-index="' + idx + '" data-i18n="sim_apply_strategy">\u3053\u306e\u6226\u7565\u3067\u5b9f\u884c</button>' +
      '</div>';
    }).join('');

    // Store strategies for later use
    window._optimizationStrategies = strategies;
    window._optimizationCrypto = crypto;
  }

  /* ==============================
     Apply selected strategy
     ============================== */
  function applyStrategy(idx) {
    var strategies = window._optimizationStrategies;
    var crypto = window._optimizationCrypto;
    if (!strategies || !strategies[idx]) return;

    var s = strategies[idx];
    var data = {
      totalCryptoAmount: s.totalCryptoAmount,
      effectiveRate: s.effectiveRate,
      savingsVsSingle: s.savingsVsSingle,
      orders: s.orders || []
    };

    renderResults(data, crypto);
    showToast('"' + (s.strategy === 'conservative' ? '\u5b89\u5168\u91cd\u8996' : s.strategy === 'balanced' ? '\u30d0\u30e9\u30f3\u30b9\u578b' : '\u30ec\u30fc\u30c8\u91cd\u8996') + '" \u6226\u7565\u3092\u9069\u7528\u3057\u307e\u3057\u305f', 'success');

    document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ==============================
     Mock data generators (fallback)
     ============================== */
  function generateMockBulkData(totalJpy, crypto, maxPerOrder) {
    var exchangesList = ['Bybit', 'Binance', 'OKX', 'HTX'];
    var merchants = ['CryptoShop_JP', 'FastTrade_24', 'SakuraCoin', 'TokyoBit', 'AsiaP2P', 'MountFuji_BTC', 'NihonCrypto', 'PayEasyJP'];

    var baseRate = crypto === 'BTC' ? 15200000 : crypto === 'ETH' ? 540000 : 155.20;
    var limit = maxPerOrder || Math.min(totalJpy, 500000);
    var numOrders = Math.max(2, Math.ceil(totalJpy / limit));
    var orders = [];
    var remaining = totalJpy;

    for (var i = 0; i < numOrders && remaining > 0; i++) {
      var amt = i === numOrders - 1 ? remaining : Math.min(limit, Math.round(remaining / (numOrders - i) * (0.8 + Math.random() * 0.4)));
      var rateVariance = baseRate * (0.997 + Math.random() * 0.006);
      var exchange = exchangesList[i % exchangesList.length];
      var merchant = merchants[Math.floor(Math.random() * merchants.length)];
      var completionRate = 85 + Math.random() * 15;
      var cryptoAmount = amt / rateVariance;

      orders.push({
        exchange: exchange,
        merchant: merchant,
        amountJpy: Math.round(amt),
        rate: parseFloat(rateVariance.toFixed(2)),
        cryptoAmount: parseFloat(cryptoAmount.toFixed(crypto === 'BTC' ? 8 : crypto === 'ETH' ? 6 : 2)),
        completionRate: parseFloat(completionRate.toFixed(1))
      });

      remaining -= amt;
    }

    var totalCrypto = orders.reduce(function(s, o) { return s + o.cryptoAmount; }, 0);
    var effectiveRate = totalJpy / totalCrypto;
    var singleRate = baseRate * 1.003;
    var singleCrypto = totalJpy / singleRate;
    var savingsVsSingle = (totalCrypto - singleCrypto) * singleRate;

    return {
      totalCryptoAmount: parseFloat(totalCrypto.toFixed(crypto === 'BTC' ? 8 : crypto === 'ETH' ? 6 : 2)),
      effectiveRate: parseFloat(effectiveRate.toFixed(2)),
      savingsVsSingle: Math.round(savingsVsSingle),
      orders: orders
    };
  }

  function generateMockOptData(totalJpy, crypto) {
    var baseRate = crypto === 'BTC' ? 15200000 : crypto === 'ETH' ? 540000 : 155.20;

    function genStrategy(type) {
      var rateMultiplier, orderCount, avgCompletion, estMinutes;

      if (type === 'conservative') {
        rateMultiplier = 1.001;
        orderCount = Math.max(2, Math.ceil(totalJpy / 500000));
        avgCompletion = 97.5;
        estMinutes = Math.ceil(orderCount * 3);
      } else if (type === 'balanced') {
        rateMultiplier = 0.999;
        orderCount = Math.max(3, Math.ceil(totalJpy / 300000));
        avgCompletion = 94.2;
        estMinutes = Math.ceil(orderCount * 2.5);
      } else {
        rateMultiplier = 0.997;
        orderCount = Math.max(4, Math.ceil(totalJpy / 150000));
        avgCompletion = 88.6;
        estMinutes = Math.ceil(orderCount * 2);
      }

      var rate = baseRate * rateMultiplier;
      var totalCrypto = totalJpy / rate;
      var singleRate = baseRate * 1.003;
      var singleCrypto = totalJpy / singleRate;
      var savings = (totalCrypto - singleCrypto) * singleRate;

      var exchangesList = ['Bybit', 'Binance', 'OKX', 'HTX'];
      var merchantsList = ['CryptoShop_JP', 'FastTrade_24', 'SakuraCoin', 'TokyoBit', 'AsiaP2P'];
      var orders = [];
      var remaining = totalJpy;
      var perOrder = Math.ceil(totalJpy / orderCount);

      for (var i = 0; i < orderCount; i++) {
        var amt = i === orderCount - 1 ? remaining : Math.min(perOrder, remaining);
        var r = rate * (0.998 + Math.random() * 0.004);
        orders.push({
          exchange: exchangesList[i % exchangesList.length],
          merchant: merchantsList[i % merchantsList.length],
          amountJpy: Math.round(amt),
          rate: parseFloat(r.toFixed(2)),
          cryptoAmount: parseFloat((amt / r).toFixed(crypto === 'BTC' ? 8 : crypto === 'ETH' ? 6 : 2)),
          completionRate: parseFloat((avgCompletion - 2 + Math.random() * 4).toFixed(1))
        });
        remaining -= amt;
      }

      return {
        strategy: type,
        recommended: type === 'balanced',
        totalCryptoAmount: parseFloat(totalCrypto.toFixed(crypto === 'BTC' ? 8 : crypto === 'ETH' ? 6 : 2)),
        effectiveRate: parseFloat(rate.toFixed(2)),
        savingsVsSingle: Math.round(savings),
        orderCount: orderCount,
        avgCompletionRate: avgCompletion,
        estimatedMinutes: estMinutes,
        orders: orders
      };
    }

    return {
      strategies: [
        genStrategy('conservative'),
        genStrategy('balanced'),
        genStrategy('aggressive')
      ]
    };
  }

  /* ==============================
     Utility
     ============================== */
  function escapeHtml(str) {
    if (!str) return '';
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, function(m) { return map[m]; });
  }

  /* ==============================
     Event listeners (replacing inline handlers)
     ============================== */

  // Theme toggle button
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);

  // Simulate button
  document.getElementById('simulateBtn').addEventListener('click', function() {
    runSimulation();
  });

  // Optimize button
  document.getElementById('optimizeBtn').addEventListener('click', function() {
    runOptimization();
  });

  // Event delegation for dynamically generated "apply strategy" buttons
  document.getElementById('optGrid').addEventListener('click', function(e) {
    var target = e.target.closest('[data-action="apply-strategy"]');
    if (!target) return;
    var idx = parseInt(target.dataset.strategyIndex);
    if (!isNaN(idx)) {
      applyStrategy(idx);
    }
  });

  /* ==============================
     Keyboard shortcut
     ============================== */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      var active = document.activeElement;
      if (active && (active.id === 'totalAmount' || active.id === 'maxPerOrder')) {
        e.preventDefault();
        runSimulation();
      }
    }
  });

});
