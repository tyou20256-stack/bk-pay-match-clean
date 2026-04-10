#!/bin/bash
# SQLite daily backup script — run via cron or pm2
# Usage: bash scripts/backup.sh
# Recommended cron (every 6 hours):
#   0 */6 * * * cd /path/to/bk-pay-match && bash scripts/backup.sh >> logs/backup.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/.."
DB_PATH="${PROJECT_DIR}/data/bkpay.db"
BACKUP_DIR="${PROJECT_DIR}/backups"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/bkpay_${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "[$(date)] ERROR: Database not found: $DB_PATH"
  exit 1
fi

# Use SQLite .backup for consistent WAL-safe snapshot (not cp)
if command -v sqlite3 &> /dev/null; then
  sqlite3 "$DB_PATH" ".backup '${BACKUP_FILE}'"
else
  # Fallback: copy (less safe with WAL)
  cp "$DB_PATH" "$BACKUP_FILE"
  echo "[$(date)] WARN: sqlite3 not found, using cp (WAL data may be missed)"
fi

# Compress
gzip "$BACKUP_FILE"
SIZE=$(du -h "${BACKUP_FILE}.gz" | cut -f1)
echo "[$(date)] Backup saved: ${BACKUP_FILE}.gz (${SIZE})"

# Prune old backups (keep last 30 days)
find "$BACKUP_DIR" -name "bkpay_*.db.gz" -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true

# Also keep at most 120 files (in case of frequent backups)
ls -t "$BACKUP_DIR"/bkpay_*.db.gz 2>/dev/null | tail -n +121 | xargs -r rm -- 2>/dev/null || true

echo "[$(date)] Backup complete. Pruned files older than ${RETENTION_DAYS} days."
