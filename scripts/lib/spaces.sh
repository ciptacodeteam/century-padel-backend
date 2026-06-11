#!/bin/bash
# DigitalOcean Spaces helpers (S3-compatible).
# All operations are scoped to SPACES_PREFIX — never touches other bucket folders.

set -euo pipefail

# Defaults (override via .env.production)
SPACES_BUCKET="${SPACES_BUCKET:-kms-data}"
SPACES_REGION="${SPACES_REGION:-sgp1}"
SPACES_PREFIX="${SPACES_PREFIX:-century-padel/db}"
SPACES_ENDPOINT="${SPACES_ENDPOINT:-https://${SPACES_REGION}.digitaloceanspaces.com}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

spaces_assert_safe_prefix() {
  if [[ ! "$SPACES_PREFIX" =~ ^century-padel/ ]]; then
    print_error "SPACES_PREFIX must start with 'century-padel/' (current: $SPACES_PREFIX)"
    print_error "This prevents accidental changes to other projects in the bucket."
    exit 1
  fi

  if [[ "$SPACES_PREFIX" == *"*"* ]] || [[ "$SPACES_PREFIX" == *".."* ]]; then
    print_error "SPACES_PREFIX contains invalid characters."
    exit 1
  fi
}

spaces_validate_credentials() {
  local missing=()

  if [ -z "${SPACES_ACCESS_KEY:-}" ]; then
    missing+=("SPACES_ACCESS_KEY")
  fi
  if [ -z "${SPACES_SECRET_KEY:-}" ]; then
    missing+=("SPACES_SECRET_KEY")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    print_error "Missing Spaces credentials in $ENV_FILE:"
    printf '  - %s\n' "${missing[@]}"
    print_info "Create keys at: DigitalOcean → API → Spaces access keys"
    exit 1
  fi
}

spaces_ensure_aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    return 0
  fi

  print_error "AWS CLI is required for Spaces uploads."
  print_info "Install on the VPS: sudo apt-get update && sudo apt-get install -y awscli"
  print_info "Or run: ./scripts/setup-backup-cron.sh (installs awscli + cron)"
  exit 1
}

spaces_configure_aws_env() {
  export AWS_ACCESS_KEY_ID="$SPACES_ACCESS_KEY"
  export AWS_SECRET_ACCESS_KEY="$SPACES_SECRET_KEY"
  # AWS CLI requires a region; DigitalOcean ignores it for Spaces.
  export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
}

spaces_upload_file() {
  local local_path="$1"
  local remote_name="$2"
  local s3_uri="s3://${SPACES_BUCKET}/${SPACES_PREFIX}/${remote_name}"

  spaces_configure_aws_env
  aws s3 cp "$local_path" "$s3_uri" \
    --endpoint-url "$SPACES_ENDPOINT" \
    --only-show-errors

  print_success "Uploaded to ${s3_uri}"
}

spaces_prune_old_backups() {
  local retention_days="${1:-$BACKUP_RETENTION_DAYS}"
  local cutoff_epoch
  local deleted=0

  cutoff_epoch=$(date -d "${retention_days} days ago" +%s)
  spaces_configure_aws_env

  print_info "Pruning remote backups older than ${retention_days} days under ${SPACES_PREFIX}/"

  while IFS=$'\t' read -r key modified; do
    [ -z "${key:-}" ] && continue
    [[ "$key" != "${SPACES_PREFIX}/"* ]] && continue
    [[ "$key" != *.dump ]] && continue

    local mod_epoch
    mod_epoch=$(date -d "$modified" +%s)

    if [ "$mod_epoch" -lt "$cutoff_epoch" ]; then
      aws s3 rm "s3://${SPACES_BUCKET}/${key}" \
        --endpoint-url "$SPACES_ENDPOINT" \
        --only-show-errors
      print_info "Deleted old backup: ${key}"
      deleted=$((deleted + 1))
    fi
  done < <(
    aws s3api list-objects-v2 \
      --bucket "$SPACES_BUCKET" \
      --prefix "${SPACES_PREFIX}/" \
      --endpoint-url "$SPACES_ENDPOINT" \
      --output text \
      --query 'Contents[].[Key,LastModified]' 2>/dev/null || true
  )

  if [ "$deleted" -eq 0 ]; then
    print_info "No remote backups to prune"
  else
    print_success "Pruned ${deleted} remote backup(s)"
  fi
}

spaces_list_backups() {
  spaces_configure_aws_env
  aws s3 ls "s3://${SPACES_BUCKET}/${SPACES_PREFIX}/" \
    --endpoint-url "$SPACES_ENDPOINT" \
    --human-readable \
    --summarize 2>/dev/null || true
}
