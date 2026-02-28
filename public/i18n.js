const I18N = {
  ja: {
    subtitle: 'P2P取引所 横断レート監視', refresh: '更新',
    best_buy_label: '一番安く買える', best_sell_label: '一番高く売れる',
    spread_label: '差額', arb_btn: 'アービトラージ',
    filter_btn: 'フィルター', f_payment: '決済方法', f_exchange: '取引所',
    f_amount: '取引金額', f_completion: '完了率', f_stock: '最低在庫', f_status: '状態',
    all: '全て', online_only: 'オンラインのみ', reset: 'リセット',
    th_exchange: '取引所', th_rate: 'レート', th_premium: '乖離率',
    th_avail: '在庫', th_limit: '取引範囲', th_merchant: '業者',
    th_comp: '完了率', th_pay: '決済', no_orders: '該当する注文なし',
    buy_title: (c) => `購入（円 → ${c}）`, sell_title: (c) => `売却（${c} → 円）`,
    buy_desc: '円を支払い、暗号資産を受け取る', sell_desc: '暗号資産を支払い、円を受け取る',
    ex_buy: '購入', ex_sell: '売却', ex_spread: 'スプレッド', ex_prem: '乖離',
    arb_active: '発生中', arb_history: '履歴',
    arb_buy_at: '購入価格', arb_sell_at: '売却価格', arb_per_unit: '枚あたり',
    arb_volume: '取引可能量', arb_max_profit: '最大利益',
    arb_buy_limit: '購入範囲', arb_sell_limit: '売却範囲',
    arb_peak: 'ピーク', arb_opened: '開始', arb_closed: '終了',
    arb_status_open: '発生中', arb_status_closed: '終了',
    arb_now: '継続中', arb_ago: '前',
    arb_none_active: '現在アービトラージ機会なし', arb_none_history: '履歴なし',
    filter_placeholder: '例: 100000',
  },
  en: {
    subtitle: 'P2P Cross-Exchange Rate Monitor', refresh: 'Refresh',
    best_buy_label: 'Best Price to Buy', best_sell_label: 'Best Price to Sell',
    spread_label: 'Spread', arb_btn: 'Arbitrage',
    filter_btn: 'Filters', f_payment: 'Payment', f_exchange: 'Exchange',
    f_amount: 'Amount', f_completion: 'Completion', f_stock: 'Min. Stock', f_status: 'Status',
    all: 'All', online_only: 'Online Only', reset: 'Reset',
    th_exchange: 'Exchange', th_rate: 'Rate', th_premium: 'Premium',
    th_avail: 'Available', th_limit: 'Limit', th_merchant: 'Merchant',
    th_comp: 'Completion', th_pay: 'Payment', no_orders: 'No matching orders',
    buy_title: (c) => `Buy (JPY → ${c})`, sell_title: (c) => `Sell (${c} → JPY)`,
    buy_desc: 'Pay JPY, receive crypto', sell_desc: 'Pay crypto, receive JPY',
    ex_buy: 'Buy', ex_sell: 'Sell', ex_spread: 'Spread', ex_prem: 'Prem',
    arb_active: 'Active', arb_history: 'History',
    arb_buy_at: 'Buy at', arb_sell_at: 'Sell at', arb_per_unit: 'per unit',
    arb_volume: 'Max Volume', arb_max_profit: 'Max Profit',
    arb_buy_limit: 'Buy Limit', arb_sell_limit: 'Sell Limit',
    arb_peak: 'Peak', arb_opened: 'Opened', arb_closed: 'Closed',
    arb_status_open: 'LIVE', arb_status_closed: 'CLOSED',
    arb_now: 'ongoing', arb_ago: 'ago',
    arb_none_active: 'No active arbitrage', arb_none_history: 'No history',
    filter_placeholder: 'e.g. 100000',
  }
};
let currentLang = localStorage.getItem('lang') || 'ja';
function t(key) { return I18N[currentLang]?.[key] || I18N.ja[key] || key; }
function tf(key, ...args) { const v = I18N[currentLang]?.[key] || I18N.ja[key]; return typeof v === 'function' ? v(...args) : v || key; }
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { const v = t(el.getAttribute('data-i18n')); if (v) el.textContent = v; });
  const fa = document.getElementById('filterAmount'); if (fa) fa.placeholder = t('filter_placeholder');
  document.getElementById('langToggle').textContent = currentLang === 'ja' ? 'EN' : 'JA';
}
function toggleLang() { currentLang = currentLang === 'ja' ? 'en' : 'ja'; localStorage.setItem('lang', currentLang); applyI18n(); if (typeof render === 'function') render(); if (typeof loadArbitrage === 'function') loadArbitrage(); }
document.addEventListener('DOMContentLoaded', applyI18n);
