#!/bin/bash
# =============================================================================
# Install daily database backup cron job on the VPS
# =============================================================================
# Installs awscli (if missing) and schedules backup-db.sh at 02:30 daily.
#
# Usage:
#   ./scripts/setup-backup-cron.sh
#   ./scripts/setup-backup-cron.sh --remove   # remove cron entry
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

REMOVE=false
if [ "${1:-}" = "--remove" ]; then
  REMOVE=true
fi

CRON_SCHEDULE="${BACKUP_CRON_SCHEDULE:-30 2 * * *}"
CRON_LOG="${BACKUP_CRON_LOG:-/var/log/century-padel-backup.log}"
CRON_MARKER="# century-padel-db-backup"
BACKUP_SCRIPT="$PROJECT_ROOT/scripts/backup-db.sh"
CRON_LINE="${CRON_SCHEDULE} cd ${PROJECT_ROOT} && ${BACKUP_SCRIPT} >> ${CRON_LOG} 2>&1 ${CRON_MARKER}"

print_header "Century Padel — Backup Cron Setup"

require_project_root
make_scripts_executable

if [ "$REMOVE" = true ]; then
  if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | crontab -
    print_success "Removed backup cron job"
  else
    print_info "No backup cron job found"
  fi
  exit 0
fi

# --- Install AWS CLI ---
if ! command -v aws >/dev/null 2>&1; then
  print_header "Installing AWS CLI"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq awscli
    print_success "AWS CLI installed"
  else
    print_error "apt-get not found — install awscli manually"
    exit 1
  fi
else
  print_success "AWS CLI already installed: $(aws --version 2>&1 | head -1)"
fi

# --- Validate env ---
if [ ! -f "$PROJECT_ROOT/$ENV_FILE" ]; then
  print_error "$ENV_FILE missing — configure Spaces credentials first"
  exit 1
fi

load_env
# shellcheck source=lib/spaces.sh
source "$SCRIPT_DIR/lib/spaces.sh"
# shellcheck source=lib/resend.sh
source "$SCRIPT_DIR/lib/resend.sh"
spaces_assert_safe_prefix
spaces_validate_credentials

if ! resend_validate_credentials; then
  print_warning "RESEND_API_KEY not set — backup will run but failure alerts won't be emailed"
fi

# --- Log file ---
if [ ! -f "$CRON_LOG" ]; then
  sudo touch "$CRON_LOG"
  sudo chown "$(whoami):$(whoami)" "$CRON_LOG" 2>/dev/null || true
fi

# --- Install cron ---
print_header "Installing cron job"
print_info "Schedule: ${CRON_SCHEDULE} (daily at 02:30 server time)"
print_info "Log file: ${CRON_LOG}"

(
  crontab -l 2>/dev/null | grep -v "$CRON_MARKER" || true
  echo "$CRON_LINE"
) | crontab -

print_success "Cron job installed"

echo ""
print_info "Test a backup now:"
echo "  ./scripts/backup-db.sh"
echo ""
print_info "View backup logs:"
echo "  tail -f ${CRON_LOG}"
echo ""
print_info "Remove scheduled backup:"
echo "  ./scripts/setup-backup-cron.sh --remove"
