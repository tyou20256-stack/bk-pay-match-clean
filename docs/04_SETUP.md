# BK P2P System — 環境構築手順書

## 前提条件

| ソフトウェア | バージョン | 用途 |
|------------|-----------|------|
| Node.js | v20以上（推奨 v25） | ランタイム |
| npm | v9以上 | パッケージ管理 |
| Git | 最新 | バージョン管理 |
| ngrok | v3（任意） | 外部公開 |

## セットアップ手順

### 1. リポジトリクローン

```bash
git clone https://github.com/BKStock/bk-p2p-aggregator.git
cd bk-p2p-aggregator
```

### 2. 依存パッケージインストール

```bash
npm install
```

主要パッケージ:
- `express` — HTTPサーバー
- `better-sqlite3` — SQLiteドライバ
- `tsx` — TypeScript直接実行
- `cookie-parser` — Cookie解析
- `puppeteer` — ブラウザ自動化（自動取引用）

### 3. 起動

```bash
npx tsx src/index.ts
```

出力例:
```
[DB] Default admin created: admin / bkpay2026
🚀 BK P2P Aggregator starting...
📡 Exchanges: Bybit, Binance, OKX
💱 Cryptos: USDT, BTC, ETH
🔄 Update interval: 30s
✅ Dashboard: http://localhost:3003
```

### 4. アクセス確認

- P2Pダッシュボード: http://localhost:3003
- BK Pay: http://localhost:3003/pay.html
- 管理画面: http://localhost:3003/admin.html
  - 初期アカウント: `admin` / `bkpay2026`

---

## 環境変数

| 変数 | デフォルト | 説明 |
|------|----------|------|
| BK_ENC_KEY | (内蔵デフォルト) | 取引所認証情報の暗号化キー（32文字） |
| PORT | 3003 | サーバーポート（※config.tsで設定） |

**本番では必ず `BK_ENC_KEY` を独自の値に変更してください。**

```bash
BK_ENC_KEY="your-32-character-secret-key-here" npx tsx src/index.ts
```

---

## 設定ファイル

### src/config.ts

```typescript
export const CONFIG = {
  port: 3003,                    // サーバーポート
  updateIntervalMs: 30000,       // レート更新間隔（ms）
  cryptos: ['USDT', 'BTC', 'ETH'],  // 対象暗号通貨
  fiat: 'JPY',                  // 対象法定通貨
  maxOrdersPerExchange: 15,     // 取引所あたり最大オーダー取得数
  requestTimeout: 10000,        // 外部API タイムアウト（ms）
  arbitrageThreshold: 0.5,      // アービトラージ検出閾値（%）
  maxDeviationPct: 15,          // スポットからの最大乖離率（%）
};
```

---

## 外部公開（ngrok）

### 初回設定

```bash
# ngrokインストール
brew install ngrok

# Auth token設定（https://dashboard.ngrok.com で取得）
ngrok config add-authtoken YOUR_TOKEN_HERE

# トンネル起動
ngrok http 3003
```

### バックグラウンド起動

```bash
ngrok http 3003 --log=stdout > /tmp/ngrok.log 2>&1 &

# URLを確認
grep -o 'url=https://[^ ]*' /tmp/ngrok.log
```

---

## Account Router連携（任意）

BK Payの自社決済モード（SELF MODE）で銀行口座を自動割当するために、Account Routerが必要です。

```bash
# 別ターミナルで起動
cd ~/remote-workspace/bk-account-router
node server.js
# → Port 3002で起動
```

Account Routerが起動していない場合、orderManager.tsのフォールバック口座が使用されます。

---

## プロセス管理（本番推奨）

### systemd（Linux）

```ini
[Unit]
Description=BK P2P Aggregator
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/bk-p2p-aggregator
ExecStart=/usr/bin/npx tsx src/index.ts
Environment=BK_ENC_KEY=your-secret-key
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### launchd（macOS）

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bkstock.p2p-aggregator</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npx</string>
        <string>tsx</string>
        <string>src/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/bk-p2p-aggregator</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>BK_ENC_KEY</key>
        <string>your-secret-key</string>
    </dict>
</dict>
</plist>
```

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| レートが0件 | 起動直後（30秒待ち） | 30秒後にリロード |
| Binanceのデータなし | IP制限（日本からブロック） | VPN使用 or 除外 |
| HTXレートが異常 | currency=11はRUB（JPYではない） | HTXは無効化済み |
| admin.htmlが403 | 未ログイン | /login.html でログイン |
| DBファイルがない | 初回起動前 | 起動時に自動作成 |
| ngrok接続エラー | Auth token未設定 | `ngrok config add-authtoken` |
