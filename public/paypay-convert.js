// paypay-convert.js — PayPay conversion page logic
// Externalized from paypay-convert.html inline script for cacheability and maintainability.
// Requires i18n.js to be loaded first (for t() and setLanguage()).
(function () {
  'use strict';

  var API = '';
  var convType = 'lite_to_money';
  var requesterId = null;
  var conversionId = null;
  var pollTimer = null;
  var cachedUsdtRate = 0;

  // Safe translator: falls back to identity if i18n.js hasn't loaded yet.
  function tr(key) {
    return (typeof t === 'function') ? t(key) : key;
  }

  // Safe toast helper: falls back to alert() if toast.js hasn't loaded yet.
  function notify(type, message) {
    if (typeof window.toast === 'object' && typeof window.toast[type] === 'function') {
      window.toast[type](message);
    } else {
      alert(message); // eslint-disable-line no-alert
    }
  }

  function setType(newType) {
    convType = newType;
    var btns = ['btnLiteToMoney', 'btnMoneyToLite', 'btnMoneyToUsdt', 'btnLiteToUsdt', 'btnUsdtToMoney', 'btnUsdtToLite'];
    var typeMap = {
      btnLiteToMoney: 'lite_to_money',
      btnMoneyToLite: 'money_to_lite',
      btnMoneyToUsdt: 'money_to_usdt',
      btnLiteToUsdt: 'lite_to_usdt',
      btnUsdtToMoney: 'usdt_to_money',
      btnUsdtToLite: 'usdt_to_lite'
    };
    btns.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var isActive = typeMap[id] === newType;
      el.style.background = isActive ? 'var(--accent)' : 'var(--card)';
      el.style.color = isActive ? '#fff' : 'var(--text2)';
    });
    // USDT input: show wallet for PayPay→USDT, show USDT amount for USDT→PayPay
    var toUsdt = (newType === 'money_to_usdt' || newType === 'lite_to_usdt');
    var fromUsdt = (newType === 'usdt_to_money' || newType === 'usdt_to_lite');
    document.getElementById('walletSection').classList.toggle('hidden', !toUsdt);
    document.getElementById('usdtRateSection').classList.toggle('hidden', !toUsdt && !fromUsdt);
    document.getElementById('jpyAmountSection').classList.toggle('hidden', fromUsdt);
    document.getElementById('usdtAmountSection').classList.toggle('hidden', !fromUsdt);
    if (toUsdt || fromUsdt) fetchUsdtRate();
    calcFee();
  }

  function fetchUsdtRate() {
    fetch(API + '/api/rates/USDT')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.success && d.data && d.data.bestBuy) {
          cachedUsdtRate = d.data.bestBuy;
          document.getElementById('usdtRate').textContent = '¥' + cachedUsdtRate.toFixed(2);
          calcFee();
        }
      })
      .catch(function () {});
  }

  function calcFee() {
    var fromUsdt = (convType === 'usdt_to_money' || convType === 'usdt_to_lite');
    var toUsdt = (convType === 'money_to_usdt' || convType === 'lite_to_usdt');
    var rates = {
      lite_to_money: 0.05,
      money_to_lite: 0.02,
      money_to_usdt: 0.03,
      lite_to_usdt: 0.07,
      usdt_to_money: 0.03,
      usdt_to_lite: 0.02
    };
    var rate = rates[convType] || 0.05;

    if (fromUsdt) {
      // USDT→PayPay: input is USDT amount
      var usdtInput = parseFloat(document.getElementById('usdtAmountInput').value) || 0;
      var jpyEquiv = cachedUsdtRate > 0 ? Math.round(usdtInput * cachedUsdtRate) : 0;
      var fee = Math.round(jpyEquiv * rate);
      var payout = jpyEquiv - fee;
      document.getElementById('feeRate').textContent = (rate * 100) + '%';
      document.getElementById('feeAmount').textContent = '¥' + fee.toLocaleString();
      document.getElementById('payoutAmount').textContent = '¥' + payout.toLocaleString();
      document.getElementById('usdtRate').textContent = cachedUsdtRate > 0 ? '¥' + cachedUsdtRate.toFixed(2) : '-';
      document.getElementById('usdtAmount').textContent = usdtInput + ' USDT → ¥' + payout.toLocaleString();
      var paypayId = document.getElementById('paypayId').value.trim();
      var valid = usdtInput >= 10 && usdtInput <= 5000 && paypayId;
      document.getElementById('btnSubmit').disabled = !valid;
      document.getElementById('btnSubmit').style.opacity = valid ? '1' : '0.5';
    } else {
      // PayPay→* : input is JPY amount
      var amount = parseInt(document.getElementById('amountInput').value.replace(/[,、\s]/g, '')) || 0;
      var fee2 = Math.round(amount * rate);
      var payout2 = amount - fee2;
      document.getElementById('feeRate').textContent = (rate * 100) + '%';
      document.getElementById('feeAmount').textContent = '¥' + fee2.toLocaleString();
      document.getElementById('payoutAmount').textContent = toUsdt ? '' : '¥' + payout2.toLocaleString();
      if (toUsdt && cachedUsdtRate > 0) {
        var usdtAmt = (payout2 / cachedUsdtRate).toFixed(2);
        document.getElementById('usdtAmount').textContent = usdtAmt + ' USDT';
        document.getElementById('payoutAmount').textContent = usdtAmt + ' USDT';
      }
      var paypayId2 = document.getElementById('paypayId').value.trim();
      var walletEl = document.getElementById('walletInput');
      var walletOk = !toUsdt || /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(((walletEl && walletEl.value) || '').trim());
      var valid2 = amount >= 1000 && amount <= 500000 && paypayId2 && walletOk;
      document.getElementById('btnSubmit').disabled = !valid2;
      document.getElementById('btnSubmit').style.opacity = valid2 ? '1' : '0.5';
    }
  }

  async function checkStatus() {
    if (!requesterId) return;
    try {
      var res = await fetch(API + '/api/paypay/status/' + requesterId);
      var data = await res.json();
      if (data.success && data.conversion && data.conversion.status === 'matched') {
        clearInterval(pollTimer);
        document.getElementById('panel-waiting').classList.add('hidden');
        document.getElementById('panel-matched').classList.remove('hidden');
        var c = data.conversion;
        document.getElementById('matchInfo').innerHTML =
          '<div style="display:flex;justify-content:space-between"><span style="color:var(--dim)">' + tr('pp_provider_id') + '</span><span style="font-weight:700">' + (c.provider_paypay_id || '--') + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;margin-top:4px"><span style="color:var(--dim)">' + tr('pp_send_amount') + '</span><span style="color:var(--accent);font-weight:700">¥' + Number(c.amount).toLocaleString() + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;margin-top:4px"><span style="color:var(--dim)">' + tr('pp_recv_amount') + '</span><span>¥' + Number(c.payout_amount).toLocaleString() + '</span></div>';
      }
      if (data.conversion && data.conversion.status === 'completed') {
        clearInterval(pollTimer);
        document.getElementById('panel-waiting').classList.add('hidden');
        document.getElementById('panel-matched').classList.add('hidden');
        document.getElementById('panel-complete').classList.remove('hidden');
      }
    } catch (e) { /* swallow polling errors */ }
  }

  // --- Initialization: wire up DOM handlers ---

  function init() {
    // Input events
    document.getElementById('amountInput').oninput = calcFee;
    document.getElementById('paypayId').oninput = calcFee;
    var walletInputEl = document.getElementById('walletInput');
    if (walletInputEl) walletInputEl.oninput = calcFee;
    var usdtAmountInputEl = document.getElementById('usdtAmountInput');
    if (usdtAmountInputEl) usdtAmountInputEl.oninput = calcFee;

    // Type selection buttons
    var typeButtons = {
      btnLiteToMoney: 'lite_to_money',
      btnMoneyToLite: 'money_to_lite',
      btnMoneyToUsdt: 'money_to_usdt',
      btnLiteToUsdt: 'lite_to_usdt',
      btnUsdtToMoney: 'usdt_to_money',
      btnUsdtToLite: 'usdt_to_lite'
    };
    Object.keys(typeButtons).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', function () { setType(typeButtons[id]); });
    });

    // Quick amount buttons (data-amt based — safe against i18n textContent rewrites)
    document.querySelectorAll('.quick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var amt = this.getAttribute('data-amt') || '10000';
        document.getElementById('amountInput').value = amt;
        calcFee();
      });
    });

    // Language selector (binds to .lang-btn buttons in nav)
    document.querySelectorAll('.lang-btn[data-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (typeof setLanguage === 'function') {
          setLanguage(this.dataset.lang);
        }
      });
    });

    // Theme toggle
    var savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    var themeBtn = document.getElementById('themeTogglePP');
    if (themeBtn) {
      themeBtn.innerHTML = savedTheme === 'dark' ? '&#9774;' : '&#9728;';
      themeBtn.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        themeBtn.innerHTML = next === 'dark' ? '&#9774;' : '&#9728;';
      });
    }

    // Cancel/reload buttons
    document.querySelectorAll('.reload-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { location.reload(); });
    });

    // Check escrow status (use i18n keys for label)
    fetch(API + '/api/escrow/status')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var badge = document.getElementById('escrowBadge');
        if (badge && d.success) {
          badge.style.display = 'block';
          var onText = tr('pp_escrow_on');
          var offText = tr('pp_escrow_off');
          if (d.escrowEnabled) {
            badge.innerHTML = '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:4px">' + onText + '</span>';
          } else {
            badge.innerHTML = '<span style="background:var(--card);border:1px solid var(--border);color:var(--dim);padding:2px 8px;border-radius:4px">' + offText + '</span>';
          }
        }
      })
      .catch(function () {});

    // Submit button
    document.getElementById('btnSubmit').onclick = async function () {
      var fromUsdt = (convType === 'usdt_to_money' || convType === 'usdt_to_lite');
      var amount = fromUsdt
        ? Math.round((parseFloat(document.getElementById('usdtAmountInput').value) || 0) * cachedUsdtRate)
        : parseInt(document.getElementById('amountInput').value.replace(/[,、\s]/g, ''));
      var paypayId = document.getElementById('paypayId').value.trim();
      var toUsdt = (convType === 'money_to_usdt' || convType === 'lite_to_usdt');
      var walletEl = document.getElementById('walletInput');
      var walletAddress = toUsdt ? ((walletEl && walletEl.value) || '').trim() : '';
      var txtStart = tr('pp_start_btn');
      this.disabled = true;
      this.textContent = tr('pp_sending');
      try {
        var body = { amount: amount, type: convType, paypayId: paypayId };
        if (walletAddress) body.walletAddress = walletAddress;
        if (fromUsdt) body.usdtAmount = parseFloat(document.getElementById('usdtAmountInput').value) || 0;
        var res = await fetch(API + '/api/paypay/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        var data = await res.json();
        if (data.success) {
          requesterId = data.requesterId;
          conversionId = data.conversionId;
          document.getElementById('panel-input').classList.add('hidden');
          document.getElementById('panel-waiting').classList.remove('hidden');
          pollTimer = setInterval(checkStatus, 5000);
        } else {
          notify('error', data.error || tr('pp_alert_error'));
          this.disabled = false;
          this.textContent = txtStart;
        }
      } catch (e) {
        notify('error', tr('pp_alert_network'));
        this.disabled = false;
        this.textContent = txtStart;
      }
    };

    // Confirm (proof upload) button
    document.getElementById('btnConfirm').onclick = async function () {
      var txtReport = tr('pp_report_sent');
      var file = document.getElementById('proofInput').files[0];
      if (!file) {
        notify('warn', tr('pp_alert_proof_required'));
        return;
      }
      this.disabled = true;
      this.textContent = tr('pp_sending');
      var fd = new FormData();
      fd.append('proof', file);
      fd.append('role', 'requester');
      fd.append('requesterId', requesterId);
      try {
        var res = await fetch(API + '/api/paypay/confirm/' + conversionId, {
          method: 'POST',
          body: fd
        });
        var data = await res.json();
        if (data.success) {
          if (data.status === 'completed') {
            document.getElementById('panel-matched').classList.add('hidden');
            document.getElementById('panel-complete').classList.remove('hidden');
          } else {
            this.textContent = tr('pp_waiting_other');
            pollTimer = setInterval(checkStatus, 10000);
          }
        } else {
          notify('error', data.error || tr('pp_alert_error'));
          this.disabled = false;
          this.textContent = txtReport;
        }
      } catch (e) {
        notify('error', tr('pp_alert_network'));
        this.disabled = false;
        this.textContent = txtReport;
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
