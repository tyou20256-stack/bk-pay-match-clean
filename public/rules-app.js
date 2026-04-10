/* rules-app.js — External JS for rules.html (CSP compliant, no inline scripts) */

document.addEventListener('DOMContentLoaded', function() {

  /* =========================================================
     Page-specific i18n translations
     ========================================================= */
  const rulesTranslations = {
    ja: {
      rules_page_title: '自動取引ルール',
      rules_stat_total: '全ルール',
      rules_stat_active: '稼働中',
      rules_stat_paused: '一時停止',
      rules_stat_executions: '本日実行',
      rules_list_title: 'ルール一覧',
      rules_list_desc: 'レート条件に基づく自動取引ルールを管理',
      rules_create_btn: '+ ルールを作成',
      rules_history_title: '実行履歴',
      rules_hist_time: '実行日時',
      rules_hist_detail: '詳細',
      rules_hist_result: '結果',
      rules_hist_amount: '金額',
      rules_modal_create: 'ルールを作成',
      rules_modal_edit: 'ルールを編集',
      rules_section_basic: '基本情報',
      rules_section_rate: 'レート条件',
      rules_section_time: '時間条件',
      rules_section_action: 'アクション設定',
      rules_field_name: 'ルール名',
      rules_field_name_placeholder: '例: USDT安値購入ルール',
      rules_field_desc: '説明',
      rules_field_desc_placeholder: 'ルールの目的や動作の説明',
      rules_field_start_hour: '開始時刻',
      rules_field_end_hour: '終了時刻',
      rules_field_weekdays: '実行曜日',
      rules_field_action_type: '取引タイプ',
      rules_field_crypto: '暗号通貨',
      rules_field_amount: '取引金額 (JPY)',
      rules_field_mode: '実行モード',
      rules_field_max_per_exec: '1回の上限 (JPY)',
      rules_field_max_daily: '1日の上限 (JPY)',
      rules_add_condition: '+ 条件追加',
      rules_action_buy: '購入',
      rules_action_sell: '売却',
      rules_mode_notify: '通知のみ',
      rules_mode_execute: '自動実行',
      rules_test_btn: 'テスト実行',
      rules_delete_confirm_title: 'ルールを削除しますか？',
      rules_delete_confirm_desc: 'この操作は取り消せません。関連する実行履歴も削除されます。',
      rules_cond_buy_below: '購入レート < 値',
      rules_cond_buy_above: '購入レート > 値',
      rules_cond_sell_below: '売却レート < 値',
      rules_cond_sell_above: '売却レート > 値',
      rules_cond_spread_below: 'スプレッド < 値',
      rules_cond_spread_above: 'スプレッド > 値',
      rules_cond_type: '条件タイプ',
      rules_cond_value: '値',
      rules_cond_exchange: '取引所（任意）',
      rules_status_active: '稼働中',
      rules_status_paused: '一時停止',
      rules_btn_history: '履歴',
      rules_btn_test: 'テスト',
      rules_empty: 'ルールがありません。「+ ルールを作成」で最初のルールを作成してください。',
      rules_history_empty: '実行履歴がありません',
      rules_saved: 'ルールを保存しました',
      rules_deleted: 'ルールを削除しました',
      rules_toggled_active: 'ルールを稼働に変更しました',
      rules_toggled_paused: 'ルールを一時停止しました',
      rules_test_success: 'テスト実行完了（ドライラン）',
      rules_test_fail: 'テスト実行に失敗しました',
      rules_error_name: 'ルール名を入力してください',
      rules_error_conditions: 'レート条件を1つ以上追加してください',
      rules_error_amount: '取引金額を入力してください',
      rules_error_load: 'ルールの読み込みに失敗しました',
      rules_error_save: 'ルールの保存に失敗しました',
      rules_last_exec: '最終実行',
      rules_exec_count: '実行回数',
      rules_never: '未実行',
      rules_day_sun: '日', rules_day_mon: '月', rules_day_tue: '火', rules_day_wed: '水',
      rules_day_thu: '木', rules_day_fri: '金', rules_day_sat: '土',
      rules_hist_success: '成功',
      rules_hist_failed: '失敗',
      rules_hist_skipped: 'スキップ',
      rules_hist_dryrun: 'ドライラン',
      rules_all_exchanges: '全取引所',
    },
    en: {
      rules_page_title: 'Auto Trading Rules',
      rules_stat_total: 'Total Rules',
      rules_stat_active: 'Active',
      rules_stat_paused: 'Paused',
      rules_stat_executions: 'Today\'s Executions',
      rules_list_title: 'Rules List',
      rules_list_desc: 'Manage automated trading rules based on rate conditions',
      rules_create_btn: '+ Create Rule',
      rules_history_title: 'Execution History',
      rules_hist_time: 'Executed At',
      rules_hist_detail: 'Details',
      rules_hist_result: 'Result',
      rules_hist_amount: 'Amount',
      rules_modal_create: 'Create Rule',
      rules_modal_edit: 'Edit Rule',
      rules_section_basic: 'Basic Info',
      rules_section_rate: 'Rate Conditions',
      rules_section_time: 'Time Conditions',
      rules_section_action: 'Action Config',
      rules_field_name: 'Rule Name',
      rules_field_name_placeholder: 'e.g. USDT Low Buy Rule',
      rules_field_desc: 'Description',
      rules_field_desc_placeholder: 'Describe the purpose and behavior of this rule',
      rules_field_start_hour: 'Start Hour',
      rules_field_end_hour: 'End Hour',
      rules_field_weekdays: 'Weekdays',
      rules_field_action_type: 'Action Type',
      rules_field_crypto: 'Cryptocurrency',
      rules_field_amount: 'Amount (JPY)',
      rules_field_mode: 'Execution Mode',
      rules_field_max_per_exec: 'Max per Execution (JPY)',
      rules_field_max_daily: 'Max Daily (JPY)',
      rules_add_condition: '+ Add Condition',
      rules_action_buy: 'Buy',
      rules_action_sell: 'Sell',
      rules_mode_notify: 'Notify Only',
      rules_mode_execute: 'Auto Execute',
      rules_test_btn: 'Test Run',
      rules_delete_confirm_title: 'Delete this rule?',
      rules_delete_confirm_desc: 'This action cannot be undone. Related execution history will also be deleted.',
      rules_cond_buy_below: 'Buy Rate < Value',
      rules_cond_buy_above: 'Buy Rate > Value',
      rules_cond_sell_below: 'Sell Rate < Value',
      rules_cond_sell_above: 'Sell Rate > Value',
      rules_cond_spread_below: 'Spread < Value',
      rules_cond_spread_above: 'Spread > Value',
      rules_cond_type: 'Condition Type',
      rules_cond_value: 'Value',
      rules_cond_exchange: 'Exchange (optional)',
      rules_status_active: 'Active',
      rules_status_paused: 'Paused',
      rules_btn_history: 'History',
      rules_btn_test: 'Test',
      rules_empty: 'No rules yet. Click "+ Create Rule" to get started.',
      rules_history_empty: 'No execution history',
      rules_saved: 'Rule saved successfully',
      rules_deleted: 'Rule deleted successfully',
      rules_toggled_active: 'Rule activated',
      rules_toggled_paused: 'Rule paused',
      rules_test_success: 'Test execution complete (dry run)',
      rules_test_fail: 'Test execution failed',
      rules_error_name: 'Please enter a rule name',
      rules_error_conditions: 'Please add at least one rate condition',
      rules_error_amount: 'Please enter a trade amount',
      rules_error_load: 'Failed to load rules',
      rules_error_save: 'Failed to save rule',
      rules_last_exec: 'Last Executed',
      rules_exec_count: 'Executions',
      rules_never: 'Never',
      rules_day_sun: 'Su', rules_day_mon: 'Mo', rules_day_tue: 'Tu', rules_day_wed: 'We',
      rules_day_thu: 'Th', rules_day_fri: 'Fr', rules_day_sat: 'Sa',
      rules_hist_success: 'Success',
      rules_hist_failed: 'Failed',
      rules_hist_skipped: 'Skipped',
      rules_hist_dryrun: 'Dry Run',
      rules_all_exchanges: 'All Exchanges',
    },
    zh: {
      rules_page_title: '自动交易规则',
      rules_stat_total: '全部规则',
      rules_stat_active: '运行中',
      rules_stat_paused: '已暂停',
      rules_stat_executions: '今日执行',
      rules_list_title: '规则列表',
      rules_list_desc: '管理基于汇率条件的自动交易规则',
      rules_create_btn: '+ 创建规则',
      rules_history_title: '执行历史',
      rules_hist_time: '执行时间',
      rules_hist_detail: '详情',
      rules_hist_result: '结果',
      rules_hist_amount: '金额',
      rules_modal_create: '创建规则',
      rules_modal_edit: '编辑规则',
      rules_section_basic: '基本信息',
      rules_section_rate: '汇率条件',
      rules_section_time: '时间条件',
      rules_section_action: '操作设置',
      rules_field_name: '规则名称',
      rules_field_name_placeholder: '例：USDT低价买入规则',
      rules_field_desc: '描述',
      rules_field_desc_placeholder: '描述规则的目的和行为',
      rules_field_start_hour: '开始时间',
      rules_field_end_hour: '结束时间',
      rules_field_weekdays: '执行日期',
      rules_field_action_type: '交易类型',
      rules_field_crypto: '加密货币',
      rules_field_amount: '交易金额 (JPY)',
      rules_field_mode: '执行模式',
      rules_field_max_per_exec: '单次上限 (JPY)',
      rules_field_max_daily: '每日上限 (JPY)',
      rules_add_condition: '+ 添加条件',
      rules_action_buy: '买入',
      rules_action_sell: '卖出',
      rules_mode_notify: '仅通知',
      rules_mode_execute: '自动执行',
      rules_test_btn: '测试运行',
      rules_delete_confirm_title: '确定删除此规则？',
      rules_delete_confirm_desc: '此操作无法撤消。相关执行历史也将被删除。',
      rules_cond_buy_below: '买入价 < 值',
      rules_cond_buy_above: '买入价 > 值',
      rules_cond_sell_below: '卖出价 < 值',
      rules_cond_sell_above: '卖出价 > 值',
      rules_cond_spread_below: '价差 < 值',
      rules_cond_spread_above: '价差 > 值',
      rules_cond_type: '条件类型',
      rules_cond_value: '值',
      rules_cond_exchange: '交易所（可选）',
      rules_status_active: '运行中',
      rules_status_paused: '已暂停',
      rules_btn_history: '历史',
      rules_btn_test: '测试',
      rules_empty: '暂无规则。点击"+ 创建规则"开始。',
      rules_history_empty: '暂无执行历史',
      rules_saved: '规则保存成功',
      rules_deleted: '规则删除成功',
      rules_toggled_active: '规则已激活',
      rules_toggled_paused: '规则已暂停',
      rules_test_success: '测试执行完成（模拟运行）',
      rules_test_fail: '测试执行失败',
      rules_error_name: '请输入规则名称',
      rules_error_conditions: '请至少添加一个汇率条件',
      rules_error_amount: '请输入交易金额',
      rules_error_load: '加载规则失败',
      rules_error_save: '保存规则失败',
      rules_last_exec: '最后执行',
      rules_exec_count: '执行次数',
      rules_never: '未执行',
      rules_day_sun: '日', rules_day_mon: '一', rules_day_tue: '二', rules_day_wed: '三',
      rules_day_thu: '四', rules_day_fri: '五', rules_day_sat: '六',
      rules_hist_success: '成功',
      rules_hist_failed: '失败',
      rules_hist_skipped: '跳过',
      rules_hist_dryrun: '模拟运行',
      rules_all_exchanges: '全部交易所',
    },
    vi: {
      rules_page_title: 'Quy tắc giao dịch tự động',
      rules_stat_total: 'Tổng quy tắc',
      rules_stat_active: 'Đang chạy',
      rules_stat_paused: 'Tạm dừng',
      rules_stat_executions: 'Thực thi hôm nay',
      rules_list_title: 'Danh sách quy tắc',
      rules_list_desc: 'Quản lý quy tắc giao dịch tự động dựa trên điều kiện tỷ giá',
      rules_create_btn: '+ Tạo quy tắc',
      rules_history_title: 'Lịch sử thực thi',
      rules_hist_time: 'Thời gian',
      rules_hist_detail: 'Chi tiết',
      rules_hist_result: 'Kết quả',
      rules_hist_amount: 'Số tiền',
      rules_modal_create: 'Tạo quy tắc',
      rules_modal_edit: 'Chỉnh sửa quy tắc',
      rules_section_basic: 'Thông tin cơ bản',
      rules_section_rate: 'Điều kiện tỷ giá',
      rules_section_time: 'Điều kiện thời gian',
      rules_section_action: 'Cấu hình hành động',
      rules_field_name: 'Tên quy tắc',
      rules_field_name_placeholder: 'VD: Quy tắc mua USDT giá thấp',
      rules_field_desc: 'Mô tả',
      rules_field_desc_placeholder: 'Mô tả mục đích và hành vi của quy tắc',
      rules_field_start_hour: 'Giờ bắt đầu',
      rules_field_end_hour: 'Giờ kết thúc',
      rules_field_weekdays: 'Ngày trong tuần',
      rules_field_action_type: 'Loại giao dịch',
      rules_field_crypto: 'Tiền mã hóa',
      rules_field_amount: 'Số tiền (JPY)',
      rules_field_mode: 'Chế độ thực thi',
      rules_field_max_per_exec: 'Tối đa mỗi lần (JPY)',
      rules_field_max_daily: 'Tối đa mỗi ngày (JPY)',
      rules_add_condition: '+ Thêm điều kiện',
      rules_action_buy: 'Mua',
      rules_action_sell: 'Bán',
      rules_mode_notify: 'Chỉ thông báo',
      rules_mode_execute: 'Tự động thực thi',
      rules_test_btn: 'Chạy thử',
      rules_delete_confirm_title: 'Xóa quy tắc này?',
      rules_delete_confirm_desc: 'Hành động này không thể hoàn tác. Lịch sử thực thi liên quan cũng sẽ bị xóa.',
      rules_cond_buy_below: 'Giá mua < Giá trị',
      rules_cond_buy_above: 'Giá mua > Giá trị',
      rules_cond_sell_below: 'Giá bán < Giá trị',
      rules_cond_sell_above: 'Giá bán > Giá trị',
      rules_cond_spread_below: 'Chênh lệch < Giá trị',
      rules_cond_spread_above: 'Chênh lệch > Giá trị',
      rules_cond_type: 'Loại điều kiện',
      rules_cond_value: 'Giá trị',
      rules_cond_exchange: 'Sàn (tùy chọn)',
      rules_status_active: 'Đang chạy',
      rules_status_paused: 'Tạm dừng',
      rules_btn_history: 'Lịch sử',
      rules_btn_test: 'Thử',
      rules_empty: 'Chưa có quy tắc. Nhấn "+ Tạo quy tắc" để bắt đầu.',
      rules_history_empty: 'Chưa có lịch sử thực thi',
      rules_saved: 'Đã lưu quy tắc',
      rules_deleted: 'Đã xóa quy tắc',
      rules_toggled_active: 'Đã kích hoạt quy tắc',
      rules_toggled_paused: 'Đã tạm dừng quy tắc',
      rules_test_success: 'Chạy thử hoàn tất (dry run)',
      rules_test_fail: 'Chạy thử thất bại',
      rules_error_name: 'Vui lòng nhập tên quy tắc',
      rules_error_conditions: 'Vui lòng thêm ít nhất một điều kiện tỷ giá',
      rules_error_amount: 'Vui lòng nhập số tiền giao dịch',
      rules_error_load: 'Không thể tải quy tắc',
      rules_error_save: 'Không thể lưu quy tắc',
      rules_last_exec: 'Lần cuối',
      rules_exec_count: 'Số lần thực thi',
      rules_never: 'Chưa thực thi',
      rules_day_sun: 'CN', rules_day_mon: 'T2', rules_day_tue: 'T3', rules_day_wed: 'T4',
      rules_day_thu: 'T5', rules_day_fri: 'T6', rules_day_sat: 'T7',
      rules_hist_success: 'Thành công',
      rules_hist_failed: 'Thất bại',
      rules_hist_skipped: 'Bỏ qua',
      rules_hist_dryrun: 'Chạy thử',
      rules_all_exchanges: 'Tất cả sàn',
    }
  };

  // Merge page-specific translations into global i18n
  if (typeof translations !== 'undefined') {
    for (const lang of Object.keys(rulesTranslations)) {
      if (translations[lang]) {
        Object.assign(translations[lang], rulesTranslations[lang]);
      } else {
        translations[lang] = Object.assign({}, rulesTranslations[lang]);
      }
    }
  }

  /* =========================================================
     State
     ========================================================= */
  var rules = [];
  var editingRuleId = null;
  var deletingRuleId = null;
  var rateConditionCounter = 0;

  var RATE_CONDITION_TYPES = [
    'buy_below', 'buy_above',
    'sell_below', 'sell_above',
    'spread_below', 'spread_above'
  ];

  var EXCHANGES = ['', 'Bybit', 'Binance', 'OKX', 'HTX'];

  /* =========================================================
     Theme
     ========================================================= */
  function toggleTheme() {
    var html = document.documentElement;
    var isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    document.getElementById('themeBtn').textContent = isDark ? 'L' : 'D';
  }

  (function initTheme() {
    var saved = localStorage.getItem('theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
      var btn = document.getElementById('themeBtn');
      if (btn) btn.textContent = saved === 'dark' ? 'D' : 'L';
    }
  })();

  /* =========================================================
     Init time selects
     ========================================================= */
  function initTimeSelects() {
    var startSel = document.getElementById('timeStart');
    var endSel = document.getElementById('timeEnd');
    for (var h = 0; h < 24; h++) {
      var label = String(h).padStart(2, '0') + ':00';
      startSel.innerHTML += '<option value="' + h + '">' + label + '</option>';
      endSel.innerHTML += '<option value="' + h + '">' + label + '</option>';
    }
  }

  /* =========================================================
     Toast
     ========================================================= */
  function showToast(message, type) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + (type || 'success');
    toast.classList.add('show');
    setTimeout(function() { toast.classList.remove('show'); }, 3000);
  }

  /* =========================================================
     Translation helper (page-specific)
     ========================================================= */
  function rt(key) {
    return (typeof t === 'function') ? t(key) : key;
  }

  /* =========================================================
     Rate Condition Type Label
     ========================================================= */
  function conditionTypeLabel(type) {
    var key = 'rules_cond_' + type;
    return rt(key);
  }

  /* =========================================================
     API calls
     ========================================================= */
  var API_BASE = '/api/rules';

  async function apiCall(url, method, body) {
    try {
      var opts = {
        method: method || 'GET',
        headers: { 'Content-Type': 'application/json' }
      };
      if (body) opts.body = JSON.stringify(body);
      var res = await fetch(url, opts);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.error('API Error:', err);
      throw err;
    }
  }

  /* =========================================================
     Load Rules
     ========================================================= */
  async function loadRules() {
    try {
      var data = await apiCall(API_BASE);
      rules = Array.isArray(data) ? data : (data.rules || []);
      renderRules();
      updateStats();
    } catch (err) {
      rules = [];
      renderRules();
      updateStats();
      console.warn('Could not load rules:', err.message);
    }
  }

  /* =========================================================
     Update Stats
     ========================================================= */
  function updateStats() {
    var total = rules.length;
    var active = rules.filter(function(r) { return r.status === 'active'; }).length;
    var paused = rules.filter(function(r) { return r.status === 'paused'; }).length;
    var todayExec = rules.reduce(function(sum, r) { return sum + (r.todayExecutions || 0); }, 0);

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statActive').textContent = active;
    document.getElementById('statPaused').textContent = paused;
    document.getElementById('statExecutions').textContent = todayExec;
  }

  /* =========================================================
     Render Rules List
     ========================================================= */
  function renderRules() {
    var container = document.getElementById('rulesList');

    if (rules.length === 0) {
      container.innerHTML = '<div class="empty-state">' + rt('rules_empty') + '</div>';
      return;
    }

    container.innerHTML = rules.map(function(rule) {
      var isActive = rule.status === 'active';
      var statusClass = isActive ? 'active-rule' : 'paused-rule';
      var statusBadge = isActive
        ? '<span class="badge badge-green">' + rt('rules_status_active') + '</span>'
        : '<span class="badge badge-yellow">' + rt('rules_status_paused') + '</span>';

      var actionBadge = rule.action && rule.action.type === 'buy'
        ? '<span class="badge badge-blue">' + rt('rules_action_buy') + '</span>'
        : '<span class="badge badge-red">' + rt('rules_action_sell') + '</span>';

      var cryptoBadge = '<span class="badge badge-purple">' + ((rule.action && rule.action.crypto) || 'USDT') + '</span>';

      var modeBadge = rule.action && rule.action.mode === 'execute'
        ? '<span class="badge badge-green">' + rt('rules_mode_execute') + '</span>'
        : '<span class="badge badge-dim">' + rt('rules_mode_notify') + '</span>';

      var condTags = (rule.rateConditions || []).map(function(c) {
        var label = conditionTypeLabel(c.type);
        var exch = c.exchange ? ' @' + c.exchange : '';
        return '<span class="condition-tag">' + label + ': ' + formatNumber(c.value) + exch + '</span>';
      }).join('');

      var tc = rule.timeConditions || {};
      var timeTag = (tc.startHour != null && tc.endHour != null)
        ? '<span class="condition-tag">' + String(tc.startHour).padStart(2,'0') + ':00 - ' + String(tc.endHour).padStart(2,'0') + ':00</span>'
        : '';

      var weekdayTag = (tc.weekdays && tc.weekdays.length > 0 && tc.weekdays.length < 7)
        ? '<span class="condition-tag">' + tc.weekdays.map(function(d) { return weekdayShort(d); }).join(', ') + '</span>'
        : '';

      var lastExec = rule.lastExecutedAt
        ? new Date(rule.lastExecutedAt).toLocaleString()
        : rt('rules_never');
      var execCount = rule.executionCount || 0;

      return '\
        <div class="rule-item ' + statusClass + '" data-id="' + rule.id + '">\
          <div class="rule-header">\
            <div style="flex:1;min-width:0">\
              <div class="rule-name">' + escapeHtml(rule.name) + '</div>\
              ' + (rule.description ? '<div class="rule-desc">' + escapeHtml(rule.description) + '</div>' : '') + '\
              <div class="rule-meta">\
                ' + statusBadge + ' ' + actionBadge + ' ' + cryptoBadge + ' ' + modeBadge + '\
              </div>\
              <div class="rule-conditions">\
                ' + condTags + timeTag + weekdayTag + '\
              </div>\
            </div>\
            <div class="rule-actions">\
              <label class="toggle" title="' + (isActive ? rt('rules_status_active') : rt('rules_status_paused')) + '">\
                <input type="checkbox" ' + (isActive ? 'checked' : '') + ' data-action="toggle-rule" data-rule-id="' + rule.id + '">\
                <span class="toggle-slider"></span>\
              </label>\
              <button class="btn btn-outline btn-sm" data-action="edit-rule" data-rule-id="' + rule.id + '" title="' + rt('edit') + '">&#9998;</button>\
              <button class="btn btn-outline btn-sm" data-action="view-history" data-rule-id="' + rule.id + '" title="' + rt('rules_btn_history') + '">' + rt('rules_btn_history') + '</button>\
              <button class="btn btn-purple btn-sm" data-action="test-rule" data-rule-id="' + rule.id + '" title="' + rt('rules_btn_test') + '">' + rt('rules_btn_test') + '</button>\
              <button class="btn btn-red btn-sm" data-action="delete-rule" data-rule-id="' + rule.id + '" title="' + rt('delete') + '">&#128465;</button>\
            </div>\
          </div>\
          <div class="rule-stats">\
            <span>' + rt('rules_last_exec') + ': <strong>' + lastExec + '</strong></span>\
            <span>' + rt('rules_exec_count') + ': <strong>' + execCount + '</strong></span>\
            ' + (rule.action && rule.action.amount ? '<span>' + rt('rules_field_amount') + ': <strong>' + formatJPY(rule.action.amount) + '</strong></span>' : '') + '\
          </div>\
        </div>';
    }).join('');

    applyTranslations();
  }

  /* =========================================================
     Format helpers
     ========================================================= */
  function formatNumber(n) {
    if (n == null) return '--';
    return Number(n).toLocaleString();
  }

  function formatJPY(n) {
    if (n == null) return '--';
    return '\u00a5' + Number(n).toLocaleString();
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function weekdayShort(d) {
    var keys = ['rules_day_sun','rules_day_mon','rules_day_tue','rules_day_wed','rules_day_thu','rules_day_fri','rules_day_sat'];
    return rt(keys[d] || keys[0]);
  }

  /* =========================================================
     Rate Conditions Builder
     ========================================================= */
  function addRateCondition(data) {
    var id = rateConditionCounter++;
    var container = document.getElementById('rateConditions');
    var row = document.createElement('div');
    row.className = 'condition-row';
    row.id = 'condRow_' + id;

    var typeOptions = RATE_CONDITION_TYPES.map(function(tp) {
      var selected = (data && data.type === tp) ? 'selected' : '';
      return '<option value="' + tp + '" ' + selected + '>' + conditionTypeLabel(tp) + '</option>';
    }).join('');

    var exchangeOptions = EXCHANGES.map(function(e) {
      var selected = (data && data.exchange === e) ? 'selected' : '';
      var label = e || rt('rules_all_exchanges');
      return '<option value="' + e + '" ' + selected + '>' + label + '</option>';
    }).join('');

    row.innerHTML = '\
      <div class="form-group" style="flex:2">\
        <label class="form-label">' + rt('rules_cond_type') + '</label>\
        <select class="form-select cond-type" data-id="' + id + '">\
          ' + typeOptions + '\
        </select>\
      </div>\
      <div class="form-group" style="flex:1">\
        <label class="form-label">' + rt('rules_cond_value') + '</label>\
        <input class="form-input cond-value" type="number" data-id="' + id + '" value="' + ((data && data.value) || '') + '" placeholder="例: 150.5" step="0.01">\
      </div>\
      <div class="form-group" style="flex:1">\
        <label class="form-label">' + rt('rules_cond_exchange') + '</label>\
        <select class="form-select cond-exchange" data-id="' + id + '">\
          ' + exchangeOptions + '\
        </select>\
      </div>\
      <button type="button" class="remove-condition" data-action="remove-condition" data-cond-id="' + id + '" title="' + rt('delete') + '">&times;</button>';

    container.appendChild(row);
  }

  function removeCondition(id) {
    var row = document.getElementById('condRow_' + id);
    if (row) row.remove();
  }

  function getConditions() {
    var rows = document.querySelectorAll('.condition-row');
    var conditions = [];
    rows.forEach(function(row) {
      var typeEl = row.querySelector('.cond-type');
      var valueEl = row.querySelector('.cond-value');
      var exchangeEl = row.querySelector('.cond-exchange');
      var type = typeEl ? typeEl.value : null;
      var value = valueEl ? parseFloat(valueEl.value) : NaN;
      var exchange = exchangeEl ? (exchangeEl.value || null) : null;
      if (type && !isNaN(value)) {
        conditions.push({ type: type, value: value, exchange: exchange });
      }
    });
    return conditions;
  }

  /* =========================================================
     Weekday Picker
     ========================================================= */
  function initWeekdayPicker() {
    document.querySelectorAll('.weekday-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        btn.classList.toggle('active');
      });
    });
  }

  function getSelectedWeekdays() {
    var days = [];
    document.querySelectorAll('.weekday-btn.active').forEach(function(btn) {
      days.push(parseInt(btn.dataset.day));
    });
    return days.sort();
  }

  function setSelectedWeekdays(days) {
    document.querySelectorAll('.weekday-btn').forEach(function(btn) {
      var d = parseInt(btn.dataset.day);
      btn.classList.toggle('active', days.includes(d));
    });
  }

  /* =========================================================
     Modal - Create
     ========================================================= */
  function openCreateModal() {
    editingRuleId = null;
    document.getElementById('modalTitle').setAttribute('data-i18n', 'rules_modal_create');
    document.getElementById('modalTitle').textContent = rt('rules_modal_create');
    document.getElementById('testRuleBtn').style.display = 'none';
    resetForm();
    addRateCondition();
    document.getElementById('ruleModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  /* =========================================================
     Modal - Edit
     ========================================================= */
  function openEditModal(id) {
    var rule = rules.find(function(r) { return r.id === id; });
    if (!rule) return;

    editingRuleId = id;
    document.getElementById('modalTitle').setAttribute('data-i18n', 'rules_modal_edit');
    document.getElementById('modalTitle').textContent = rt('rules_modal_edit');
    document.getElementById('testRuleBtn').style.display = 'inline-flex';
    resetForm();

    document.getElementById('ruleName').value = rule.name || '';
    document.getElementById('ruleDescription').value = rule.description || '';

    (rule.rateConditions || []).forEach(function(c) { addRateCondition(c); });
    if ((rule.rateConditions || []).length === 0) addRateCondition();

    var tc = rule.timeConditions || {};
    if (tc.startHour != null) document.getElementById('timeStart').value = tc.startHour;
    if (tc.endHour != null) document.getElementById('timeEnd').value = tc.endHour;
    setSelectedWeekdays(tc.weekdays || [0,1,2,3,4,5,6]);

    var act = rule.action || {};
    document.getElementById('actionType').value = act.type || 'buy';
    document.getElementById('actionCrypto').value = act.crypto || 'USDT';
    document.getElementById('actionAmount').value = act.amount || '';
    document.getElementById('actionMode').value = act.mode || 'notify';
    document.getElementById('maxPerExec').value = act.maxPerExecution || '';
    document.getElementById('maxDaily').value = act.maxDaily || '';

    document.getElementById('ruleModal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  /* =========================================================
     Close Modal
     ========================================================= */
  function closeModal() {
    document.getElementById('ruleModal').classList.remove('open');
    document.body.style.overflow = '';
    editingRuleId = null;
  }

  /* =========================================================
     Reset Form
     ========================================================= */
  function resetForm() {
    document.getElementById('ruleName').value = '';
    document.getElementById('ruleDescription').value = '';
    document.getElementById('rateConditions').innerHTML = '';
    rateConditionCounter = 0;
    document.getElementById('timeStart').value = '';
    document.getElementById('timeEnd').value = '';
    setSelectedWeekdays([0,1,2,3,4,5,6]);
    document.getElementById('actionType').value = 'buy';
    document.getElementById('actionCrypto').value = 'USDT';
    document.getElementById('actionAmount').value = '';
    document.getElementById('actionMode').value = 'notify';
    document.getElementById('maxPerExec').value = '';
    document.getElementById('maxDaily').value = '';
  }

  /* =========================================================
     Save Rule (Create / Update)
     ========================================================= */
  async function saveRule() {
    var name = document.getElementById('ruleName').value.trim();
    if (!name) {
      showToast(rt('rules_error_name'), 'error');
      document.getElementById('ruleName').focus();
      return;
    }

    var conditions = getConditions();
    if (conditions.length === 0) {
      showToast(rt('rules_error_conditions'), 'error');
      return;
    }

    var amount = parseFloat(document.getElementById('actionAmount').value);
    if (!amount || isNaN(amount)) {
      showToast(rt('rules_error_amount'), 'error');
      document.getElementById('actionAmount').focus();
      return;
    }

    var startHour = document.getElementById('timeStart').value;
    var endHour = document.getElementById('timeEnd').value;

    var payload = {
      name: name,
      description: document.getElementById('ruleDescription').value.trim(),
      rateConditions: conditions,
      timeConditions: {
        startHour: startHour !== '' ? parseInt(startHour) : null,
        endHour: endHour !== '' ? parseInt(endHour) : null,
        weekdays: getSelectedWeekdays()
      },
      action: {
        type: document.getElementById('actionType').value,
        crypto: document.getElementById('actionCrypto').value,
        amount: amount,
        mode: document.getElementById('actionMode').value,
        maxPerExecution: parseFloat(document.getElementById('maxPerExec').value) || null,
        maxDaily: parseFloat(document.getElementById('maxDaily').value) || null
      }
    };

    var saveBtn = document.getElementById('saveRuleBtn');
    saveBtn.disabled = true;

    try {
      if (editingRuleId) {
        await apiCall(API_BASE + '/' + editingRuleId, 'PUT', payload);
      } else {
        await apiCall(API_BASE, 'POST', payload);
      }
      showToast(rt('rules_saved'), 'success');
      closeModal();
      await loadRules();
    } catch (err) {
      showToast(rt('rules_error_save'), 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* =========================================================
     Toggle Rule Active/Paused
     ========================================================= */
  async function toggleRule(id, checkboxEl) {
    try {
      var result = await apiCall(API_BASE + '/' + id + '/toggle', 'POST');
      var newStatus = (result && result.status) || (checkboxEl.checked ? 'active' : 'paused');
      var rule = rules.find(function(r) { return r.id === id; });
      if (rule) rule.status = newStatus;
      renderRules();
      updateStats();
      showToast(
        newStatus === 'active' ? rt('rules_toggled_active') : rt('rules_toggled_paused'),
        'success'
      );
    } catch (err) {
      checkboxEl.checked = !checkboxEl.checked;
      showToast(rt('error'), 'error');
    }
  }

  /* =========================================================
     Delete Rule
     ========================================================= */
  function promptDelete(id) {
    deletingRuleId = id;
    var rule = rules.find(function(r) { return r.id === id; });
    if (rule) {
      document.getElementById('confirmDesc').textContent =
        '"' + rule.name + '" - ' + rt('rules_delete_confirm_desc');
    }
    document.getElementById('confirmDialog').classList.add('open');
  }

  function closeConfirm() {
    document.getElementById('confirmDialog').classList.remove('open');
    deletingRuleId = null;
  }

  async function confirmDelete() {
    if (!deletingRuleId) return;
    var btn = document.getElementById('confirmDeleteBtn');
    btn.disabled = true;
    try {
      await apiCall(API_BASE + '/' + deletingRuleId, 'DELETE');
      showToast(rt('rules_deleted'), 'success');
      closeConfirm();
      await loadRules();
      var historySection = document.getElementById('historySection');
      if (historySection.dataset.ruleId === deletingRuleId) {
        closeHistory();
      }
    } catch (err) {
      showToast(rt('error'), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /* =========================================================
     Test Rule (Dry Run)
     ========================================================= */
  async function testRule() {
    if (!editingRuleId) return;
    await testRuleById(editingRuleId);
  }

  async function testRuleById(id) {
    try {
      var result = await apiCall(API_BASE + '/test/' + id, 'POST');
      showToast(rt('rules_test_success'), 'info');
      console.log('Test result:', result);
    } catch (err) {
      showToast(rt('rules_test_fail'), 'error');
    }
  }

  /* =========================================================
     Execution History
     ========================================================= */
  async function viewHistory(id) {
    var rule = rules.find(function(r) { return r.id === id; });
    if (!rule) return;

    var section = document.getElementById('historySection');
    section.style.display = 'block';
    section.dataset.ruleId = id;
    document.getElementById('historyRuleName').textContent = rule.name;
    document.getElementById('historyList').innerHTML = '<div class="empty-state">' + rt('loading') + '</div>';

    section.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      var data = await apiCall(API_BASE + '/' + id + '/history');
      var history = Array.isArray(data) ? data : (data.history || []);
      renderHistory(history);
    } catch (err) {
      document.getElementById('historyList').innerHTML = '<div class="empty-state">' + rt('rules_history_empty') + '</div>';
    }
  }

  function renderHistory(history) {
    var container = document.getElementById('historyList');

    if (!history || history.length === 0) {
      container.innerHTML = '<div class="empty-state">' + rt('rules_history_empty') + '</div>';
      return;
    }

    container.innerHTML = history.map(function(h) {
      var time = new Date(h.executedAt).toLocaleString();
      var statusClass = h.status === 'success' ? 'success'
        : h.status === 'failed' ? 'failed'
        : h.status === 'skipped' ? 'skipped'
        : 'dry-run';
      var statusKey = h.status === 'success' ? 'rules_hist_success'
        : h.status === 'failed' ? 'rules_hist_failed'
        : h.status === 'skipped' ? 'rules_hist_skipped'
        : 'rules_hist_dryrun';

      var detail = h.detail || h.message || '--';
      var amount = h.amount ? formatJPY(h.amount) : '--';

      return '\
        <div class="history-item">\
          <span class="history-time">' + time + '</span>\
          <span class="history-detail">' + escapeHtml(detail) + '</span>\
          <span class="history-status ' + statusClass + '">' + rt(statusKey) + '</span>\
          <span class="history-amount" style="text-align:right">' + amount + '</span>\
        </div>';
    }).join('');
  }

  function closeHistory() {
    document.getElementById('historySection').style.display = 'none';
  }

  /* =========================================================
     Event delegation for dynamically generated elements
     ========================================================= */

  // Rules list: toggle, edit, history, test, delete buttons
  document.getElementById('rulesList').addEventListener('click', function(e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;

    var action = target.dataset.action;
    var ruleId = target.dataset.ruleId;

    if (action === 'edit-rule') {
      e.stopPropagation();
      openEditModal(ruleId);
    } else if (action === 'view-history') {
      e.stopPropagation();
      viewHistory(ruleId);
    } else if (action === 'test-rule') {
      e.stopPropagation();
      testRuleById(ruleId);
    } else if (action === 'delete-rule') {
      e.stopPropagation();
      promptDelete(ruleId);
    }
  });

  // Toggle rule via change event (checkbox)
  document.getElementById('rulesList').addEventListener('change', function(e) {
    var target = e.target.closest('[data-action="toggle-rule"]');
    if (!target) return;
    e.stopPropagation();
    toggleRule(target.dataset.ruleId, target);
  });

  // Rate conditions: remove button (event delegation)
  document.getElementById('rateConditions').addEventListener('click', function(e) {
    var target = e.target.closest('[data-action="remove-condition"]');
    if (!target) return;
    removeCondition(parseInt(target.dataset.condId));
  });

  /* =========================================================
     Static element event listeners (replacing inline handlers)
     ========================================================= */

  // Language buttons
  document.querySelectorAll('.lang-btn[data-lang]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (typeof setLanguage === 'function') {
        setLanguage(btn.dataset.lang);
      }
    });
  });

  // Theme toggle
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);

  // Refresh (load rules) button
  document.getElementById('btnRefreshRules').addEventListener('click', function() {
    loadRules();
  });

  // Create rule button
  document.getElementById('btnCreateRule').addEventListener('click', function() {
    openCreateModal();
  });

  // Close history button
  document.getElementById('btnCloseHistory').addEventListener('click', function() {
    closeHistory();
  });

  // Modal close (X) button
  document.getElementById('btnModalClose').addEventListener('click', function() {
    closeModal();
  });

  // Add rate condition button
  document.getElementById('btnAddCondition').addEventListener('click', function() {
    addRateCondition();
  });

  // Modal footer: cancel button
  document.getElementById('btnModalCancel').addEventListener('click', function() {
    closeModal();
  });

  // Modal footer: test rule button
  document.getElementById('testRuleBtn').addEventListener('click', function() {
    testRule();
  });

  // Modal footer: save rule button
  document.getElementById('saveRuleBtn').addEventListener('click', function() {
    saveRule();
  });

  // Confirm dialog: cancel button
  document.getElementById('btnConfirmCancel').addEventListener('click', function() {
    closeConfirm();
  });

  // Confirm dialog: delete button
  document.getElementById('confirmDeleteBtn').addEventListener('click', function() {
    confirmDelete();
  });

  /* =========================================================
     Close modals on overlay click
     ========================================================= */
  document.getElementById('ruleModal').addEventListener('click', function(e) {
    if (e.target === this) closeModal();
  });

  document.getElementById('confirmDialog').addEventListener('click', function(e) {
    if (e.target === this) closeConfirm();
  });

  /* =========================================================
     Keyboard shortcuts
     ========================================================= */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (document.getElementById('confirmDialog').classList.contains('open')) {
        closeConfirm();
      } else if (document.getElementById('ruleModal').classList.contains('open')) {
        closeModal();
      }
    }
  });

  /* =========================================================
     Init
     ========================================================= */
  initTimeSelects();
  initWeekdayPicker();
  if (typeof applyTranslations === 'function') {
    applyTranslations();
  }
  loadRules();

});
