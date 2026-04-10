// pay-app.js — Pay page logic (extracted from pay.html)

function escapeHtml(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

var amount=0,payMethod='bank',selectedCrypto='USDT',currentOrder=null,timerSec=900,timerInterval=null,customerWalletAddress='';
var pollOrderTimeout=null;

// Config
var WALLET='TXxx...設定してください';
var FALLBACK_ACCOUNTS={
  bank:{name:'BK決済',bank:'三菱UFJ銀行',branch:'新宿支店',type:'普通',number:'1234567',holder:'カ）ビーケーストック'},
  paypay:{id:'bkstock-pay',qr:'https://qr.paypay.ne.jp/example'},
  linepay:{url:'https://line.me/pay/example'},
  aupay:{id:'bk-aupay'}
};

// Theme
function toggleTheme(){var n=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);document.getElementById('themeBtn').textContent=n==='dark'?'D':'L';localStorage.setItem('theme',n);}
(function(){var s=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',s);})();
if(location.search.indexOf('embed')>-1)document.body.classList.add('embed');

// Navigation
function go(n){
  for(var i=1;i<=4;i++){
    document.getElementById('p'+i).classList.toggle('active',i===n);
    var s=document.getElementById('s'+i);s.classList.remove('active','done');
    if(i<n)s.classList.add('done');if(i===n)s.classList.add('active');
  }
  if(timerInterval&&n!==3){clearInterval(timerInterval);timerInterval=null;}
  window.scrollTo(0,0);
}

// Step 1
function setAmt(v,el){amount=v;document.getElementById('inAmount').value=v;document.querySelectorAll('.quick-amounts .quick-btn').forEach(function(b){b.classList.remove('active');});if(el)el.classList.add('active');onAmountChange();}
function selCrypto(c,el){selectedCrypto=c;document.querySelectorAll('#cryptoSelector .quick-btn').forEach(function(b){b.classList.remove('active');});if(el)el.classList.add('active');onAmountChange();}
function selPay(m,el){payMethod=m;document.querySelectorAll('.pay-method').forEach(function(b){b.classList.remove('selected');});if(el)el.classList.add('selected');}
function onAmountChange(){
  var raw=document.getElementById('inAmount').value.replace(/[^0-9]/g,'');
  amount=parseInt(raw)||0;
  if(amount>100000000)amount=100000000; // max 100M JPY
  document.getElementById('inAmount').value=amount||'';
  var box=document.getElementById('convertBox'),btn=document.getElementById('btnGo'),walletWrap=document.getElementById('walletInputWrap');
  if(amount>=500){box.style.display='block';walletWrap.style.display='block';checkBuyReady();fetchPreview();}
  else{box.style.display='none';walletWrap.style.display='none';btn.disabled=true;}
}
async function fetchPreview(){
  try{
    var r=await fetch('/api/rates/'+selectedCrypto);var j=await r.json();if(!j.success)return;
    var best=null;
    j.data.rates.forEach(function(ex){ex.buyOrders.forEach(function(o){
      if(o.minLimit<=amount&&(o.maxLimit===0||o.maxLimit>=amount)&&o.merchant.completionRate>=90){
        if(hasPayMethod(o,payMethod)&&(!best||o.price<best.price))best=o;
      }
    });});
    if(!best)j.data.rates.forEach(function(ex){ex.buyOrders.forEach(function(o){if(o.minLimit<=amount&&(o.maxLimit===0||o.maxLimit>=amount)){if(!best||o.price<best.price)best=o;}});});
    if(best){
      document.getElementById('cvRate').textContent='¥'+fmt(best.price)+' / '+selectedCrypto;
      document.getElementById('cvUsdt').textContent=(amount/best.price).toFixed(selectedCrypto==='USDT'?2:6)+' '+selectedCrypto;
    }
  }catch(e){}
}
function hasPayMethod(order,method){
  var map={bank:['銀行振込','Bank Transfer','Bank'],paypay:['PayPay'],linepay:['LINE Pay'],aupay:['au PAY']};
  var keys=map[method]||[];
  return order.paymentMethods.some(function(p){return keys.some(function(k){return p.indexOf(k)>-1;});});
}
function fmt(n){return Number(n).toLocaleString('ja-JP',{minimumFractionDigits:1,maximumFractionDigits:1});}
var TRON_ADDR_RE=/^T[1-9A-HJ-NP-Za-km-z]{33}$/;
function onWalletChange(){customerWalletAddress=(document.getElementById('inWalletAddr').value||'').trim();checkBuyReady();}
function checkBuyReady(){var btn=document.getElementById('btnGo');btn.disabled=!(amount>=500&&TRON_ADDR_RE.test(customerWalletAddress));}

// Step 2: Matching
async function startMatching(){
  go(2);
  document.getElementById('matchingScreen').style.display='block';
  document.getElementById('fallbackScreen').style.display='none';
  var log=document.getElementById('matchLog');
  log.innerHTML='';

  addLog(log,'マッチング開始... 金額: ¥'+amount.toLocaleString());
  await wait(300);
  addLog(log,'支払方法: '+payMethod);
  await wait(300);
  addLog(log,'4取引所を検索中...');
  await wait(200);

  try{
    var res=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:amount,payMethod:payMethod,crypto:selectedCrypto,customerWalletAddress:customerWalletAddress})});
    if(!res.ok){addLog(log,'サーバーエラー ('+res.status+')','warn');showFallback();return;}
    var data=await res.json();

    if(!data.success){
      addLog(log,'エラー: '+data.error,'warn');
      showFallback();
      return;
    }

    currentOrder=data.order;

    if(currentOrder.mode==='auto'){
      addLog(log,'Bybit を検索...','ok');await wait(200);
      addLog(log,'Binance を検索...','ok');await wait(200);
      addLog(log,'OKX を検索...','ok');await wait(200);
      addLog(log,'HTX を検索...','ok');await wait(200);
      addLog(log,'最適マーチャント: '+currentOrder.exchange+' / '+currentOrder.merchantName,'ok');
      addLog(log,'レート: ¥'+fmt(currentOrder.rate)+' / '+currentOrder.crypto,'ok');
      addLog(log,'完了率: '+currentOrder.merchantCompletionRate+'%','ok');
      await wait(500);
      addLog(log,'注文作成完了','ok');
      await wait(300);
      showPaymentFromOrder();
    }else{
      addLog(log,'P2Pマッチング: 該当なし','warn');
      addLog(log,'自社決済に切り替え...','warn');
      await wait(500);
      addLog(log,'Account Routerから最適口座を取得','ok');
      await wait(300);
      addLog(log,'口座割当完了','ok');
      await wait(300);
      showPaymentFromOrder();
    }
  }catch(e){
    addLog(log,'接続エラー','warn');
    showFallback();
  }
}

function showPaymentFromOrder(){
  go(3);
  var o=currentOrder;
  var badge=document.getElementById('modeBadge');
  if(o.mode==='self'){badge.className='mode-badge manual';badge.textContent='SELF MERCHANT';}
  else{badge.className='mode-badge auto';badge.textContent='AUTO MATCH';}

  // Payment info
  var info=document.getElementById('paymentInfo');
  var pi=o.paymentInfo;
  if(pi.type==='bank'){
    info.innerHTML='<div class="pi-card"><div class="pi-label">振込先口座</div>'
      +'<div class="pi-row"><span class="pi-row-label">銀行名</span><span class="pi-row-val">'+escapeHtml(pi.bankName)+'</span></div>'
      +'<div class="pi-row"><span class="pi-row-label">支店名</span><span class="pi-row-val">'+escapeHtml(pi.branchName)+'</span></div>'
      +'<div class="pi-row"><span class="pi-row-label">口座種別</span><span class="pi-row-val">'+escapeHtml(pi.accountType)+'</span></div>'
      +'<div class="pi-row"><span class="pi-row-label">口座番号</span><span class="pi-row-val" style="font-size:18px;letter-spacing:2px;font-weight:800">'+escapeHtml(pi.accountNumber)+'</span></div>'
      +'<div class="pi-row"><span class="pi-row-label">口座名義</span><span class="pi-row-val">'+escapeHtml(pi.accountHolder)+'</span></div>'
      +'<div class="pi-row"><span class="pi-row-label">振込金額</span><span class="pi-row-val" style="color:var(--green);font-size:18px;font-weight:800">¥'+o.amount.toLocaleString()+'</span></div>'
      +(o.mode==='auto'?'<div class="pi-row"><span class="pi-row-label">マーチャント</span><span class="pi-row-val">'+escapeHtml(o.merchantName)+' (完了率'+escapeHtml(String(Number(o.merchantCompletionRate)||0))+'%)</span></div>':'')
      +'</div>'
      +'<button class="copy-btn" data-copy="'+escapeHtml(pi.accountNumber)+'">口座番号をコピー</button>';
  }else{
    var payNames={paypay:'PayPay',linepay:'LINE Pay',aupay:'au PAY'};
    var pName=payNames[pi.type]||escapeHtml(pi.type);
    info.innerHTML='<div class="pi-card"><div class="pi-label">'+pName+' で支払い</div>'
      +(pi.qrUrl&&/^https?:\/\//i.test(pi.qrUrl)?'<div class="pi-qr"><img src="'+escapeHtml(pi.qrUrl)+'" style="max-width:160px;max-height:160px" data-qr-fallback="1"></div>':'<div class="pi-qr">'+pName+' QRコード</div>')
      +'<div class="pi-row"><span class="pi-row-label">'+pName+' ID</span><span class="pi-row-val" style="font-weight:800">'+escapeHtml(pi.payId||'--')+'</span></div>'
      +'<div class="pi-row"><span class="pi-row-label">支払金額</span><span class="pi-row-val" style="color:var(--green);font-size:18px;font-weight:800">¥'+o.amount.toLocaleString()+'</span></div>'
      +(o.merchantName?'<div class="pi-row"><span class="pi-row-label">マーチャント</span><span class="pi-row-val">'+escapeHtml(o.merchantName)+'</span></div>':'')
      +'</div>';
  }

  // Summary
  document.getElementById('sumAmt').textContent='¥'+o.amount.toLocaleString();
  document.getElementById('sumRate').textContent='¥'+fmt(o.rate)+' / '+(o.crypto||'USDT');
  document.getElementById('sumExch').textContent=o.exchange||'--';
  document.getElementById('sumUsdt').textContent=o.cryptoAmount+' '+(o.crypto||'USDT');

  startTimer();
}

function addLog(el,msg,cls){el.innerHTML+='<div class="'+(cls||'')+'">['+(new Date).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+'] '+escapeHtml(String(msg))+'</div>';el.scrollTop=el.scrollHeight;}
function wait(ms){return new Promise(function(r){setTimeout(r,ms);});}
function showFallback(){
  document.getElementById('matchingScreen').style.display='none';
  document.getElementById('fallbackScreen').style.display='block';
}
function useFallback(){currentOrder={id:'SELF',mode:'self',status:'pending_payment',amount:amount,crypto:'USDT',cryptoAmount:0,rate:0,payMethod:payMethod,exchange:'Pay Match（自社決済）',merchantName:'BK Stock',merchantCompletionRate:100,paymentInfo:null,createdAt:Date.now(),expiresAt:Date.now()+900000};fetchPreview().then(function(){showPaymentFromOrder();});}

// Step 3: Payment
function fillSummary(){
  document.getElementById('sumAmt').textContent='¥'+amount.toLocaleString();
  document.getElementById('sumRate').textContent=currentOrder.price?'¥'+fmt(currentOrder.price)+' / '+(currentOrder.crypto||'USDT'):'計算中...';
  document.getElementById('sumExch').textContent=currentOrder.exchange;
  document.getElementById('sumUsdt').textContent=currentOrder.price?(amount/currentOrder.price).toFixed(2)+' '+(currentOrder.crypto||'USDT'):'--';
}
function startTimer(){
  timerSec=900;clearInterval(timerInterval);
  timerInterval=setInterval(function(){
    timerSec--;if(timerSec<=0){clearInterval(timerInterval);cancelOrder();return;}
    var m=Math.floor(timerSec/60),s=timerSec%60;
    document.getElementById('timerCount').textContent=m+':'+(s<10?'0':'')+s;
    document.getElementById('timerBar').classList.toggle('urgent',timerSec<120);
  },1000);
}
function copyText(t,btn){navigator.clipboard.writeText(t).then(function(){if(btn){var orig=btn.textContent;btn.textContent='コピーしました';setTimeout(function(){btn.textContent=orig;},2000);}});}

// Step 4
async function confirmPaid(){
  clearInterval(timerInterval);timerInterval=null;
  if(currentOrder){try{var pr=await fetch('/api/orders/'+currentOrder.id+'/paid',{method:'POST'});if(!pr.ok)console.error('markPaid failed:',pr.status);}catch(e){console.error('markPaid error:',e);}}
  go(4);
  var o=currentOrder||{};
  document.getElementById('finalSummary').innerHTML=
    '<div class="summary-row"><span class="summary-label">注文ID</span><span class="summary-val">'+escapeHtml(String(o.id||'--'))+'</span></div>'
    +'<div class="summary-row"><span class="summary-label">入金額</span><span class="summary-val">¥'+amount.toLocaleString()+'</span></div>'
    +'<div class="summary-row"><span class="summary-label">レート</span><span class="summary-val">¥'+fmt(o.rate||0)+' / '+escapeHtml(String(o.crypto||'USDT'))+'</span></div>'
    +'<div class="summary-row"><span class="summary-label">受取り額</span><span class="summary-val big">'+escapeHtml(String(o.cryptoAmount||'--'))+' '+escapeHtml(String(o.crypto||'USDT'))+'</span></div>'
    +'<div class="summary-row"><span class="summary-label">送信先</span><span class="summary-val" style="font-family:monospace;font-size:10px">'+escapeHtml(customerWalletAddress||'--')+'</span></div>'
    +'<div class="summary-row"><span class="summary-label">ステータス</span><span class="summary-val" id="orderStatusText" style="color:var(--yellow)">確認待ち</span></div>';
  // Poll order status
  if(o.id)pollOrderStatus();
}
async function pollOrderStatus(){
  if(!currentOrder||!currentOrder.id)return;
  try{
    var res=await fetch('/api/orders/'+currentOrder.id);
    var data=await res.json();
    if(data.success&&data.order){
      var st=data.order.status;
      var el=document.getElementById('orderStatusText');
      var card=document.getElementById('successCard');
      if(st==='confirming'){el.textContent='入金確認中';el.style.color='var(--yellow)';}
      else if(st==='payment_verified'){el.textContent='入金確認済み（送金準備中）';el.style.color='var(--blue)';}
      else if(st==='sending_crypto'){el.textContent='USDT送金中...';el.style.color='var(--blue)';}
      else if(st==='completed'){
        el.textContent='完了';el.style.color='var(--green)';
        card.querySelector('.status-title').textContent='USDT送金完了';
        card.querySelector('.status-desc').textContent='ウォレットにUSDTが送金されました。';
        if(data.order.txId){
          var safeTxId=escapeHtml(String(data.order.txId));
          document.getElementById('finalSummary').innerHTML+='<div class="summary-row"><span class="summary-label">TX ID</span><span class="summary-val" style="font-family:monospace;font-size:9px"><a href="https://tronscan.org/#/transaction/'+encodeURIComponent(data.order.txId)+'" target="_blank" rel="noopener" style="color:var(--green)">'+safeTxId.slice(0,16)+'...</a></span></div>';
        }
        return; // Stop polling
      }
    }
  }catch(e){}
  pollOrderTimeout=setTimeout(pollOrderStatus,8000);
}
function cancelOrder(){
  clearInterval(timerInterval);timerInterval=null;
  if(pollOrderTimeout){clearTimeout(pollOrderTimeout);pollOrderTimeout=null;}
  if(currentOrder)fetch('/api/orders/'+currentOrder.id+'/cancel',{method:'POST'}).catch(function(e){console.error('cancel error:',e);});
  go(1);
}

// === SELL FLOW ===
var sellCrypto='USDT',sellOrder=null,sellTimerSec=1800,sellTimerInterval=null,pollSellTimeout=null;
var buyFlow=true;

function setDirection(dir,el){
  buyFlow=(dir==='buy');
  document.querySelectorAll('.dir-tab').forEach(function(b){b.classList.remove('active');});
  if(el)el.classList.add('active');
  else document.querySelectorAll('.dir-tab')[dir==='buy'?0:1].classList.add('active');

  // Show/hide flows
  var buyPanels=['p1','p2','p3','p4'];
  buyPanels.forEach(function(id){document.getElementById(id).style.display=buyFlow?'':'none';});
  document.getElementById('buySteps').style.display=buyFlow?'':'none';
  document.getElementById('sellFlow').style.display=buyFlow?'none':'block';
  if(!buyFlow)goSell(1);
  else go(1);
}

function selSellCrypto(c,el){
  sellCrypto=c;
  document.querySelectorAll('#sellCryptoSelector .quick-btn').forEach(function(b){b.classList.remove('active');});
  if(el)el.classList.add('active');
  onSellAmountChange();
}

async function onSellAmountChange(){
  var val=parseFloat(document.getElementById('sellAmount').value)||0;
  var box=document.getElementById('sellConvertBox');
  var btn=document.getElementById('btnSellGo');
  if(val>0){
    box.style.display='block';
    try{
      var r=await fetch('/api/rates/'+sellCrypto);var j=await r.json();
      if(j.success){
        var allSell=[];
        j.data.rates.forEach(function(ex){(ex.sellOrders||[]).forEach(function(o){allSell.push(o);});});
        allSell.sort(function(a,b){return Number(b.price)-Number(a.price);});
        if(allSell.length>0){
          var price=Number(allSell[0].price);
          document.getElementById('sellCvRate').textContent='¥'+fmt(price)+' / '+sellCrypto;
          document.getElementById('sellCvJpy').textContent='¥'+Math.floor(val*price).toLocaleString();
        }
      }
    }catch(e){}
    // Check all bank fields
    var b1=document.getElementById('sellBankName').value;
    var b2=document.getElementById('sellAccountNumber').value;
    var b3=document.getElementById('sellAccountHolder').value;
    btn.disabled=!(val>0&&b1&&b2&&b3);
  }else{
    box.style.display='none';
    btn.disabled=true;
  }
}

// Add input listeners for bank fields
['sellBankName','sellBranchName','sellAccountNumber','sellAccountHolder'].forEach(function(id){
  document.getElementById(id).addEventListener('input',onSellAmountChange);
});

async function startSellOrder(){
  var cryptoAmount=parseFloat(document.getElementById('sellAmount').value);
  var bankInfo={
    bankName:document.getElementById('sellBankName').value,
    branchName:document.getElementById('sellBranchName').value,
    accountNumber:document.getElementById('sellAccountNumber').value,
    accountHolder:document.getElementById('sellAccountHolder').value
  };
  try{
    var res=await fetch('/api/orders/sell',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cryptoAmount:cryptoAmount,crypto:sellCrypto,customerBankInfo:bankInfo})});
    if(!res.ok){alert('サーバーエラー ('+res.status+')');return;}
    var data=await res.json();
    if(!data.success){alert(data.error||'エラーが発生しました');return;}
    sellOrder=data.order;
    document.getElementById('sellDepositAddr').textContent=sellOrder.depositAddress||'--';
    document.getElementById('sellSumCrypto').textContent=sellOrder.crypto;
    document.getElementById('sellSumAmount').textContent=sellOrder.cryptoAmount+' '+sellOrder.crypto;
    document.getElementById('sellSumRate').textContent='¥'+fmt(sellOrder.rate);
    document.getElementById('sellSumJpy').textContent='¥'+(sellOrder.jpyAmount||0).toLocaleString();
    document.getElementById('sellOrderId').textContent=sellOrder.id;
    goSell(2);
  }catch(e){alert('サーバーに接続できませんでした');}
}

function goSell(n){
  for(var i=1;i<=4;i++){
    var sp=document.getElementById('sp'+i);
    if(sp)sp.classList.toggle('active',i===n);
    var ss=document.getElementById('ss'+i);
    if(ss){ss.classList.remove('active','done');if(i<n)ss.classList.add('done');if(i===n)ss.classList.add('active');}
  }
  if(n===3)startSellTimer();
  window.scrollTo(0,0);
}

function startSellTimer(){
  sellTimerSec=1800;
  if(sellTimerInterval){clearInterval(sellTimerInterval);sellTimerInterval=null;}
  sellTimerInterval=setInterval(function(){
    sellTimerSec--;if(sellTimerSec<=0){clearInterval(sellTimerInterval);sellTimerInterval=null;return;}
    var m=Math.floor(sellTimerSec/60),s=sellTimerSec%60;
    document.getElementById('sellTimerCount').textContent=m+':'+(s<10?'0':'')+s;
  },1000);
  // Poll order status
  if(sellOrder)pollSellStatus();
}

async function pollSellStatus(){
  if(!sellOrder)return;
  try{
    var res=await fetch('/api/orders/'+sellOrder.id);
    var data=await res.json();
    if(data.success&&data.order){
      var st=data.order.status;
      document.getElementById('sellStatus').textContent=
        st==='awaiting_deposit'?'入金待ち':
        st==='deposit_received'?'入金確認済み（出金処理中）':
        st==='completed'?'完了':'処理中';
      if(st==='completed'){
        clearInterval(sellTimerInterval);sellTimerInterval=null;
        if(pollSellTimeout){clearTimeout(pollSellTimeout);pollSellTimeout=null;}
        goSell(4);
        document.getElementById('sellFinalSummary').innerHTML=
          '<div class="summary-row"><span class="summary-label">注文ID</span><span class="summary-val">'+escapeHtml(String(sellOrder.id))+'</span></div>'
          +'<div class="summary-row"><span class="summary-label">売却数量</span><span class="summary-val">'+escapeHtml(String(sellOrder.cryptoAmount))+' '+escapeHtml(String(sellOrder.crypto))+'</span></div>'
          +'<div class="summary-row"><span class="summary-label">振込額</span><span class="summary-val big">¥'+(Number(sellOrder.jpyAmount)||0).toLocaleString()+'</span></div>';
        return;
      }
    }
  }catch(e){}
  pollSellTimeout=setTimeout(pollSellStatus,10000);
}

if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(function(){}); }

// PWA Install Banner
var deferredPrompt;
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredPrompt = e;
  if (!localStorage.getItem('pwa_dismissed')) {
    document.getElementById('installBanner').style.display = 'flex';
  }
});
function installPWA() {
  if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
  document.getElementById('installBanner').style.display = 'none';
}
function dismissInstall() {
  document.getElementById('installBanner').style.display = 'none';
  localStorage.setItem('pwa_dismissed', '1');
}

// --- Event bindings (moved from inline handlers) ---
document.addEventListener('DOMContentLoaded', function() {
  // Language buttons
  document.querySelectorAll('.lang-btn[data-lang]').forEach(function(btn) {
    btn.addEventListener('click', function() { setLanguage(btn.dataset.lang); });
  });

  // Theme toggle
  document.getElementById('themeBtn').addEventListener('click', function() { toggleTheme(); });

  // Direction tabs (buy/sell)
  document.querySelectorAll('.dir-tab[data-dir]').forEach(function(btn) {
    btn.addEventListener('click', function() { setDirection(btn.dataset.dir, btn); });
  });

  // Crypto selector (buy flow)
  document.querySelectorAll('#cryptoSelector [data-crypto]').forEach(function(btn) {
    btn.addEventListener('click', function() { selCrypto(btn.dataset.crypto, btn); });
  });

  // Amount input
  document.getElementById('inAmount').addEventListener('input', function() { onAmountChange(); });

  // Quick amount buttons
  document.querySelectorAll('.quick-amounts [data-amount]').forEach(function(btn) {
    btn.addEventListener('click', function() { setAmt(parseInt(btn.dataset.amount), btn); });
  });

  // Payment method selection
  document.querySelectorAll('.pay-method[data-pay]').forEach(function(el) {
    el.addEventListener('click', function() { selPay(el.dataset.pay, el); });
  });

  // Wallet address input
  document.getElementById('inWalletAddr').addEventListener('input', function() { onWalletChange(); });

  // Start matching button
  document.getElementById('btnGo').addEventListener('click', function() { startMatching(); });

  // Fallback buttons
  document.getElementById('btnUseFallback').addEventListener('click', function() { useFallback(); });
  document.getElementById('btnBackToAmount').addEventListener('click', function() { go(1); });

  // Payment confirmation buttons
  document.getElementById('btnConfirmPaid').addEventListener('click', function() { confirmPaid(); });
  document.getElementById('btnCancelOrder').addEventListener('click', function() { cancelOrder(); });

  // New deposit button
  document.getElementById('btnNewDeposit').addEventListener('click', function() { go(1); });

  // Event delegation for dynamically generated copy buttons and QR fallback
  document.addEventListener('click', function(e) {
    var copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) { copyText(copyBtn.dataset.copy, copyBtn); return; }
  });
  document.addEventListener('error', function(e) {
    if (e.target.tagName === 'IMG' && e.target.dataset.qrFallback) {
      e.target.parentNode.textContent = 'QR';
    }
  }, true);

  // === SELL FLOW ===
  // Sell crypto selector
  document.querySelectorAll('#sellCryptoSelector [data-sell-crypto]').forEach(function(btn) {
    btn.addEventListener('click', function() { selSellCrypto(btn.dataset.sellCrypto, btn); });
  });

  // Sell amount input
  document.getElementById('sellAmount').addEventListener('input', function() { onSellAmountChange(); });

  // Sell order button
  document.getElementById('btnSellGo').addEventListener('click', function() { startSellOrder(); });

  // Copy sell address
  document.getElementById('btnCopySellAddr').addEventListener('click', function() {
    copyText(document.getElementById('sellDepositAddr').textContent, this);
  });

  // Sell navigation buttons
  document.getElementById('btnSellSent').addEventListener('click', function() { goSell(3); });
  document.getElementById('btnSellCancel').addEventListener('click', function() { goSell(1); });
  document.getElementById('btnNewSell').addEventListener('click', function() { setDirection('sell'); goSell(1); });

  // PWA Install buttons
  document.getElementById('btnInstallPWA').addEventListener('click', function() { installPWA(); });
  document.getElementById('btnDismissInstall').addEventListener('click', function() { dismissInstall(); });
});
