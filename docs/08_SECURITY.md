# BK P2P System — セキュリティ設計書

## 1. 認証

### 方式
- **Cookie認証:** `bkpay_token`（HttpOnly, SameSite=Lax）
- **代替:** `Authorization: Bearer <token>` ヘッダー
- **セッション有効期間:** 24時間
- **トークン:** 32バイトランダム（crypto.randomBytes）→ 64文字hex

### パスワードハッシュ
```
SHA-256(password + 'bkpay-salt')
```

### 改善推奨事項
- [ ] SHA-256 → bcrypt / argon2 に変更（ブルートフォース耐性向上）
- [ ] レート制限（ログイン試行回数制限）の追加
- [ ] CSRF トークンの追加
- [ ] セッションの強制無効化機能（管理者が他のセッションを切断）

---

## 2. 暗号化

### 対象フィールド

| テーブル | カラム | 方式 |
|---------|--------|------|
| exchange_credentials | password_enc | AES-256-CBC |
| exchange_credentials | api_secret_enc | AES-256-CBC |
| exchange_credentials | totp_secret_enc | AES-256-CBC |
| exchange_credentials | passphrase_enc | AES-256-CBC |

### 暗号化仕様
- **アルゴリズム:** AES-256-CBC
- **キー:** 環境変数 `BK_ENC_KEY`（32バイト、不足時はpadEnd(32)で補完）
- **IV:** 16バイトランダム（各暗号化で新規生成）
- **保存形式:** `iv_hex:encrypted_hex`

### 改善推奨事項
- [ ] デフォルト暗号化キーの使用禁止（起動時チェック）
- [ ] キーローテーション機能
- [ ] 暗号化キーのHSM/Vault管理

---

## 3. アクセス制御

### 公開/保護の境界

```
公開（認証不要）
├── / (index.html)          — P2Pダッシュボード
├── /pay.html               — 決済ページ
├── /guide.html             — 利用ガイド
├── /login.html             — ログインページ
├── GET /api/rates/*        — レートAPI
├── GET /api/best           — ベストレート
├── GET /api/spread         — スプレッド
├── GET /api/arbitrage      — アービトラージ
├── GET /api/status         — ステータス
├── POST /api/orders        — 注文作成（顧客用）
├── GET /api/orders/:id     — 注文確認（顧客用）
├── POST /api/orders/:id/paid   — 振込完了報告
├── POST /api/orders/:id/cancel — キャンセル
└── POST /api/auth/login    — ログイン

保護（認証必須）
├── /admin.html             — 管理画面（リダイレクト制御）
├── GET /api/orders         — 全注文一覧
├── /api/accounts/*         — 口座管理
├── /api/epay/*             — 電子決済設定
├── /api/trader/*           — 取引所API
├── /api/wallet/*           — ウォレット
└── /api/settings/*         — 設定
```

### 改善推奨事項
- [ ] 注文APIにレート制限（DoS防止）
- [ ] 注文IDの推測困難性の検証
- [ ] IP制限（管理画面を特定IPのみに制限）
- [ ] WAF（Web Application Firewall）の導入

---

## 4. データ保護

### 保存データ分類

| データ | 機密度 | 保護方式 |
|-------|-------|---------|
| 注文情報 | 中 | DB保存（平文） |
| 銀行口座情報 | 高 | DB保存（平文）※暗号化推奨 |
| 取引所パスワード | 最高 | DB保存（AES-256暗号化） |
| 取引所APIキー | 高 | DB保存（平文）※暗号化推奨 |
| ウォレットアドレス | 中 | DB保存（平文） |
| 管理者パスワード | 最高 | SHA-256ハッシュ |

### 改善推奨事項
- [ ] 銀行口座番号の暗号化
- [ ] APIキーの暗号化
- [ ] DB暗号化（SQLCipher）
- [ ] バックアップの暗号化

---

## 5. 通信セキュリティ

### 現状
- **内部:** HTTP（localhost:3003）
- **外部:** HTTPS（ngrok経由）

### 改善推奨事項
- [ ] 本番環境ではngrokではなくリバースプロキシ+SSL証明書
- [ ] HSTS ヘッダーの追加
- [ ] Content-Security-Policy ヘッダー
- [ ] X-Frame-Options: DENY

---

## 6. 既知のリスク

| リスク | 深刻度 | 状態 | 対策 |
|-------|-------|------|------|
| デフォルト管理者パスワード | 高 | 初期状態で admin/bkpay2026 | 初回ログイン時に変更を強制 |
| デフォルト暗号化キー | 高 | BK_ENC_KEY未設定時にデフォルト使用 | 起動時警告 or 拒否 |
| SHA-256パスワードハッシュ | 中 | ソルトが固定値 | bcrypt/argon2に移行 |
| 注文APIにレート制限なし | 中 | DoS攻撃の可能性 | express-rate-limit導入 |
| SQLiteファイルが平文 | 中 | DBファイルへの直接アクセスで全データ閲覧可能 | SQLCipher or ファイル暗号化 |
| フォールバック口座がハードコード | 低 | orderManager.tsに銀行情報が直書き | DB/設定ファイルに移行 |

---

## 7. 本番デプロイ前チェックリスト

- [ ] 管理者パスワードを変更
- [ ] `BK_ENC_KEY` を独自の32文字に設定
- [ ] ngrok → 本番用ドメイン+SSL に移行
- [ ] express-rate-limit を追加
- [ ] セキュリティヘッダーを追加（helmet.js）
- [ ] フォールバック口座のハードコードを削除
- [ ] DBの定期バックアップ設定
- [ ] ログ出力の設定（アクセスログ、エラーログ）
- [ ] 不要なAPIエンドポイントの無効化
