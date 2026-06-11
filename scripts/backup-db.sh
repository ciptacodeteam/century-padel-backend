#!/bin/bash
# =============================================================================
# Daily PostgreSQL backup → DigitalOcean Spaces
# =============================================================================
# Dumps the production database and uploads to an isolated Spaces prefix.
# Only touches: s3://<bucket>/century-padel/db/
# On failure only: sends alert email via Resend to BACKUP_ALERT_EMAIL.
#
# Usage:
#   ./scripts/backup-db.sh              # dump + upload + prune
#   ./scripts/backup-db.sh --dry-run    # show what would happen
#
# Requires in .env.production:
#   SPACES_ACCESS_KEY, SPACES_SECRET_KEY
#   RESEND_API_KEY (for failure alerts only)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/spaces.sh
source "$SCRIPT_DIR/lib/spaces.sh"
# shellcheck source=lib/resend.sh
source "$SCRIPT_DIR/lib/resend.sh"

DRY_RUN=false
BACKUP_NOTIFIED=false

if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
fi

LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-/var/backups/century-padel}"
LOG_TAG="[backup-db $(date '+%Y-%m-%d %H:%M:%S')]"

log() { echo "$LOG_TAG $1"; }

notify_backup_failure() {
  local reason="$1"
  if [ "$DRY_RUN" = true ] || [ "$BACKUP_NOTIFIED" = true ]; then
    return 0
  fi
  BACKUP_NOTIFIED=true
  resend_send_backup_failure_alert "$reason" || true
}

fail_backup() {
  local reason="$1"
  print_error "$reason"
  notify_backup_failure "$reason"
  exit 1
}

on_exit() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ]; then
    notify_backup_failure "Backup exited with code ${exit_code}"
  fi
  exit "$exit_code"
}
trap on_exit EXIT

run_backup() {
  local db_name db_user timestamp dump_file local_path remote_prefix dump_size

  print_header "Century Padel — Database Backup"

  require_project_root
  require_docker
  load_env
  spaces_assert_safe_prefix
  spaces_validate_credentials
  spaces_ensure_aws_cli

  db_name="${DB_NAME:-century_padel}"
  db_user="${DB_USER:-postgres}"
  timestamp="$(date +%Y%m%d_%H%M%S)"
  dump_file="century_padel_${timestamp}.dump"
  local_path="${LOCAL_BACKUP_DIR}/${dump_file}"
  remote_prefix="s3://${SPACES_BUCKET}/${SPACES_PREFIX}/"

  log "Database: ${db_name}"
  log "Spaces destination: ${remote_prefix}"
  log "Retention: ${BACKUP_RETENTION_DAYS} days"

  if ! compose -f "$COMPOSE_FILE" ps db 2>/dev/null | grep -q "Up"; then
    fail_backup "Database container is not running"
  fi

  if [ "$DRY_RUN" = true ]; then
    print_warning "Dry run — no dump or upload will be performed"
    print_info "Would dump ${db_name} → ${local_path}"
    print_info "Would upload to ${remote_prefix}${dump_file}"
    print_info "Would prune backups older than ${BACKUP_RETENTION_DAYS} days under ${SPACES_PREFIX}/"
    return 0
  fi

  mkdir -p "$LOCAL_BACKUP_DIR"

  print_header "Creating database dump"
  log "Dumping to ${local_path}"

  if ! compose -f "$COMPOSE_FILE" exec -T db \
    pg_dump -U "$db_user" -Fc "$db_name" > "$local_path"; then
    rm -f "$local_path"
    fail_backup "pg_dump failed for database '${db_name}'"
  fi

  dump_size="$(du -h "$local_path" | awk '{print $1}')"
  print_success "Dump created (${dump_size})"

  print_header "Uploading to DigitalOcean Spaces"
  if ! spaces_upload_file "$local_path" "$dump_file"; then
    fail_backup "Failed to upload backup to Spaces (${remote_prefix}${dump_file})"
  fi

  print_header "Pruning old backups"
  if ! spaces_prune_old_backups "$BACKUP_RETENTION_DAYS"; then
    fail_backup "Failed to prune old backups under ${SPACES_PREFIX}/"
  fi

  find "$LOCAL_BACKUP_DIR" -name 'century_padel_*.dump' -type f -mtime +1 -delete 2>/dev/null || true

  print_header "Backup Complete"
  print_success "Latest backup: ${remote_prefix}${dump_file}"
  spaces_list_backups
}

run_backup
