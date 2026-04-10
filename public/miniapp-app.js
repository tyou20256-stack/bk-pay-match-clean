/* ───── MiniApp (CSP-safe external JS) ───── */
var tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }

function haptic(type, val) {
  try { if (tg && tg.HapticFeedback) tg.HapticFeedback[type](val); } catch(e) {}
}

function applyTheme() {
  var tp = tg ? tg.themeParams : {};
  var s = document.documentElement.style;
  if (tp.bg_color) s.setProperty('--bg', tp.bg_color);
  if (tp.text_color) s.setProperty('--text', tp.text_color);
  if (tp.hint_color) s.setProperty('--hint', tp.hint_color);
  if (tp.button_color) s.setProperty('--btn', tp.button_color);
  if (tp.button_text_color) s.setProperty('--btn-text', tp.button_text_color);
  if (tp.secondary_bg_color) s.setProperty('--secondary-bg', tp.secondary_bg_color);
  document.body.style.background = 'linear-gradient(180deg, ' + (tp.secondary_bg_color || '#f2f2f7') + ' 0%, ' + (tp.bg_color || '#ffffff') + ' 40%)';
}
applyTheme();
if (tg) tg.onEvent('themeChanged', applyTheme);

var currentStep = 1, selectedAmount = 0, selectedCrypto = 'USDT', selectedMethod = 'bank';
var rates = { USDT: null, BTC: null, ETH: null };
var rateData = null, orderId = null, orderData = null, timerInterval = null, timerTotal = 15 * 60;

function $(id) { return document.getElementById(id); }

function showToast(msg) {
  var t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function() { t.classList.remove('show'); }, 1800);
}

function updateDots() {
  for (var i = 1; i <= 4; i++) {
    var d = $('dot' + i);
    d.className = 'dot';
    if (i < currentStep) d.classList.add('done');
    if (i === currentStep) d.classList.add('active');
  }
}

function showStep(n) {
  var steps = document.querySelectorAll('.step');
  for (var i = 0; i < steps.length; i++) steps[i].classList.remove('active');
  $('step' + n).classList.add('active');
  currentStep = n;
  updateDots();
  updateButtons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateButtons() {
  if (!tg) return;
  var mb = tg.MainButton, bb = tg.BackButton;
  mb.offClick(onMainButton);
  if (bb) bb.offClick(onBackButton);

  if (currentStep === 1) {
    mb.setText('レート確認'); mb.show();
    if (selectedAmount > 0) mb.enable(); else mb.disable();
    if (bb) bb.hide();
  } else if (currentStep === 2) {
    mb.setText('注文を確定');
    if (rateData) { mb.show(); mb.enable(); } else mb.hide();
    if (bb) bb.show();
  } else if (currentStep === 3) {
    mb.setText('支払い完了を報告'); mb.show(); mb.enable();
    if (bb) bb.show();
  } else {
    mb.hide();
    if (bb) bb.hide();
  }
  mb.onClick(onMainButton);
  if (bb) bb.onClick(onBackButton);
}

function onBackButton() {
  if (currentStep > 1 && currentStep < 4) {
    if (currentStep === 3 && timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    showStep(currentStep - 1);
  }
}

function onMainButton() {
  if (currentStep === 1) goToStep2();
  else if (currentStep === 2) goToStep3();
  else if (currentStep === 3) goToStep4();
}

function fetchRates(callback) {
  var cryptos = ['USDT', 'BTC', 'ETH'], done = 0;
  cryptos.forEach(function(c) {
    fetch('/api/rates/' + c)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) {
          var r = d.bestRate || (d.rates && d.rates.length > 0 ? d.rates[0].price : null);
          if (r) rates[c] = parseFloat(r);
        }
      })
      .catch(function() {})
      .finally(function() {
        done++;
        updateRateDisplay(c);
        if (done === cryptos.length) { updateAmountEstimates(); if (callback) callback(); }
      });
  });
}

function updateRateDisplay(c) {
  var el = $('rate' + c);
  if (rates[c]) {
    el.classList.remove('loading');
    el.textContent = '¥' + Math.round(rates[c]).toLocaleString();
  }
}

var amounts = [5000, 10000, 30000, 50000, 100000, 200000, 500000];
var popularAmounts = [30000, 50000];

function buildAmountGrid() {
  var grid = $('amountGrid'), html = '';
  for (var i = 0; i < amounts.length; i++) {
    var a = amounts[i], pop = popularAmounts.indexOf(a) >= 0 ? ' popular' : '';
    html += '<button class="amount-btn' + pop + '" data-amount="' + a + '">¥' + a.toLocaleString() + '<span class="est" id="est' + a + '">---</span></button>';
  }
  html += '<button class="amount-btn" id="customAmountBtn">カスタム<span class="est">自由入力</span></button>';
  grid.innerHTML = html;
  bindAmountButtons();
}

function updateAmountEstimates() {
  var r = rates[selectedCrypto];
  if (!r) return;
  for (var i = 0; i < amounts.length; i++) {
    var el = $('est' + amounts[i]);
    if (el) {
      var est = amounts[i] / r;
      if (selectedCrypto === 'USDT') el.textContent = '≈ ' + est.toFixed(2) + ' USDT';
      else if (selectedCrypto === 'BTC') el.textContent = '≈ ' + est.toFixed(6) + ' BTC';
      else el.textContent = '≈ ' + est.toFixed(4) + ' ETH';
    }
  }
}

function bindAmountButtons() {
  var btns = document.querySelectorAll('.amount-btn[data-amount]');
  for (var i = 0; i < btns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        var all = document.querySelectorAll('.amount-btn');
        for (var j = 0; j < all.length; j++) all[j].classList.remove('selected');
        btn.classList.add('selected');
        selectedAmount = parseInt(btn.dataset.amount);
        $('customInputGroup').style.display = 'none';
        $('customAmount').value = '';
        haptic('impactOccurred', 'medium');
        updateButtons();
      });
    })(btns[i]);
  }
  var cb = $('customAmountBtn');
  if (cb) cb.addEventListener('click', function() {
    var all = document.querySelectorAll('.amount-btn');
    for (var j = 0; j < all.length; j++) all[j].classList.remove('selected');
    cb.classList.add('selected');
    $('customInputGroup').style.display = 'block';
    $('customAmount').focus();
    selectedAmount = 0;
    haptic('impactOccurred', 'light');
    updateButtons();
  });
}

$('customAmount').addEventListener('input', function(e) {
  selectedAmount = parseInt(e.target.value) || 0;
  updateButtons();
});

var cryptoCards = document.querySelectorAll('.crypto-card');
for (var i = 0; i < cryptoCards.length; i++) {
  (function(card) {
    card.addEventListener('click', function() {
      for (var j = 0; j < cryptoCards.length; j++) cryptoCards[j].classList.remove('selected');
      card.classList.add('selected');
      selectedCrypto = card.dataset.crypto;
      haptic('impactOccurred', 'light');
      updateAmountEstimates();
    });
  })(cryptoCards[i]);
}

var methodPills = document.querySelectorAll('.method-pill');
for (var i = 0; i < methodPills.length; i++) {
  (function(pill) {
    pill.addEventListener('click', function() {
      for (var j = 0; j < methodPills.length; j++) methodPills[j].classList.remove('selected');
      pill.classList.add('selected');
      selectedMethod = pill.dataset.method;
      haptic('impactOccurred', 'light');
    });
  })(methodPills[i]);
}

function goToStep2() {
  if (selectedAmount < 1000) { if (tg) tg.showAlert('最小金額は¥1,000です'); return; }
  if (selectedAmount > 1000000) { if (tg) tg.showAlert('最大金額は¥1,000,000です'); return; }
  showStep(2);
  $('rateLoading').style.display = 'flex';
  $('rateContent').style.display = 'none';
  $('rateError').style.display = 'none';
  if (tg) tg.MainButton.hide();
  var bar = $('matchBar'); bar.style.width = '0%';
  var prog = 0;
  var progInterval = setInterval(function() { prog += Math.random() * 15; if (prog > 85) prog = 85; bar.style.width = prog + '%'; }, 300);

  fetch('/api/rates/' + selectedCrypto)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      clearInterval(progInterval); bar.style.width = '100%';
      if (!data.success) throw new Error(data.error || 'レート取得失敗');
      var r = data.bestRate || (data.rates && data.rates.length > 0 ? data.rates[0].price : null);
      if (!r) throw new Error('レートが取得できません');
      rateData = parseFloat(r);
      var cryptoAmt;
      if (selectedCrypto === 'USDT') cryptoAmt = (selectedAmount / rateData).toFixed(2);
      else if (selectedCrypto === 'BTC') cryptoAmt = (selectedAmount / rateData).toFixed(6);
      else cryptoAmt = (selectedAmount / rateData).toFixed(4);
      var methodLabels = { bank: '銀行振込', paypay: 'PayPay', linepay: 'LINE Pay', aupay: 'au PAY' };
      $('confirmAmount').textContent = '¥' + selectedAmount.toLocaleString();
      $('confirmCrypto').textContent = selectedCrypto;
      $('confirmRate').textContent = '¥' + rateData.toLocaleString();
      $('confirmMethod').textContent = methodLabels[selectedMethod] || selectedMethod;
      $('confirmCryptoAmount').textContent = cryptoAmt + ' ' + selectedCrypto;
      setTimeout(function() { $('rateLoading').style.display = 'none'; $('rateContent').style.display = 'block'; updateButtons(); }, 400);
    })
    .catch(function(e) { clearInterval(progInterval); $('rateLoading').style.display = 'none'; $('rateError').style.display = 'block'; });
}

function goToStep3() {
  if (tg) { tg.MainButton.showProgress(); tg.MainButton.disable(); }
  fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: selectedAmount, crypto: selectedCrypto, payMethod: selectedMethod,
      walletAddress: tg && tg.initDataUnsafe && tg.initDataUnsafe.user ? 'tg_' + tg.initDataUnsafe.user.id : 'tg_unknown',
      source: 'miniapp',
    }),
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (!data.success || !data.order) throw new Error(data.error || '注文作成に失敗しました');
      orderData = data.order; orderId = data.order.id;
      var account = data.account || data.order.bankAccount || {};
      var fields = [
        { label: '注文ID', value: orderId, copy: true },
        { label: '銀行名', value: account.bankName || '-', copy: false },
        { label: '支店名', value: account.branchName || '-', copy: false },
        { label: '口座種別', value: account.accountType || '普通', copy: false },
        { label: '口座番号', value: account.accountNumber || '-', copy: true },
        { label: '口座名義', value: account.accountHolder || '-', copy: true },
        { label: '振込金額', value: '¥' + selectedAmount.toLocaleString(), copy: true },
      ];
      var html = '';
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i], cleanVal = f.value.replace(/[¥,]/g, '');
        html += '<div class="bank-row"><span class="label">' + f.label + '</span><span class="value-wrap"><span class="value">' + f.value + '</span>';
        if (f.copy) html += '<button class="copy-btn" data-copy-value="' + cleanVal.replace(/"/g, '&quot;') + '">コピー</button>';
        html += '</span></div>';
      }
      $('bankDetails').innerHTML = html;
      if (tg) tg.MainButton.hideProgress();
      showStep(3); startTimer(timerTotal);
    })
    .catch(function(e) {
      if (tg) { tg.MainButton.hideProgress(); tg.MainButton.enable(); }
      if (tg) tg.showAlert(e.message || '注文作成に失敗しました');
    });
}

function goToStep4() {
  showStep(4);
  $('resultLoading').style.display = 'flex'; $('resultContent').style.display = 'none';
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (tg) tg.MainButton.hide();
  fetch('/api/orders/' + orderId + '/paid', { method: 'POST' })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (!data.success) throw new Error(data.error || '処理に失敗しました');
      var cryptoAmt = orderData && orderData.cryptoAmount ? orderData.cryptoAmount : (selectedAmount / rateData).toFixed(selectedCrypto === 'BTC' ? 6 : selectedCrypto === 'ETH' ? 4 : 2);
      $('resultOrderId').textContent = orderId;
      $('resultAmount').textContent = '¥' + selectedAmount.toLocaleString();
      $('resultCrypto').textContent = cryptoAmt + ' ' + selectedCrypto;
      $('resultLoading').style.display = 'none'; $('resultContent').style.display = 'block';
      haptic('notificationOccurred', 'success');
      launchConfetti();
    })
    .catch(function(e) { if (tg) tg.showAlert(e.message || '処理に失敗しました'); showStep(3); });
}

function startTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);
  var remaining = seconds, total = seconds, circumference = 2 * Math.PI * 52;
  var display = $('timerDisplay'), arc = $('timerArc'), ring = $('timerRing'), warningFired = false;
  function update() {
    var m = Math.floor(remaining / 60), s = remaining % 60;
    display.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    arc.style.strokeDashoffset = circumference * (1 - remaining / total);
    if (remaining < 180) { ring.classList.add('warning'); if (!warningFired) { haptic('notificationOccurred', 'warning'); warningFired = true; } }
    else ring.classList.remove('warning');
    if (remaining < 60) ring.classList.add('pulse'); else ring.classList.remove('pulse');
    if (remaining <= 0) {
      clearInterval(timerInterval); timerInterval = null;
      if (tg) tg.showAlert('制限時間が過ぎました。注文は自動キャンセルされます。');
      setTimeout(function() { if (tg) tg.close(); }, 2000);
    }
    remaining--;
  }
  update();
  timerInterval = setInterval(update, 1000);
}

function copyField(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function() { showToast('コピー済み'); haptic('impactOccurred', 'light'); });
  } else {
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    showToast('コピー済み');
  }
}

function launchConfetti() {
  var colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'];
  for (var i = 0; i < 40; i++) {
    (function(i) {
      setTimeout(function() {
        var el = document.createElement('div');
        el.className = 'confetti-piece';
        el.style.left = Math.random() * 100 + 'vw';
        el.style.background = colors[Math.floor(Math.random() * colors.length)];
        el.style.animationDuration = (2 + Math.random() * 2) + 's';
        el.style.width = (4 + Math.random() * 6) + 'px';
        el.style.height = (4 + Math.random() * 6) + 'px';
        document.body.appendChild(el);
        setTimeout(function() { el.remove(); }, 4000);
      }, i * 50);
    })(i);
  }
}

var touchStartY = 0, pulling = false;
document.addEventListener('touchstart', function(e) { if (currentStep === 1 && window.scrollY === 0) touchStartY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchmove', function(e) {
  if (currentStep !== 1 || touchStartY === 0) return;
  var diff = e.touches[0].clientY - touchStartY;
  if (diff > 60 && !pulling) {
    pulling = true; $('pullIndicator').style.height = '40px';
    fetchRates(function() { $('pullIndicator').style.height = '0'; pulling = false; showToast('レート更新完了'); });
  }
}, { passive: true });
document.addEventListener('touchend', function() { touchStartY = 0; if (!pulling) $('pullIndicator').style.height = '0'; }, { passive: true });

/* ───── Event delegation for dynamically created copy buttons ───── */
document.addEventListener('click', function(e) {
  var copyBtn = e.target.closest('.copy-btn[data-copy-value]');
  if (copyBtn) {
    copyField(copyBtn.getAttribute('data-copy-value'));
  }
});

/* ───── Bind static inline handler replacements ───── */
// Retry button (step 2 error)
$('retryBtn').addEventListener('click', function() {
  goToStep2();
});

// Close button (step 4 completion)
$('closeBtn').addEventListener('click', function() {
  if (tg) tg.close();
});

buildAmountGrid(); fetchRates(); updateButtons(); updateDots();
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(function() {}); }
