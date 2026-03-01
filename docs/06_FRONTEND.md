# BK P2P System — フロントエンド構成

## ファイル一覧

| ファイル | サイズ | 役割 |
|---------|-------|------|
| index.html | ~6KB | P2Pダッシュボード（メインページ） |
| style.css | ~12KB | ダッシュボード用スタイル |
| app.js | ~15KB | ダッシュボード用ロジック |
| i18n.js | ~3KB | 多言語翻訳定義（日/英） |
| pay.html | ~20KB | BK Pay決済ページ（HTML+CSS+JS一体） |
| admin.html | ~15KB | 管理画面（HTML+CSS+JS一体） |
| login.html | ~3KB | ログインページ |
| guide.html | ~5KB | 利用ガイド |

## CSS設計

### テーマシステム

`data-theme` 属性でダーク/ライトモードを切替。CSS変数で全色を管理。

```css
[data-theme="dark"] {
  --bg: #0c1017;
  --card: #1a2233;
  --border: #243049;
  --text: #edf0f7;
  --green: #34d399;
  --red: #f87171;
  /* ... */
}

[data-theme="light"] {
  --bg: #f5f7fa;
  --card: #fff;
  /* ... */
}
```

テーマ保存: `localStorage.setItem('theme', 'dark'|'light')`

### レスポンシブブレークポイント

| ブレークポイント | 対象 |
|----------------|------|
| 768px | タブレット: 1カラム化、フィルターをスクロール可能に |
| 480px | スマートフォン: コンパクトフィルター、テーブル列非表示 |
| 380px | 小型スマートフォン: クイック金額ボタン3列化 |

### フォント

```css
font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Segoe UI', sans-serif;
```

システムフォントを使用。Webフォントの読み込みなし。

---

## i18n（多言語対応）

### 仕組み

1. HTMLに `data-i18n="key"` 属性を付与
2. `i18n.js` に翻訳辞書を定義（ja/en）
3. `applyI18n()` で全要素のテキストを差し替え

```javascript
// i18n.js
const translations = {
  ja: {
    best_buy_label: '購入 平均価格',
    best_sell_label: '売却 平均価格',
    spread_label: '平均スプレッド',
    // ...
  },
  en: {
    best_buy_label: 'Avg Buy Price',
    // ...
  }
};
```

言語切替: `localStorage.setItem('lang', 'ja'|'en')`

### 翻訳キー追加手順

1. HTMLに `data-i18n="new_key"` を追加
2. `i18n.js` の `ja` と `en` に `new_key` を追加
3. `applyI18n()` が自動適用

---

## app.js 構造

### グローバル設定

```javascript
var CONFIG = {
  maxDeviationPct: 15,    // 乖離率フィルター
  arbitrageThreshold: 0.5  // アービトラージ閾値
};
var volThreshold = 5.0;    // ボリュームスポット閾値（%）
var currentCrypto = 'USDT';
var countdown = 30;
var rawData = null;        // 最新のAPIレスポンス
```

### 主要関数

| 関数 | 説明 |
|------|------|
| `fetchData()` | `/api/rates/{crypto}` からデータ取得 → `rawData` に保存 → `render()` |
| `render()` | rawDataからUIを全描画（ヒーロー/フィルター/テーブル/アービトラージ） |
| `renderOrders(orders, type, tbody)` | オーダーをテーブル行に描画 |
| `applyFilters(orders)` | フィルター条件でオーダーを絞り込み |
| `adjustThreshold(delta)` | ボリューム閾値を変更して再描画 |
| `adjustDeviation(delta)` | 乖離率閾値を変更して再描画 |
| `switchCrypto(crypto)` | 表示する暗号通貨を切替 |
| `toggleTheme()` | ダーク/ライト切替 |
| `clearFilter(type)` | 指定フィルターを「全て」にリセット |

### データフロー

```
fetchData() → rawData保存 → render()
  → renderHero(data)      // 平均価格・スプレッド
  → renderVolume(data)    // ボリューム計算
  → applyFilters(orders)  // フィルター適用
  → renderOrders(filtered) // テーブル描画
  → renderArbitrage(data)  // アービトラージバー
```

### 自動更新

```javascript
setInterval(fetchData, 30000);  // 30秒ごとにデータ取得
setInterval(() => {
  countdown--;
  // カウントダウン表示更新
  if (countdown <= 0) countdown = 30;
}, 1000);
```

---

## pay.html 構造

### 状態管理

```javascript
var amount = 0;
var payMethod = 'bank';
var currentOrder = null;   // APIから取得した注文オブジェクト
var timerSec = 900;        // 15分タイマー
var timerInterval = null;
```

### 主要関数

| 関数 | 説明 |
|------|------|
| `setAmt(v, el)` | クイック金額ボタンから金額設定 |
| `onAmountChange()` | 金額変更時の換算表示更新 |
| `startMatching()` | POST /api/orders → マッチング開始 |
| `showPaymentFromOrder()` | 振込先情報を表示 |
| `markPaid()` | POST /api/orders/:id/paid → 振込完了報告 |
| `cancelOrder()` | POST /api/orders/:id/cancel → キャンセル |
| `useFallback()` | 自社決済モードで続行 |
| `fetchPreview()` | レートプレビュー取得 |
| `startTimer()` | 15分カウントダウン開始 |
| `copyText(text)` | クリップボードにコピー |

---

## admin.html 構造

### タブ構成

| タブ | データソース | 保存先 |
|------|------------|--------|
| 注文管理 | GET /api/orders | 読み取り専用 |
| 銀行口座 | GET/POST/DELETE /api/accounts | SQLite DB |
| 電子決済 | POST /api/epay/:type | SQLite DB |
| 取引所API | POST /api/trader/credentials | SQLite DB（暗号化） |
| ウォレット | POST /api/wallet | SQLite DB |
| 設定 | POST /api/settings | SQLite DB |

### 注意事項

- **現在、銀行口座タブはlocalStorageとAPI両方にコードが存在**
  → API版（/api/accounts）への統一が必要（TODO）
- 電子決済のQR画像はBase64でlocalStorageに一時保存
  → DBのepay_configテーブルに統一すべき（TODO）

---

## キャッシュバスティング

```html
<link rel="stylesheet" href="style.css?v=1772345713">
<script src="app.js?v=1772345713"></script>
<script src="i18n.js?v=1772345713"></script>
```

CSSやJSを変更した場合、`v=` パラメータを更新して強制リロードさせる。
