#!/bin/bash
# Resend API helpers for shell scripts (backup alerts, etc.)

set -euo pipefail

RESEND_API_URL="${RESEND_API_URL:-https://api.resend.com/emails}"
RESEND_FROM="${RESEND_FROM:-Century Padel <onboarding@resend.dev>}"
BACKUP_ALERT_EMAIL="${BACKUP_ALERT_EMAIL:-ciptacodeteam@gmail.com}"

resend_validate_credentials() {
  if [ -z "${RESEND_API_KEY:-}" ]; then
    print_error "RESEND_API_KEY is missing from $ENV_FILE"
    print_info "Create an API key at: https://resend.com/api-keys"
    return 1
  fi
  return 0
}

# Send backup failure alert via Resend REST API (curl — avoids Cloudflare blocks on python urllib).
# Arguments: error_message [optional_host]
resend_send_backup_failure_alert() {
  local error_message="$1"
  local host_name="${2:-$(hostname -f 2>/dev/null || hostname)}"
  local database_name="${DB_NAME:-century_padel}"
  local timestamp_utc log_hint payload response http_code body

  timestamp_utc="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  log_hint="${BACKUP_CRON_LOG:-${PROJECT_ROOT:-.}/logs/backup.log}"

  if ! resend_validate_credentials; then
    print_warning "Skipping backup failure email — Resend not configured"
    return 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    print_warning "curl not found — cannot send backup failure email"
    return 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    print_warning "python3 not found — cannot build Resend payload"
    return 1
  fi

  payload="$(RESEND_FROM="$RESEND_FROM" \
    BACKUP_ALERT_EMAIL="$BACKUP_ALERT_EMAIL" \
    LOG_HINT="$log_hint" \
    python3 - "$error_message" "$host_name" "$database_name" "$timestamp_utc" <<'PY'
import html
import json
import os
import sys

error_message, host_name, database_name, timestamp_utc = sys.argv[1:5]
log_hint = os.environ.get("LOG_HINT", "backup log on server")

subject = f"[Century Padel] Database backup failed — {host_name}"
body = f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <h2 style="color:#dc2626;">Database Backup Failed</h2>
  <p>The scheduled PostgreSQL backup did not complete successfully.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;">
    <tr><td style="padding:8px;border:1px solid #eee;">Server</td>
        <td style="padding:8px;border:1px solid #eee;font-weight:600;">{html.escape(host_name)}</td></tr>
    <tr><td style="padding:8px;border:1px solid #eee;">Database</td>
        <td style="padding:8px;border:1px solid #eee;font-weight:600;">{html.escape(database_name)}</td></tr>
    <tr><td style="padding:8px;border:1px solid #eee;">Time (UTC)</td>
        <td style="padding:8px;border:1px solid #eee;font-weight:600;">{html.escape(timestamp_utc)}</td></tr>
    <tr><td style="padding:8px;border:1px solid #eee;">Error</td>
        <td style="padding:8px;border:1px solid #eee;font-weight:600;color:#dc2626;">{html.escape(error_message)}</td></tr>
  </table>
  <p style="font-size:12px;color:#666;">Check backup logs: <code>{html.escape(log_hint)}</code></p>
</div>
"""

print(json.dumps({
    "from": os.environ["RESEND_FROM"],
    "to": [os.environ["BACKUP_ALERT_EMAIL"]],
    "subject": subject,
    "html": body,
}))
PY
)"

  response="$(curl -sS -w $'\n%{http_code}' -X POST "$RESEND_API_URL" \
    -H "Authorization: Bearer ${RESEND_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "User-Agent: century-padel-backup/1.0" \
    --data-binary "$payload" \
    --max-time 30)" || {
    print_warning "Failed to reach Resend API (network error)"
    return 1
  }

  http_code="${response##*$'\n'}"
  body="${response%$'\n'*}"

  case "$http_code" in
    200 | 201 | 202)
      print_info "Backup failure alert sent to ${BACKUP_ALERT_EMAIL}"
      return 0
      ;;
    403)
      print_warning "Resend rejected the alert (HTTP 403)"
      print_info "Common causes: invalid API key, unverified RESEND_FROM domain, or VPS IP blocked"
      [ -n "$body" ] && print_info "Resend response: ${body}"
      return 1
      ;;
    *)
      print_warning "Resend returned HTTP ${http_code}"
      [ -n "$body" ] && print_info "Resend response: ${body}"
      return 1
      ;;
  esac
}
