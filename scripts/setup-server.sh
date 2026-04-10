#!/bin/bash
# ============================================================
# setup-server.sh — Hetzner CPX11 初期セットアップ
# Ubuntu 22.04/24.04 対応
# 実行: ssh root@YOUR_IP 'bash -s' < setup-server.sh
# ============================================================
set -euo pipefail

echo "=========================================="
echo " bk-pay-match サーバーセットアップ"
echo "=========================================="

# --- 1. システム更新 ---
echo "[1/6] システム更新..."
apt-get update -qq && apt-get upgrade -y -qq

# --- 2. 基本パッケージ ---
echo "[2/6] 基本パッケージインストール..."
apt-get install -y -qq curl git ufw fail2ban

# --- 3. Docker インストール ---
echo "[3/6] Docker インストール..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "  Docker $(docker --version) インストール完了"
else
    echo "  Docker 既にインストール済み"
fi

# Docker Compose プラグイン確認
if ! docker compose version &> /dev/null; then
    apt-get install -y -qq docker-compose-plugin
fi
echo "  $(docker compose version)"

# --- 4. Caddy インストール ---
echo "[4/6] Caddy インストール..."
if ! command -v caddy &> /dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
    echo "  Caddy $(caddy version) インストール完了"
else
    echo "  Caddy 既にインストール済み"
fi

# --- 5. ファイアウォール設定 ---
echo "[5/6] ファイアウォール設定..."
ufw --force reset > /dev/null 2>&1
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (Caddy用)
ufw allow 443/tcp   # HTTPS (Caddy用)
# ポート3003は外部に開けない（Caddy経由のみ）
ufw --force enable
echo "  UFW 有効: SSH(22), HTTP(80), HTTPS(443)"

# --- 6. fail2ban 設定 ---
echo "[6/6] fail2ban 設定..."
systemctl enable fail2ban
systemctl start fail2ban

# --- アプリ用ディレクトリ ---
mkdir -p /opt/bk-pay-match
mkdir -p /var/log/caddy

echo ""
echo "=========================================="
echo " セットアップ完了!"
echo "=========================================="
echo ""
echo "次のステップ:"
echo "  1. リポジトリをクローン or ファイルを /opt/bk-pay-match に配置"
echo "  2. scripts/deploy.sh を実行"
echo ""
