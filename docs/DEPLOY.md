## bk-pay-match 本番デプロイ手順

### 前提条件
- Hetzner CPX11（シンガポール）契約済み
- ドメイン取得済み + DNS Aレコード設定済み
- GitHubリポジトリへのアクセス権あり

---

### ステップ1: サーバー初期セットアップ

ローカルPCからサーバーにSSH接続してセットアップスクリプトを実行する。

```bash
# ローカルPCで実行（IPはHetznerコンソールで確認）
ssh root@YOUR_SERVER_IP 'bash -s' < scripts/setup-server.sh
```

インストールされるもの:
- Docker + Docker Compose
- Caddy（SSL自動取得）
- UFW（ファイアウォール: 22, 80, 443のみ開放）
- fail2ban（SSH brute-force対策）

---

### ステップ2: リポジトリ配置

```bash
ssh root@YOUR_SERVER_IP

# サーバー上で
cd /opt/bk-pay-match
git clone https://github.com/YOUR_ORG/bk-pay-match.git .
```

**プライベートリポジトリの場合:**
```bash
# ① サーバー上でSSHキー生成
ssh-keygen -t ed25519 -C "bk-pay-match-deploy"

# ② 公開鍵をGitHub → リポジトリ → Settings → Deploy keys に追加
cat ~/.ssh/id_ed25519.pub

# ③ SSHでクローン
git clone git@github.com:YOUR_ORG/bk-pay-match.git .
```

---

### ステップ3: .env 設定

```bash
cp .env.production .env
nano .env
```

**最低限書き換える項目:**

| 変数 | 書き換え内容 |
|------|------------|
| `BASE_URL` | `https://yourdomain.com` に変更 |
| `BK_ADMIN_PASSWORD` | （生成済みだが、必要なら変更） |

**任意の追加設定:**

| 変数 | 用途 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram通知を使う場合 |
| `TELEGRAM_STAFF_CHAT_ID` | 同上 |
| `ENABLE_NOTIFIER` | `true` に変更 |
| `TRON_WALLET_PRIVATE_KEY` | USDT自動送金を使う場合 |
| `ANTHROPIC_API_KEY` | AIチャットを使う場合 |

---

### ステップ4: デプロイ実行

```bash
bash scripts/deploy.sh
```

このスクリプトが自動で行うこと:
1. `.env` の必須項目チェック
2. Caddyfileにドメインを設定 → Caddy再起動（SSL自動取得）
3. `docker compose up -d --build`
4. ヘルスチェック

---

### ステップ5: 動作確認

```bash
# ヘルスチェック
curl https://yourdomain.com/health

# ログ確認
docker compose logs -f

# 管理画面にアクセス
# ブラウザで https://yourdomain.com を開く
# ユーザー名: admin
# パスワード: .env の BK_ADMIN_PASSWORD
```

初回ログイン後、管理画面からMFA（二要素認証）を設定すること。

---

### 運用コマンド

```bash
# ログ確認
docker compose logs -f
docker compose logs --tail 100

# 再起動
docker compose restart

# 停止
docker compose down

# コード更新 → 再デプロイ
cd /opt/bk-pay-match
git pull
docker compose up -d --build

# バックアップ（SQLiteデータ）
docker compose exec app cp /app/data/bkpay.db /app/backups/bkpay_$(date +%Y%m%d).db
```

---

### トラブルシューティング

| 症状 | 対処 |
|------|------|
| HTTPS でアクセスできない | DNS Aレコード確認 → `caddy validate` → `systemctl restart caddy` |
| コンテナが起動しない | `docker compose logs --tail 50` でエラー確認 |
| ポート3003に外部からアクセス不可 | 正常（UFWで意図的にブロック、Caddy経由のみ） |
| ディスク容量不足 | `docker system prune -f` で未使用イメージ削除 |
| SSL証明書エラー | Caddyが自動更新するため通常発生しない。`systemctl status caddy` 確認 |

---

### セキュリティチェックリスト

- [ ] `BK_ADMIN_PASSWORD` をデフォルトから変更した
- [ ] MFA（二要素認証）を設定した
- [ ] `.env` ファイルのパーミッション確認: `chmod 600 .env`
- [ ] SSH鍵認証のみ（パスワード認証無効化）
- [ ] UFW有効（22, 80, 443のみ）
- [ ] fail2ban稼働中
