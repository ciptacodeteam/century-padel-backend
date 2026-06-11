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

# Send backup failure alert via Resend REST API (no Node/Bun required on host).
# Arguments: error_message [optional_host]
resend_send_backup_failure_alert() {
  local error_message="$1"
  local host_name="${2:-$(hostname -f 2>/dev/null || hostname)}"
  local database_name="${DB_NAME:-century_padel}"
  local timestamp_utc
  timestamp_utc="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  if ! resend_validate_credentials; then
    print_warning "Skipping backup failure email — Resend not configured"
    return 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    print_warning "python3 not found — cannot send backup failure email"
    return 1
  fi

  local http_code
  if ! http_code="$(RESEND_API_KEY="$RESEND_API_KEY" \
    RESEND_FROM="$RESEND_FROM" \
    BACKUP_ALERT_EMAIL="$BACKUP_ALERT_EMAIL" \
    python3 - "$error_message" "$host_name" "$database_name" "$timestamp_utc" <<'PY'
import html
import json
import os
import sys
import urllib.error
import urllib.request

error_message, host_name, database_name, timestamp_utc = sys.argv[1:5]

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
  <p style="font-size:12px;color:#666;">Check backup logs: <code>/var/log/century-padel-backup.log</code></p>
</div>
"""

payload = {
    "from": os.environ["RESEND_FROM"],
    "to": [os.environ["BACKUP_ALERT_EMAIL"]],
    "subject": subject,
    "html": body,
}

req = urllib.request.Request(
    "https://api.resend.com/emails",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {os.environ['RESEND_API_KEY']}",
        "Content-Type": "application/json",
    },
    method="POST",
)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        print(resp.status)
except urllib.error.HTTPError as e:
    detail = e.read().decode("utf-8", errors="replace")
    print(f"HTTP_{e.code}:{detail}", file=sys.stderr)
    raise SystemExit(1)
PY
  )"; then
    print_warning "Failed to send backup failure alert via Resend"
    return 1
  fi

  if [ "$http_code" = "200" ] || [ "$http_code" = "201" ] || [ "$http_code" = "202" ]; then
    print_info "Backup failure alert sent to ${BACKUP_ALERT_EMAIL}"
    return 0
  fi

  print_warning "Unexpected Resend response code: ${http_code}"
  return 1
}
