# BK P2P System — システム概要書

## 1. システム概要

BK P2P Systemは、暗号通貨（USDT/BTC/ETH）のP2P取引レートをリアルタイムで比較し、顧客向けの入金（法定通貨→暗号通貨）決済を自動化する統合プラットフォームです。

### 対象ユーザー

| ユーザー | 用途 |
|---------|------|
| 一般顧客 | BK Pay（決済ページ）で日本円を入金し、USDTを受け取る |
| 運用スタッフ | 管理画面で注文管理、口座管理、設定変更を行う |
| 経営層 | P2Pダッシュボードでレート・スプレッド・アービトラージを監視する |

### ビジネスフロー

```
顧客がBK Payで入金申請（例: ¥50,000）
  ↓
システムが3取引所のP2Pレートを自動検索
  ↓
┌─ マッチ成功 → AUTO MODE（取引所マーチャントの振込先を表示）
└─ マッチ失敗 → SELF MODE（自社口座をAccount Routerから割当）
  ↓
顧客が振込を実行 → 「振込完了」ボタン
  ↓
スタッフが入金確認 → USDT送付 → 完了
```

## 2. システム構成図

```
┌──────────────────────────────────────────────────────────┐
│                    BK P2P System (Port 3003)              │
│                                                          │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐             │
│  │ P2P Dashboard│ │  BK Pay  │  │  Admin   │             │
│  │ index.html  │  │ pay.html │  │admin.html│             │
│  │ (公開)      │  │ (公開)    │  │(認証必須) │             │
│  └─────┬──────┘  └────┬─────┘  └────┬─────┘             │
│        └───────────────┴─────────────┘                   │
│                        │                                  │
│            ┌───────────┴───────────┐                     │
│            │   Express.js Server    │                     │
│            ├────────┬────────┬──────┤                     │
│            │Rates   │Orders  │Admin │                     │
│            │API     │API     │API   │                     │
│            └───┬────┴───┬────┴──┬───┘                     │
│                │        │       │                         │
│  ┌─────────┐  │  ┌─────┴────┐  │  ┌─────────┐           │
│  │Fetchers │  │  │ Order    │  │  │ SQLite  │           │
│  │Bybit    │  │  │ Manager  │  │  │ DB      │           │
│  │Binance  │  │  │          │  │  │         │           │
│  │OKX      │  │  │Puppeteer │  │  │ Auth    │           │
│  └─────────┘  │  │Trader    │  │  │ Encrypt │           │
│               │  └──────────┘  │  └─────────┘           │
│               │                │                         │
│  外部接続:     │                │                         │
│  Bybit API ───┘    Account ───┘                          │
│  Binance API       Router                                │
│  OKX API           (port 3002)                           │
│  CoinGecko API                                           │
│  ngrok (外部公開)                                         │
└──────────────────────────────────────────────────────────┘
```

## 3. 画面一覧

| パス | 名称 | 認証 | 説明 |
|------|------|------|------|
| `/` | P2Pダッシュボード | 不要 | リアルタイムレート比較、アービトラージ監視 |
| `/pay.html` | BK Pay | 不要 | 顧客向け入金ページ（4ステップウィザード） |
| `/admin.html` | 管理画面 | **必要** | 注文管理、口座管理、電子決済/API/ウォレット設定 |
| `/login.html` | ログイン | 不要 | 管理画面の認証ページ |
| `/guide.html` | 利用ガイド | 不要 | 顧客向けのBK Pay使い方説明 |

## 4. 技術スタック

| レイヤー | 技術 |
|---------|------|
| ランタイム | Node.js v25+ / tsx（TypeScript直接実行） |
| サーバー | Express.js |
| データベース | SQLite（better-sqlite3）/ WALモード |
| フロントエンド | Vanilla HTML/CSS/JS（フレームワークなし） |
| 認証 | Cookie（HttpOnly）+ SHA-256ハッシュ |
| 暗号化 | AES-256-CBC（API認証情報の保護） |
| 外部公開 | ngrok |
| 自動取引 | Puppeteer（フレームワーク済、未稼働） |

## 5. ディレクトリ構成

```
bk-p2p-aggregator/
├── docs/                    # 本ドキュメント群
├── data/
│   └── bkpay.db             # SQLiteデータベース
├── public/                  # フロントエンド（静的ファイル）
│   ├── index.html           # P2Pダッシュボード
│   ├── pay.html             # BK Pay決済ページ
│   ├── admin.html           # 管理画面
│   ├── login.html           # ログインページ
│   ├── guide.html           # 利用ガイド
│   ├── style.css            # ダッシュボード用CSS
│   ├── app.js               # ダッシュボード用JS
│   └── i18n.js              # 多言語対応（日/英）
├── src/                     # バックエンド（TypeScript）
│   ├── index.ts             # エントリーポイント、Express設定、認証
│   ├── config.ts            # システム設定
│   ├── types.ts             # 型定義
│   ├── routes/
│   │   └── api.ts           # APIルーター
│   ├── fetchers/
│   │   ├── bybit.ts         # Bybit P2P API
│   │   ├── binance.ts       # Binance P2P API
│   │   ├── okx.ts           # OKX P2P API
│   │   └── htx.ts           # HTX（無効: JPY非対応）
│   ├── services/
│   │   ├── aggregator.ts    # レート集約・乖離率フィルター
│   │   ├── arbitrage.ts     # アービトラージ検出
│   │   ├── spot.ts          # スポットレート取得（CoinGecko）
│   │   ├── orderManager.ts  # 注文管理
│   │   ├── database.ts      # DB操作、認証、暗号化
│   │   └── puppeteerTrader.ts # 自動取引フレームワーク
│   └── middleware/
│       └── auth.ts          # 認証ミドルウェア
├── package.json
└── tsconfig.json
```
