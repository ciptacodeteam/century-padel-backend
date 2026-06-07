#!/bin/bash
# =============================================================================
# Step 3 — Incremental update (run when application code changes)
# =============================================================================
# Pulls latest code, rebuilds ONLY the app image (uses Docker layer cache),
# restarts app + workers. Does NOT rebuild db/redis/nginx/certbot from scratch.
#
# Usage:
#   ./scripts/update.sh
#
# Options via environment:
#   SKIP_PULL=true           Skip git pull
#   REBUILD_ALL=true         Rebuild every service that has a build section
#   CLEAN_BUILD=true         Build without cache (slow — use only if needed)
#   AUTO_DEPLOY=true         Skip confirmation prompt
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

print_header "Century Padel — Application Update (Step 3)"

require_project_root
require_docker
make_scripts_executable

if [ ! -f "$PROJECT_ROOT/$ENV_FILE" ]; then
  print_error "$ENV_FILE missing — run ./scripts/deploy-fresh.sh first"
  exit 1
fi

validate_env
load_env

if [ "${AUTO_DEPLOY:-}" != "true" ]; then
  print_info "Fast update: pull code → rebuild app image (cached) → restart app + workers"
  read -r -p "Continue? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
  fi
fi

# --- Git pull ---
if [ "${SKIP_PULL:-false}" != "true" ] && [ -d "$PROJECT_ROOT/.git" ]; then
  print_header "Pulling latest code"
  BEFORE_HEAD="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"
  git -C "$PROJECT_ROOT" pull origin "${DEPLOY_BRANCH:-main}"
  AFTER_HEAD="$(git -C "$PROJECT_ROOT" rev-parse HEAD)"

  if [ "$BEFORE_HEAD" = "$AFTER_HEAD" ]; then
    print_info "Already up to date ($AFTER_HEAD)"
  else
    print_success "Updated $(git -C "$PROJECT_ROOT" log -1 --oneline)"
  fi

  # Auto-detect infra changes that need a wider rebuild
  CHANGED_FILES="$(git -C "$PROJECT_ROOT" diff --name-only "$BEFORE_HEAD" "$AFTER_HEAD" 2>/dev/null || true)"
  if echo "$CHANGED_FILES" | grep -qE '^(Dockerfile|docker-compose\.prod\.yml|docker/|prisma/schema\.prisma)'; then
    print_warning "Infrastructure or schema changes detected"
    if [ "${REBUILD_ALL:-false}" != "true" ]; then
      print_info "Tip: REBUILD_ALL=true ./scripts/update.sh for compose/docker changes"
    fi
  fi
else
  print_info "Skipping git pull (SKIP_PULL=true or not a git repo)"
fi

# --- Build (app only by default) ---
print_header "Building application image (uses cache — typically 1–3 min)"

BUILD_ARGS=()
if [ "${CLEAN_BUILD:-false}" = "true" ]; then
  BUILD_ARGS+=(--no-cache)
  print_warning "Clean build requested — this will be slow"
fi

if [ "${REBUILD_ALL:-false}" = "true" ]; then
  compose -f "$COMPOSE_FILE" build "${BUILD_ARGS[@]}"
else
  compose -f "$COMPOSE_FILE" build "${BUILD_ARGS[@]}" app
fi
print_success "Build complete"

# --- Rolling restart app + workers (same image tag) ---
print_header "Restarting application and workers"

compose -f "$COMPOSE_FILE" up -d --no-deps app
print_info "Waiting for app..."
if wait_for_healthy app 20; then
  print_success "App healthy"
else
  print_warning "App health check pending — tail logs if needed"
fi

compose -f "$COMPOSE_FILE" up -d --no-deps email-worker scheduler-worker
print_success "Workers restarted"

# Reload nginx only if nginx config templates changed
if [ -n "${CHANGED_FILES:-}" ] && echo "$CHANGED_FILES" | grep -q 'docker/nginx/'; then
  print_info "Nginx config changed — restarting nginx"
  compose -f "$COMPOSE_FILE" up -d --no-deps nginx
fi

# --- Status ---
print_header "Update Status"
print_service_status

print_info "Migration status:"
compose -f "$COMPOSE_FILE" exec -T app bunx prisma migrate status 2>/dev/null || print_warning "Could not check migrations"

echo ""
compose -f "$COMPOSE_FILE" logs --tail=15 app

print_header "Update Complete"
print_success "Application updated without full stack rebuild"

print_useful_commands
