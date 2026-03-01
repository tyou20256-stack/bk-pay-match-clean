# BK P2P System — DB設計書

## 概要

- **エンジン:** SQLite 3（better-sqlite3 v11）
- **ファイル:** `data/bkpay.db`
- **ジャーナルモード:** WAL（Write-Ahead Logging）
- **外部キー:** 有効

---

## テーブル定義

### orders（注文）

| カラム | 型 | 制約 | 説明 |
|-------|-----|------|------|
| id | TEXT | PRIMARY KEY | 注文ID（例: ORD-MM7A15RO-Y4JU） |
| mode | TEXT | NOT NULL DEFAULT 'auto' | auto / self |
| status | TEXT | NOT NULL DEFAULT 'matching' | 注文ステータス |
| amount | INTEGER | NOT NULL | 日本円金額 |
| crypto | TEXT | NOT NULL DEFAULT 'USDT' | 暗号通貨種別 |
| crypto_amount | REAL | DEFAULT 0 | 暗号通貨数量 |
| rate | REAL | DEFAULT 0 | 適用レート（JPY/crypto） |
| pay_method | TEXT | NOT NULL DEFAULT 'bank' | 支払方法 |
| exchange | TEXT | | 取引所名 or 'BK Pay（自社決済）' |
| merchant_name | TEXT | | マーチャント名 |
| merchant_completion_rate | REAL | | マーチャント完了率 |
| payment_info | TEXT | | 振込先情報（JSON） |
| created_at | INTEGER | NOT NULL | 作成日時（Unix ms） |
| expires_at | INTEGER | NOT NULL | 有効期限（Unix ms） |
| paid_at | INTEGER | | 振込完了報告日時 |
| completed_at | INTEGER | | 注文完了日時 |

**payment_info JSON構造（bank）:**
```json
{
  "type": "bank",
  "bankName": "みずほ銀行",
  "branchName": "渋谷支店",
  "accountType": "普通",
  "accountNumber": "3058271",
  "accountHolder": "タナカ タロウ",
  "amount": 50000
}
```

**payment_info JSON構造（電子決済）:**
```json
{
  "type": "paypay",
  "payId": "bkstock-pay",
  "qrUrl": "/img/paypay-qr.png",
  "amount": 50000
}
```

### bank_accounts（銀行口座）

| カラム | 型 | 制約 | 説明 |
|-------|-----|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| bank_name | TEXT | NOT NULL | 銀行名 |
| branch_name | TEXT | NOT NULL | 支店名 |
| account_type | TEXT | NOT NULL DEFAULT '普通' | 普通 / 当座 |
| account_number | TEXT | NOT NULL | 口座番号 |
| account_holder | TEXT | NOT NULL | 口座名義（カタカナ） |
| daily_limit | INTEGER | DEFAULT 3000000 | 1日の上限額（円） |
| used_today | INTEGER | DEFAULT 0 | 今日の使用額 |
| used_today_date | TEXT | | 使用額の日付（YYYY-MM-DD） |
| priority | TEXT | DEFAULT 'medium' | high / medium / low |
| status | TEXT | DEFAULT 'active' | active / rest / frozen |
| memo | TEXT | | メモ |
| created_at | INTEGER | | 作成日時（Unix ms） |

**口座選定ロジック（getRoutableAccount）:**
1. `used_today_date` が今日でなければ `used_today` をリセット
2. `status = 'active'` かつ `used_today + amount <= daily_limit` の口座を検索
3. `priority` 高い順 → `used_today` 少ない順でソート
4. 選定した口座の `used_today` を加算

### epay_config（電子決済設定）

| カラム | 型 | 制約 | 説明 |
|-------|-----|------|------|
| type | TEXT | PRIMARY KEY | paypay / linepay / aupay |
| pay_id | TEXT | | 決済ID |
| display_name | TEXT | | 表示名 |
| qr_image | TEXT | | QRコード画像（Base64） |
| link_url | TEXT | | 送金リンクURL |
| updated_at | INTEGER | | 更新日時 |

### exchange_credentials（取引所認証情報）

| カラム | 型 | 制約 | 説明 |
|-------|-----|------|------|
| exchange | TEXT | PRIMARY KEY | Bybit / OKX |
| email | TEXT | | メールアドレス |
| password_enc | TEXT | | パスワード（AES-256暗号化） |
| api_key | TEXT | | APIキー（平文） |
| api_secret_enc | TEXT | | APIシークレット（暗号化） |
| totp_secret_enc | TEXT | | 2FA TOTPシークレット（暗号化） |
| passphrase_enc | TEXT | | パスフレーズ（暗号化、OKX用） |
| updated_at | INTEGER | | 更新日時 |

**暗号化:** AES-256-CBC、IVはランダム生成、`iv_hex:encrypted_hex` 形式で保存。
暗号化キーは環境変数 `BK_ENC_KEY` で設定（未設定時はデフォルトキー使用）。

### wallet_config（ウォレット設定）

| カラム | 型 | 制約 | 説明 |
|-------|-----|------|------|
| id | INTEGER | PRIMARY KEY DEFAULT 1 | 常に1（1レコード） |
| address | TEXT | | TRONアドレス |
| label | TEXT | | ラベル |
| network | TEXT | DEFAULT 'TRC-20' | ネットワーク |
| updated_at | INTEGER | | 更新日時 |

### settings（設定）

| カラム | 型 | 制約 | 説明 |
|-------|-----|------|------|
| key | TEXT | PRIMARY KEY | 設定キー |
| value | TEXT | | 設定値 |

**現在のキー:**
- `minCompletion` — 最低完了率（%）
- `orderTimeout` — 注文タイムアウト（分）
- `minAmount` — 最低注文額（円）
- `maxAmount` — 最大注文額（円）
- `onlineOnly` — オンラインのみマッチング（yes/no）
- `fallbackMode` — フォールバック（self/reject）

### admin_users（管理ユーザー）

| カラム | 型 | 制約 | 説明 |
|-------|-----|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| username | TEXT | UNIQUE NOT NULL | ユーザー名 |
| password_hash | TEXT | NOT NULL | SHA-256ハッシュ |
| created_at | INTEGER | | 作成日時 |

**ハッシュ:** `SHA-256(password + 'bkpay-salt')`

### sessions（セッション）

| カラム | 型 | 制約 | 説明 |
|-------|-----|------|------|
| token | TEXT | PRIMARY KEY | セッショントークン（64文字hex） |
| user_id | INTEGER | NOT NULL, FK → admin_users.id | |
| expires_at | INTEGER | NOT NULL | 有効期限（Unix ms） |

**自動クリーンアップ:** 1時間ごとに期限切れセッションを削除。

---

## ER図

```
admin_users 1──N sessions
                 
orders（独立）
bank_accounts（独立）
epay_config（独立）
exchange_credentials（独立）
wallet_config（独立、1レコード）
settings（独立、KVS）
```

---

## データライフサイクル

### 注文
```
作成（createOrder）→ DBにINSERT
  → ステータス変更（markPaid/cancelOrder）→ UPDATE
  → 15分で expired → UPDATE（※現在はメモリ内のみ。要改善）
```

### 口座の日次リセット
```
getRoutableAccount() 呼び出し時:
  used_today_date ≠ 今日 → used_today = 0, used_today_date = 今日
```
