#!/bin/bash
# =============================================================================
# Restore PostgreSQL from a Spaces backup
# =============================================================================
# Downloads a .dump file from century-padel/db/ and restores into production DB.
# USE WITH CAUTION — overwrites existing data in the target database.
#
# Usage:
#   ./scripts/restore-db.sh                          # list available backups
#   ./scripts/restore-db.sh century_padel_20260611_023000.dump
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/spaces.sh
source "$SCRIPT_DIR/lib/spaces.sh"

BACKUP_NAME="${1:-}"

print_header "Century Padel — Database Restore"

require_project_root
require_docker
load_env
resolve_local_backup_dir
spaces_assert_safe_prefix
spaces_validate_credentials
spaces_ensure_aws_cli

DB_NAME="${DB_NAME:-century_padel}"
DB_USER="${DB_USER:-postgres}"

if [ -z "$BACKUP_NAME" ]; then
  print_info "Available backups under s3://${SPACES_BUCKET}/${SPACES_PREFIX}/:"
  spaces_list_backups
  echo ""
  print_info "Usage: ./scripts/restore-db.sh <backup-filename.dump>"
  exit 0
fi

if [[ "$BACKUP_NAME" != *.dump ]]; then
  print_error "Backup filename must end with .dump"
  exit 1
fi

LOCAL_PATH="${LOCAL_BACKUP_DIR}/${BACKUP_NAME}"
S3_URI="s3://${SPACES_BUCKET}/${SPACES_PREFIX}/${BACKUP_NAME}"

print_warning "This will REPLACE all data in database '${DB_NAME}'"
read -r -p "Type the database name to confirm: " confirm
if [ "$confirm" != "$DB_NAME" ]; then
  print_error "Confirmation failed — restore cancelled"
  exit 1
fi

print_header "Downloading backup"
spaces_configure_aws_env
aws s3 cp "$S3_URI" "$LOCAL_PATH" \
  --endpoint-url "$SPACES_ENDPOINT" \
  --only-show-errors
print_success "Downloaded to ${LOCAL_PATH}"

print_header "Restoring database"
compose -f "$COMPOSE_FILE" exec -T db \
  pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists < "$LOCAL_PATH"

print_success "Restore complete from ${BACKUP_NAME}"
