#!/bin/bash
# Git history cleanup — remove leaked secrets from git history
# WARNING: This rewrites git history. All collaborators must re-clone after this.
#
# Prerequisites:
#   pip install git-filter-repo   (or: brew install git-filter-repo)
#
# Usage:
#   1. Create a fresh backup: cp -r .git .git-backup
#   2. Run this script: bash scripts/git-cleanup.sh
#   3. Force push: git push --force --all
#   4. All collaborators must: git clone <repo> (fresh clone)
#
# What this removes from history:
#   - .env files (may contain API keys, passwords)
#   - *.db / *.sqlite files (database snapshots)
#   - data/ directory (runtime data)
#   - Any file matching secret patterns

set -euo pipefail

echo "=== Git History Cleanup ==="
echo ""
echo "WARNING: This will rewrite ALL git history."
echo "Make sure you have a backup of .git before proceeding."
echo ""
read -p "Continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# Check if git-filter-repo is installed
if ! command -v git-filter-repo &> /dev/null; then
  echo "ERROR: git-filter-repo is not installed."
  echo "Install: pip install git-filter-repo"
  exit 1
fi

# Remove sensitive files from history
git filter-repo --invert-paths \
  --path .env \
  --path-glob '*.env' \
  --path-glob '*.db' \
  --path-glob '*.sqlite' \
  --path data/ \
  --path-glob '*.enc' \
  --force

echo ""
echo "=== Cleanup complete ==="
echo ""
echo "Next steps:"
echo "  1. Verify the repo: git log --oneline | head -20"
echo "  2. Force push: git push --force --all"
echo "  3. Rotate ALL secrets:"
echo "     - BK_ENC_KEY (generate new: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
echo "     - BK_ADMIN_PASSWORD"
echo "     - ANTHROPIC_API_KEY"
echo "     - TRON_WALLET_PRIVATE_KEY"
echo "     - TELEGRAM_BOT_TOKEN"
echo "     - All exchange API keys (OKX, Bybit, Binance)"
echo "  4. All collaborators must do a fresh: git clone <repo>"
