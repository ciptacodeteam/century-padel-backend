#!/bin/bash
# =============================================================================
# Sync PostgreSQL password to match DB_PASSWORD in .env.production
# =============================================================================
# POSTGRES_PASSWORD only applies on first volume init. If you changed
# DB_PASSWORD after deploy, run this once to update the live database.
#
# Usage:
#   ./scripts/sync-db-password.sh
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

escape_sql_literal() {
  printf "%s" "$1" | sed "s/'/''/g"
}

print_header "Sync PostgreSQL password"

require_project_root
require_docker
validate_env
load_env

db_user="${DB_USER:-postgres}"
db_pass_escaped="$(escape_sql_literal "$DB_PASSWORD")"

if ! compose -f "$COMPOSE_FILE" ps db 2>/dev/null | grep -q "Up"; then
  print_error "Database container is not running"
  exit 1
fi

print_info "Updating password for user '${db_user}'..."

if ! compose -f "$COMPOSE_FILE" exec -T db \
  psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER USER \"${db_user}\" PASSWORD '${db_pass_escaped}';"; then
  print_error "Failed to update PostgreSQL password"
  exit 1
fi

print_success "PostgreSQL password synced to DB_PASSWORD in $ENV_FILE"
print_info "Restart app and workers if they still fail to connect:"
echo "  compose -f $COMPOSE_FILE up -d --no-deps app email-worker scheduler-worker"
