#!/bin/bash
# =============================================================================
# Step 2 — First deploy from scratch (run once after install-vps.sh)
# =============================================================================
# Full build, starts all services, runs SSL bootstrap, seeds production stack.
#
# Usage:
#   cd century-padel-backend
#   cp docker/env.production.template .env.production && nano .env.production
#   ./scripts/deploy-fresh.sh
#
# Non-interactive (CI / automation):
#   AUTO_DEPLOY=true GENERATE_SECRETS=true ./scripts/deploy-fresh.sh
#
# Force clean rebuild:
#   CLEAN_BUILD=true ./scripts/deploy-fresh.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

print_header "Century Padel — Fresh Deploy (Step 2 of 3)"

require_project_root
require_docker
make_scripts_executable

ensure_env_file true
validate_env
load_env

if [ "${AUTO_DEPLOY:-}" != "true" ]; then
  print_warning "This performs a FULL first-time production deploy"
  read -r -p "Continue? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Cancelled."
    exit 0
  fi
fi

# --- Pull latest code if git repo ---
if [ -d "$PROJECT_ROOT/.git" ]; then
  print_header "Pulling latest code"
  if git -C "$PROJECT_ROOT" pull origin "${DEPLOY_BRANCH:-main}"; then
    print_success "Code updated"
  else
    print_warning "Git pull failed — continuing with current code"
  fi
fi

# --- Build ---
print_header "Building Docker images (first build: 5–10 min on 4GB VPS)"

if [ "${CLEAN_BUILD:-false}" = "true" ]; then
  print_warning "Clean build (no cache) — slower but safest"
  compose -f "$COMPOSE_FILE" build --no-cache
else
  compose -f "$COMPOSE_FILE" build
fi
print_success "Images built"

# --- Core services ---
print_header "Starting database, Redis, and application"
compose -f "$COMPOSE_FILE" up -d db redis app

print_info "Waiting for app to become healthy..."
if wait_for_healthy app 30; then
  print_success "Application is healthy"
else
  print_warning "App not healthy yet — check: compose -f $COMPOSE_FILE logs -f app"
fi

# --- SSL + nginx ---
print_header "SSL & nginx (fully containerized)"
if [ -f "$PROJECT_ROOT/docker/ssl-init.sh" ]; then
  if bash "$PROJECT_ROOT/docker/ssl-init.sh"; then
    print_success "SSL and nginx ready"
  else
    print_warning "SSL init incomplete — nginx runs HTTP-only until DNS/port 80 is fixed"
    print_info "After fixing DNS/firewall: ./docker/ssl-init.sh"
    compose -f "$COMPOSE_FILE" up -d nginx || true
  fi
else
  compose -f "$COMPOSE_FILE" up -d nginx
fi

# --- Workers + certbot ---
print_header "Starting background workers"
compose -f "$COMPOSE_FILE" up -d email-worker scheduler-worker certbot
print_success "Workers started"

# --- Verify ---
print_header "Deployment Status"
print_service_status

print_info "Checking migrations..."
if compose -f "$COMPOSE_FILE" exec -T app bunx prisma migrate status 2>/dev/null; then
  print_success "Migrations OK"
else
  print_warning "Could not verify migrations — app entrypoint runs migrate deploy on start"
fi

echo ""
print_info "Recent app logs:"
compose -f "$COMPOSE_FILE" logs --tail=20 app

print_header "Fresh Deploy Complete"
print_success "Production stack is running"

load_env
if [ -n "${BASE_URL:-}" ]; then
  print_info "API URL: ${BASE_URL}"
fi
if [ -n "${SSL_DOMAIN:-}" ]; then
  print_info "Test: curl -s https://${SSL_DOMAIN}/health"
fi

print_useful_commands
print_info "For future code changes use: ./scripts/update.sh"
