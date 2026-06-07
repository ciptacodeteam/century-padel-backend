#!/bin/bash
# Backward-compatible entry point.
# Prefer:
#   ./scripts/install-vps.sh   — fresh VPS (once)
#   ./scripts/deploy-fresh.sh — first deploy (once)
#   ./scripts/update.sh       — routine code updates

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${UPDATE_ONLY:-}" = "true" ]; then
  exec bash "$SCRIPT_DIR/scripts/update.sh"
fi

echo "ℹ️  deploy.sh → scripts/deploy-fresh.sh (use scripts/update.sh for routine updates)"
exec bash "$SCRIPT_DIR/scripts/deploy-fresh.sh"
