/* ───── Customer Login App (CSP-safe external JS) ───── */
document.addEventListener('DOMContentLoaded', function() {

  /* ───── Customer login i18n extensions ───── */
  (function() {
    var custJa = {
      'cust_login_subtitle': 'P2P決済プラットフォーム',
      'cust_tab_login': 'ログイン',
      'cust_tab_register': '新規登録',
      'cust_email': 'メールアドレス',
      'cust_email_placeholder': 'mail@example.com',
      'cust_password': 'パスワード',
      'cust_password_placeholder': 'パスワードを入力',
      'cust_confirm_password': 'パスワード確認',
      'cust_confirm_password_placeholder': 'パスワードを再入力',
      'cust_display_name': '表示名',
      'cust_display_name_placeholder': '表示名を入力',
      'cust_display_name_hint': '任意',
      'cust_password_hint': '8文字以上',
      'cust_login_btn': 'ログイン',
      'cust_register_btn': 'アカウント作成',
      'cust_back_home': 'ホームに戻る',
      'cust_err_email_required': 'メールアドレスを入力してください',
      'cust_err_email_invalid': '有効なメールアドレスを入力してください',
      'cust_err_password_required': 'パスワードを入力してください',
      'cust_err_password_min': 'パスワードは8文字以上で入力してください',
      'cust_err_password_mismatch': 'パスワードが一致しません',
      'cust_err_login_failed': 'メールアドレスまたはパスワードが正しくありません',
      'cust_err_register_failed': '登録に失敗しました。もう一度お試しください',
      'cust_err_email_exists': 'このメールアドレスは既に登録されています',
      'cust_err_network': 'ネットワークエラーが発生しました',
      'cust_success_register': '登録が完了しました！ログインしてください',
      'cust_logging_in': 'ログイン中...',
      'cust_registering': '登録中...'
    };
    var custEn = {
      'cust_login_subtitle': 'P2P Payment Platform',
      'cust_tab_login': 'Login',
      'cust_tab_register': 'Register',
      'cust_email': 'Email',
      'cust_email_placeholder': 'mail@example.com',
      'cust_password': 'Password',
      'cust_password_placeholder': 'Enter password',
      'cust_confirm_password': 'Confirm Password',
      'cust_confirm_password_placeholder': 'Re-enter password',
      'cust_display_name': 'Display Name',
      'cust_display_name_placeholder': 'Enter display name',
      'cust_display_name_hint': 'Optional',
      'cust_password_hint': '8 characters minimum',
      'cust_login_btn': 'Login',
      'cust_register_btn': 'Create Account',
      'cust_back_home': 'Back to Home',
      'cust_err_email_required': 'Email is required',
      'cust_err_email_invalid': 'Please enter a valid email address',
      'cust_err_password_required': 'Password is required',
      'cust_err_password_min': 'Password must be at least 8 characters',
      'cust_err_password_mismatch': 'Passwords do not match',
      'cust_err_login_failed': 'Invalid email or password',
      'cust_err_register_failed': 'Registration failed. Please try again',
      'cust_err_email_exists': 'This email is already registered',
      'cust_err_network': 'Network error occurred',
      'cust_success_register': 'Registration successful! Please login',
      'cust_logging_in': 'Logging in...',
      'cust_registering': 'Registering...'
    };
    var custZh = {
      'cust_login_subtitle': 'P2P支付平台',
      'cust_tab_login': '登录',
      'cust_tab_register': '注册',
      'cust_email': '邮箱',
      'cust_email_placeholder': 'mail@example.com',
      'cust_password': '密码',
      'cust_password_placeholder': '输入密码',
      'cust_confirm_password': '确认密码',
      'cust_confirm_password_placeholder': '重新输入密码',
      'cust_display_name': '显示名称',
      'cust_display_name_placeholder': '输入显示名称',
      'cust_display_name_hint': '可选',
      'cust_password_hint': '至少8个字符',
      'cust_login_btn': '登录',
      'cust_register_btn': '创建账户',
      'cust_back_home': '返回首页',
      'cust_err_email_required': '请输入邮箱',
      'cust_err_email_invalid': '请输入有效的邮箱地址',
      'cust_err_password_required': '请输入密码',
      'cust_err_password_min': '密码至少需要8个字符',
      'cust_err_password_mismatch': '两次密码不一致',
      'cust_err_login_failed': '邮箱或密码错误',
      'cust_err_register_failed': '注册失败，请重试',
      'cust_err_email_exists': '此邮箱已注册',
      'cust_err_network': '网络错误',
      'cust_success_register': '注册成功！请登录',
      'cust_logging_in': '登录中...',
      'cust_registering': '注册中...'
    };
    var custVi = {
      'cust_login_subtitle': 'Nền tảng thanh toán P2P',
      'cust_tab_login': 'Đăng nhập',
      'cust_tab_register': 'Đăng ký',
      'cust_email': 'Email',
      'cust_email_placeholder': 'mail@example.com',
      'cust_password': 'Mật khẩu',
      'cust_password_placeholder': 'Nhập mật khẩu',
      'cust_confirm_password': 'Xác nhận mật khẩu',
      'cust_confirm_password_placeholder': 'Nhập lại mật khẩu',
      'cust_display_name': 'Tên hiển thị',
      'cust_display_name_placeholder': 'Nhập tên hiển thị',
      'cust_display_name_hint': 'Tùy chọn',
      'cust_password_hint': 'Tối thiểu 8 ký tự',
      'cust_login_btn': 'Đăng nhập',
      'cust_register_btn': 'Tạo tài khoản',
      'cust_back_home': 'Về trang chủ',
      'cust_err_email_required': 'Vui lòng nhập email',
      'cust_err_email_invalid': 'Vui lòng nhập email hợp lệ',
      'cust_err_password_required': 'Vui lòng nhập mật khẩu',
      'cust_err_password_min': 'Mật khẩu phải có ít nhất 8 ký tự',
      'cust_err_password_mismatch': 'Mật khẩu không khớp',
      'cust_err_login_failed': 'Email hoặc mật khẩu không đúng',
      'cust_err_register_failed': 'Đăng ký thất bại. Vui lòng thử lại',
      'cust_err_email_exists': 'Email này đã được đăng ký',
      'cust_err_network': 'Lỗi mạng',
      'cust_success_register': 'Đăng ký thành công! Vui lòng đăng nhập',
      'cust_logging_in': 'Đang đăng nhập...',
      'cust_registering': 'Đang đăng ký...'
    };
    if (typeof translations !== 'undefined') {
      Object.assign(translations.ja, custJa);
      Object.assign(translations.en, custEn);
      if (translations.zh) Object.assign(translations.zh, custZh);
      if (translations.vi) Object.assign(translations.vi, custVi);
    }
  })();

  /* ───── State ───── */
  var currentTab = 'login';

  /* ───── Tab switching ───── */
  function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
    document.getElementById('loginForm').classList.toggle('active', tab === 'login');
    document.getElementById('registerForm').classList.toggle('active', tab === 'register');
    clearMessages();
    clearFieldErrors();
  }

  /* ───── Password visibility toggle ───── */
  function togglePassword(inputId, btn) {
    var input = document.getElementById(inputId);
    if (input.type === 'password') {
      input.type = 'text';
      btn.innerHTML = '&#x1F512;';
    } else {
      input.type = 'password';
      btn.innerHTML = '&#x1F441;';
    }
  }

  /* ───── Message display ───── */
  function showMessage(elementId, text, type) {
    var el = document.getElementById(elementId);
    el.textContent = text;
    el.className = 'message ' + type;
  }

  function clearMessages() {
    var msgs = document.querySelectorAll('.message');
    for (var i = 0; i < msgs.length; i++) {
      msgs[i].className = 'message';
      msgs[i].textContent = '';
    }
  }

  function showFieldError(elementId, text) {
    var el = document.getElementById(elementId);
    el.textContent = text;
    el.style.display = 'block';
  }

  function clearFieldErrors() {
    var errs = document.querySelectorAll('.field-error');
    for (var i = 0; i < errs.length; i++) {
      errs[i].style.display = 'none';
      errs[i].textContent = '';
    }
    var inputs = document.querySelectorAll('.form-input.error');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].classList.remove('error');
    }
  }

  /* ───── Validation ───── */
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validateLogin() {
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;

    if (!email) {
      showMessage('loginMessage', t('cust_err_email_required'), 'error');
      document.getElementById('loginEmail').classList.add('error');
      document.getElementById('loginEmail').focus();
      return false;
    }
    if (!isValidEmail(email)) {
      showMessage('loginMessage', t('cust_err_email_invalid'), 'error');
      document.getElementById('loginEmail').classList.add('error');
      document.getElementById('loginEmail').focus();
      return false;
    }
    if (!password) {
      showMessage('loginMessage', t('cust_err_password_required'), 'error');
      document.getElementById('loginPassword').classList.add('error');
      document.getElementById('loginPassword').focus();
      return false;
    }
    return true;
  }

  function validateRegister() {
    clearFieldErrors();
    var email = document.getElementById('regEmail').value.trim();
    var password = document.getElementById('regPassword').value;
    var confirm = document.getElementById('regConfirmPassword').value;
    var valid = true;

    if (!email) {
      showFieldError('regEmailError', t('cust_err_email_required'));
      document.getElementById('regEmail').classList.add('error');
      valid = false;
    } else if (!isValidEmail(email)) {
      showFieldError('regEmailError', t('cust_err_email_invalid'));
      document.getElementById('regEmail').classList.add('error');
      valid = false;
    }

    if (!password) {
      showFieldError('regPasswordError', t('cust_err_password_required'));
      document.getElementById('regPassword').classList.add('error');
      valid = false;
    } else if (password.length < 8) {
      showFieldError('regPasswordError', t('cust_err_password_min'));
      document.getElementById('regPassword').classList.add('error');
      valid = false;
    }

    if (password && password !== confirm) {
      showFieldError('regConfirmError', t('cust_err_password_mismatch'));
      document.getElementById('regConfirmPassword').classList.add('error');
      valid = false;
    }

    if (!valid) {
      var firstErr = document.querySelector('.form-input.error');
      if (firstErr) firstErr.focus();
    }
    return valid;
  }

  /* ───── Cookie helpers ───── */
  function setCookie(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }

  function getCookie(name) {
    var nameEQ = name + '=';
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
      var c = cookies[i].trim();
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length));
    }
    return null;
  }

  /* ───── Button loading state ───── */
  function setButtonLoading(btnId, loading, loadingText) {
    var btn = document.getElementById(btnId);
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.innerHTML = '<span class="btn-spinner"></span>' + (loadingText || btn.textContent);
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  }

  /* ───── Login handler ───── */
  async function handleLogin() {
    clearMessages();
    clearFieldErrors();
    if (!validateLogin()) return;

    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;

    setButtonLoading('loginBtn', true, t('cust_logging_in'));

    try {
      var res = await fetch('/api/customer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      });

      var data = await res.json();

      if (res.ok && data.token) {
        setCookie('bkpay_customer_token', data.token, 7);
        if (data.displayName) {
          localStorage.setItem('bkpay_customer_name', data.displayName);
        }
        if (data.customerId) {
          localStorage.setItem('bkpay_customer_id', data.customerId);
        }
        showMessage('loginMessage', '', 'success');
        window.location.href = '/customer-dashboard.html';
      } else {
        var errMsg = data.error || data.message || t('cust_err_login_failed');
        showMessage('loginMessage', errMsg, 'error');
      }
    } catch (e) {
      console.error('Login error:', e);
      showMessage('loginMessage', t('cust_err_network'), 'error');
    } finally {
      setButtonLoading('loginBtn', false);
    }
  }

  /* ───── Register handler ───── */
  async function handleRegister() {
    clearMessages();
    if (!validateRegister()) return;

    var email = document.getElementById('regEmail').value.trim();
    var password = document.getElementById('regPassword').value;
    var displayName = document.getElementById('regDisplayName').value.trim();

    setButtonLoading('registerBtn', true, t('cust_registering'));

    try {
      var payload = { email: email, password: password };
      if (displayName) payload.displayName = displayName;

      var res = await fetch('/api/customer/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      var data = await res.json();

      if (res.ok && data.customerId) {
        showMessage('registerMessage', t('cust_success_register'), 'success');
        // Clear register form
        document.getElementById('regEmail').value = '';
        document.getElementById('regPassword').value = '';
        document.getElementById('regConfirmPassword').value = '';
        document.getElementById('regDisplayName').value = '';
        // Auto-switch to login tab after 1.5s
        setTimeout(function() {
          switchTab('login');
          document.getElementById('loginEmail').value = email;
          document.getElementById('loginEmail').focus();
        }, 1500);
      } else {
        var errMsg = data.error || data.message || t('cust_err_register_failed');
        if (res.status === 409) errMsg = t('cust_err_email_exists');
        showMessage('registerMessage', errMsg, 'error');
      }
    } catch (e) {
      console.error('Register error:', e);
      showMessage('registerMessage', t('cust_err_network'), 'error');
    } finally {
      setButtonLoading('registerBtn', false);
    }
  }

  /* ───── Bind inline handler replacements via addEventListener ───── */

  // Language buttons
  var langBtns = document.querySelectorAll('.lang-btn[data-lang]');
  for (var i = 0; i < langBtns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        setLanguage(btn.getAttribute('data-lang'));
      });
    })(langBtns[i]);
  }

  // Tab buttons
  document.getElementById('tabLogin').addEventListener('click', function() {
    switchTab('login');
  });
  document.getElementById('tabRegister').addEventListener('click', function() {
    switchTab('register');
  });

  // Password toggle buttons
  var pwToggles = document.querySelectorAll('.password-toggle[data-target]');
  for (var j = 0; j < pwToggles.length; j++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        togglePassword(btn.getAttribute('data-target'), btn);
      });
    })(pwToggles[j]);
  }

  // Login button
  document.getElementById('loginBtn').addEventListener('click', function() {
    handleLogin();
  });

  // Register button
  document.getElementById('registerBtn').addEventListener('click', function() {
    handleRegister();
  });

  /* ───── Keyboard support ───── */
  document.getElementById('loginPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('loginEmail').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('regConfirmPassword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') handleRegister();
  });

  /* ───── Clear error on input ───── */
  document.querySelectorAll('.form-input').forEach(function(input) {
    input.addEventListener('input', function() {
      this.classList.remove('error');
    });
  });

  /* ───── Check if already logged in ───── */
  (function() {
    var token = getCookie('bkpay_customer_token');
    if (token) {
      window.location.href = '/customer-dashboard.html';
    }
  })();

  /* ───── Apply i18n on load ───── */
  if (typeof applyTranslations === 'function') applyTranslations();
});
