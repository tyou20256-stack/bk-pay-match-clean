#!/bin/bash
# ============================================================
# deploy.sh — bk-pay-match デプロイスクリプト
# 実行: bash scripts/deploy.sh
# ============================================================
set -euo pipefail

APP_DIR="/opt/bk-pay-match"
REPO_URL="${1:-}"

echo "=========================================="
echo " bk-pay-match デプロイ"
echo "=========================================="

# --- 1. ディレクトリ確認 ---
cd "$APP_DIR" 2>/dev/null || {
    echo "[ERROR] $APP_DIR が存在しません。setup-server.sh を先に実行してください。"
    exit 1
}

# --- 2. リポジトリ取得 ---
if [ ! -f "docker-compose.yml" ]; then
    if [ -z "$REPO_URL" ]; then
        echo "[ERROR] リポジトリURLを引数で指定してください:"
        echo "  bash scripts/deploy.sh https://github.com/YOUR_ORG/bk-pay-match.git"
        exit 1
    fi
    echo "[1/5] リポジトリをクローン中..."
    git clone "$REPO_URL" .
else
    echo "[1/5] コード更新中..."
    git pull --ff-only
fi

# --- 3. .env 確認 ---
echo "[2/5] .env 確認..."
if [ ! -f ".env" ]; then
    if [ -f ".env.production" ]; then
        cp .env.production .env
        echo "  .env.production → .env コピー完了"
    else
        echo "[ERROR] .env が見つかりません。"
        echo "  .env.production をコピーして編集してください:"
        echo "  cp .env.production .env && nano .env"
        exit 1
    fi
fi

# --- 4. 必須項目チェック ---
echo "[3/5] 必須設定チェック..."
ERRORS=0

check_env() {
    local key="$1"
    local val
    val=$(grep "^${key}=" .env 2>/dev/null | cut -d'=' -f2- | tr -d ' ')
    if [ -z "$val" ] || [ "$val" = "YOUR_DOMAIN.com" ] || echo "$val" | grep -q "YOUR_"; then
        echo "  [NG] $key が未設定です"
        ERRORS=$((ERRORS + 1))
    else
        echo "  [OK] $key"
    fi
}

check_env "BK_ENC_KEY"
check_env "BK_ADMIN_PASSWORD"
check_env "BASE_URL"

if [ "$ERRORS" -gt 0 ]; then
    echo ""
    echo "[ERROR] 未設定の項目があります。.env を編集してください:"
    echo "  nano .env"
    exit 1
fi

# --- 5. Caddy 設定 ---
echo "[4/5] Caddy 設定..."
if [ -f "Caddyfile" ]; then
    DOMAIN=$(grep "^BASE_URL=" .env | cut -d'=' -f2- | sed 's|https://||' | sed 's|http://||' | tr -d '/')
    if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "YOUR_DOMAIN.com" ]; then
        sed "s/YOUR_DOMAIN\.com/$DOMAIN/g" Caddyfile > /etc/caddy/Caddyfile
        echo "  ドメイン: $DOMAIN"
        caddy validate --config /etc/caddy/Caddyfile > /dev/null 2>&1 && echo "  Caddyfile 検証OK" || echo "  [WARN] Caddyfile 検証失敗"
        systemctl restart caddy
    else
        echo "  [SKIP] BASE_URL にドメインを設定してください"
    fi
fi

# --- 6. Docker起動 ---
echo "[5/5] アプリ起動..."
docker compose down 2>/dev/null || true
docker compose up -d --build

echo ""
echo "=========================================="
echo " デプロイ完了!"
echo "=========================================="

# ヘルスチェック
echo ""
echo "ヘルスチェック待機中（10秒）..."
sleep 10

if curl -sf http://localhost:3003/health > /dev/null 2>&1; then
    echo "[OK] アプリ正常起動"
    curl -s http://localhost:3003/health | head -1
else
    echo "[WARN] ヘルスチェック失敗。ログを確認:"
    echo "  docker compose logs --tail 50"
fi

echo ""
echo "管理画面: https://$DOMAIN"
echo "ログ確認: docker compose logs -f"
echo ""
