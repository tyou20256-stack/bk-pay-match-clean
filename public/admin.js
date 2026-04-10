// admin.js — Admin dashboard logic (extracted from admin.html)

// HTML escape to prevent XSS
function escapeHtml(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// Get CSRF token from cookie
function getCsrfToken(){var m=document.cookie.match(/bkpay_csrf=([^;]+)/);return m?m[1]:'';}

// Safe fetch wrapper — checks res.ok, handles JSON parse errors, includes CSRF token
async function safeFetch(url,opts){
  opts=opts||{};
  opts.headers=opts.headers||{};
  if(typeof opts.headers==='object'&&!Array.isArray(opts.headers)){opts.headers['X-CSRF-Token']=getCsrfToken();}
  var r=await fetch(url,opts);
  if(!r.ok){console.error('[Fetch]',url,'status:',r.status);return{success:false,error:'Server error ('+r.status+')'};}
  try{return await r.json();}catch(e){console.error('[Fetch] JSON parse error:',url);return{success:false,error:'Response parse error'};}
}

// Theme
function toggleTheme(){var n=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);document.getElementById('themeBtn').textContent=n==='dark'?'D':'L';localStorage.setItem('theme',n);}
(function(){var s=localStorage.getItem('theme')||'dark';document.documentElement.setAttribute('data-theme',s);})();

// Tabs
function showTab(t,btn){
  document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active');});
  document.getElementById('tab-'+t).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.remove('active');});
  if(btn)btn.classList.add('active');
  if(t==='orders')loadOrders();
  if(t==='accounts')loadAccounts();
  if(t==='exchange')loadTraderStatus();
  if(t==='reports')loadReports();
  if(t==='customers')loadCustomers();
  if(t==='spread')loadSpread();
  if(t==='fees')loadFeeReport();
  if(t==='users'){loadUsers();loadMfaStatus();}
  if(t==='limits')loadLimits();
  if(t==='apikeys')loadApiKeys();
  if(t==='p2psellers')loadP2PSellers();
  if(t==='withdrawals')loadWithdrawals();
  if(t==='autotrade')loadAutoTrade();
  if(t==='matchboard')loadMatchBoard();
  if(t==='wallet'){loadWalletStatus();loadCryptoTransactions();loadBankVerifierStatus();loadBankTransfers();}
}

// Orders
async function loadOrders(){
  try{
    var d=await safeFetch('/api/orders');
    if(!d.success)return;
    allOrders=d.orders;
    applyFilters();
  }catch(e){}
}
async function confirmOrder(id){await fetch('/api/orders/'+id+'/paid',{method:'POST'});loadOrders();}
async function cancelOrderAdmin(id){await fetch('/api/orders/'+id+'/cancel',{method:'POST'});loadOrders();}
async function verifyPayment(id){
  if(!confirm('この注文の入金を確認済みにしますか？'))return;
  var d=await safeFetch('/api/orders/'+id+'/verify',{method:'POST'});
  if(!d.success)alert('エラー: '+(d.error||'不明'));
  loadOrders();
}
async function sendCrypto(id,btn){
  if(!confirm('この注文のUSDTを自動送金しますか？'))return;
  if(btn){btn.disabled=true;btn.textContent='送金中...';}
  try{
    var d=await safeFetch('/api/orders/'+id+'/send-crypto',{method:'POST'});
    if(d.success){alert('送金成功 TX: '+(d.txId||'--'));}
    else{alert('送金失敗: '+(d.error||'不明'));}
  }catch(e){alert('通信エラー');}
  if(btn){btn.disabled=false;btn.textContent='USDT送金';}
  loadOrders();
}
async function manualComplete(id){
  var txId=prompt('トランザクションID（任意）を入力してください:','');
  if(txId===null)return;
  var d=await safeFetch('/api/orders/'+encodeURIComponent(id)+'/manual-complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({txId:txId||undefined})});
  if(!d.success){alert('エラー: '+(d.error||'不明'));return;}
  loadOrders();
}

// Accounts
function showAddAccount(){document.getElementById('addAccountForm').style.display='block';}
function hideAddAccount(){document.getElementById('addAccountForm').style.display='none';}
async function saveAccount(){
  var acc={bankName:document.getElementById('accBank').value,branchName:document.getElementById('accBranch').value,accountType:document.getElementById('accType').value,accountNumber:document.getElementById('accNumber').value,accountHolder:document.getElementById('accHolder').value,dailyLimit:parseInt(document.getElementById('accLimit').value)||3000000,priority:document.getElementById('accPriority').value,status:document.getElementById('accStatus').value,memo:document.getElementById('accMemo').value};
  if(!acc.bankName||!acc.accountNumber||!acc.accountHolder){alert('銀行名、口座番号、名義は必須です');return;}
  await fetch('/api/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(acc)});
  hideAddAccount();loadAccounts();
  ['accBank','accBranch','accNumber','accHolder','accMemo'].forEach(function(id){document.getElementById(id).value='';});
}
async function deleteAccount(id){await fetch('/api/accounts/'+id,{method:'DELETE'});loadAccounts();}
async function toggleAccountStatus(id,current){
  var newStatus=current==='active'?'rest':'active';
  await fetch('/api/accounts/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:newStatus})});
  loadAccounts();
}
async function loadAccounts(){
  try{
    var d=await safeFetch('/api/accounts');
    if(!d.success)return;
    var accounts=d.accounts;
    var tbody=document.getElementById('accountTableBody');
    if(!accounts.length){tbody.innerHTML='<tr><td colspan="9" class="empty-state">口座が登録されていません</td></tr>';return;}
    tbody.innerHTML=accounts.map(function(a){
      var sc=a.status==='active'?'on':a.status==='rest'?'rest':'off';
      var sl=a.status==='active'?'稼働中':a.status==='rest'?'休止中':'凍結';
      return'<tr><td><span class="status-dot '+sc+'"></span>'+sl+'</td>'
        +'<td>'+(a.bank_name||'')+'</td><td>'+(a.branch_name||'')+'</td>'
        +'<td style="font-family:monospace;letter-spacing:1px">'+(a.account_number||'')+'</td>'
        +'<td>'+(a.account_holder||'')+'</td>'
        +'<td>¥'+(a.daily_limit||0).toLocaleString()+'</td>'
        +'<td>¥'+(a.used_today||0).toLocaleString()+'</td>'
        +'<td>'+(a.priority||'')+'</td>'
        +'<td><button class="btn btn-outline" style="padding:2px 8px;font-size:9px" data-action="toggleAccountStatus" data-id="'+a.id+'" data-status="'+escapeHtml(a.status)+'">'+(a.status==='active'?'休止':'稼働')+'</button> <button class="btn btn-red" style="padding:2px 8px;font-size:9px" data-action="deleteAccount" data-id="'+a.id+'">削除</button></td></tr>';
    }).join('');
  }catch(e){}
}

// E-pay
function previewQr(input,boxId,type){
  var file=input.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    var box=document.getElementById(boxId);
    box.innerHTML='<img src="'+e.target.result+'" alt="QR"><input type="file" accept="image/*" data-qr-preview="'+escapeHtml(boxId)+'" data-qr-type="'+escapeHtml(type)+'">';
    localStorage.setItem('bkpay_qr_'+type,e.target.result);
  };
  reader.readAsDataURL(file);
}
async function saveEpay(type){
  var data={};
  if(type==='paypay'){data={payId:document.getElementById('paypayId').value,displayName:document.getElementById('paypayName').value,qrImage:localStorage.getItem('bkpay_qr_paypay')||''};}
  if(type==='linepay'){data={payId:document.getElementById('linepayId').value,linkUrl:document.getElementById('linepayUrl').value,qrImage:localStorage.getItem('bkpay_qr_linepay')||''};}
  if(type==='aupay'){data={payId:document.getElementById('aupayId').value,displayName:document.getElementById('aupayName').value,qrImage:localStorage.getItem('bkpay_qr_aupay')||''};}
  await fetch('/api/epay/'+type,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  alert(type+' の設定を保存しました');
}

// Exchange
async function saveExchange(ex){
  var prefix=ex.toLowerCase();
  var body={exchange:ex,email:document.getElementById(prefix+'Email').value,password:document.getElementById(prefix+'Pass').value};
  if(document.getElementById(prefix+'ApiKey'))body.apiKey=document.getElementById(prefix+'ApiKey').value;
  if(document.getElementById(prefix+'ApiSecret'))body.apiSecret=document.getElementById(prefix+'ApiSecret').value;
  if(document.getElementById(prefix+'Totp'))body.totpSecret=document.getElementById(prefix+'Totp').value;
  if(document.getElementById(prefix+'Passphrase'))body.passphrase=document.getElementById(prefix+'Passphrase').value;
  await fetch('/api/exchange-creds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var d=await safeFetch('/api/trader/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(d.success){document.getElementById(prefix+'Status').className='badge badge-green';document.getElementById(prefix+'Status').textContent='設定済み';}
  alert(d.message||d.error);
}
async function traderLogin(ex,btn){
  if(btn){btn.disabled=true;btn.textContent='ログイン中...';}
  try{
    var d=await safeFetch('/api/trader/login/'+ex,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
    alert(d.message||d.error||'Error');
    loadTraderStatus();
  }catch(e){alert('Login error');}
  if(btn){btn.disabled=false;btn.textContent='ログイン';}
}
async function loadScreenshot(){
  var container=document.getElementById('screenshotContainer');
  try{
    var r=await fetch('/api/trader/screenshot');
    if(r.headers.get('content-type')?.includes('image')){
      var blob=await r.blob();
      var url=URL.createObjectURL(blob);
      container.innerHTML='<img src="'+url+'" style="max-width:100%;border:1px solid var(--border);border-radius:8px;margin-top:4px">';
    }else{
      var d=await r.json();
      container.innerHTML='<span style="color:var(--text2)">'+escapeHtml(d.error||'スクリーンショットなし')+'</span>';
    }
  }catch(e){container.innerHTML='<span style="color:var(--red)">取得失敗</span>';}
}
async function loadTraderStatus(){
  try{var d=await safeFetch('/api/trader/status');
    var s=d.status;
    var html='<div>ブラウザ: '+(s.browserReady?'<span style="color:var(--green)">起動中</span>':'<span style="color:var(--red)">停止中</span>')+'</div>'
      +'<div>対応取引所: '+s.supported.map(escapeHtml).join(', ')+'</div>';
    if(s.loginStatus){
      for(var ex of s.supported){
        var ls=s.loginStatus[ex]||{};
        var statusEl=document.getElementById(escapeHtml(ex.toLowerCase())+'Status');
        html+='<div style="margin-top:4px">'+escapeHtml(ex)+': '+(ls.loggedIn?'<span style="color:var(--green)">ログイン済み</span>':'<span style="color:var(--yellow)">未ログイン</span>');
        if(ls.lastActivity)html+=' (最終: '+escapeHtml(new Date(ls.lastActivity).toLocaleString('ja-JP'))+')';
        html+='</div>';
        if(statusEl){statusEl.className='badge badge-'+(ls.loggedIn?'green':'yellow');statusEl.textContent=ls.loggedIn?'ログイン済み':'未設定';}
      }
    }
    document.getElementById('traderStatus').innerHTML=html;
  }catch(e){}
}

// Wallet
async function saveWallet(){
  var addr=document.getElementById('walletAddr').value;
  var label=document.getElementById('walletLabel').value;
  await fetch('/api/wallet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:addr,label:label})});
  alert('ウォレットアドレスを保存しました');
}

// Settings
async function saveSettings(){
  var data={minCompletion:document.getElementById('setMinCompletion').value,orderTimeout:document.getElementById('setTimeout').value,minAmount:document.getElementById('setMinAmount').value,maxAmount:document.getElementById('setMaxAmount').value,onlineOnly:document.getElementById('setOnlineOnly').value,fallbackMode:document.getElementById('setFallback').value};
  await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  alert('設定を保存しました');
}


// Order Filters
var allOrders = [];
function applyFilters(){
  var fId = document.getElementById('filterOrderId').value.toLowerCase();
  var fStatus = document.getElementById('filterStatus').value;
  var fMethod = document.getElementById('filterMethod').value;
  var fFrom = document.getElementById('filterFrom').value;
  var fTo = document.getElementById('filterTo').value;
  var filtered = allOrders.filter(function(o){
    if(fId && !o.id.toLowerCase().includes(fId)) return false;
    if(fStatus && o.status !== fStatus) return false;
    if(fMethod && o.payMethod !== fMethod) return false;
    if(fFrom && o.createdAt < fFrom) return false;
    if(fTo && o.createdAt > fTo + 'T23:59:59') return false;
    return true;
  });
  renderOrders(filtered);
}
function clearFilters(){
  ['filterOrderId','filterFrom','filterTo'].forEach(function(id){document.getElementById(id).value='';});
  ['filterStatus','filterMethod'].forEach(function(id){document.getElementById(id).value='';});
  renderOrders(allOrders);
}
function renderOrders(orders){
  document.getElementById('statTotal').textContent=orders.length;
  document.getElementById('statPending').textContent=orders.filter(function(o){return o.status==='pending_payment';}).length;
  document.getElementById('statCompleted').textContent=orders.filter(function(o){return o.status==='completed';}).length;
  document.getElementById('statCancelled').textContent=orders.filter(function(o){return o.status==='cancelled'||o.status==='expired';}).length;
  var tbody=document.getElementById('orderTableBody');
  if(!orders.length){tbody.innerHTML='<tr><td colspan="12" class="empty-state">該当する注文がありません</td></tr>';return;}
  var sc={'matching':'os-matching','pending_payment':'os-pending','confirming':'os-confirming','payment_verified':'os-verified','sending_crypto':'os-sending','completed':'os-completed','cancelled':'os-cancelled','expired':'os-expired'};
  var sl={'matching':'検索中','pending_payment':'支払待ち','confirming':'入金確認中','payment_verified':'入金確認済','sending_crypto':'送金中','completed':'完了','cancelled':'キャンセル','expired':'期限切れ','paid':'支払済'};
  tbody.innerHTML=orders.map(function(o){
    var dt=new Date(o.createdAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
    var actions='--';
    var btnStyle='padding:3px 8px;font-size:9px';
    var eid=escapeHtml(o.id);
    if(o.status==='pending_payment'){
      actions='<button class="btn btn-green" style="'+btnStyle+'" data-action="confirmOrder" data-oid="'+eid+'">承認</button> <button class="btn btn-red" style="'+btnStyle+'" data-action="cancelOrderAdmin" data-oid="'+eid+'">却下</button>';
    }else if(o.status==='confirming'){
      actions='<button class="btn btn-green" style="'+btnStyle+'" data-action="verifyPayment" data-oid="'+eid+'">入金確認</button> <button class="btn btn-red" style="'+btnStyle+'" data-action="cancelOrderAdmin" data-oid="'+eid+'">却下</button>';
    }else if(o.status==='payment_verified'){
      actions='<button class="btn btn-green" style="'+btnStyle+'" data-action="sendCrypto" data-oid="'+eid+'">USDT送金</button> <button class="btn btn-outline" style="'+btnStyle+'" data-action="manualComplete" data-oid="'+eid+'">手動完了</button>';
    }else if(o.status==='sending_crypto'){
      actions='<span style="color:var(--yellow);font-size:10px">送金処理中...</span>';
    }
    var txInfo=o.txId?'<div style="font-size:8px;color:var(--dim);margin-top:2px" title="'+escapeHtml(o.txId)+'">TX: '+escapeHtml(o.txId.slice(0,8))+'...</div>':'';
    return'<tr><td style="font-family:monospace;font-size:10px">'+eid+txInfo+'</td>'
      +'<td><span class="badge '+(o.mode==='auto'?'badge-green':'badge-yellow')+'">'+escapeHtml(o.mode).toUpperCase()+'</span></td>'
      +'<td>¥'+o.amount.toLocaleString()+'</td>'
      +'<td>'+escapeHtml(o.crypto||'USDT')+'</td>'
      +'<td>'+o.cryptoAmount+'</td>'
      +'<td>¥'+(o.rate||0).toFixed(1)+'</td>'
      +'<td>'+escapeHtml(o.exchange||'--')+'</td>'
      +'<td style="font-size:10px;color:var(--dim)">'+(o.sellerId?'S'+o.sellerId:'-')+'</td>'
      +'<td>'+escapeHtml(o.payMethod)+'</td>'
      +'<td><span class="order-status '+(sc[o.status]||'')+'">'+(sl[o.status]||escapeHtml(o.status))+'</span></td>'
      +'<td>'+dt+'</td>'
      +'<td>'+actions+'</td></tr>';
  }).join('');
}

// CSV Import
function showBulkImport(){document.getElementById('bulkImportForm').style.display='block';}
function hideBulkImport(){document.getElementById('bulkImportForm').style.display='none';document.getElementById('csvResult').style.display='none';}
async function importCsv(){
  var csv=document.getElementById('csvData').value.trim();
  if(!csv){alert('CSVデータを入力してください');return;}
  var lines=csv.split('\n').filter(function(l){return l.trim();});
  var accounts=lines.map(function(line){
    var cols=line.split(',').map(function(c){return c.trim();});
    return{bankName:cols[0]||'',branchName:cols[1]||'',accountType:cols[2]||'普通',accountNumber:cols[3]||'',accountHolder:cols[4]||'',dailyLimit:parseInt(cols[5])||3000000,priority:cols[6]||'medium'};
  });
  try{
    var d=await safeFetch('/api/accounts/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(accounts)});
    var el=document.getElementById('csvResult');
    el.style.display='block';
    if(d.success){el.innerHTML='<span style="color:var(--green)">'+Number(d.count||0)+'件の口座を登録しました</span>';loadAccounts();}
    else{el.innerHTML='<span style="color:var(--red)">エラー: '+escapeHtml(d.error||'不明')+'</span>';}
  }catch(e){alert('通信エラー');}
}

// Reports
async function loadReports(){
  try{
    var d=await safeFetch('/api/reports/summary');
    if(!d.success)return;
    var today=d.today||{};
    document.getElementById('rpTotal').textContent=today.totalOrders||0;
    document.getElementById('rpCompleted').textContent=today.completedOrders||0;
    document.getElementById('rpVolume').textContent='¥'+((today.totalJpy||0)).toLocaleString();
    document.getElementById('rpUsdt').textContent=(today.totalUsdt||0).toFixed(2);
    var days=d.days||[];
    var tbody=document.getElementById('reportTableBody');
    if(!days.length){tbody.innerHTML='<tr><td colspan="7" class="empty-state">データがありません</td></tr>';return;}
    tbody.innerHTML=days.map(function(day){
      var rate=day.completedOrders>0?(day.totalJpy/day.totalUsdt).toFixed(1):'--';
      var pct=day.totalOrders>0?Math.round(day.completedOrders/day.totalOrders*100)+'%':'--';
      return'<tr><td>'+day.date+'</td><td>'+day.totalOrders+'</td><td>'+day.completedOrders+'</td><td>'+pct+'</td><td>¥'+(day.totalJpy||0).toLocaleString()+'</td><td>'+(day.totalUsdt||0).toFixed(2)+'</td><td>'+(rate==='--'?'--':'¥'+rate)+'</td></tr>';
    }).join('');
  }catch(e){}
}

// Password Change
async function changePassword(){
  var cur=document.getElementById('pwCurrent').value;
  var nw=document.getElementById('pwNew').value;
  var cf=document.getElementById('pwConfirm').value;
  if(!cur||!nw){alert('パスワードを入力してください');return;}
  if(nw!==cf){alert('新しいパスワードが一致しません');return;}
  if(nw.length<6){alert('パスワードは6文字以上にしてください');return;}
  try{
    var d=await safeFetch('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:cur,newPassword:nw})});
    if(d.success){alert('パスワードを変更しました');['pwCurrent','pwNew','pwConfirm'].forEach(function(id){document.getElementById(id).value='';});}
    else{alert('エラー: '+(d.error||'変更できませんでした'));}
  }catch(e){alert('通信エラー');}
}


// Customers
async function loadCustomers(){
  try{
    var d=await safeFetch("/api/admin/customers");
    if(!d.success)return;
    var customers=d.customers||[];
    document.getElementById("custTotal").textContent=customers.length;
    document.getElementById("custActive").textContent=customers.filter(function(c){return c.isActive;}).length;
    document.getElementById("custVip").textContent=customers.filter(function(c){return c.vipRank&&c.vipRank!=="Bronze";}).length;
    var totalRewards=customers.reduce(function(s,c){return s+(c.referralReward||0);},0);
    document.getElementById("custRewards").textContent="¥"+totalRewards.toLocaleString();
    var tbody=document.getElementById("customerTableBody");
    if(!customers.length){tbody.innerHTML="<tr><td colspan=\"7\" class=\"empty-state\">顧客がいません</td></tr>";return;}
    tbody.innerHTML=customers.map(function(c){
      var dt=c.createdAt?new Date(c.createdAt).toLocaleDateString("ja-JP"):"--";
      var validRanks=["Bronze","Silver","Gold","Platinum"];
      var safeRank=validRanks.includes(c.vipRank)?c.vipRank:"Bronze";
      var rankCls={"Bronze":"badge-yellow","Silver":"badge-yellow","Gold":"badge-green","Platinum":"badge-green"};
      return "<tr><td style=\"font-family:monospace\">"+escapeHtml(String(c.telegramId||"--"))+"</td>"
        +"<td><span class=\"badge "+(rankCls[safeRank]||"badge-yellow")+"\">"+escapeHtml(safeRank)+"</span></td>"
        +"<td>¥"+((c.totalVolume||0)).toLocaleString()+"</td>"
        +"<td>"+Number(c.totalTrades||0)+"</td>"
        +"<td style=\"font-family:monospace\">"+escapeHtml(String(c.referralCode||"--"))+"</td>"
        +"<td>"+Number(c.referralCount||0)+"</td>"
        +"<td>"+escapeHtml(dt)+"</td></tr>";
    }).join("");
  }catch(e){console.error("loadCustomers error:",e);}
}

// Fee Settings
async function loadFeeSettings(){
  try{
    var d=await safeFetch('/api/fees/settings');
    if(!d.success||!d.data)return;
    document.getElementById('feeBronze').value=d.data.vip_bronze_rate;
    document.getElementById('feeSilver').value=d.data.vip_silver_rate;
    document.getElementById('feeGold').value=d.data.vip_gold_rate;
    document.getElementById('feePlatinum').value=d.data.vip_platinum_rate;
  }catch(e){}
}
async function saveFeeSettings(){
  var body={vip_bronze_rate:parseFloat(document.getElementById('feeBronze').value),vip_silver_rate:parseFloat(document.getElementById('feeSilver').value),vip_gold_rate:parseFloat(document.getElementById('feeGold').value),vip_platinum_rate:parseFloat(document.getElementById('feePlatinum').value)};
  body.base_fee_rate=body.vip_bronze_rate;
  await fetch('/api/fees/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  alert('手数料設定を保存しました');
}
async function loadFeeReport(){
  try{
    var today=new Date().toISOString().slice(0,10);
    var monthStart=today.slice(0,8)+'01';
    // Today
    var d1=await safeFetch('/api/fees/report?from='+today+'&to='+today);
    if(d1.success)document.getElementById('feesToday').textContent='\u00a5'+(d1.data.total.total_fee_jpy||0).toLocaleString();
    // Month
    var d2=await safeFetch('/api/fees/report?from='+monthStart+'&to='+today);
    if(d2.success){
      document.getElementById('feesMonth').textContent='\u00a5'+(d2.data.total.total_fee_jpy||0).toLocaleString();
      document.getElementById('feesOrders').textContent=d2.data.total.order_count||0;
      var tbody=document.getElementById('feeTableBody');
      var days=d2.data.byDay||[];
      if(!days.length){tbody.innerHTML='<tr><td colspan="4" class="empty-state">データなし</td></tr>';return;}
      tbody.innerHTML=days.map(function(d){return'<tr><td>'+d.day+'</td><td>\u00a5'+(d.fee_jpy||0).toLocaleString()+'</td><td>'+(d.fee_crypto||0).toFixed(4)+'</td><td>'+d.order_count+'</td></tr>';}).join('');
    }
    // Total (all time)
    var d3=await safeFetch('/api/fees/report?from=2020-01-01&to='+today);
    if(d3.success)document.getElementById('feesTotal').textContent='\u00a5'+(d3.data.total.total_fee_jpy||0).toLocaleString();
    loadFeeSettings();
    loadCostConfig();
  }catch(e){console.error(e);}
}


// Cost Config (margin safety)
async function loadCostConfig(){
  try{
    var d=await safeFetch('/api/cost-config');
    if(!d.success||!d.data)return;
    document.getElementById('costTronGas').value=d.data.tron_gas_jpy;
    document.getElementById('costBankFee').value=d.data.bank_transfer_fee_jpy;
    document.getElementById('costExchangeRate').value=d.data.exchange_fee_rate;
    document.getElementById('costMinMarginJpy').value=d.data.min_margin_jpy;
    document.getElementById('costMinMarginRate').value=d.data.min_margin_rate;
    document.getElementById('costAutoAdjust').value=d.data.auto_adjust_fee;
  }catch(e){}
}
async function saveCostConfig(){
  var body={
    tron_gas_jpy:parseFloat(document.getElementById('costTronGas').value),
    bank_transfer_fee_jpy:parseFloat(document.getElementById('costBankFee').value),
    exchange_fee_rate:parseFloat(document.getElementById('costExchangeRate').value),
    min_margin_jpy:parseFloat(document.getElementById('costMinMarginJpy').value),
    min_margin_rate:parseFloat(document.getElementById('costMinMarginRate').value),
    auto_adjust_fee:parseInt(document.getElementById('costAutoAdjust').value)
  };
  await safeFetch('/api/cost-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  alert('コスト設定を保存しました');
}
async function calcCostEstimate(){
  var amount=parseFloat(document.getElementById('estimateAmount').value)||10000;
  var direction=document.getElementById('estimateDirection').value;
  var d=await safeFetch('/api/cost-config/estimate?amount='+amount+'&direction='+direction);
  if(d.success&&d.data){
    document.getElementById('estCost').textContent='\u00a5'+d.data.estimatedCost.toLocaleString();
    document.getElementById('estMinFee').textContent='\u00a5'+d.data.minFeeJpy.toLocaleString();
    document.getElementById('estMinRate').textContent=(d.data.minFeeRate*100).toFixed(2)+'%';
    document.getElementById('estimateResult').style.display='block';
  }
}

// Spread Optimizer
async function loadSpread(){
  try{
    // Load recommendation
    var d=await safeFetch('/api/spread/recommendation');
    if(d.success&&d.data){
      var recs=d.data.recommendations||[];
      var usdt=recs.find(function(x){return x.crypto==='USDT';});
      if(usdt){
        document.getElementById('spBuySpread').textContent=(usdt.buy.finalSpread*100).toFixed(2)+'%';
        document.getElementById('spSellSpread').textContent=(usdt.sell.finalSpread*100).toFixed(2)+'%';
        document.getElementById('spDemand').textContent=usdt.buy.demandAdjustment>0?'High':usdt.buy.demandAdjustment<0?'Low':'Normal';
      }
      // Render recommendations
      var html='';
      recs.forEach(function(rec){
        html+='<div style="margin-bottom:12px"><strong>'+escapeHtml(String(rec.crypto))+'</strong><br>';
        html+='<span style="color:var(--green)">Buy: '+(rec.buy.finalSpread*100).toFixed(2)+'%</span>';
        html+=' | <span style="color:var(--blue)">Sell: '+(rec.sell.finalSpread*100).toFixed(2)+'%</span><br>';
        html+='<span style="font-size:10px;color:var(--dim)">'+rec.buy.reason.map(escapeHtml).join(' / ')+'</span>';
        html+='</div>';
      });
      document.getElementById('spreadRecContent').innerHTML=html||'データなし';

      // Render configs
      var configs=d.data.configs||[];
      var chtml='';
      configs.forEach(function(c){
        // Restrict crypto ID to safe alphanumeric for use in element IDs and onclick
        var cid=String(c.crypto).replace(/[^A-Za-z0-9]/g,'');
        var cdisplay=escapeHtml(String(c.crypto));
        chtml+='<div class="card"><div class="card-title">'+cdisplay+' スプレッド設定</div>';
        chtml+='<div class="form-grid">';
        chtml+='<div class="form-group"><label class="form-label">Buy Markup (%)</label><input class="form-input" type="number" step="0.1" id="sp_buy_'+cid+'" value="'+(c.buyMarkup*100).toFixed(1)+'"></div>';
        chtml+='<div class="form-group"><label class="form-label">Sell Discount (%)</label><input class="form-input" type="number" step="0.1" id="sp_sell_'+cid+'" value="'+(c.sellDiscount*100).toFixed(1)+'"></div>';
        chtml+='<div class="form-group"><label class="form-label">Min Spread (%)</label><input class="form-input" type="number" step="0.1" id="sp_min_'+cid+'" value="'+(c.minMarkup*100).toFixed(1)+'"></div>';
        chtml+='<div class="form-group"><label class="form-label">Max Spread (%)</label><input class="form-input" type="number" step="0.1" id="sp_max_'+cid+'" value="'+(c.maxMarkup*100).toFixed(1)+'"></div>';
        chtml+='<div class="form-group"><label class="form-label">Auto Adjust</label><select class="form-select" id="sp_auto_'+cid+'"><option value="1"'+(c.autoAdjust?' selected':'')+'>ON</option><option value="0"'+(!c.autoAdjust?' selected':'')+'>OFF</option></select></div>';
        chtml+='</div>';
        chtml+='<div class="btn-group"><button class="btn btn-green" data-action="saveSpreadConfig" data-crypto="'+cid+'">保存</button></div>';
        chtml+='</div>';
      });
      document.getElementById('spreadConfigCards').innerHTML=chtml;
    }

    // Load 24h stats
    var d2=await safeFetch('/api/spread/stats');
    if(d2.success&&d2.data){
      var stats=d2.data;
      document.getElementById('sp24hOrders').textContent=stats.reduce(function(s,x){return s+x.orderCount;},0);
      // Render volume chart (24 bars)
      var hourData=new Array(24).fill(0);
      stats.forEach(function(s){hourData[s.hour]=(hourData[s.hour]||0)+s.totalVolume;});
      var maxVol=Math.max.apply(null,hourData)||1;
      var chartHtml='';
      for(var h=0;h<24;h++){
        var pct=Math.max(2,hourData[h]/maxVol*100);
        var jstH=h;
        chartHtml+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">';
        chartHtml+='<div style="width:100%;background:var(--green);border-radius:2px 2px 0 0;height:'+pct+'%;min-height:2px;opacity:'+(hourData[h]>0?'1':'0.2')+'" title="'+jstH+':00 - ¥'+Math.round(hourData[h]).toLocaleString()+'"></div>';
        chartHtml+='<div style="font-size:8px;color:var(--dim)">'+(h%3===0?jstH:'')+'</div>';
        chartHtml+='</div>';
      }
      document.getElementById('volumeChart').innerHTML=chartHtml;
    }
  }catch(e){console.error('loadSpread error:',e);}
}

async function saveSpreadConfig(crypto){
  var data={
    crypto:crypto,
    buyMarkup:parseFloat(document.getElementById('sp_buy_'+crypto).value)/100,
    sellDiscount:parseFloat(document.getElementById('sp_sell_'+crypto).value)/100,
    minMarkup:parseFloat(document.getElementById('sp_min_'+crypto).value)/100,
    maxMarkup:parseFloat(document.getElementById('sp_max_'+crypto).value)/100,
    autoAdjust:document.getElementById('sp_auto_'+crypto).value==='1'
  };
  await fetch('/api/spread/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  alert(crypto+' スプレッド設定を保存しました');
  loadSpread();
}

// WebSocket for live order updates
(function() {
  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var ws = new WebSocket(proto + '//' + location.host + '/ws');
  ws.onmessage = function(e) {
    var msg = JSON.parse(e.data);
    if (msg.type === 'order') { loadOrders(); }
  };
  ws.onclose = function() {
    setTimeout(function reconnect() {
      var p = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var w = new WebSocket(p + '//' + location.host + '/ws');
      w.onmessage = ws.onmessage;
      w.onclose = function() { setTimeout(reconnect, 5000); };
    }, 5000);
  };
})();

function exportCSV(format) {
  var from = document.getElementById("exportFrom")?.value || "";
  var to = document.getElementById("exportTo")?.value || "";
  var url = "/api/export/orders" + (format !== "standard" ? "/" + format : "") + "?from=" + from + "&to=" + to;
  window.open(url, "_blank");
}

function exportAccounts() {
  window.open("/api/export/accounts", "_blank");
}

// === Account Health ===
async function loadAccountHealth(){
  try{
    var d=await safeFetch('/api/accounts/health');
    if(!d.success||!d.data)return;
    window._healthData=d.data;
    // Update account table with health info
    var rows=document.querySelectorAll('#accountTableBody tr');
    d.data.forEach(function(h){
      rows.forEach(function(row){
        var cells=row.querySelectorAll('td');
        if(!cells.length)return;
        var lastCell=cells[cells.length-1];
        var bankCell=cells[1];
        if(bankCell&&bankCell.textContent===h.bankName){
          var existingBadge=row.querySelector('.health-badge');
          if(existingBadge)existingBadge.remove();
          var badge=document.createElement('span');
          badge.className='health-badge';
          var color=h.healthScore>=80?'#22c55e':h.healthScore>=50?'#eab308':'#ef4444';
          badge.style.cssText='display:inline-block;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;color:#fff;background:'+color+';margin-left:4px';
          badge.textContent=h.healthScore;
          if(h.healthScore<50)badge.textContent+=' !';
          cells[0].appendChild(badge);
        }
      });
    });
  }catch(e){console.error('Health load error:',e);}
}

async function checkAllAccountHealth(){
  try{
    var d=await safeFetch('/api/accounts/health/check-all',{method:'POST'});
    if(d.success){
      alert('Check complete: '+d.rested+' rested, '+d.frozen+' frozen');
      loadAccounts();
      setTimeout(loadAccountHealth,500);
    }
  }catch(e){alert('Error');}
}

// Override showTab to also load health
var _origShowTab=window.showTab;
if(_origShowTab){
  window.showTab=function(t,btn){
    _origShowTab(t,btn);
    if(t==='accounts')setTimeout(loadAccountHealth,300);
  };
}

// Also load health on initial account load
var _origLoadAccounts=window.loadAccounts;
if(_origLoadAccounts){
  var _newLoadAccounts=async function(){
    await _origLoadAccounts();
    setTimeout(loadAccountHealth,200);
  };
  window.loadAccounts=_newLoadAccounts;
}

// Add "全口座チェック" button
document.addEventListener('DOMContentLoaded',function(){
  var accountsSection=document.querySelector('[data-tab="accounts"]');
  if(accountsSection){
    setTimeout(function(){
      var secTitles=document.querySelectorAll('.sec-title');
      secTitles.forEach(function(t){
        if(t.textContent.includes('銀行口座')){
          var btn=document.createElement('button');
          btn.className='btn btn-outline';
          btn.style.cssText='margin-left:12px;padding:4px 12px;font-size:10px';
          btn.textContent='全口座ヘルスチェック';
          btn.addEventListener('click', checkAllAccountHealth);
          t.parentElement.appendChild(btn);
        }
      });
    },100);
  }
});

// === MFA Management ===
async function loadMfaStatus(){
  try{
    var d=await safeFetch('/api/auth/check');
    // Check if MFA is enabled by calling a dedicated endpoint
    var m=await safeFetch('/api/auth/mfa/status');
    if(!m.success)return;
    var badge=document.getElementById('mfaBadge');
    var setupBtn=document.getElementById('mfaSetupBtn');
    var disableBtn=document.getElementById('mfaDisableBtn');
    if(m.mfaEnabled){
      badge.textContent='有効';badge.style.color='var(--green)';
      setupBtn.style.display='none';
      disableBtn.style.display='inline-block';
    } else {
      badge.textContent='無効';badge.style.color='var(--red)';
      setupBtn.style.display='inline-block';
      disableBtn.style.display='none';
    }
  }catch(e){ document.getElementById('mfaBadge').textContent='エラー'; }
}

async function setupMfaFlow(){
  try{
    var d=await safeFetch('/api/auth/mfa/setup',{method:'POST'});
    if(!d.success){alert(d.error||'MFA設定エラー');return;}
    document.getElementById('mfaSetupArea').style.display='block';
    document.getElementById('mfaActions').style.display='none';
    // Show QR code as an image using the otpauth URL via a QR service or inline
    var qrArea=document.getElementById('mfaQrArea');
    qrArea.innerHTML='<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(d.otpauthUrl)+'" alt="QR Code" style="border-radius:8px;background:#fff;padding:8px">';
    document.getElementById('mfaSecretText').textContent='手動入力: '+d.secret;
  }catch(e){alert('MFA設定エラー');}
}

async function enableMfaFlow(){
  var code=document.getElementById('mfaSetupCode').value;
  if(!code||code.length!==6){alert('6桁のコードを入力してください');return;}
  try{
    var d=await safeFetch('/api/auth/mfa/enable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({totpCode:code})});
    if(d.success){
      alert('MFAが有効化されました');
      document.getElementById('mfaSetupArea').style.display='none';
      document.getElementById('mfaActions').style.display='block';
      loadMfaStatus();
    } else {
      alert(d.error||'コードが正しくありません');
      document.getElementById('mfaSetupCode').value='';
    }
  }catch(e){alert('エラー');}
}

async function disableMfaFlow(){
  var pw=prompt('MFAを無効化するにはパスワードを入力してください:');
  if(!pw)return;
  try{
    var d=await safeFetch('/api/auth/mfa/disable',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
    if(d.success){alert('MFAを無効化しました');loadMfaStatus();}
    else{alert(d.error||'エラー');}
  }catch(e){alert('エラー');}
}

// === User Management (RBAC) ===
function showAddUser(){document.getElementById('addUserForm').style.display='block';}

async function loadUsers(){
  try{
    var d=await safeFetch('/api/admin/users');
    if(!d.success)return;
    var tb=document.getElementById('usersTableBody');
    if(!d.users||d.users.length===0){tb.innerHTML='<tr><td colspan="4" class="empty-state">ユーザーなし</td></tr>';return;}
    tb.innerHTML=d.users.map(function(u){
      var roleColors={admin:'green',trader:'blue',operator:'yellow',viewer:'dim'};
      var validRoles=['admin','trader','operator','viewer'];
      var safeRole=validRoles.includes(u.role)?u.role:'viewer';
      var c=roleColors[safeRole]||'dim';
      var uid=parseInt(u.id,10)||0;
      return '<tr><td>'+uid+'</td><td>'+escapeHtml(u.username)+'</td><td><span class="badge" style="color:var(--'+c+')">'+escapeHtml(safeRole)+'</span></td><td>'
        +'<select data-action="changeUserRole" data-uid="'+uid+'" style="background:var(--input-bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:10px">'
        +'<option value="viewer"'+(safeRole==='viewer'?' selected':'')+'>Viewer</option>'
        +'<option value="operator"'+(safeRole==='operator'?' selected':'')+'>Operator</option>'
        +'<option value="trader"'+(safeRole==='trader'?' selected':'')+'>Trader</option>'
        +'<option value="admin"'+(safeRole==='admin'?' selected':'')+'>Admin</option></select> '
        +'<button class="btn btn-red" style="padding:2px 8px;font-size:9px" data-action="deleteUser" data-uid="'+uid+'">削除</button></td></tr>';
    }).join('');
  }catch(e){}
}

async function createUser(){
  var un=document.getElementById('newUsername').value;
  var pw=document.getElementById('newUserPassword').value;
  var role=document.getElementById('newUserRole').value;
  if(!un||!pw){alert('ユーザー名とパスワードを入力してください');return;}
  try{
    var d=await safeFetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:un,password:pw,role:role})});
    if(d.success){document.getElementById('addUserForm').style.display='none';loadUsers();}
    else{alert(d.error||'Error');}
  }catch(e){alert('Error');}
}

async function changeUserRole(id,role){
  try{await fetch('/api/admin/users/'+id+'/role',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:role})});}catch(e){}
}

async function deleteUser(id){
  if(!confirm('このユーザーを削除しますか？'))return;
  try{var d=await safeFetch('/api/admin/users/'+id,{method:'DELETE'});if(d.success)loadUsers();else alert(d.error||'Error');}catch(e){alert('Error');}
}

// === Trading Limits ===
async function loadLimits(){
  try{
    var d=await safeFetch('/api/limits');
    if(!d.success)return;
    var tb=document.getElementById('limitsTableBody');
    if(!d.limits||d.limits.length===0){tb.innerHTML='<tr><td colspan="7" class="empty-state">上限設定なし</td></tr>';return;}
    tb.innerHTML=d.limits.map(function(l){
      return '<tr><td>'+l.scope+'</td><td>'+(l.scope_id||'-')+'</td>'
        +'<td>¥'+Number(l.per_transaction).toLocaleString()+'</td>'
        +'<td>¥'+Number(l.daily_limit).toLocaleString()+'</td>'
        +'<td>¥'+Number(l.weekly_limit).toLocaleString()+'</td>'
        +'<td>¥'+Number(l.monthly_limit).toLocaleString()+'</td>'
        +'<td>'+(l.scope!=='global'?'<button class="btn btn-red" style="padding:2px 8px;font-size:9px" data-action="deleteLimits" data-scope="'+escapeHtml(l.scope)+'" data-scope-id="'+escapeHtml(l.scope_id||'')+'">削除</button>':'-')+'</td></tr>';
    }).join('');
    // Load usage
    var u=await fetch('/api/limits/usage?scope=global&scopeId=');var ud=await u.json();
    if(ud.success&&ud.usage){
      document.getElementById('limitDaily').textContent='¥'+Number(ud.usage.daily_used).toLocaleString()+' / ¥'+Number(ud.usage.daily_limit).toLocaleString();
      document.getElementById('limitWeekly').textContent='¥'+Number(ud.usage.weekly_used).toLocaleString()+' / ¥'+Number(ud.usage.weekly_limit).toLocaleString();
      document.getElementById('limitMonthly').textContent='¥'+Number(ud.usage.monthly_used).toLocaleString()+' / ¥'+Number(ud.usage.monthly_limit).toLocaleString();
      document.getElementById('limitPerTx').textContent='¥'+Number(ud.usage.per_transaction).toLocaleString();
    }
  }catch(e){}
}

async function deleteLimits(scope,scopeId){
  if(!confirm('この上限設定を削除しますか？'))return;
  try{var d=await safeFetch('/api/limits',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:scope,scopeId:scopeId})});if(d.success)loadLimits();}catch(e){}
}

// === Wallet Sending Status ===
async function loadWalletStatus(){
  try{
    var d=await safeFetch('/api/wallet/status');
    if(!d.success)return;
    var el=document.getElementById('walletSendingStatus');
    if(!el)return;
    if(d.ready){
      var bal=d.balance;
      el.innerHTML='<span style="color:var(--green)">送金ウォレット: 有効</span>'
        +'<br><span style="font-size:10px;color:var(--dim)">アドレス: '+(d.address||'--')+'</span>'
        +(bal?'<br><span style="font-size:10px">TRX: '+bal.trx.toFixed(2)+' | USDT: '+bal.usdt.toFixed(2)+'</span>':'');
    }else{
      el.innerHTML='<span style="color:var(--yellow)">送金ウォレット: 未設定</span><br><span style="font-size:10px;color:var(--dim)">TRON_WALLET_PRIVATE_KEY を設定してください</span>';
    }
  }catch(e){}
}

// === Crypto Transactions ===
async function loadCryptoTransactions(){
  try{
    var d=await safeFetch('/api/crypto-transactions');
    if(!d.success)return;
    var el=document.getElementById('cryptoTxBody');
    if(!el)return;
    if(!d.transactions||!d.transactions.length){el.innerHTML='<tr><td colspan="6" class="empty-state">送金履歴なし</td></tr>';return;}
    el.innerHTML=d.transactions.map(function(tx){
      var dt=new Date(tx.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      return '<tr><td style="font-family:monospace;font-size:9px">'+escapeHtml(tx.order_id)+'</td>'
        +'<td>'+escapeHtml(tx.crypto)+'</td><td>'+tx.amount+'</td>'
        +'<td style="font-family:monospace;font-size:8px" title="'+escapeHtml(tx.to_address)+'">'+escapeHtml(tx.to_address.slice(0,8))+'...'+escapeHtml(tx.to_address.slice(-6))+'</td>'
        +'<td style="font-family:monospace;font-size:8px"><a href="https://tronscan.org/#/transaction/'+encodeURIComponent(tx.tx_id)+'" target="_blank" rel="noopener" style="color:var(--green)">'+escapeHtml(tx.tx_id.slice(0,10))+'...</a></td>'
        +'<td>'+dt+'</td></tr>';
    }).join('');
  }catch(e){}
}

// === Bank Transfer Verification (Phase C) ===
var bankVerifierEnabled=true;

async function loadBankVerifierStatus(){
  try{
    var d=await safeFetch('/api/bank-transfers/status');
    if(!d.success)return;
    bankVerifierEnabled=d.enabled;
    var el=document.getElementById('bankVerifierStatus');
    if(!el)return;
    var statusColor=d.enabled?'var(--green)':'var(--yellow)';
    el.innerHTML='<span style="color:'+statusColor+'">'+(d.enabled?'有効':'無効')+'</span>'
      +' | 未マッチ入金: <b>'+d.unmatchedTransfers+'</b> | confirming注文: <b>'+d.confirmingOrders+'</b>';
    var btn=document.getElementById('btnToggleVerifier');
    if(btn)btn.textContent=d.enabled?'無効にする':'有効にする';
  }catch(e){}
}

async function toggleBankVerifier(){
  try{
    var d=await safeFetch('/api/bank-transfers/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!bankVerifierEnabled})});
    if(d.success){bankVerifierEnabled=d.enabled;loadBankVerifierStatus();}
  }catch(e){}
}

async function triggerBankMatch(){
  try{
    var d=await safeFetch('/api/bank-transfers/match',{method:'POST'});
    if(d.success){
      alert('マッチ完了: '+d.matched+'件');
      loadBankTransfers();loadBankVerifierStatus();loadOrders();
    }
  }catch(e){alert('エラー');}
}

async function registerBankTransfer(){
  var amount=document.getElementById('btAmount').value;
  var date=document.getElementById('btDate').value;
  var sender=document.getElementById('btSender').value;
  var ref=document.getElementById('btRef').value;
  if(!amount||!date){alert('金額と入金日は必須です');return;}
  try{
    var d=await safeFetch('/api/bank-transfers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:Number(amount),transferDate:date,senderName:sender||undefined,reference:ref||undefined})});
    if(d.success){
      var msg='登録完了 (#'+d.id+')';
      if(d.autoMatched)msg+=' → 注文 '+d.matchedOrderId+' と自動マッチ！';
      alert(msg);
      document.getElementById('btAmount').value='';
      document.getElementById('btSender').value='';
      document.getElementById('btRef').value='';
      loadBankTransfers();loadBankVerifierStatus();if(d.autoMatched)loadOrders();
    }else{alert(d.error||'エラー');}
  }catch(e){alert('通信エラー');}
}

async function importBankCSV(){
  var csv=document.getElementById('btCsvInput').value;
  if(!csv.trim()){alert('CSVデータを入力してください');return;}
  try{
    var d=await safeFetch('/api/bank-transfers/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv:csv})});
    var el=document.getElementById('btImportResult');
    if(d.success){
      var html='<span style="color:var(--green)">インポート: '+d.imported+'件 / マッチ: '+d.matched+'件</span>';
      if(d.errors&&d.errors.length)html+='<br><span style="color:var(--red)">エラー: '+d.errors.join(', ')+'</span>';
      if(d.details){
        d.details.forEach(function(det){
          if(det.matched)html+='<br><span style="font-size:10px;color:var(--green)">行'+det.line+': ¥'+det.amount.toLocaleString()+' → '+det.orderId+'</span>';
        });
      }
      el.innerHTML=html;
      document.getElementById('btCsvInput').value='';
      loadBankTransfers();loadBankVerifierStatus();if(d.matched>0)loadOrders();
    }else{
      el.innerHTML='<span style="color:var(--red)">'+escapeHtml(d.error||'エラー')+'</span>';
    }
  }catch(e){document.getElementById('btImportResult').innerHTML='<span style="color:var(--red)">通信エラー</span>';}
}

async function loadBankTransfers(){
  try{
    var d=await safeFetch('/api/bank-transfers?limit=50');
    if(!d.success)return;
    var el=document.getElementById('bankTransferBody');
    if(!el)return;
    if(!d.transfers||!d.transfers.length){el.innerHTML='<tr><td colspan="7" class="empty-state">入金記録なし</td></tr>';return;}
    el.innerHTML=d.transfers.map(function(t){
      var dt=new Date(t.created_at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
      var sc=t.status==='matched'?'color:var(--green)':t.status==='unmatched'?'color:var(--yellow)':'';
      var sl={'unmatched':'未マッチ','matched':'マッチ済','manual':'手動確認'};
      return '<tr><td>'+t.id+'</td>'
        +'<td>¥'+Number(t.amount).toLocaleString()+'</td>'
        +'<td>'+t.transfer_date+'</td>'
        +'<td>'+escapeHtml(t.sender_name||'-')+'</td>'
        +'<td style="'+sc+'">'+(sl[t.status]||t.status)+'</td>'
        +'<td style="font-family:monospace;font-size:9px">'+(t.order_id||'-')+'</td>'
        +'<td>'+dt+'</td></tr>';
    }).join('');
  }catch(e){}
}

// Init
loadOrders();
loadAccounts();
loadTraderStatus();
loadWalletStatus();


// ═══════════════════════════════════════════════════════════════
// APIキー管理
// ═══════════════════════════════════════════════════════════════
async function loadApiKeys() {
  try {
    var d = await safeFetch('/api/v1/keys');
    var el = document.getElementById('apiKeysTableBody');
    if (!el) return;
    if (!d.success || !d.keys || !d.keys.length) {
      el.innerHTML = '<tr><td colspan="7" class="empty-state">APIキーなし</td></tr>';
      return;
    }
    el.innerHTML = d.keys.map(function(k) {
      var dt = k.last_used_at ? new Date(k.last_used_at).toLocaleString('ja-JP', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '-';
      var status = k.is_active ? '<span style="color:var(--green)">有効</span>' : '<span style="color:var(--red)">無効</span>';
      return '<tr>'
        + '<td>' + k.id + '</td>'
        + '<td>' + escapeHtml(k.name) + '</td>'
        + '<td style="font-family:monospace;font-size:11px">' + escapeHtml(k.key_prefix) + '</td>'
        + '<td style="font-size:11px">' + (k.webhook_url ? escapeHtml(k.webhook_url) : '-') + '</td>'
        + '<td>' + status + '</td>'
        + '<td>' + dt + '</td>'
        + '<td><button class="btn btn-outline" style="padding:2px 8px;font-size:11px;color:var(--red);border-color:var(--red)" data-action="revokeApiKey" data-kid="' + k.id + '" data-kname="' + escapeHtml(k.name) + '">失効</button></td>'
        + '</tr>';
    }).join('');
  } catch(e) {}
}

function openNewKeyModal() {
  var m = document.getElementById('newKeyModal');
  m.style.display = 'flex';
  document.getElementById('newKeyName').value = '';
  document.getElementById('newKeyWebhook').value = '';
}

function closeNewKeyModal() {
  document.getElementById('newKeyModal').style.display = 'none';
}

async function createApiKey() {
  var name = document.getElementById('newKeyName').value.trim();
  var webhookUrl = document.getElementById('newKeyWebhook').value.trim();
  if (!name) { alert('キー名を入力してください'); return; }
  try {
    var body = { name: name };
    if (webhookUrl) body.webhookUrl = webhookUrl;
    var d = await safeFetch('/api/v1/keys', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    closeNewKeyModal();
    if (d.success) {
      document.getElementById('generatedKey').textContent = d.key;
      document.getElementById('keyResultModal').style.display = 'flex';
      loadApiKeys();
    } else {
      alert('エラー: ' + (d.error || '発行失敗'));
    }
  } catch(e) { alert('通信エラー'); }
}

function closeKeyResultModal() {
  document.getElementById('keyResultModal').style.display = 'none';
}

function copyKey() {
  var key = document.getElementById('generatedKey').textContent;
  navigator.clipboard.writeText(key).then(function() { alert('コピーしました'); });
}

async function revokeApiKey(id, name) {
  if (!confirm('「' + name + '」を失効させますか？\nこのキーは使用できなくなります。')) return;
  try {
    var d = await safeFetch('/api/v1/keys/' + id, { method: 'DELETE' });
    if (d.success) { loadApiKeys(); } else { alert('失効エラー: ' + (d.error || '')); }
  } catch(e) { alert('通信エラー'); }
}

// ═══════════════════════════════════════════════════════════════
// P2P セラー管理
// ═══════════════════════════════════════════════════════════════
var _creditSellerId = null;

async function loadP2PSellers() {
  try {
    var d = await safeFetch('/api/p2p/sellers');
    var el = document.getElementById('p2pSellersTableBody');
    if (!el) return;
    if (!d.success || !d.sellers || !d.sellers.length) {
      el.innerHTML = '<tr><td colspan="9" class="empty-state">セラーなし</td></tr>';
      return;
    }
    el.innerHTML = d.sellers.map(function(s) {
      var avail = ((s.usdt_balance || 0) - (s.usdt_locked || 0)).toFixed(2);
      var status = s.status === 'active' ? '<span style="color:var(--green)">有効</span>'
        : s.status === 'pending' ? '<span style="color:var(--yellow)">承認待ち</span>'
        : '<span style="color:var(--red)">停止</span>';
      var approveBtn = s.status === 'pending'
        ? '<button class="btn btn-green" style="padding:2px 8px;font-size:11px" data-action="p2pSetStatus" data-sid="' + s.id + '" data-new-status="active">承認</button> '
        : '';
      var suspendBtn = s.status === 'active'
        ? '<button class="btn btn-outline" style="padding:2px 8px;font-size:11px;color:var(--red);border-color:var(--red)" data-action="p2pSetStatus" data-sid="' + s.id + '" data-new-status="suspended">停止</button> '
        : '';
      return '<tr>'
        + '<td>' + s.id + '</td>'
        + '<td>' + escapeHtml(s.name) + '</td>'
        + '<td style="font-size:11px">' + escapeHtml(s.email) + '</td>'
        + '<td style="font-family:monospace;font-size:11px">' + escapeHtml(s.paypay_id || '-') + '</td>'
        + '<td style="color:var(--green)">' + avail + '</td>'
        + '<td style="color:var(--yellow)">' + (s.usdt_locked || 0).toFixed(2) + '</td>'
        + '<td>' + (s.total_trades || 0) + '</td>'
        + '<td>' + status + '</td>'
        + '<td>' + approveBtn + suspendBtn
          + '<button class="btn btn-outline" style="padding:2px 8px;font-size:11px" data-action="openCreditModal" data-sid="' + s.id + '" data-sname="' + escapeHtml(s.name) + '">残高付与</button> '
          + (s.confirm_token ? '<button class="btn btn-outline" style="padding:2px 6px;font-size:10px" data-action="copySellerConfirmToken" data-token="' + escapeHtml(s.confirm_token) + '" title="確認URLをコピー">URL</button>' : '')
          + '</td>'
        + '</tr>';
    }).join('');
  } catch(e) {}
}

async function p2pSetStatus(id, status) {
  try {
    var d = await safeFetch('/api/p2p/sellers/' + id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
    if (d.success) loadP2PSellers(); else alert('エラー: ' + (d.error || ''));
  } catch(e) { alert('通信エラー'); }
}

function openCreditModal(id, name) {
  _creditSellerId = id;
  document.getElementById('creditSellerName').textContent = name;
  document.getElementById('creditAmount').value = '';
  document.getElementById('creditModal').style.display = 'flex';
}

function closeCreditModal() {
  document.getElementById('creditModal').style.display = 'none';
  _creditSellerId = null;
}

async function doCredit() {
  var amount = parseFloat(document.getElementById('creditAmount').value);
  if (!amount || amount <= 0) { alert('USDT量を入力してください'); return; }
  try {
    var d = await safeFetch('/api/p2p/sellers/' + _creditSellerId + '/credit', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount })
    });
    closeCreditModal();
    if (d.success) { loadP2PSellers(); } else { alert('エラー: ' + (d.error || '')); }
  } catch(e) { alert('通信エラー'); }
}

function copySellerConfirmToken(token) {
  var url = location.origin + '/seller-confirm.html?orderId=ORDER_ID&token=' + token;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(function() {
      alert('確認 URL をコピーしました。\n※ orderId= 部分を実際の注文 ID に置換してください:\n\n' + url);
    }).catch(function() {
      prompt('URLをコピーしてください:', url);
    });
  } else {
    prompt('URLをコピーしてください:', url);
  }
}

// === Withdrawals (Triangle Matching) ===
async function loadWithdrawals() {
  try {
    var d = await safeFetch('/api/withdrawals');
    if (!d.success) return;
    var wds = d.withdrawals || [];

    // Stats
    var counts = { pending: 0, matched: 0, completed: 0, cancelled: 0 };
    wds.forEach(function(w) { if (counts[w.status] !== undefined) counts[w.status]++; });
    var statsEl = document.getElementById('wdStats');
    statsEl.innerHTML =
      '<div class="card" style="flex:1;min-width:100px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:700;color:var(--blue)">' + counts.pending + '</div><div style="font-size:11px;color:var(--dim)">受付中</div></div>' +
      '<div class="card" style="flex:1;min-width:100px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:700;color:var(--yellow,#eab308)">' + counts.matched + '</div><div style="font-size:11px;color:var(--dim)">マッチ済</div></div>' +
      '<div class="card" style="flex:1;min-width:100px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:700;color:var(--green)">' + counts.completed + '</div><div style="font-size:11px;color:var(--dim)">完了</div></div>' +
      '<div class="card" style="flex:1;min-width:100px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:700;color:var(--red,#ef4444)">' + counts.cancelled + '</div><div style="font-size:11px;color:var(--dim)">キャンセル</div></div>';

    // Table
    var tbody = document.getElementById('wdTableBody');
    if (!wds.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-state">出金リクエストなし</td></tr>';
      return;
    }
    var statusLabels = { pending: '受付中', matched: 'マッチ済', completed: '完了', cancelled: 'キャンセル', expired: '期限切れ' };
    var statusColors = { pending: 'var(--blue)', matched: '#eab308', completed: 'var(--green)', cancelled: '#ef4444', expired: 'var(--dim)' };
    tbody.innerHTML = wds.map(function(w) {
      var sLabel = statusLabels[w.status] || w.status;
      var sColor = statusColors[w.status] || 'var(--dim)';
      return '<tr>' +
        '<td>' + w.id + '</td>' +
        '<td>' + escapeHtml(w.externalRef || '-') + '</td>' +
        '<td style="text-align:right">\u00a5' + Number(w.amount).toLocaleString() + '</td>' +
        '<td>' + (w.payMethod === 'bank' ? '銀行' : w.payMethod) + '</td>' +
        '<td><span style="color:' + sColor + ';font-weight:600">' + sLabel + '</span></td>' +
        '<td>' + escapeHtml(w.matchedOrderId || '-') + '</td>' +
        '<td>' + (w.matchedSellerId || '-') + '</td>' +
        '<td style="font-size:11px">' + fmtTs(w.createdAt) + '</td>' +
        '<td style="font-size:11px">' + fmtTs(w.expiresAt) + '</td>' +
        '<td style="font-size:11px">' + (w.completedAt ? fmtTs(w.completedAt) : '-') + '</td>' +
        '</tr>';
    }).join('');
  } catch(e) { console.error('[Withdrawals]', e); }
}
function fmtTs(ts) {
  if (!ts) return '-';
  var d = new Date(ts);
  return d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

// === Auto-Trade ===
async function loadAutoTrade() {
  try {
    // Load status
    var statusRes = await safeFetch('/api/auto-trade/status');
    var statusData = statusRes;
    if (statusData.success) {
      var s = statusData;
      var statusHtml =
        '<div class="stat-card"><div class="stat-value">' + (s.enabled ? '有効' : '無効') + '</div><div class="stat-label">自動取引</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + (s.polling ? '稼働中' : '停止') + '</div><div class="stat-label">ポーリング</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + (s.okxAvailable ? '接続可' : '未設定') + '</div><div class="stat-label">OKX API</div></div>' +
        '<div class="stat-card"><div class="stat-value">' + (s.puppeteerStatus?.browserReady ? '起動済' : '停止') + '</div><div class="stat-label">Puppeteer</div></div>';
      document.getElementById('atStatus').innerHTML = statusHtml;
    }

    // Load config
    var configRes = await safeFetch('/api/auto-trade/config');
    var configData = configRes;
    if (configData.success) {
      var c = configData.config;
      var configLabels = {
        enabled: '有効化', preferred_channel: '優先チャネル', preferred_exchange: '優先取引所',
        max_amount: '上限額 (JPY)', min_amount: '下限額 (JPY)',
        auto_confirm_payment: '支払い自動確認', polling_interval_ms: 'ポーリング間隔 (ms)',
      };
      var formHtml = '';
      for (var key in configLabels) {
        var val = c[key] || '';
        var label = configLabels[key];
        if (key === 'enabled' || key === 'auto_confirm_payment') {
          formHtml += '<div><label style="font-size:12px;color:var(--dim)">' + label + '</label>' +
            '<select data-key="' + key + '" class="at-config-input" style="width:100%;padding:6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px">' +
            '<option value="true"' + (val==='true'?' selected':'') + '>はい</option>' +
            '<option value="false"' + (val==='false'?' selected':'') + '>いいえ</option>' +
            '</select></div>';
        } else if (key === 'preferred_channel') {
          formHtml += '<div><label style="font-size:12px;color:var(--dim)">' + label + '</label>' +
            '<select data-key="' + key + '" class="at-config-input" style="width:100%;padding:6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px">' +
            '<option value="api"' + (val==='api'?' selected':'') + '>API (OKX)</option>' +
            '<option value="puppeteer"' + (val==='puppeteer'?' selected':'') + '>Puppeteer (Bybit/Binance)</option>' +
            '</select></div>';
        } else if (key === 'preferred_exchange') {
          formHtml += '<div><label style="font-size:12px;color:var(--dim)">' + label + '</label>' +
            '<select data-key="' + key + '" class="at-config-input" style="width:100%;padding:6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px">' +
            '<option value="OKX"' + (val==='OKX'?' selected':'') + '>OKX</option>' +
            '<option value="Bybit"' + (val==='Bybit'?' selected':'') + '>Bybit</option>' +
            '<option value="Binance"' + (val==='Binance'?' selected':'') + '>Binance</option>' +
            '</select></div>';
        } else {
          formHtml += '<div><label style="font-size:12px;color:var(--dim)">' + label + '</label>' +
            '<input data-key="' + key + '" class="at-config-input" type="text" value="' + val + '" style="width:100%;padding:6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px"></div>';
        }
      }
      document.getElementById('atConfigForm').innerHTML = formHtml;
    }

    // Load orders
    var ordersRes = await safeFetch('/api/auto-trade/orders?limit=50');
    var ordersData = ordersRes;
    if (ordersData.success && ordersData.orders.length > 0) {
      document.getElementById('atTableBody').innerHTML = ordersData.orders.map(function(o) {
        var statusClass = o.status === 'completed' ? 'status-completed' : o.status === 'failed' ? 'status-cancelled' : o.status === 'placed' ? 'status-pending' : o.status === 'paid' ? 'status-matched' : '';
        return '<tr>' +
          '<td>' + o.id + '</td>' +
          '<td style="font-size:11px">' + (o.order_id || '-') + '</td>' +
          '<td>' + (o.exchange || '-') + '</td>' +
          '<td>' + (o.channel || '-') + '</td>' +
          '<td style="font-size:11px">' + (o.exchange_order_id || '-') + '</td>' +
          '<td><span class="status-badge ' + statusClass + '">' + (o.status || '-') + '</span></td>' +
          '<td>¥' + (o.amount_jpy ? Number(o.amount_jpy).toLocaleString() : '-') + '</td>' +
          '<td style="font-size:11px">' + fmtTs(o.created_at) + '</td>' +
          '<td style="font-size:11px">' + (o.completed_at ? fmtTs(o.completed_at) : '-') + '</td>' +
          '<td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis">' + (o.error_message || '-') + '</td>' +
          '</tr>';
      }).join('');
    } else {
      document.getElementById('atTableBody').innerHTML = '<tr><td colspan="10" class="empty-state">取引所注文はありません</td></tr>';
    }
  } catch(e) { console.error('[AutoTrade]', e); }
}

async function saveAutoTradeConfig() {
  try {
    var inputs = document.querySelectorAll('.at-config-input');
    var body = {};
    inputs.forEach(function(el) {
      body[el.getAttribute('data-key')] = el.value;
    });
    var data = await safeFetch('/api/auto-trade/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (data.success) {
      alert('設定を保存しました');
      loadAutoTrade();
    } else {
      alert('エラー: ' + (data.error || '保存に失敗しました'));
    }
  } catch(e) { console.error('[AutoTrade]', e); alert('保存に失敗しました'); }
}

// --- Event delegation for admin.html (moved from inline handlers) ---
document.addEventListener('DOMContentLoaded', function() {
  // Theme toggle
  document.getElementById('themeBtn').addEventListener('click', function() { toggleTheme(); });

  // Nav tab buttons
  document.querySelectorAll('.nav-btn[data-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() { showTab(btn.dataset.tab, btn); });
  });

  // Order filter inputs
  document.getElementById('filterOrderId').addEventListener('input', function() { applyFilters(); });
  document.getElementById('filterStatus').addEventListener('change', function() { applyFilters(); });
  document.getElementById('filterMethod').addEventListener('change', function() { applyFilters(); });
  document.getElementById('filterFrom').addEventListener('change', function() { applyFilters(); });
  document.getElementById('filterTo').addEventListener('change', function() { applyFilters(); });

  // QR upload boxes
  document.querySelectorAll('[data-action="qrUploadClick"]').forEach(function(box) {
    box.addEventListener('click', function() { box.querySelector('input').click(); });
  });

  // Global event delegation for click actions
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;

    // Static actions (from HTML)
    if (action === 'loadOrders') { loadOrders(); return; }
    if (action === 'clearFilters') { clearFilters(); return; }
    if (action === 'exportCSV') { exportCSV(btn.dataset.format); return; }
    if (action === 'showAddAccount') { showAddAccount(); return; }
    if (action === 'showBulkImport') { showBulkImport(); return; }
    if (action === 'exportAccounts') { exportAccounts(); return; }
    if (action === 'saveAccount') { saveAccount(); return; }
    if (action === 'hideAddAccount') { hideAddAccount(); return; }
    if (action === 'importCsv') { importCsv(); return; }
    if (action === 'hideBulkImport') { hideBulkImport(); return; }
    if (action === 'saveEpay') { saveEpay(btn.dataset.epayType); return; }
    if (action === 'saveExchange') { saveExchange(btn.dataset.exchange); return; }
    if (action === 'traderLogin') { traderLogin(btn.dataset.exchange, btn); return; }
    if (action === 'loadScreenshot') { loadScreenshot(); return; }
    if (action === 'saveWallet') { saveWallet(); return; }
    if (action === 'toggleBankVerifier') { toggleBankVerifier(); return; }
    if (action === 'triggerBankMatch') { triggerBankMatch(); return; }
    if (action === 'registerBankTransfer') { registerBankTransfer(); return; }
    if (action === 'importBankCSV') { importBankCSV(); return; }
    if (action === 'saveSettings') { saveSettings(); return; }
    if (action === 'loadSpread') { loadSpread(); return; }
    if (action === 'loadReports') { loadReports(); return; }
    if (action === 'loadCustomers') { loadCustomers(); return; }
    if (action === 'loadFeeReport') { loadFeeReport(); return; }
    if (action === 'saveFeeSettings') { saveFeeSettings(); return; }
    if (action === 'showAddUser') { showAddUser(); return; }
    if (action === 'createUser') { createUser(); return; }
    if (action === 'hideAddUserForm') { document.getElementById('addUserForm').style.display = 'none'; return; }
    if (action === 'changePassword') { changePassword(); return; }
    if (action === 'loadLimits') { loadLimits(); return; }
    if (action === 'openNewKeyModal') { openNewKeyModal(); return; }
    if (action === 'closeNewKeyModal') { closeNewKeyModal(); return; }
    if (action === 'createApiKey') { createApiKey(); return; }
    if (action === 'copyKey') { copyKey(); return; }
    if (action === 'closeKeyResultModal') { closeKeyResultModal(); return; }
    if (action === 'loadP2PSellers') { loadP2PSellers(); return; }
    if (action === 'closeCreditModal') { closeCreditModal(); return; }
    if (action === 'doCredit') { doCredit(); return; }
    if (action === 'loadWithdrawals') { loadWithdrawals(); return; }
    if (action === 'loadAutoTrade') { loadAutoTrade(); return; }
    if (action === 'loadMatchBoard') { loadMatchBoard(); return; }
    if (action === 'saveAutoTradeConfig') { saveAutoTradeConfig(); return; }
    if (action === 'saveCostConfig') { saveCostConfig(); return; }
    if (action === 'calcEstimate') { calcCostEstimate(); return; }

    // Dynamic actions (from rendered HTML)
    if (action === 'toggleAccountStatus') { toggleAccountStatus(parseInt(btn.dataset.id), btn.dataset.status); return; }
    if (action === 'deleteAccount') { deleteAccount(parseInt(btn.dataset.id)); return; }
    if (action === 'confirmOrder') { confirmOrder(btn.dataset.oid); return; }
    if (action === 'cancelOrderAdmin') { cancelOrderAdmin(btn.dataset.oid); return; }
    if (action === 'verifyPayment') { verifyPayment(btn.dataset.oid); return; }
    if (action === 'sendCrypto') { sendCrypto(btn.dataset.oid, btn); return; }
    if (action === 'manualComplete') { manualComplete(btn.dataset.oid); return; }
    if (action === 'saveSpreadConfig') { saveSpreadConfig(btn.dataset.crypto); return; }
    if (action === 'deleteUser') { deleteUser(parseInt(btn.dataset.uid)); return; }
    if (action === 'setupMfa') { setupMfaFlow(); return; }
    if (action === 'enableMfa') { enableMfaFlow(); return; }
    if (action === 'disableMfa') { disableMfaFlow(); return; }
    if (action === 'cancelMfaSetup') { document.getElementById('mfaSetupArea').style.display='none'; document.getElementById('mfaActions').style.display='block'; return; }
    if (action === 'deleteLimits') { deleteLimits(btn.dataset.scope, btn.dataset.scopeId); return; }
    if (action === 'revokeApiKey') { revokeApiKey(parseInt(btn.dataset.kid), btn.dataset.kname); return; }
    if (action === 'p2pSetStatus') { p2pSetStatus(parseInt(btn.dataset.sid), btn.dataset.newStatus); return; }
    if (action === 'openCreditModal') { openCreditModal(parseInt(btn.dataset.sid), btn.dataset.sname); return; }
    if (action === 'copySellerConfirmToken') { copySellerConfirmToken(btn.dataset.token); return; }
  });

  // Event delegation for change events (user role selects, QR file inputs)
  document.addEventListener('change', function(e) {
    var el = e.target;
    // User role change
    if (el.dataset.action === 'changeUserRole') {
      changeUserRole(parseInt(el.dataset.uid), el.value);
      return;
    }
    // QR file preview
    if (el.dataset.qrPreview) {
      previewQr(el, el.dataset.qrPreview, el.dataset.qrType);
      return;
    }
  });
});

// === Match Board ===
async function loadMatchBoard() {
  try {
    // Fetch TruPay queue + P2P rates in parallel
    var [queueRes, ratesRes] = await Promise.all([
      safeFetch('/api/trupay/withdrawals?status=queued&limit=100'),
      safeFetch('/api/rates/USDT'),
    ]);

    // Parse TruPay queue
    var queue = (queueRes.success && queueRes.data) ? queueRes.data : [];
    var totalQueueJpy = queue.reduce(function(s, w) { return s + (w.amount_jpy || 0); }, 0);

    // Parse P2P buy orders (bank transfer only)
    var buyOrders = [];
    if (ratesRes.success && ratesRes.data && ratesRes.data.rates) {
      ratesRes.data.rates.forEach(function(ex) {
        (ex.buyOrders || []).forEach(function(o) {
          var methods = (o.paymentMethods || []).map(function(m) { return String(m).toLowerCase(); });
          var hasBank = methods.some(function(m) {
            return m.indexOf('bank') >= 0 || m.indexOf('振込') >= 0 || m.indexOf('transfer') >= 0;
          });
          if (hasBank) buyOrders.push(o);
        });
      });
    }
    buyOrders.sort(function(a, b) { return a.price - b.price; });

    var totalBuyerDemand = buyOrders.reduce(function(s, o) { return s + (o.maxLimit || 0); }, 0);
    var bestRate = ratesRes.data && ratesRes.data.bestBuyExchange ? ratesRes.data.bestBuyExchange.price : 0;

    // Stats
    var statsEl = document.getElementById('mbStats');
    statsEl.innerHTML =
      '<div class="card" style="flex:1;min-width:130px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:700;color:var(--green)">' + queue.length + '</div><div style="font-size:10px;color:var(--dim)">出金キュー</div></div>' +
      '<div class="card" style="flex:1;min-width:130px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:700;color:var(--green)">\u00a5' + totalQueueJpy.toLocaleString() + '</div><div style="font-size:10px;color:var(--dim)">出金合計</div></div>' +
      '<div class="card" style="flex:1;min-width:130px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:700;color:var(--blue)">' + buyOrders.length + '</div><div style="font-size:10px;color:var(--dim)">P2P買い注文（銀行振込）</div></div>' +
      '<div class="card" style="flex:1;min-width:130px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:700;color:var(--blue)">\u00a5' + totalBuyerDemand.toLocaleString() + '</div><div style="font-size:10px;color:var(--dim)">買い需要合計</div></div>' +
      '<div class="card" style="flex:1;min-width:130px;padding:12px;text-align:center"><div style="font-size:20px;font-weight:700;color:#eab308">\u00a5' + (bestRate ? bestRate.toFixed(2) : '--') + '</div><div style="font-size:10px;color:var(--dim)">最安レート</div></div>';

    // Queue table
    var qBody = document.getElementById('mbQueueBody');
    document.getElementById('mbQueueSummary').textContent = queue.length + '件 / 合計 \u00a5' + totalQueueJpy.toLocaleString();
    if (!queue.length) {
      qBody.innerHTML = '<tr><td colspan="5" class="empty-state">キューが空です</td></tr>';
    } else {
      qBody.innerHTML = queue.slice(0, 50).map(function(w) {
        var elapsed = Math.floor((Date.now() - w.created_at) / 60000);
        var elapsedStr = elapsed < 60 ? elapsed + '分' : Math.floor(elapsed / 60) + '時間' + (elapsed % 60) + '分';
        return '<tr>' +
          '<td>' + w.id + '</td>' +
          '<td style="text-align:right;font-weight:600">\u00a5' + Number(w.amount_jpy).toLocaleString() + '</td>' +
          '<td>' + escapeHtml(w.bank_name) + '</td>' +
          '<td style="font-size:10px">' + escapeHtml(w.account_name) + '</td>' +
          '<td style="color:var(--dim)">' + elapsedStr + '</td>' +
          '</tr>';
      }).join('');
    }

    // Buyers table
    var bBody = document.getElementById('mbBuyerBody');
    document.getElementById('mbBuyerSummary').textContent = buyOrders.length + '件 / 需要合計 \u00a5' + totalBuyerDemand.toLocaleString();
    if (!buyOrders.length) {
      bBody.innerHTML = '<tr><td colspan="6" class="empty-state">銀行振込対応の買い注文なし</td></tr>';
    } else {
      bBody.innerHTML = buyOrders.slice(0, 30).map(function(o) {
        var exColor = o.exchange === 'Binance' ? '#f0b90b' : o.exchange === 'OKX' ? '#fff' : '#f7a600';
        return '<tr>' +
          '<td style="color:' + exColor + ';font-weight:600">' + escapeHtml(o.exchange) + '</td>' +
          '<td style="text-align:right;font-weight:600">\u00a5' + Number(o.price).toFixed(2) + '</td>' +
          '<td style="font-size:10px">\u00a5' + Number(o.minLimit).toLocaleString() + '~\u00a5' + Number(o.maxLimit).toLocaleString() + '</td>' +
          '<td style="font-size:10px">' + escapeHtml(o.merchant ? o.merchant.name : '-') + '</td>' +
          '<td>' + (o.merchant ? o.merchant.completionRate.toFixed(1) + '%' : '-') + '</td>' +
          '<td>' + (o.merchant && o.merchant.isOnline ? '<span style="color:var(--green)">ON</span>' : '<span style="color:var(--dim)">OFF</span>') + '</td>' +
          '</tr>';
      }).join('');
    }

    // Match candidates (queue × buyers where amount falls in range)
    var candidates = [];
    queue.forEach(function(w) {
      buyOrders.forEach(function(o) {
        if (w.amount_jpy >= (o.minLimit || 0) && w.amount_jpy <= (o.maxLimit || Infinity)) {
          candidates.push({ withdrawal: w, buyer: o, usdt: (w.amount_jpy / o.price).toFixed(2) });
        }
      });
    });

    var cBody = document.getElementById('mbCandidateBody');
    var matchedWithdrawals = new Set();
    candidates.forEach(function(c) { matchedWithdrawals.add(c.withdrawal.id); });
    document.getElementById('mbMatchInfo').textContent =
      candidates.length + '件のマッチング候補 / ' + matchedWithdrawals.size + '/' + queue.length + '件の出金がマッチ可能';

    if (!candidates.length) {
      cBody.innerHTML = '<tr><td colspan="10" class="empty-state">マッチング候補なし</td></tr>';
    } else {
      cBody.innerHTML = candidates.slice(0, 50).map(function(c) {
        var w = c.withdrawal;
        var o = c.buyer;
        return '<tr>' +
          '<td>' + w.id + '</td>' +
          '<td style="text-align:right;font-weight:600">\u00a5' + Number(w.amount_jpy).toLocaleString() + '</td>' +
          '<td style="font-size:10px">' + escapeHtml(w.bank_name) + '</td>' +
          '<td style="text-align:center;color:#eab308;font-size:14px">\u2194</td>' +
          '<td style="font-weight:600">' + escapeHtml(o.exchange) + '</td>' +
          '<td style="font-size:10px">' + escapeHtml(o.merchant ? o.merchant.name : '-') + '</td>' +
          '<td style="text-align:right">\u00a5' + Number(o.price).toFixed(2) + '</td>' +
          '<td style="text-align:right;color:var(--green);font-weight:600">' + c.usdt + ' USDT</td>' +
          '<td style="font-size:10px">\u00a5' + Number(o.minLimit).toLocaleString() + '~\u00a5' + Number(o.maxLimit).toLocaleString() + '</td>' +
          '<td>' + (o.merchant ? o.merchant.completionRate.toFixed(1) + '%' : '-') + '</td>' +
          '</tr>';
      }).join('');
    }

    // Market analysis
    var analysisEl = document.getElementById('mbMarketAnalysis');
    var unmatchedCount = queue.length - matchedWithdrawals.size;
    var avgQueueAmount = queue.length > 0 ? Math.floor(totalQueueJpy / queue.length) : 0;
    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    html += '<div>';
    html += '<div style="font-weight:700;margin-bottom:8px;color:var(--text)">供給側（TruPay出金）</div>';
    html += '<div>キュー件数: <strong>' + queue.length + '件</strong></div>';
    html += '<div>合計金額: <strong>\u00a5' + totalQueueJpy.toLocaleString() + '</strong></div>';
    html += '<div>平均金額: <strong>\u00a5' + avgQueueAmount.toLocaleString() + '</strong></div>';
    html += '<div>マッチ可能: <strong style="color:var(--green)">' + matchedWithdrawals.size + '件</strong></div>';
    html += '<div>マッチ不可: <strong style="color:' + (unmatchedCount > 0 ? 'var(--red,#ef4444)' : 'var(--dim)') + '">' + unmatchedCount + '件</strong></div>';
    html += '</div>';
    html += '<div>';
    html += '<div style="font-weight:700;margin-bottom:8px;color:var(--text)">需要側（P2Pプラットフォーム）</div>';
    html += '<div>買い注文（銀行振込）: <strong>' + buyOrders.length + '件</strong></div>';
    html += '<div>需要合計: <strong>\u00a5' + totalBuyerDemand.toLocaleString() + '</strong></div>';
    if (bestRate) {
      html += '<div>最安レート: <strong>\u00a5' + bestRate.toFixed(2) + '</strong></div>';
      html += '<div>PayMatch推奨レート: <strong style="color:var(--green)">\u00a5' + (bestRate * 0.995).toFixed(2) + '</strong> (0.5%安)</div>';
      html += '<div style="font-size:11px;color:var(--dim);margin-top:4px">※ プラットフォーム最安値より0.5%安く設定すればバイヤーを誘引可能</div>';
    }
    html += '</div>';
    html += '</div>';

    // Demand vs Supply ratio
    if (totalQueueJpy > 0 && totalBuyerDemand > 0) {
      var ratio = (totalBuyerDemand / totalQueueJpy).toFixed(1);
      var ratioColor = ratio >= 1 ? 'var(--green)' : '#ef4444';
      html += '<div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:8px;text-align:center">';
      html += '<span style="font-size:12px;color:var(--dim)">需要/供給 比率: </span>';
      html += '<span style="font-size:24px;font-weight:800;color:' + ratioColor + '">' + ratio + 'x</span>';
      html += '<div style="font-size:11px;color:var(--dim);margin-top:4px">' +
        (ratio >= 1 ? 'P2Pプラットフォームに十分な需要あり。PayMatchへの誘導でマッチング率向上が見込める。' : '現在のP2P需要がTruPay出金供給を下回っています。レート競争力の向上が必要。') +
        '</div>';
      html += '</div>';
    }

    analysisEl.innerHTML = html;

  } catch(e) {
    console.error('[MatchBoard]', e);
    document.getElementById('mbStats').innerHTML = '<div class="card" style="padding:16px;color:#ef4444">データ取得に失敗しました: ' + escapeHtml(e.message || String(e)) + '</div>';
  }
}
