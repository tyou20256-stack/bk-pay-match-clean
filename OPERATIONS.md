# BK Pay Match — 運用手順書

> バージョン: 2025-03 / ポート: 3003

---

## 目次

1. [システム概要](#1-システム概要)
2. [初期セットアップ](#2-初期セットアップ)
3. [起動・停止](#3-起動停止)
4. [管理者操作](#4-管理者操作)
5. [P2Pセラー操作](#5-p2pセラー操作)
6. [バイヤー（顧客）フロー](#6-バイヤー顧客フロー)
7. [日常運用](#7-日常運用)
8. [トラブルシューティング](#8-トラブルシューティング)
9. [環境変数リファレンス](#9-環境変数リファレンス)

---

## 1. システム概要

```
バイヤー（JPY払い） ──→ Pay Match サーバー ──→ P2Pセラー（USDT保有者）
  PayPay/LINE Pay/au PAY          |           PayPayで受取
                                  |
                                  └──→ USDT 自動送金（TRC-20）
                                         バイヤーのウォレットへ
```

### 主要ページ

| URL | 説明 | 認証 |
|-----|------|------|
| `/` → `/admin.html` | 管理者ダッシュボード | 管理者セッション |
| `/login.html` | 管理者ログイン | - |
| `/pay.html` | バイヤー決済ページ | - |
| `/seller-register.html` | セラー新規登録 | - |
| `/seller-dashboard.html` | セラーダッシュボード | セラートークン |
| `/seller-confirm.html` | 入金確認ページ | セラートークン |
| `/guide.html` | 利用ガイド | - |

---

## 2. 初期セットアップ

### 2-1. `.env` 設定

`.env` を開き、必要な値を設定します。

```bash
# === 基本設定（必須） ===
BK_ADMIN_PASSWORD=強固なパスワードに変更すること   # 管理者ログインパスワード
PORT=3003

# === 暗号化キー（必須） ===
BK_ENC_KEY=32文字のランダム文字列                # 例: openssl rand -hex 16

# === TRON/USDT 送金（USDT自動送金を使う場合） ===
TRON_WALLET_PRIVATE_KEY=TRONウォレットの秘密鍵
TRONGRID_API_KEY=TronGridのAPIキー               # https://www.trongrid.io

# === Telegram 通知（任意） ===
ENABLE_NOTIFIER=true                             # true にすると有効
TELEGRAM_BOT_TOKEN=BotFatherで発行したトークン
TELEGRAM_STAFF_CHAT_ID=スタッフのチャットID

# === サーバー URL（セラー確認URLに使用） ===
BASE_URL=https://yourdomain.com                  # 本番ではドメインを設定
```

> **BK_ENC_KEY の生成方法（Bash）:**
> ```bash
> openssl rand -hex 16
> ```

### 2-2. ビルド

```bash
cd /path/to/bk-pay-match
npm install          # 初回のみ
npm run build        # TypeScript → dist/ にコンパイル
```

### 2-3. 管理者アカウント確認

初回起動時、`BK_ADMIN_PASSWORD` の値がデフォルト管理者のパスワードになります。
ログイン後すぐに「パスワード変更」を実施してください（8文字以上、英数字混在）。

---

## 3. 起動・停止

### 通常起動（開発・テスト）

```bash
bash start.sh
```

### PM2 で本番運用（推奨）

```bash
# PM2 インストール（未導入の場合）
npm install -g pm2

# 起動
pm2 start ecosystem.config.js

# ステータス確認
pm2 status

# ログ確認
pm2 logs bk-pay-match

# 再起動
pm2 restart bk-pay-match

# 停止
pm2 stop bk-pay-match

# OS起動時に自動起動
pm2 startup
pm2 save
```

ログは `logs/out.log`（標準出力）と `logs/error.log`（エラー）に出力されます。

```bash
mkdir -p logs   # 初回のみ
```

---

## 4. 管理者操作

### 4-1. ログイン

1. `http://localhost:3003/login.html` を開く
2. ユーザー名: `admin`（デフォルト）
3. パスワード: `.env` の `BK_ADMIN_PASSWORD`

### 4-2. 注文管理（Ordersタブ）

| ボタン | 動作 | タイミング |
|--------|------|-----------|
| 承認 | `pending_payment` → `confirming` | バイヤーの振込報告を受け付け |
| 入金確認 | `confirming` → `payment_verified` | 実際の入金を確認したとき |
| USDT送金 | USDT自動送金を実行 | TRON_WALLET_PRIVATE_KEY 設定済みの場合 |
| 手動完了 | 管理者が手動でTXIDを入力して完了 | ウォレット外で送金した場合 |
| 却下 | 注文をキャンセル | |

**P2P注文の場合:** バイヤーが振込報告 → セラーが入金確認（`/seller-confirm.html`）→ USDT自動送金の流れになるため、管理者の「入金確認」ボタンは不要です。

### 4-3. P2Pセラー管理（P2Pセラータブ）

#### セラー承認
1. 登録されたセラーが「承認待ち」で表示される
2. 「承認」ボタンをクリックでステータスが `active` に変更
3. `active` のセラーのみ注文マッチングに参加

#### 残高付与（USDTデポジット）
セラーが運営口座にUSDTを送金した後、管理者が残高を付与します:
1. 対象セラーの「残高付与」ボタンをクリック
2. 付与するUSDT量を入力して実行

> **現在の設計:** セラーが物理的にUSDTを送金してきた量を手動で残高に反映させます。将来的にはTRON監視（tronMonitor）で自動検出も可能です。

#### 確認URL発行
1. セラー行の「🔗URL」ボタンをクリックでクリップボードにコピー
2. URL形式: `/seller-confirm.html?orderId=ORDER_ID&token=SELLER_TOKEN`
3. `ORDER_ID` 部分を実際の注文IDに置換してセラーに送付
   ※ Telegram通知が有効なセラーには自動送信されます

### 4-4. ユーザー管理・権限（管理タブ）

ロール一覧:
- `admin` — 全操作可能
- `trader` — 注文・レート閲覧
- `operator` — 注文操作
- `viewer` — 閲覧のみ

---

## 5. P2Pセラー操作

### 5-1. セラー登録

1. `http://localhost:3003/seller-register.html` を開く
2. 必要事項を入力:
   - お名前・メール・パスワード（8文字以上）
   - PayPay ID / LINE Pay ID / au PAY ID（最低1つ）
   - 最低/最高注文金額（JPY）
3. 「登録申請する」をクリック
4. 管理者の承認後に取引可能になります

### 5-2. セラーダッシュボード

1. `http://localhost:3003/seller-dashboard.html` を開く
2. 登録時のメール・パスワードでログイン
3. ダッシュボードで確認できる内容:
   - **利用可能残高**: 取引に使えるUSDT量
   - **ロック中**: 進行中の注文でロックされているUSDT
   - **累計取引数**: 完了した取引の件数
   - **確認ページURL**: 入金確認用のURL（コピーボタンあり）
   - **注文履歴**: 直近50件の取引

### 5-3. 入金確認フロー

バイヤーが振込完了を報告すると:

1. **Telegram通知**（`telegram_chat_id` 設定済みの場合）
   確認URLが記載されたメッセージが届きます

2. **確認ページアクセス**
   `/seller-confirm.html?orderId=ORD-xxx&token=YOUR_TOKEN`
   （ダッシュボードからもURLをコピーしてorderId部分を置換）

3. **入金確認ボタンを押す**
   → ステータスが `payment_verified` に変更
   → システムが自動でバイヤーのウォレットにUSDTを送金
   → セラーの残高から自動的に減算

### 5-4. セラーの Telegram 通知設定

管理画面でセラーの `telegram_chat_id` を設定することで、入金確認依頼が届くようになります:

```bash
curl -X PUT http://localhost:3003/api/p2p/sellers/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: bkpay_token=ADMIN_TOKEN" \
  -d '{"telegramChatId": "123456789"}'
```

セラー自身の Telegram Chat ID 確認方法: `@userinfobot` に `/start` を送信

---

## 6. バイヤー（顧客）フロー

1. `/pay.html` を開く
2. 金額・暗号資産・支払方法・ウォレットアドレスを入力
3. 「レートを確認」→「注文する」をクリック
4. **P2Pマッチ時:** セラーのPayPay IDが表示される → 指定口座に振込
5. **銀行振込時:** 口座情報が表示される → 振込
6. 振込後「振込完了を報告する」をクリック
7. 確認後、ウォレットにUSDTが届く（通常数分以内）

---

## 7. 日常運用

### バックアップ

```bash
# 手動バックアップ
bash scripts/backup.sh

# cronで自動バックアップ（6時間ごと）
crontab -e
# 以下を追記:
0 */6 * * * /path/to/bk-pay-match/scripts/backup.sh >> /path/to/bk-pay-match/logs/backup.log 2>&1
```

バックアップファイルは `backups/bkpay_YYYYMMDD_HHMMSS.db` に保存されます（最新30件を保持）。

### DBのリストア

```bash
# サーバーを停止
pm2 stop bk-pay-match

# バックアップをリストア
cp backups/bkpay_20250301_060000.db bkpay.db

# 再起動
pm2 start bk-pay-match
```

### ログ確認

```bash
# リアルタイムログ（PM2）
pm2 logs bk-pay-match

# 出力ログ
tail -f logs/out.log

# エラーログ
tail -f logs/error.log
```

### レート更新間隔

`.env` または `config.ts` で設定（デフォルト: 30秒）。
Bybit / Binance / OKX の P2P レートを定期取得しています。

---

## 8. トラブルシューティング

### サーバーが起動しない

```bash
# ポートが使用中か確認
netstat -an | grep 3003

# .env が正しく読み込まれているか確認
bash -c 'set -a; source .env; set +a; echo $PORT'

# ビルドが最新か確認
npm run build
```

### USDT送金が失敗する

1. **ウォレット残高不足**: `TRON_WALLET_PRIVATE_KEY` のウォレットにTRX（手数料用）とUSDTがあるか確認
2. **秘密鍵未設定**: `.env` の `TRON_WALLET_PRIVATE_KEY` を確認
3. **ネットワークエラー**: TronGrid APIキーの残量を確認（https://www.trongrid.io）
4. 失敗時はステータスが `payment_verified` に戻るので、管理画面から手動再試行可能

送金は3回自動リトライ（2秒・4秒間隔）されます。

### P2Pマッチングが起きない

以下を確認:
- セラーのステータスが `active`
- 注文金額がセラーの `min_amount` ～ `max_amount` 範囲内
- セラーの利用可能残高（`usdt_balance - usdt_locked`）≥ 必要USDT量
- セラーの支払方法に注文の支払方法が含まれる

```bash
# セラー一覧確認（管理画面 P2Pセラータブ、またはAPI）
curl -s http://localhost:3003/api/p2p/sellers -H "Cookie: bkpay_token=TOKEN"
```

### セラーに通知が届かない

1. `ENABLE_NOTIFIER=true` になっているか確認
2. `TELEGRAM_BOT_TOKEN` が正しいか確認（`@BotFather` で発行）
3. セラーの `telegram_chat_id` が設定されているか確認
4. セラーがボットを **ブロックしていないか** 確認
5. セラーがボットに `/start` を送信済みか確認

### ロック残高がおかしい

期限切れ注文でロックが残った場合（稀なケース）、管理者が直接APIで残高をリセット可能:

```bash
curl -X PUT http://localhost:3003/api/p2p/sellers/SELLER_ID \
  -H "Content-Type: application/json" \
  -H "Cookie: bkpay_token=TOKEN" \
  -d '{"name": "セラー名"}'
# → updateP2PSeller を通じて直接DB値をリセット（現時点ではDBを直接操作）
```

---

## 9. 環境変数リファレンス

| 変数名 | 必須 | 説明 | デフォルト |
|--------|------|------|-----------|
| `BK_ADMIN_PASSWORD` | ✅ | 管理者ログインパスワード | `bkpay2026` |
| `PORT` | - | サーバーポート | `3003` |
| `BK_ENC_KEY` | ✅ | 取引所認証情報の暗号化キー（32文字） | *(未設定)* |
| `TRON_WALLET_PRIVATE_KEY` | USDT送金時 | TRONウォレット秘密鍵 | *(未設定)* |
| `TRONGRID_API_KEY` | USDT送金時 | TronGrid API キー | *(未設定)* |
| `BASE_URL` | - | セラー確認URL生成に使用 | `http://localhost:3003` |
| `ENABLE_NOTIFIER` | - | Telegram通知の有効化 | `false` |
| `TELEGRAM_BOT_TOKEN` | 通知時 | Telegram Bot トークン | *(未設定)* |
| `TELEGRAM_STAFF_CHAT_ID` | 通知時 | スタッフのチャットID | *(未設定)* |
| `ENABLE_TELEGRAM_BOT` | - | インタラクティブBotの有効化 | `false` |
| `ENABLE_ALERTS` | - | レートアラートの有効化 | `false` |
| `ENABLE_NOTIFICATIONS` | - | 価格通知の有効化 | `false` |
| `SSL_CERT_PATH` | HTTPS時 | SSL証明書パス | *(未設定)* |
| `SSL_KEY_PATH` | HTTPS時 | SSL秘密鍵パス | *(未設定)* |
| `ANTHROPIC_API_KEY` | AIチャット時 | Claude API キー | *(設定済み)* |

---

## セキュリティチェックリスト

本番環境に移行する前に確認してください:

- [ ] `BK_ADMIN_PASSWORD` をデフォルトから変更済み
- [ ] `BK_ENC_KEY` を32文字のランダム値に設定済み
- [ ] `.env` ファイルのパーミッションを制限 (`chmod 600 .env`)
- [ ] SSL/HTTPS を設定済み（`SSL_CERT_PATH` / `SSL_KEY_PATH`）
- [ ] `BASE_URL` を本番ドメインに設定済み
- [ ] ファイアウォールでポート3003は必要な送信元のみ許可
- [ ] 管理者ログイン後すぐにパスワード変更を実施
- [ ] バックアップのcronジョブを設定済み
