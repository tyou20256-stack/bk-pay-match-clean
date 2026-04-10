/* ───── Customer Dashboard App (CSP-compliant, no inline JS) ───── */
document.addEventListener('DOMContentLoaded', function () {

  /* ───── Customer dashboard i18n extensions ───── */
  (function () {
    var dJa = {
      'cust_dash_welcome': 'ようこそ',
      'cust_logout': 'ログアウト',
      'cust_tab_overview': '概要',
      'cust_tab_transactions': '取引履歴',
      'cust_tab_kyc': 'KYC認証',
      'cust_tab_profile': 'プロフィール',
      'cust_balance_title': '残高',
      'cust_balance_jpy_sub': '日本円',
      'cust_balance_usdt_sub': 'テザー USD',
      'cust_balance_btc_sub': 'ビットコイン',
      'cust_balance_eth_sub': 'イーサリアム',
      'cust_recent_tx': '最近の取引',
      'cust_tx_history': '取引履歴',
      'cust_th_date': '日時',
      'cust_th_type': '種別',
      'cust_th_currency': '通貨',
      'cust_th_amount': '金額',
      'cust_th_balance_after': '残高',
      'cust_th_description': '説明',
      'cust_no_transactions': '取引履歴がありません',
      'cust_kyc_title': 'KYC認証',
      'cust_kyc_status_label': '認証状態',
      'cust_kyc_none': '未提出',
      'cust_kyc_pending': '審査中',
      'cust_kyc_verified': '認証済み',
      'cust_kyc_rejected': '却下',
      'cust_kyc_none_desc': '本人確認書類を提出して、KYC認証を完了してください。',
      'cust_kyc_pending_desc': '書類は審査中です。通常1-2営業日で完了します。',
      'cust_kyc_verified_desc': 'KYC認証が完了しました。すべての機能をご利用いただけます。',
      'cust_kyc_rejected_desc': '提出された書類に問題がありました。再度提出してください。',
      'cust_kyc_submit_title': '書類を提出',
      'cust_kyc_doc_type': '書類の種類',
      'cust_kyc_select_doc': '書類の種類を選択...',
      'cust_kyc_passport': 'パスポート',
      'cust_kyc_drivers_license': '運転免許証',
      'cust_kyc_national_id': '国民IDカード',
      'cust_kyc_residence_card': '在留カード',
      'cust_kyc_mynumber': 'マイナンバーカード',
      'cust_kyc_upload': '書類をアップロード',
      'cust_kyc_upload_text': 'クリックしてファイルを選択、またはドラッグ＆ドロップ',
      'cust_kyc_upload_hint': 'JPG、PNG、PDF形式、最大10MB',
      'cust_kyc_submit_btn': '認証を申請',
      'cust_profile_title': 'プロフィール',
      'cust_display_name': '表示名',
      'cust_display_name_placeholder': '表示名を入力',
      'cust_email': 'メールアドレス',
      'cust_phone': '電話番号',
      'cust_phone_placeholder': '電話番号を入力',
      'cust_err_network': 'ネットワークエラーが発生しました',
      'cust_err_auth': '認証エラー。再度ログインしてください。',
      'cust_err_kyc_doc_required': '書類の種類を選択してください',
      'cust_err_kyc_file_required': 'ファイルを選択してください',
      'cust_err_kyc_submit': 'KYC提出に失敗しました',
      'cust_success_kyc': 'KYC書類が提出されました',
      'cust_success_profile': 'プロフィールが保存されました',
      'cust_err_profile': 'プロフィールの保存に失敗しました',
      'cust_confirm_logout': 'ログアウトしますか？',
      'cust_tx_page_info': '{start}〜{end}件 / {total}件中',
      'cust_type_deposit': '入金',
      'cust_type_withdrawal': '出金',
      'cust_type_trade': '取引',
      'cust_type_fee': '手数料'
    };
    var dEn = {
      'cust_dash_welcome': 'Welcome,',
      'cust_logout': 'Logout',
      'cust_tab_overview': 'Overview',
      'cust_tab_transactions': 'Transactions',
      'cust_tab_kyc': 'KYC Verification',
      'cust_tab_profile': 'Profile',
      'cust_balance_title': 'Balance',
      'cust_balance_jpy_sub': 'Japanese Yen',
      'cust_balance_usdt_sub': 'Tether USD',
      'cust_balance_btc_sub': 'Bitcoin',
      'cust_balance_eth_sub': 'Ethereum',
      'cust_recent_tx': 'Recent Transactions',
      'cust_tx_history': 'Transaction History',
      'cust_th_date': 'Date',
      'cust_th_type': 'Type',
      'cust_th_currency': 'Currency',
      'cust_th_amount': 'Amount',
      'cust_th_balance_after': 'Balance After',
      'cust_th_description': 'Description',
      'cust_no_transactions': 'No transactions yet',
      'cust_kyc_title': 'KYC Verification',
      'cust_kyc_status_label': 'Verification Status',
      'cust_kyc_none': 'Not Submitted',
      'cust_kyc_pending': 'Under Review',
      'cust_kyc_verified': 'Verified',
      'cust_kyc_rejected': 'Rejected',
      'cust_kyc_none_desc': 'Please submit your identity documents to complete KYC verification.',
      'cust_kyc_pending_desc': 'Your documents are under review. This typically takes 1-2 business days.',
      'cust_kyc_verified_desc': 'Your KYC verification is complete. All features are available.',
      'cust_kyc_rejected_desc': 'There was an issue with your submitted documents. Please resubmit.',
      'cust_kyc_submit_title': 'Submit Documents',
      'cust_kyc_doc_type': 'Document Type',
      'cust_kyc_select_doc': 'Select document type...',
      'cust_kyc_passport': 'Passport',
      'cust_kyc_drivers_license': "Driver's License",
      'cust_kyc_national_id': 'National ID Card',
      'cust_kyc_residence_card': 'Residence Card',
      'cust_kyc_mynumber': 'My Number Card',
      'cust_kyc_upload': 'Upload Document',
      'cust_kyc_upload_text': 'Click to select file or drag and drop',
      'cust_kyc_upload_hint': 'JPG, PNG or PDF, max 10MB',
      'cust_kyc_submit_btn': 'Submit for Verification',
      'cust_profile_title': 'Profile',
      'cust_display_name': 'Display Name',
      'cust_display_name_placeholder': 'Enter display name',
      'cust_email': 'Email',
      'cust_phone': 'Phone',
      'cust_phone_placeholder': 'Enter phone number',
      'cust_err_network': 'Network error occurred',
      'cust_err_auth': 'Authentication error. Please log in again.',
      'cust_err_kyc_doc_required': 'Please select a document type',
      'cust_err_kyc_file_required': 'Please select a file',
      'cust_err_kyc_submit': 'KYC submission failed',
      'cust_success_kyc': 'KYC documents submitted successfully',
      'cust_success_profile': 'Profile saved successfully',
      'cust_err_profile': 'Failed to save profile',
      'cust_confirm_logout': 'Are you sure you want to logout?',
      'cust_tx_page_info': '{start}-{end} of {total}',
      'cust_type_deposit': 'Deposit',
      'cust_type_withdrawal': 'Withdrawal',
      'cust_type_trade': 'Trade',
      'cust_type_fee': 'Fee'
    };
    var dZh = {
      'cust_dash_welcome': '欢迎',
      'cust_logout': '退出',
      'cust_tab_overview': '概览',
      'cust_tab_transactions': '交易记录',
      'cust_tab_kyc': 'KYC验证',
      'cust_tab_profile': '个人资料',
      'cust_balance_title': '余额',
      'cust_balance_jpy_sub': '日元',
      'cust_balance_usdt_sub': '泰达币',
      'cust_balance_btc_sub': '比特币',
      'cust_balance_eth_sub': '以太坊',
      'cust_recent_tx': '最近交易',
      'cust_tx_history': '交易记录',
      'cust_th_date': '日期',
      'cust_th_type': '类型',
      'cust_th_currency': '币种',
      'cust_th_amount': '金额',
      'cust_th_balance_after': '余额',
      'cust_th_description': '说明',
      'cust_no_transactions': '暂无交易记录',
      'cust_kyc_title': 'KYC验证',
      'cust_kyc_status_label': '验证状态',
      'cust_kyc_none': '未提交',
      'cust_kyc_pending': '审核中',
      'cust_kyc_verified': '已验证',
      'cust_kyc_rejected': '已拒绝',
      'cust_kyc_none_desc': '请提交身份证明文件以完成KYC验证。',
      'cust_kyc_pending_desc': '您的文件正在审核中，通常需要1-2个工作日。',
      'cust_kyc_verified_desc': 'KYC验证已完成，所有功能均可使用。',
      'cust_kyc_rejected_desc': '您提交的文件有问题，请重新提交。',
      'cust_kyc_submit_title': '提交文件',
      'cust_kyc_doc_type': '文件类型',
      'cust_kyc_select_doc': '选择文件类型...',
      'cust_kyc_passport': '护照',
      'cust_kyc_drivers_license': '驾照',
      'cust_kyc_national_id': '身份证',
      'cust_kyc_residence_card': '居留卡',
      'cust_kyc_mynumber': '个人编号卡',
      'cust_kyc_upload': '上传文件',
      'cust_kyc_upload_text': '点击选择文件或拖放',
      'cust_kyc_upload_hint': 'JPG、PNG或PDF，最大10MB',
      'cust_kyc_submit_btn': '提交验证',
      'cust_profile_title': '个人资料',
      'cust_display_name': '显示名称',
      'cust_display_name_placeholder': '输入显示名称',
      'cust_email': '邮箱',
      'cust_phone': '电话',
      'cust_phone_placeholder': '输入电话号码',
      'cust_err_network': '网络错误',
      'cust_err_auth': '认证错误，请重新登录。',
      'cust_err_kyc_doc_required': '请选择文件类型',
      'cust_err_kyc_file_required': '请选择文件',
      'cust_err_kyc_submit': 'KYC提交失败',
      'cust_success_kyc': 'KYC文件已提交',
      'cust_success_profile': '资料已保存',
      'cust_err_profile': '保存失败',
      'cust_confirm_logout': '确定要退出吗？',
      'cust_tx_page_info': '{start}-{end} / 共{total}条',
      'cust_type_deposit': '入金',
      'cust_type_withdrawal': '出金',
      'cust_type_trade': '交易',
      'cust_type_fee': '手续费'
    };
    var dVi = {
      'cust_dash_welcome': 'Xin chao,',
      'cust_logout': 'Dang xuat',
      'cust_tab_overview': 'Tong quan',
      'cust_tab_transactions': 'Giao dich',
      'cust_tab_kyc': 'Xac minh KYC',
      'cust_tab_profile': 'Ho so',
      'cust_balance_title': 'So du',
      'cust_balance_jpy_sub': 'Yen Nhat',
      'cust_balance_usdt_sub': 'Tether USD',
      'cust_balance_btc_sub': 'Bitcoin',
      'cust_balance_eth_sub': 'Ethereum',
      'cust_recent_tx': 'Giao dich gan day',
      'cust_tx_history': 'Lich su giao dich',
      'cust_th_date': 'Ngay',
      'cust_th_type': 'Loai',
      'cust_th_currency': 'Tien te',
      'cust_th_amount': 'So tien',
      'cust_th_balance_after': 'So du',
      'cust_th_description': 'Mo ta',
      'cust_no_transactions': 'Chua co giao dich',
      'cust_kyc_title': 'Xac minh KYC',
      'cust_kyc_status_label': 'Trang thai xac minh',
      'cust_kyc_none': 'Chua nop',
      'cust_kyc_pending': 'Dang xem xet',
      'cust_kyc_verified': 'Da xac minh',
      'cust_kyc_rejected': 'Bi tu choi',
      'cust_kyc_none_desc': 'Vui long nop giay to tuy than de hoan tat xac minh KYC.',
      'cust_kyc_pending_desc': 'Giay to cua ban dang duoc xem xet. Thoi gian thuong tu 1-2 ngay lam viec.',
      'cust_kyc_verified_desc': 'Xac minh KYC da hoan tat. Tat ca tinh nang deu co san.',
      'cust_kyc_rejected_desc': 'Giay to cua ban co van de. Vui long nop lai.',
      'cust_kyc_submit_title': 'Nop giay to',
      'cust_kyc_doc_type': 'Loai giay to',
      'cust_kyc_select_doc': 'Chon loai giay to...',
      'cust_kyc_passport': 'Ho chieu',
      'cust_kyc_drivers_license': 'Bang lai xe',
      'cust_kyc_national_id': 'CMND/CCCD',
      'cust_kyc_residence_card': 'The cu tru',
      'cust_kyc_mynumber': 'The My Number',
      'cust_kyc_upload': 'Tai len giay to',
      'cust_kyc_upload_text': 'Nhan de chon hoac keo tha file',
      'cust_kyc_upload_hint': 'JPG, PNG hoac PDF, toi da 10MB',
      'cust_kyc_submit_btn': 'Nop xac minh',
      'cust_profile_title': 'Ho so',
      'cust_display_name': 'Ten hien thi',
      'cust_display_name_placeholder': 'Nhap ten hien thi',
      'cust_email': 'Email',
      'cust_phone': 'Dien thoai',
      'cust_phone_placeholder': 'Nhap so dien thoai',
      'cust_err_network': 'Loi mang',
      'cust_err_auth': 'Loi xac thuc. Vui long dang nhap lai.',
      'cust_err_kyc_doc_required': 'Vui long chon loai giay to',
      'cust_err_kyc_file_required': 'Vui long chon file',
      'cust_err_kyc_submit': 'Nop KYC that bai',
      'cust_success_kyc': 'Giay to KYC da duoc nop',
      'cust_success_profile': 'Ho so da luu',
      'cust_err_profile': 'Luu that bai',
      'cust_confirm_logout': 'Ban co chac muon dang xuat?',
      'cust_tx_page_info': '{start}-{end} / {total}',
      'cust_type_deposit': 'Nap tien',
      'cust_type_withdrawal': 'Rut tien',
      'cust_type_trade': 'Giao dich',
      'cust_type_fee': 'Phi'
    };
    if (typeof translations !== 'undefined') {
      Object.assign(translations.ja, dJa);
      Object.assign(translations.en, dEn);
      if (translations.zh) Object.assign(translations.zh, dZh);
      if (translations.vi) Object.assign(translations.vi, dVi);
    }
  })();

  /* ───── State ───── */
  var customerProfile = null;
  var customerBalances = {};
  var txData = { items: [], total: 0, limit: 50, offset: 0 };
  var selectedKycFile = null;

  /* ───── Cookie helpers ───── */
  function getCookie(name) {
    var nameEQ = name + '=';
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
      var c = cookies[i].trim();
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
    }
    return null;
  }
  function deleteCookie(name) {
    document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;SameSite=Lax';
  }

  /* ───── Auth check ───── */
  function getToken() {
    return getCookie('bkpay_customer_token');
  }
  function authHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken()
    };
  }
  function handleAuthError() {
    deleteCookie('bkpay_customer_token');
    localStorage.removeItem('bkpay_customer_name');
    localStorage.removeItem('bkpay_customer_id');
    window.location.href = '/customer-login.html';
  }

  /* ───── Toast notifications ───── */
  var toastTimer = null;
  function showToast(msg, type) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast ' + (type || 'info');
    requestAnimationFrame(function () { el.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3500);
  }

  /* ───── Section switching ───── */
  function switchSection(name) {
    var sections = document.querySelectorAll('.dash-section');
    var tabs = document.querySelectorAll('.dash-tab');
    var map = { overview: 'sectionOverview', transactions: 'sectionTransactions', kyc: 'sectionKyc', profile: 'sectionProfile' };
    for (var i = 0; i < sections.length; i++) {
      sections[i].classList.remove('active');
    }
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.remove('active');
    }
    var target = document.getElementById(map[name]);
    if (target) target.classList.add('active');
    tabs[['overview', 'transactions', 'kyc', 'profile'].indexOf(name)].classList.add('active');

    if (name === 'transactions' && txData.items.length === 0) {
      loadTransactions();
    }
  }

  /* ───── Format helpers ───── */
  function formatCurrency(amount, currency) {
    if (currency === 'JPY') {
      return '\u00a5' + Number(amount).toLocaleString('ja-JP', { maximumFractionDigits: 0 });
    }
    if (currency === 'BTC') {
      return Number(amount).toFixed(8) + ' BTC';
    }
    if (currency === 'ETH') {
      return Number(amount).toFixed(6) + ' ETH';
    }
    return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + currency;
  }

  function formatDate(dateStr) {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr || '---';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return y + '/' + m + '/' + day + ' ' + h + ':' + min;
  }

  function getTxTypeLabel(type) {
    var key = 'cust_type_' + type;
    return t(key) || type;
  }

  /* ───── API: Load profile ───── */
  async function loadProfile() {
    try {
      var res = await fetch('/api/customer/profile', { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) { handleAuthError(); return; }
      if (!res.ok) throw new Error('Profile load failed');
      var data = await res.json();
      customerProfile = data.profile || data;
      renderProfile();
    } catch (e) {
      console.error('Profile load error:', e);
      // Use cached name if available
      var cachedName = localStorage.getItem('bkpay_customer_name');
      if (cachedName) {
        document.getElementById('headerDisplayName').textContent = cachedName;
      }
    }
  }

  function renderProfile() {
    if (!customerProfile) return;
    var name = customerProfile.displayName || customerProfile.email || '---';
    document.getElementById('headerDisplayName').textContent = name;
    document.getElementById('profileDisplayName').value = customerProfile.displayName || '';
    document.getElementById('profileEmail').value = customerProfile.email || '';
    document.getElementById('profilePhone').value = customerProfile.phone || '';
    localStorage.setItem('bkpay_customer_name', name);

    // KYC status
    var kyc = customerProfile.kycStatus || 'none';
    updateKycDisplay(kyc);
  }

  /* ───── API: Load balances ───── */
  async function loadBalances() {
    try {
      var res = await fetch('/api/customer/balance', { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) { handleAuthError(); return; }
      if (!res.ok) throw new Error('Balance load failed');
      var data = await res.json();
      customerBalances = data.balances || data;
      renderBalances();
    } catch (e) {
      console.error('Balance load error:', e);
      renderBalancesEmpty();
    }
  }

  function renderBalances() {
    var currencies = ['JPY', 'USDT', 'BTC', 'ETH'];
    for (var i = 0; i < currencies.length; i++) {
      var cur = currencies[i];
      var el = document.getElementById('balance' + cur);
      var amount = customerBalances[cur] !== undefined ? customerBalances[cur] : (customerBalances[cur.toLowerCase()] !== undefined ? customerBalances[cur.toLowerCase()] : 0);
      el.textContent = formatCurrency(amount, cur);
    }
  }

  function renderBalancesEmpty() {
    var currencies = ['JPY', 'USDT', 'BTC', 'ETH'];
    for (var i = 0; i < currencies.length; i++) {
      document.getElementById('balance' + currencies[i]).textContent = formatCurrency(0, currencies[i]);
    }
  }

  /* ───── API: Load transactions ───── */
  async function loadTransactions() {
    var filterType = document.getElementById('txFilterType').value;
    var filterCurrency = document.getElementById('txFilterCurrency').value;
    var query = '?limit=' + txData.limit + '&offset=' + txData.offset;
    if (filterType) query += '&type=' + filterType;
    if (filterCurrency) query += '&currency=' + filterCurrency;

    try {
      var res = await fetch('/api/customer/transactions' + query, { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) { handleAuthError(); return; }
      if (!res.ok) throw new Error('Transactions load failed');
      var data = await res.json();
      txData.items = data.transactions || data.items || [];
      txData.total = data.total || txData.items.length;
      renderTransactions();
      renderOverviewTransactions();
    } catch (e) {
      console.error('Transactions load error:', e);
      txData.items = [];
      txData.total = 0;
      renderTransactions();
      renderOverviewTransactions();
    }
  }

  function renderTransactionRows(items) {
    if (!items || items.length === 0) {
      return '<tr><td colspan="6" class="tx-empty">' + t('cust_no_transactions') + '</td></tr>';
    }
    return items.map(function (tx) {
      var amountNum = Number(tx.amount);
      var amountClass = amountNum >= 0 ? 'positive' : 'negative';
      var typeClass = tx.type || 'trade';
      return '<tr>' +
        '<td>' + formatDate(tx.date || tx.createdAt) + '</td>' +
        '<td><span class="tx-type ' + typeClass + '">' + getTxTypeLabel(tx.type) + '</span></td>' +
        '<td>' + (tx.currency || '---') + '</td>' +
        '<td class="tx-amount ' + amountClass + '">' + (amountNum >= 0 ? '+' : '') + formatCurrency(amountNum, tx.currency) + '</td>' +
        '<td>' + (tx.balanceAfter !== undefined ? formatCurrency(tx.balanceAfter, tx.currency) : '---') + '</td>' +
        '<td style="color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis">' + (tx.description || '---') + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderTransactions() {
    document.getElementById('txTableBody').innerHTML = renderTransactionRows(txData.items);

    // Pagination
    var total = txData.total;
    var start = total > 0 ? txData.offset + 1 : 0;
    var end = Math.min(txData.offset + txData.limit, total);
    var infoText = t('cust_tx_page_info')
      .replace('{start}', start)
      .replace('{end}', end)
      .replace('{total}', total);
    document.getElementById('txPageInfo').textContent = infoText;
    document.getElementById('txPrevBtn').disabled = txData.offset <= 0;
    document.getElementById('txNextBtn').disabled = (txData.offset + txData.limit) >= total;
  }

  function renderOverviewTransactions() {
    var recent = txData.items.slice(0, 5);
    document.getElementById('overviewTxBody').innerHTML = renderTransactionRows(recent);
  }

  function changeTxPage(dir) {
    txData.offset = Math.max(0, txData.offset + (dir * txData.limit));
    loadTransactions();
  }

  /* ───── KYC display ───── */
  function updateKycDisplay(status) {
    var iconEl = document.getElementById('kycStatusIcon');
    var valueEl = document.getElementById('kycStatusValue');
    var descEl = document.getElementById('kycStatusDesc');
    var badgeEl = document.getElementById('profileKycBadge');
    var formCard = document.getElementById('kycFormCard');

    var icons = { none: '&#x2753;', pending: '&#x23F3;', verified: '&#x2705;', rejected: '&#x274C;' };

    iconEl.className = 'kyc-status-icon ' + status;
    iconEl.innerHTML = icons[status] || icons.none;

    valueEl.className = 'value ' + status;
    valueEl.textContent = t('cust_kyc_' + status);

    descEl.textContent = t('cust_kyc_' + status + '_desc');

    badgeEl.className = 'status-badge ' + status;
    badgeEl.textContent = t('cust_kyc_' + status);

    // Hide form if pending or verified
    if (status === 'pending' || status === 'verified') {
      formCard.style.display = 'none';
    } else {
      formCard.style.display = 'block';
    }
  }

  /* ───── File upload handling ───── */
  function handleFileSelect(input) {
    var file = input.files[0];
    if (!file) return;

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      showToast('File too large. Maximum 10MB.', 'error');
      input.value = '';
      return;
    }

    // Validate file type
    var validTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (validTypes.indexOf(file.type) === -1) {
      showToast('Invalid file type. JPG, PNG or PDF only.', 'error');
      input.value = '';
      return;
    }

    selectedKycFile = file;
    var area = document.getElementById('fileUploadArea');
    area.classList.add('has-file');
    var nameEl = document.getElementById('fileUploadName');
    nameEl.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
    nameEl.style.display = 'block';
  }

  // Drag & drop support
  (function () {
    var area = document.getElementById('fileUploadArea');
    if (!area) return;
    area.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      this.style.borderColor = 'var(--primary)';
      this.style.background = 'var(--primary-soft)';
    });
    area.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!this.classList.contains('has-file')) {
        this.style.borderColor = '';
        this.style.background = '';
      }
    });
    area.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      this.style.borderColor = '';
      this.style.background = '';
      if (e.dataTransfer.files.length > 0) {
        document.getElementById('kycFileInput').files = e.dataTransfer.files;
        handleFileSelect(document.getElementById('kycFileInput'));
      }
    });
  })();

  /* ───── API: KYC submit ───── */
  async function handleKycSubmit() {
    var docType = document.getElementById('kycDocType').value;
    if (!docType) {
      showToast(t('cust_err_kyc_doc_required'), 'error');
      return;
    }
    if (!selectedKycFile) {
      showToast(t('cust_err_kyc_file_required'), 'error');
      return;
    }

    var btn = document.getElementById('kycSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>' + t('cust_kyc_submit_btn');

    try {
      // For file upload, we submit as JSON with a file path placeholder.
      // In production this would be a multipart form or pre-signed upload.
      var filePath = '/uploads/kyc/' + Date.now() + '_' + selectedKycFile.name;

      var res = await fetch('/api/customer/kyc', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ documentType: docType, filePath: filePath })
      });

      if (res.status === 401 || res.status === 403) { handleAuthError(); return; }

      var data = await res.json();
      if (res.ok && (data.success !== false)) {
        showToast(t('cust_success_kyc'), 'success');
        updateKycDisplay('pending');
        // Reset form
        selectedKycFile = null;
        document.getElementById('kycDocType').value = '';
        document.getElementById('kycFileInput').value = '';
        document.getElementById('fileUploadArea').classList.remove('has-file');
        document.getElementById('fileUploadName').style.display = 'none';
      } else {
        showToast(data.error || t('cust_err_kyc_submit'), 'error');
      }
    } catch (e) {
      console.error('KYC submit error:', e);
      showToast(t('cust_err_network'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = t('cust_kyc_submit_btn');
    }
  }

  /* ───── API: Profile save ───── */
  async function handleProfileSave() {
    var displayName = document.getElementById('profileDisplayName').value.trim();
    var phone = document.getElementById('profilePhone').value.trim();

    var btn = document.getElementById('profileSaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span>' + t('save');

    try {
      var res = await fetch('/api/customer/profile', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ displayName: displayName, phone: phone })
      });

      if (res.status === 401 || res.status === 403) { handleAuthError(); return; }

      var data = await res.json();
      if (res.ok && (data.success !== false)) {
        showToast(t('cust_success_profile'), 'success');
        if (displayName) {
          document.getElementById('headerDisplayName').textContent = displayName;
          localStorage.setItem('bkpay_customer_name', displayName);
        }
        if (customerProfile) {
          customerProfile.displayName = displayName;
          customerProfile.phone = phone;
        }
      } else {
        showToast(data.error || t('cust_err_profile'), 'error');
      }
    } catch (e) {
      console.error('Profile save error:', e);
      showToast(t('cust_err_network'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = t('save');
    }
  }

  /* ───── API: Logout ───── */
  async function handleLogout() {
    if (!confirm(t('cust_confirm_logout'))) return;

    try {
      await fetch('/api/customer/logout', {
        method: 'POST',
        headers: authHeaders()
      });
    } catch (e) {
      // Ignore errors, logout locally anyway
    }

    deleteCookie('bkpay_customer_token');
    localStorage.removeItem('bkpay_customer_name');
    localStorage.removeItem('bkpay_customer_id');
    window.location.href = '/customer-login.html';
  }

  /* ───── Refresh dashboard ───── */
  async function refreshDashboard() {
    await Promise.all([loadProfile(), loadBalances(), loadTransactions()]);
    showToast(t('refresh') + ' OK', 'success');
  }

  /* ═══════════════════════════════════════════════════════════════
     Event listener bindings (replacing all 18 inline handlers)
     ═══════════════════════════════════════════════════════════════ */

  /* --- 1-4: Language buttons (onclick="setLanguage('xx')") --- */
  var langBtns = document.querySelectorAll('.lang-btn[data-lang]');
  for (var i = 0; i < langBtns.length; i++) {
    langBtns[i].addEventListener('click', (function (lang) {
      return function () { setLanguage(lang); };
    })(langBtns[i].getAttribute('data-lang')));
  }

  /* --- 5: Refresh button (onclick="refreshDashboard()") --- */
  document.getElementById('btnRefresh').addEventListener('click', function () {
    refreshDashboard();
  });

  /* --- 6: Logout button (onclick="handleLogout()") --- */
  document.getElementById('btnLogout').addEventListener('click', function () {
    handleLogout();
  });

  /* --- 7-10: Tab buttons (onclick="switchSection('xxx')") --- */
  var tabBtns = document.querySelectorAll('.dash-tab[data-section]');
  for (var j = 0; j < tabBtns.length; j++) {
    tabBtns[j].addEventListener('click', (function (section) {
      return function () { switchSection(section); };
    })(tabBtns[j].getAttribute('data-section')));
  }

  /* --- 11: Transaction type filter (onchange="loadTransactions()") --- */
  document.getElementById('txFilterType').addEventListener('change', function () {
    loadTransactions();
  });

  /* --- 12: Transaction currency filter (onchange="loadTransactions()") --- */
  document.getElementById('txFilterCurrency').addEventListener('change', function () {
    loadTransactions();
  });

  /* --- 13: Pagination prev button (onclick="changeTxPage(-1)") --- */
  document.getElementById('txPrevBtn').addEventListener('click', function () {
    changeTxPage(-1);
  });

  /* --- 14: Pagination next button (onclick="changeTxPage(1)") --- */
  document.getElementById('txNextBtn').addEventListener('click', function () {
    changeTxPage(1);
  });

  /* --- 15: File upload area click (onclick="document.getElementById('kycFileInput').click()") --- */
  document.getElementById('fileUploadArea').addEventListener('click', function () {
    document.getElementById('kycFileInput').click();
  });

  /* --- 16: File input change (onchange="handleFileSelect(this)") --- */
  document.getElementById('kycFileInput').addEventListener('change', function () {
    handleFileSelect(this);
  });

  /* --- 17: KYC submit button (onclick="handleKycSubmit()") --- */
  document.getElementById('kycSubmitBtn').addEventListener('click', function () {
    handleKycSubmit();
  });

  /* --- 18: Profile save button (onclick="handleProfileSave()") --- */
  document.getElementById('profileSaveBtn').addEventListener('click', function () {
    handleProfileSave();
  });

  /* ═══════════════════════════════════════════════════════════════
     Initialize
     ═══════════════════════════════════════════════════════════════ */
  async function init() {
    var token = getToken();
    if (!token) {
      window.location.href = '/customer-login.html';
      return;
    }

    // Show cached name immediately
    var cachedName = localStorage.getItem('bkpay_customer_name');
    if (cachedName) {
      document.getElementById('headerDisplayName').textContent = cachedName;
    }

    try {
      await Promise.all([loadProfile(), loadBalances(), loadTransactions()]);
    } catch (e) {
      console.error('Init error:', e);
    }

    // Hide loading overlay
    document.getElementById('loadingOverlay').classList.add('hidden');

    // Apply translations
    if (typeof applyTranslations === 'function') applyTranslations();
  }

  init();
});
