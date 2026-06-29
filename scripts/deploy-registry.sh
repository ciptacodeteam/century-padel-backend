#!/bin/bash
# =============================================================================
# Registry deploy — pull a prebuilt image and restart app + workers
# =============================================================================
# NO Docker build happens on this host. The image is built and pushed by CI
# (GitHub Actions → GHCR); this script only pulls it and rolls the containers.
# This keeps build CPU/RAM off the production VPS.
#
# On health-check failure, automatically rolls back to the image that was
# running before this deploy (or .deploy-last-good-image as a fallback).
#
# Usage:
#   APP_IMAGE=ghcr.io/<owner>/century-padel-backend:<tag> ./scripts/deploy-registry.sh
#
# Options via environment:
#   SKIP_PULL_CODE=true   Skip git pull (compose/nginx/script config sync)
#   AUTO_DEPLOY=true      Skip the confirmation prompt (used by CI)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

print_header "Century Padel — Registry Deploy (pull prebuilt image)"

require_project_root
require_docker
make_scripts_executable

if [ -z "${APP_IMAGE:-}" ]; then
  print_error "APP_IMAGE is required (e.g. ghcr.io/<owner>/century-padel-backend:<sha>)"
  exit 1
fi

if [ ! -f "$PROJECT_ROOT/$ENV_FILE" ]; then
  print_error "$ENV_FILE missing — run ./scripts/deploy-fresh.sh first"
  exit 1
fi

validate_env
load_env

TARGET_APP_IMAGE="$APP_IMAGE"

# Remember what was running before we touch anything (for automatic rollback).
PREVIOUS_APP_IMAGE="$(read_running_app_image)"
if [ -z "$PREVIOUS_APP_IMAGE" ]; then
  PREVIOUS_APP_IMAGE="$(read_persisted_app_image)"
fi
if [ -z "$PREVIOUS_APP_IMAGE" ]; then
  PREVIOUS_APP_IMAGE="$(read_last_good_app_image)"
fi

if [ -n "$PREVIOUS_APP_IMAGE" ]; then
  print_info "Rollback image (if needed): $PREVIOUS_APP_IMAGE"
fi
print_info "Deploy target: $TARGET_APP_IMAGE"

# Compose uses $APP_IMAGE from the environment. Do NOT persist the new tag to
# .env until the deploy passes health checks — otherwise a failed deploy would
# overwrite the last-known-good tag and make rollback harder.
export APP_IMAGE="$TARGET_APP_IMAGE"

if [ "${AUTO_DEPLOY:-}" != "true" ]; then
  read -r -p "Pull and deploy this image? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
  fi
fi

# --- Sync config from git (compose / nginx / scripts) ---
if [ "${SKIP_PULL_CODE:-false}" != "true" ] && [ -d "$PROJECT_ROOT/.git" ]; then
  print_header "Syncing config from git"
  BEFORE_HEAD="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || true)"
  if git -C "$PROJECT_ROOT" pull origin "${DEPLOY_BRANCH:-main}"; then
    print_success "Config up to date"
    AFTER_HEAD="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || true)"
    if [ -z "${CHANGED_FILES:-}" ]; then
      CHANGED_FILES="$(git -C "$PROJECT_ROOT" diff --name-only "$BEFORE_HEAD" "$AFTER_HEAD" 2>/dev/null || true)"
    fi
  else
    print_warning "git pull failed — continuing with current config"
  fi
fi

# --- Pull prebuilt image ---
print_header "Pulling application image"
compose -f "$COMPOSE_FILE" pull app
print_success "Image pulled"

# --- Deploy new image ---
print_header "Restarting application"
compose -f "$COMPOSE_FILE" up -d --no-deps app

print_info "Waiting for container health + HTTP /health ..."
DEPLOY_OK=false
if wait_for_healthy app 30 && probe_app_http_health "$(resolve_app_port)" 12; then
  DEPLOY_OK=true
fi

if [ "$DEPLOY_OK" != true ]; then
  print_error "New deployment failed health checks"
  echo ""
  compose -f "$COMPOSE_FILE" logs --tail=30 app
  echo ""

  if [ -n "$PREVIOUS_APP_IMAGE" ] && [ "$PREVIOUS_APP_IMAGE" != "$TARGET_APP_IMAGE" ]; then
    if rollback_app_deployment "$PREVIOUS_APP_IMAGE"; then
      print_warning "Deploy rejected — rolled back to $PREVIOUS_APP_IMAGE"
      exit 1
    fi
  else
    print_warning "No previous image available for automatic rollback"
  fi

  exit 1
fi

print_success "New version healthy"

# Safe to record the new tag only after health checks pass.
persist_app_image "$TARGET_APP_IMAGE"
save_last_good_app_image "$TARGET_APP_IMAGE"

print_header "Restarting workers"
compose -f "$COMPOSE_FILE" up -d --no-deps email-worker scheduler-worker
print_success "Workers restarted"

if [ -n "${CHANGED_FILES:-}" ] && echo "$CHANGED_FILES" | grep -q 'docker/nginx/'; then
  print_info "Nginx config changed — restarting nginx"
  compose -f "$COMPOSE_FILE" up -d --no-deps nginx
fi

# --- Status ---
print_header "Deploy Status"
print_service_status

print_info "Migration status:"
compose -f "$COMPOSE_FILE" exec -T app bunx prisma migrate status 2>/dev/null || print_warning "Could not check migrations"

echo ""
compose -f "$COMPOSE_FILE" logs --tail=15 app

print_header "Registry Deploy Complete"
print_success "Deployed $TARGET_APP_IMAGE — no build ran on this host"

print_useful_commands
