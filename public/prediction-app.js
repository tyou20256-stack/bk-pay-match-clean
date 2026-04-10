// prediction-app.js — Prediction page logic (extracted from prediction.html)
document.addEventListener('DOMContentLoaded', function() {

/* ===== State ===== */
const API = '/api';
let selectedCrypto = 'USDT';
let autoRefresh = true;
let refreshTimer = null;
let countdown = 60;
let predictionData = null;
let optimalTimeData = null;

/* ===== Auth ===== */
let token = document.cookie.split(';').map(function(c) { return c.trim(); }).find(function(c) { return c.startsWith('bkpay_token='); });
token = token ? token.split('=')[1] : '';
if (!token) token = localStorage.getItem('bkpay_token') || '';
const headers = function() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }; };

/* ===== Theme ===== */
function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = next;
  document.getElementById('themeBtn').textContent = next === 'dark' ? 'D' : 'L';
  localStorage.setItem('theme', next);
}
(function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved) {
    document.documentElement.dataset.theme = saved;
    document.getElementById('themeBtn').textContent = saved === 'dark' ? 'D' : 'L';
  }
})();

/* ===== Theme button binding ===== */
document.getElementById('themeBtn').addEventListener('click', toggleTheme);

/* ===== Crypto Tabs ===== */
document.getElementById('cryptoTabs').addEventListener('click', function(e) {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  this.querySelector('.active')?.classList.remove('active');
  btn.classList.add('active');
  selectedCrypto = btn.dataset.crypto;
  resetCountdown();
  loadAllData();
});

/* ===== Auto-refresh Toggle ===== */
const autoRefreshToggle = document.getElementById('autoRefreshToggle');
autoRefreshToggle.addEventListener('change', function() {
  autoRefresh = this.checked;
  const dot = document.getElementById('statusDot');
  if (autoRefresh) {
    dot.classList.remove('paused');
    resetCountdown();
    startCountdown();
  } else {
    dot.classList.add('paused');
    stopCountdown();
    document.getElementById('countdownText').textContent = '--';
  }
});

/* ===== Countdown ===== */
function startCountdown() {
  stopCountdown();
  refreshTimer = setInterval(function() {
    if (!autoRefresh) return;
    countdown--;
    document.getElementById('countdownText').textContent = countdown + 's';
    if (countdown <= 0) {
      loadAllData();
      countdown = 60;
    }
  }, 1000);
}

function stopCountdown() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function resetCountdown() {
  countdown = 60;
  document.getElementById('countdownText').textContent = '60s';
}

/* ===== API Fetch ===== */
async function apiFetch(path) {
  const r = await fetch(API + path, { headers: headers(), credentials: 'include' });
  if (r.status === 401) { window.location.href = '/admin.html'; return null; }
  const j = await r.json();
  return j;
}

/* ===== Formatting ===== */
function fmtRate(n) {
  if (n == null || isNaN(n)) return '--';
  return '\u00a5' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '--%';
  return Number(n).toFixed(1) + '%';
}

/* ===== Day Names ===== */
const DAY_NAMES_JA = ['\u65e5', '\u6708', '\u706b', '\u6c34', '\u6728', '\u91d1', '\u571f'];
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_ZH = ['\u65e5', '\u4e00', '\u4e8c', '\u4e09', '\u56db', '\u4e94', '\u516d'];
const DAY_NAMES_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function getDayNames() {
  const lang = typeof currentLang !== 'undefined' ? currentLang : 'ja';
  switch (lang) {
    case 'en': return DAY_NAMES_EN;
    case 'zh': return DAY_NAMES_ZH;
    case 'vi': return DAY_NAMES_VI;
    default: return DAY_NAMES_JA;
  }
}

function getDayName(index) {
  const names = getDayNames();
  return names[index] || names[0];
}

/* ===== Score Helpers ===== */
function getScoreClass(score) {
  if (score >= 70) return 'good';
  if (score >= 40) return 'mid';
  return 'bad';
}

function getScoreAdvice(score) {
  const lang = typeof currentLang !== 'undefined' ? currentLang : 'ja';
  if (lang === 'en') {
    if (score >= 70) return 'Good timing to buy. Market conditions are favorable.';
    if (score >= 40) return 'Average timing. Consider waiting for a better opportunity.';
    return 'Poor timing. It is recommended to wait before buying.';
  }
  if (lang === 'zh') {
    if (score >= 70) return '\u8d2d\u4e70\u65f6\u673a\u826f\u597d\u3002\u5e02\u573a\u6761\u4ef6\u6709\u5229\u3002';
    if (score >= 40) return '\u65f6\u673a\u4e00\u822c\u3002\u5efa\u8bae\u7b49\u5f85\u66f4\u597d\u7684\u673a\u4f1a\u3002';
    return '\u65f6\u673a\u4e0d\u4f73\u3002\u5efa\u8bae\u7b49\u5f85\u540e\u8d2d\u4e70\u3002';
  }
  if (lang === 'vi') {
    if (score >= 70) return 'Th\u1eddi \u0111i\u1ec3m t\u1ed1t \u0111\u1ec3 mua. \u0110i\u1ec1u ki\u1ec7n th\u1ecb tr\u01b0\u1eddng thu\u1eadn l\u1ee3i.';
    if (score >= 40) return 'Th\u1eddi \u0111i\u1ec3m trung b\u00ecnh. H\u00e3y c\u00e2n nh\u1eafc ch\u1edd th\u00eam.';
    return 'Th\u1eddi \u0111i\u1ec3m kh\u00f4ng t\u1ed1t. Khuy\u00ean ch\u1edd \u0111\u1ee3i.';
  }
  // ja default
  if (score >= 70) return '\u8cfc\u5165\u306e\u597d\u6a5f\u3067\u3059\u3002\u5e02\u5834\u72b6\u6cc1\u304c\u826f\u597d\u3067\u3059\u3002';
  if (score >= 40) return '\u5e73\u5747\u7684\u306a\u30bf\u30a4\u30df\u30f3\u30b0\u3067\u3059\u3002\u3082\u3046\u5c11\u3057\u5f85\u3064\u3053\u3068\u3092\u691c\u8a0e\u3057\u3066\u304f\u3060\u3055\u3044\u3002';
  return '\u8cfc\u5165\u306b\u306f\u4e0d\u5411\u304d\u3067\u3059\u3002\u5f85\u3064\u3053\u3068\u3092\u304a\u52e7\u3081\u3057\u307e\u3059\u3002';
}

/* ===== Direction Helpers ===== */
function getDirectionInfo(direction) {
  const lang = typeof currentLang !== 'undefined' ? currentLang : 'ja';
  const map = {
    up:   { ja: '\u4e0a\u6607', en: 'Rising', zh: '\u4e0a\u6da8', vi: 'T\u0103ng', arrow: '\u25b2', cls: 'up' },
    down: { ja: '\u4e0b\u964d', en: 'Falling', zh: '\u4e0b\u8dcc', vi: 'Gi\u1ea3m', arrow: '\u25bc', cls: 'down' },
    flat: { ja: '\u6a2a\u3070\u3044', en: 'Sideways', zh: '\u6a2a\u76d8', vi: 'Ngang', arrow: '\u25c6', cls: 'flat' }
  };
  const info = map[direction] || map['flat'];
  return { text: info[lang] || info['ja'], arrow: info.arrow, cls: info.cls };
}

/* ===== Render Prediction ===== */
function renderPrediction(data) {
  if (!data) return;
  predictionData = data;

  const score = data.buyTimingScore != null ? Math.round(data.buyTimingScore) : null;
  const direction = data.direction || 'flat';
  const confidence = data.confidence != null ? data.confidence : null;
  const currentRateVal = data.currentRate;
  const indicators = data.indicators || {};

  // Gauge
  const gaugeScore = document.getElementById('gaugeScore');
  const gaugeFill = document.getElementById('gaugeFill');
  const gaugeAdvice = document.getElementById('gaugeAdvice');

  if (score != null) {
    const cls = getScoreClass(score);
    gaugeScore.textContent = score;
    gaugeScore.className = 'gauge-score score-' + cls;

    const circumference = 534;
    const offset = circumference - (circumference * Math.min(score, 100) / 100);
    gaugeFill.style.strokeDashoffset = offset;
    gaugeFill.className = 'gauge-fill stroke-' + cls;

    gaugeAdvice.textContent = getScoreAdvice(score);
  } else {
    gaugeScore.textContent = '--';
    gaugeScore.className = 'gauge-score';
    gaugeFill.style.strokeDashoffset = 534;
    gaugeAdvice.textContent = '';
  }

  // Direction
  const dirInfo = getDirectionInfo(direction);
  const dirArrow = document.getElementById('directionArrow');
  const dirText = document.getElementById('directionText');
  dirArrow.textContent = dirInfo.arrow;
  dirArrow.className = 'direction-arrow ' + dirInfo.cls;
  dirText.textContent = dirInfo.text;
  dirText.className = 'direction-text ' + dirInfo.cls;

  // Confidence
  if (confidence != null) {
    document.getElementById('confidenceValue').textContent = fmtPct(confidence);
    document.getElementById('confidenceFill').style.width = Math.min(confidence, 100) + '%';
  } else {
    document.getElementById('confidenceValue').textContent = '--%';
    document.getElementById('confidenceFill').style.width = '0%';
  }

  // Current Rate
  document.getElementById('currentRate').textContent = fmtRate(currentRateVal);

  // Predicted direction display
  const predictedEl = document.getElementById('predictedDirection');
  const rateArrow = document.getElementById('rateArrow');
  if (direction === 'up') {
    predictedEl.textContent = dirInfo.arrow + ' ' + dirInfo.text;
    predictedEl.style.color = 'var(--green)';
    rateArrow.innerHTML = '&#8599;';
    rateArrow.style.color = 'var(--green)';
  } else if (direction === 'down') {
    predictedEl.textContent = dirInfo.arrow + ' ' + dirInfo.text;
    predictedEl.style.color = 'var(--red)';
    rateArrow.innerHTML = '&#8600;';
    rateArrow.style.color = 'var(--red)';
  } else {
    predictedEl.textContent = dirInfo.arrow + ' ' + dirInfo.text;
    predictedEl.style.color = 'var(--yellow)';
    rateArrow.innerHTML = '&#8594;';
    rateArrow.style.color = 'var(--yellow)';
  }

  // Indicators
  document.getElementById('sma12').textContent = fmtRate(indicators.sma12);
  document.getElementById('sma24').textContent = fmtRate(indicators.sma24);

  const volEl = document.getElementById('volatility');
  if (indicators.volatility != null) {
    volEl.textContent = fmtPct(indicators.volatility);
    const volLevel = indicators.volatility >= 5 ? 'var(--red)' : indicators.volatility >= 2 ? 'var(--yellow)' : 'var(--green)';
    volEl.style.color = volLevel;
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'ja';
    const volLabels = {
      ja: { high: '\u9ad8\u30dc\u30e9\u30c6\u30a3\u30ea\u30c6\u30a3', mid: '\u4e2d\u7a0b\u5ea6', low: '\u4f4e\u30dc\u30e9\u30c6\u30a3\u30ea\u30c6\u30a3' },
      en: { high: 'High volatility', mid: 'Moderate', low: 'Low volatility' },
      zh: { high: '\u9ad8\u6ce2\u52a8', mid: '\u4e2d\u7b49', low: '\u4f4e\u6ce2\u52a8' },
      vi: { high: 'Bi\u1ebfn \u0111\u1ed9ng cao', mid: 'Trung b\u00ecnh', low: 'Bi\u1ebfn \u0111\u1ed9ng th\u1ea5p' }
    };
    const labels = volLabels[lang] || volLabels['ja'];
    document.getElementById('volatilitySub').textContent = indicators.volatility >= 5 ? labels.high : indicators.volatility >= 2 ? labels.mid : labels.low;
  } else {
    volEl.textContent = '--%';
    volEl.style.color = '';
    document.getElementById('volatilitySub').textContent = '';
  }

  // Trend direction indicator
  const trendEl = document.getElementById('trendIndicator');
  const trendDir = indicators.trend || direction;
  const trendInfo = getDirectionInfo(trendDir);
  trendEl.textContent = trendInfo.arrow + ' ' + trendInfo.text;
  trendEl.style.color = trendDir === 'up' ? 'var(--green)' : trendDir === 'down' ? 'var(--red)' : 'var(--yellow)';

  // SMA cross info
  if (indicators.sma12 != null && indicators.sma24 != null) {
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'ja';
    const crossLabels = {
      ja: { golden: '\u30b4\u30fc\u30eb\u30c7\u30f3\u30af\u30ed\u30b9', dead: '\u30c7\u30c3\u30c9\u30af\u30ed\u30b9', neutral: '\u4e2d\u7acb' },
      en: { golden: 'Golden cross', dead: 'Dead cross', neutral: 'Neutral' },
      zh: { golden: '\u91d1\u53c9', dead: '\u6b7b\u53c9', neutral: '\u4e2d\u6027' },
      vi: { golden: 'Golden cross', dead: 'Dead cross', neutral: 'Trung t\u00ednh' }
    };
    const labels = crossLabels[lang] || crossLabels['ja'];
    if (indicators.sma12 > indicators.sma24) {
      document.getElementById('trendSub').textContent = labels.golden;
      document.getElementById('trendSub').style.color = 'var(--green)';
    } else if (indicators.sma12 < indicators.sma24) {
      document.getElementById('trendSub').textContent = labels.dead;
      document.getElementById('trendSub').style.color = 'var(--red)';
    } else {
      document.getElementById('trendSub').textContent = labels.neutral;
      document.getElementById('trendSub').style.color = '';
    }
  }

  // Update timestamp
  document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
}

/* ===== Render Optimal Time ===== */
function renderOptimalTime(data) {
  if (!data) return;
  optimalTimeData = data;

  // Best hour
  const bestHourEl = document.getElementById('bestHour');
  const bestHourSubEl = document.getElementById('bestHourSub');
  if (data.bestHour != null) {
    bestHourEl.textContent = String(data.bestHour).padStart(2, '0') + ':00';
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'ja';
    const hourDesc = {
      ja: '\u904e\u53bb\u30c7\u30fc\u30bf\u306b\u57fa\u3065\u304f\u6700\u9069\u6642\u9593',
      en: 'Based on historical data',
      zh: '\u57fa\u4e8e\u5386\u53f2\u6570\u636e',
      vi: 'D\u1ef1a tr\u00ean d\u1eef li\u1ec7u l\u1ecbch s\u1eed'
    };
    bestHourSubEl.textContent = hourDesc[lang] || hourDesc['ja'];
  } else {
    bestHourEl.textContent = '--:00';
    bestHourSubEl.textContent = '';
  }

  // Best day
  const bestDayEl = document.getElementById('bestDay');
  const bestDaySubEl = document.getElementById('bestDaySub');
  if (data.bestDay != null) {
    bestDayEl.textContent = getDayName(data.bestDay);
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'ja';
    const dayDesc = {
      ja: '\u6700\u3082\u30ec\u30fc\u30c8\u304c\u6709\u5229\u306a\u66dc\u65e5',
      en: 'Most favorable day for rates',
      zh: '\u6c47\u7387\u6700\u6709\u5229\u7684\u4e00\u5929',
      vi: 'Ng\u00e0y c\u00f3 t\u1ef7 gi\u00e1 thu\u1eadn l\u1ee3i nh\u1ea5t'
    };
    bestDaySubEl.textContent = dayDesc[lang] || dayDesc['ja'];
  } else {
    bestDayEl.textContent = '--';
    bestDaySubEl.textContent = '';
  }

  // Patterns
  renderPatterns(data.patterns);
}

/* ===== Render Patterns ===== */
function renderPatterns(patterns) {
  const hourlyContainer = document.getElementById('hourlyPatterns');
  const dailyContainer = document.getElementById('dailyPatterns');

  if (!patterns) {
    hourlyContainer.innerHTML = '<div style="color:var(--dim);font-size:12px;text-align:center;padding:12px">' + (typeof t === 'function' ? t('no_data') : '\u30c7\u30fc\u30bf\u304c\u3042\u308a\u307e\u305b\u3093') + '</div>';
    dailyContainer.innerHTML = '<div style="color:var(--dim);font-size:12px;text-align:center;padding:12px">' + (typeof t === 'function' ? t('no_data') : '\u30c7\u30fc\u30bf\u304c\u3042\u308a\u307e\u305b\u3093') + '</div>';
    return;
  }

  // Hourly patterns (show select hours for readability)
  const hourlyData = patterns.hourly || [];
  if (hourlyData.length > 0) {
    const maxVal = Math.max.apply(null, hourlyData.map(function(h) { return h.score || 0; }).concat([1]));
    const bestHourScore = optimalTimeData && optimalTimeData.bestHour != null
      ? (hourlyData.find(function(h) { return h.hour === optimalTimeData.bestHour; }) || {}).score || 0
      : 0;

    // Show every 2 hours for cleaner display
    const displayHours = hourlyData.filter(function(h) { return h.hour % 2 === 0; });
    hourlyContainer.innerHTML = displayHours.map(function(h) {
      const pct = Math.round((h.score / maxVal) * 100);
      const isBest = h.score === bestHourScore && h.score > 0;
      const barClass = isBest ? 'best' : (h.score >= maxVal * 0.7 ? 'good' : 'normal');
      return '<div class="pattern-row">' +
        '<div class="pattern-label">' + String(h.hour).padStart(2, '0') + 'h</div>' +
        '<div class="pattern-bar-wrap"><div class="pattern-bar ' + barClass + '" style="width:' + pct + '%"></div></div>' +
        '<div class="pattern-value">' + Math.round(h.score) + '</div>' +
      '</div>';
    }).join('');
  } else {
    hourlyContainer.innerHTML = '<div style="color:var(--dim);font-size:12px;text-align:center;padding:12px">' + (typeof t === 'function' ? t('no_data') : '\u30c7\u30fc\u30bf\u304c\u3042\u308a\u307e\u305b\u3093') + '</div>';
  }

  // Daily patterns
  const dailyData = patterns.daily || [];
  if (dailyData.length > 0) {
    const maxVal = Math.max.apply(null, dailyData.map(function(d) { return d.score || 0; }).concat([1]));
    const bestDayScore = optimalTimeData && optimalTimeData.bestDay != null
      ? (dailyData.find(function(d) { return d.day === optimalTimeData.bestDay; }) || {}).score || 0
      : 0;

    dailyContainer.innerHTML = dailyData.map(function(d) {
      const pct = Math.round((d.score / maxVal) * 100);
      const isBest = d.score === bestDayScore && d.score > 0;
      const barClass = isBest ? 'best' : (d.score >= maxVal * 0.7 ? 'good' : 'normal');
      return '<div class="pattern-row">' +
        '<div class="pattern-label">' + getDayName(d.day) + '</div>' +
        '<div class="pattern-bar-wrap"><div class="pattern-bar ' + barClass + '" style="width:' + pct + '%"></div></div>' +
        '<div class="pattern-value">' + Math.round(d.score) + '</div>' +
      '</div>';
    }).join('');
  } else {
    dailyContainer.innerHTML = '<div style="color:var(--dim);font-size:12px;text-align:center;padding:12px">' + (typeof t === 'function' ? t('no_data') : '\u30c7\u30fc\u30bf\u304c\u3042\u308a\u307e\u305b\u3093') + '</div>';
  }
}

/* ===== Show Loading State ===== */
function showLoading(sectionId, show) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  const existing = section.querySelector('.loading-overlay');
  if (show && !existing) {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<div class="spinner"></div><span>' + (typeof t === 'function' ? t('loading') : '\u8aad\u307f\u8fbc\u307f\u4e2d...') + '</span>';
    section.style.position = 'relative';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.background = 'var(--card)';
    overlay.style.borderRadius = '10px';
    overlay.style.zIndex = '10';
    section.appendChild(overlay);
  } else if (!show && existing) {
    existing.remove();
  }
}

/* ===== Load All Data ===== */
async function loadAllData() {
  try {
    const [predResponse, optResponse] = await Promise.all([
      apiFetch('/prediction/' + selectedCrypto),
      apiFetch('/prediction/' + selectedCrypto + '/optimal-time')
    ]);

    if (predResponse && predResponse.success !== false) {
      const predData = predResponse.data || predResponse;
      renderPrediction(predData);
    } else if (predResponse && predResponse.success === false) {
      console.warn('Prediction API error:', predResponse.message);
    }

    if (optResponse && optResponse.success !== false) {
      const optData = optResponse.data || optResponse;
      renderOptimalTime(optData);
    } else if (optResponse && optResponse.success === false) {
      console.warn('Optimal time API error:', optResponse.message);
    }

    // Apply i18n translations after rendering
    if (typeof applyTranslations === 'function') {
      applyTranslations();
    }

  } catch (err) {
    console.error('Failed to load prediction data:', err);
  }
}

/* ===== Init ===== */
loadAllData();
startCountdown();

}); // end DOMContentLoaded
