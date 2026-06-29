#!/bin/bash
# =============================================================================
# Registry deploy — pull a prebuilt image and restart app + workers
# =============================================================================
# NO Docker build happens on this host. The image is built and pushed by CI
# (GitHub Actions → GHCR); this script only pulls it and rolls the containers.
# This keeps build CPU/RAM off the production VPS.
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

# Make the tag available to Compose interpolation now and for future commands.
persist_app_image "$APP_IMAGE"
export APP_IMAGE

print_info "Target image: $APP_IMAGE"

if [ "${AUTO_DEPLOY:-}" != "true" ]; then
  read -r -p "Pull and deploy this image? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
  fi
fi

# --- Sync config from git (compose / nginx / scripts) ---
# The app CODE is already baked into the prebuilt image, so we do NOT build.
# We still pull so infra config (compose, nginx templates) stays in sync.
if [ "${SKIP_PULL_CODE:-false}" != "true" ] && [ -d "$PROJECT_ROOT/.git" ]; then
  print_header "Syncing config from git"
  if git -C "$PROJECT_ROOT" pull origin "${DEPLOY_BRANCH:-main}"; then
    print_success "Config up to date"
  else
    print_warning "git pull failed — continuing with current config"
  fi
fi

# --- Pull prebuilt image ---
print_header "Pulling application image"
compose -f "$COMPOSE_FILE" pull app
print_success "Image pulled"

# --- Rolling restart: app first (runs migrations), then workers ---
print_header "Restarting application"
compose -f "$COMPOSE_FILE" up -d --no-deps app
print_info "Waiting for app to become healthy..."
if wait_for_healthy app 30; then
  print_success "App healthy"
else
  print_warning "App health check pending — tail logs: compose -f $COMPOSE_FILE logs -f app"
fi

print_header "Restarting workers"
compose -f "$COMPOSE_FILE" up -d --no-deps email-worker scheduler-worker
print_success "Workers restarted"

# Reload nginx only if its config templates changed in this pull
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
print_success "Deployed $APP_IMAGE — no build ran on this host"

print_useful_commands
