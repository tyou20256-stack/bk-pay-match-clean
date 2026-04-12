#!/usr/bin/env bash
# ============================================================================
# deploy-zero-downtime.sh — Blue/green zero-downtime deployment for bk-pay-match
# ============================================================================
#
# Flow:
#   1. Build a new Docker image from the current working tree.
#   2. Start a "green" container (bk-pay-match-new) on a temporary host port.
#   3. Poll /health on the green container until it returns HTTP 200.
#   4. Atomically swap Caddy's upstream from the blue to the green container.
#   5. Drain and stop the blue container (bk-pay-match).
#   6. Rename green -> bk-pay-match so the next deploy repeats cleanly.
#
# ----------------------------------------------------------------------------
# Rollback instructions (if /health never goes green, or if the swap breaks):
#   1. Stop and remove the failed green container:
#        docker stop bk-pay-match-new && docker rm bk-pay-match-new
#   2. Restore Caddy upstream to the blue container (127.0.0.1:3003):
#        cp /etc/caddy/Caddyfile.prev /etc/caddy/Caddyfile
#        systemctl reload caddy
#   3. Verify blue is still serving:
#        curl -fsS https://bkpay.app/health
#
# If the blue container was already stopped when rollback is needed:
#   docker start bk-pay-match
#   (the restart policy `unless-stopped` will keep it up after that)
# ----------------------------------------------------------------------------

set -euo pipefail

BLUE_NAME="bk-pay-match"
GREEN_NAME="bk-pay-match-new"
BLUE_PORT="${BLUE_PORT:-3003}"
GREEN_PORT="${GREEN_PORT:-3004}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"  # seconds
HEALTH_INTERVAL=3

log() { echo "[deploy $(date -u +%H:%M:%S)] $*"; }
die() { echo "[deploy ERROR] $*" >&2; exit 1; }

# --- 0. Preflight -----------------------------------------------------------
command -v docker >/dev/null || die "docker not found"
command -v curl >/dev/null || die "curl not found"
[ -f "$CADDYFILE" ] || die "Caddyfile not found at $CADDYFILE"

# --- 1. Build new image -----------------------------------------------------
log "Building new image..."
IMAGE_TAG="bk-pay-match:$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
docker build -t "$IMAGE_TAG" -t bk-pay-match:latest .
log "Built $IMAGE_TAG"

# --- 2. Start green container -----------------------------------------------
if docker ps -a --format '{{.Names}}' | grep -q "^${GREEN_NAME}$"; then
  log "Stale green container found — removing"
  docker rm -f "$GREEN_NAME" >/dev/null
fi

log "Starting green container on port $GREEN_PORT..."
docker run -d \
  --name "$GREEN_NAME" \
  --restart unless-stopped \
  --network "bk-pay-match_default" \
  -p "127.0.0.1:${GREEN_PORT}:3003" \
  --env-file .env \
  -e NODE_ENV=production \
  -e REDIS_URL=redis://redis:6379 \
  -v bk-pay-match_app-data:/app/data \
  -v bk-pay-match_app-logs:/app/logs \
  -v bk-pay-match_app-backups:/app/backups \
  "$IMAGE_TAG"

# --- 3. Wait for /health to return 200 --------------------------------------
log "Waiting for green /health (timeout ${HEALTH_TIMEOUT}s)..."
elapsed=0
while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
  if curl -fsS -m 2 "http://127.0.0.1:${GREEN_PORT}/health" >/dev/null 2>&1; then
    log "Green container is healthy"
    break
  fi
  sleep "$HEALTH_INTERVAL"
  elapsed=$((elapsed + HEALTH_INTERVAL))
done

if [ "$elapsed" -ge "$HEALTH_TIMEOUT" ]; then
  log "Green container failed health check — rolling back"
  docker logs --tail 50 "$GREEN_NAME" || true
  docker rm -f "$GREEN_NAME" >/dev/null || true
  die "Health check timeout; blue container untouched — no downtime"
fi

# --- 4. Swap Caddy upstream from blue -> green ------------------------------
log "Swapping Caddy upstream ${BLUE_PORT} -> ${GREEN_PORT}"
cp "$CADDYFILE" "${CADDYFILE}.prev"
sed -i "s/127\.0\.0\.1:${BLUE_PORT}/127.0.0.1:${GREEN_PORT}/g" "$CADDYFILE"

if ! systemctl reload caddy; then
  log "Caddy reload failed — restoring previous config"
  cp "${CADDYFILE}.prev" "$CADDYFILE"
  systemctl reload caddy || true
  docker rm -f "$GREEN_NAME" >/dev/null || true
  die "Caddy reload failed; rolled back"
fi

# --- 5. Stop blue container --------------------------------------------------
log "Draining blue container (SIGTERM → 40s grace)"
docker stop -t 40 "$BLUE_NAME" || log "blue stop returned non-zero (may already be gone)"
docker rm "$BLUE_NAME" >/dev/null || true

# --- 6. Rename green -> blue and restore canonical port ---------------------
log "Stopping green to rename and rebind to canonical port ${BLUE_PORT}"
docker stop -t 40 "$GREEN_NAME" >/dev/null
docker rm "$GREEN_NAME" >/dev/null

# Recreate with canonical name + port so next deploy is idempotent
docker run -d \
  --name "$BLUE_NAME" \
  --restart unless-stopped \
  --network "bk-pay-match_default" \
  -p "127.0.0.1:${BLUE_PORT}:3003" \
  --env-file .env \
  -e NODE_ENV=production \
  -e REDIS_URL=redis://redis:6379 \
  -v bk-pay-match_app-data:/app/data \
  -v bk-pay-match_app-logs:/app/logs \
  -v bk-pay-match_app-backups:/app/backups \
  "$IMAGE_TAG"

# Final swap back to canonical port in Caddy
log "Swapping Caddy upstream back to canonical port ${BLUE_PORT}"
sed -i "s/127\.0\.0\.1:${GREEN_PORT}/127.0.0.1:${BLUE_PORT}/g" "$CADDYFILE"
systemctl reload caddy

# Final verification
if ! curl -fsS -m 5 "http://127.0.0.1:${BLUE_PORT}/health" >/dev/null; then
  die "Final health check failed after swap — manual intervention required"
fi

log "Deploy complete: $IMAGE_TAG is live on ${BLUE_NAME}:${BLUE_PORT}"
