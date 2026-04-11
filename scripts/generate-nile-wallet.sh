#!/usr/bin/env bash
# generate-nile-wallet.sh — generate a disposable TRON Nile testnet wallet
#
# Usage:
#   bash scripts/generate-nile-wallet.sh
#
# Creates .env.signer.nile with a fresh private key + address pair that can
# be used for end-to-end testing of the hot wallet signer worker without
# risking real funds.
#
# Requirements:
#   - Node.js 20+ with the project's node_modules installed (tronweb is
#     read from the existing package.json install)
#
# Safety:
#   - The generated key is for NILE TESTNET ONLY. Do not send real USDT to
#     this address — real TRC-20 transfers on mainnet will NOT work with
#     this key because it is not a mainnet-derived key in the first place
#     (TRON uses the same curve for both nets, but this script generates
#     a brand new random key).
#   - The output file .env.signer.nile is gitignored (covered by the
#     .env.* pattern in .gitignore).
#
# After generation:
#   1. Fund the address from a Nile testnet faucet:
#      https://nileex.io/join/getJoinPage  (click "Get 2000 TRX")
#   2. Follow docs/SIGNER_WORKER.md section "Nile testnet validation"

set -euo pipefail

ENV_FILE=".env.signer.nile"

if [ -f "$ENV_FILE" ]; then
  echo "⚠  $ENV_FILE already exists. Remove it first if you want to regenerate." >&2
  exit 1
fi

# Use tronweb's utils.accounts.generateAccount() which is the canonical way
# to create a new TRON key pair. Zero external dependencies beyond the
# already-installed tronweb package.
node -e '
const TronWeb = require("tronweb").default || require("tronweb");
const acc = TronWeb.utils.accounts.generateAccount();
// Emit as shell-escapable env vars. The private key is hex without the
// leading 0x (tronweb convention).
console.log("TRON_WALLET_ADDRESS=" + acc.address.base58);
console.log("TRON_WALLET_PRIVATE_KEY=" + acc.privateKey);
' > /tmp/nile-wallet.tmp

ADDR=$(grep TRON_WALLET_ADDRESS /tmp/nile-wallet.tmp | cut -d= -f2)

cat > "$ENV_FILE" <<EOF
# === Nile testnet signer wallet ===
# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
# DO NOT commit. DO NOT use on mainnet.
# Fund via https://nileex.io/join/getJoinPage
NODE_ENV=production
ENABLE_JOB_QUEUE=true
ENABLE_SIGNER_WORKER=true
REDIS_URL=redis://redis:6379
BK_ENC_KEY=nile_testnet_disposable_key_xxxxxxxxxxxxxxxxxxxx

$(cat /tmp/nile-wallet.tmp)

# Point TronWeb at Nile testnet instead of mainnet
# The signer worker uses getTronWeb() which reads TRONGRID_API from code.
# To redirect to Nile, patch TRONGRID_API in a follow-up step or set
# TRON_FULL_HOST via a temporary code modification.
TRON_NETWORK=nile
TRON_FULL_HOST=https://api.nileex.io
EOF

chmod 0400 "$ENV_FILE"
rm -f /tmp/nile-wallet.tmp

echo
echo "✓ Generated $ENV_FILE"
echo "  Address: $ADDR"
echo
echo "Next steps:"
echo "  1. Fund address with testnet TRX:"
echo "     https://nileex.io/join/getJoinPage"
echo "  2. Follow docs/SIGNER_WORKER.md 'Nile testnet validation' section"
echo
