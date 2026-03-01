# BK P2P System — 本番デプロイ手順書

## 1. 前提条件

- Linux VPS（Ubuntu 22.04+推奨）またはmacOS
- Node.js v20以上
- ドメイン名（例: pay.bkstock.com）
- SSL証明書（Let's Encrypt推奨）

---

## 2. サーバーセットアップ

### 2.1 Node.jsインストール
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2.2 アプリケーション配置
```bash
git clone https://github.com/BKStock/bk-p2p-aggregator.git /opt/bkpay
cd /opt/bkpay
npm install --production
```

### 2.3 環境変数設定
```bash
sudo vi /opt/bkpay/.env
```

```env
BK_ENC_KEY=your-32-character-secret-key-here
NODE_ENV=production
TRONGRID_API_KEY=your-trongrid-api-key
```

---

## 3. セキュリティ設定

### 3.1 初期パスワード変更
```bash
# 起動後すぐに実行
curl -s -X POST http://localhost:3003/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"bkpay2026"}' -c cookies.txt

curl -s -X POST http://localhost:3003/api/auth/change-password \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"currentPassword":"bkpay2026","newPassword":"YOUR_STRONG_PASSWORD"}'
```

### 3.2 ファイアウォール
```bash
# Nginx経由でのみアクセス（3003を直接公開しない）
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

---

## 4. PM2でプロセス管理

### 4.1 PM2インストール
```bash
sudo npm install -g pm2
```

### 4.2 ecosystem設定
```bash
cat > /opt/bkpay/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'bkpay',
    script: 'npx',
    args: 'tsx src/index.ts',
    cwd: '/opt/bkpay',
    env: {
      NODE_ENV: 'production',
      BK_ENC_KEY: 'your-32-character-secret-key-here'
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '500M',
    log_file: '/var/log/bkpay/app.log',
    error_file: '/var/log/bkpay/error.log',
    merge_logs: true,
    time: true
  }]
};
EOF
```

### 4.3 起動
```bash
sudo mkdir -p /var/log/bkpay
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # OS起動時に自動起動
```

### 4.4 管理コマンド
```bash
pm2 status          # ステータス確認
pm2 logs bkpay      # ログ表示
pm2 restart bkpay   # 再起動
pm2 stop bkpay      # 停止
pm2 monit           # リアルタイム監視
```

---

## 5. Nginx + SSL

### 5.1 Nginxインストール
```bash
sudo apt install -y nginx
```

### 5.2 設定ファイル
```bash
sudo vi /etc/nginx/sites-available/bkpay
```

```nginx
server {
    listen 80;
    server_name pay.bkstock.com;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name pay.bkstock.com;

    ssl_certificate /etc/letsencrypt/live/pay.bkstock.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pay.bkstock.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';";

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:3003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Block admin access from outside (optional)
    # location /admin.html {
    #     allow 203.0.113.0/24;  # Office IP
    #     deny all;
    #     proxy_pass http://127.0.0.1:3003;
    # }
}
```

### 5.3 SSL証明書（Let's Encrypt）
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pay.bkstock.com
```

### 5.4 有効化
```bash
sudo ln -s /etc/nginx/sites-available/bkpay /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 6. バックアップ

### 6.1 SQLiteバックアップ（日次）
```bash
cat > /opt/bkpay/scripts/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/bkpay/backups"
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d_%H%M%S)
sqlite3 /opt/bkpay/data/bkpay.db ".backup $BACKUP_DIR/bkpay_$DATE.db"
# 30日以上前のバックアップを削除
find $BACKUP_DIR -name "bkpay_*.db" -mtime +30 -delete
echo "Backup done: bkpay_$DATE.db"
EOF
chmod +x /opt/bkpay/scripts/backup.sh
```

### 6.2 cron設定
```bash
crontab -e
# 毎日3時にバックアップ
0 3 * * * /opt/bkpay/scripts/backup.sh >> /var/log/bkpay/backup.log 2>&1
```

---

## 7. 監視

### 7.1 ヘルスチェック
```bash
# crontab に追加
*/5 * * * * curl -sf http://localhost:3003/api/status > /dev/null || pm2 restart bkpay
```

### 7.2 ディスク容量
```bash
# DBサイズ監視
du -sh /opt/bkpay/data/bkpay.db
```

---

## 8. macOS（launchd）の場合

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bkstock.bkpay</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/npx</string>
        <string>tsx</string>
        <string>src/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/mr.k/remote-workspace/bk-p2p-aggregator</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>BK_ENC_KEY</key>
        <string>your-secret-key</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/bkpay.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/bkpay-error.log</string>
</dict>
</plist>
```

```bash
cp com.bkstock.bkpay.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.bkstock.bkpay.plist
```

---

## 9. 本番チェックリスト

- [ ] 管理者パスワード変更済み
- [ ] BK_ENC_KEY を独自の値に設定済み
- [ ] SSL証明書設定済み（HTTPS）
- [ ] ファイアウォール設定済み
- [ ] PM2/launchdで自動起動設定済み
- [ ] DBバックアップ自動化設定済み
- [ ] ヘルスチェック設定済み
- [ ] ログローテーション設定済み
- [ ] 管理画面のIP制限（任意）
- [ ] テストデータを削除
- [ ] Telegram通知を有効化（ENABLED = true）
- [ ] ウォレットアドレスを設定（USDT着金検知用）
- [ ] 銀行口座を登録
