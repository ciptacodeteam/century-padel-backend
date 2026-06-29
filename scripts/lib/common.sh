#!/bin/bash
# Shared helpers for install / deploy / update scripts.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

print_info()    { echo -e "${BLUE}ℹ️  $1${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error()   { echo -e "${RED}❌ $1${NC}"; }

# Resolve project root (parent of scripts/)
if [ -z "${PROJECT_ROOT:-}" ]; then
  PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

cd "$PROJECT_ROOT"

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

compose() {
  local args=()
  if [ -f "$PROJECT_ROOT/$ENV_FILE" ]; then
    args+=(--env-file "$PROJECT_ROOT/$ENV_FILE")
  fi
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "${args[@]}" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "${args[@]}" "$@"
  else
    print_error "Docker Compose not found. Run: ./scripts/install-vps.sh"
    exit 1
  fi
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    print_error "Docker is not installed. Run: ./scripts/install-vps.sh"
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    print_error "Docker daemon is not running or you lack permission."
    print_info "Try: sudo systemctl start docker"
    print_info "Or add your user to the docker group: sudo usermod -aG docker \$USER && newgrp docker"
    exit 1
  fi
}

require_project_root() {
  if [ ! -f "$PROJECT_ROOT/package.json" ] || [ ! -f "$PROJECT_ROOT/Dockerfile" ]; then
    print_error "Must run from century-padel-backend project root (package.json + Dockerfile missing)"
    print_info "Current: $PROJECT_ROOT"
    exit 1
  fi
}

load_env() {
  if [ -f "$PROJECT_ROOT/$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$PROJECT_ROOT/$ENV_FILE"
    set +a
  fi
}

# Persist APP_IMAGE in the Compose default env file (.env) so that subsequent
# manual `docker compose -f docker-compose.prod.yml ...` commands resolve the
# same prebuilt image that was last deployed from the registry.
persist_app_image() {
  local image="$1"
  local env_default="$PROJECT_ROOT/.env"

  [ -n "$image" ] || return 0
  touch "$env_default"

  if grep -q '^APP_IMAGE=' "$env_default" 2>/dev/null; then
    sed -i "s|^APP_IMAGE=.*|APP_IMAGE=${image}|" "$env_default"
  else
    echo "APP_IMAGE=${image}" >> "$env_default"
  fi
}

read_persisted_app_image() {
  local env_default="$PROJECT_ROOT/.env"
  if [ -f "$env_default" ]; then
    grep -E '^APP_IMAGE=' "$env_default" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r'
  fi
}

read_running_app_image() {
  docker inspect century-padel-app-prod --format '{{.Config.Image}}' 2>/dev/null | tr -d '\r' || true
}

read_last_good_app_image() {
  local marker="$PROJECT_ROOT/.deploy-last-good-image"
  if [ -f "$marker" ]; then
    head -n1 "$marker" | tr -d '\r'
  fi
}

save_last_good_app_image() {
  local image="$1"
  local marker="$PROJECT_ROOT/.deploy-last-good-image"
  [ -n "$image" ] && printf '%s\n' "$image" > "$marker"
}

resolve_app_port() {
  load_env
  echo "${PORT:-8000}"
}

# HTTP probe against the app binding on localhost (same check CI uses post-deploy).
probe_app_http_health() {
  local port="${1:-$(resolve_app_port)}"
  local max_attempts="${2:-12}"
  local i

  for i in $(seq 1 "$max_attempts"); do
    if curl -fsS --max-time 5 "http://127.0.0.1:${port}/health" 2>/dev/null \
      | grep -qE '"success"[[:space:]]*:[[:space:]]*true|"up"[[:space:]]*:[[:space:]]*true'; then
      return 0
    fi
    echo "  HTTP health attempt ${i}/${max_attempts} not ready; retrying in 5s..."
    sleep 5
  done
  return 1
}

# Restore the last known-good image and restart app + workers.
rollback_app_deployment() {
  local rollback_image="$1"

  if [ -z "$rollback_image" ]; then
    print_error "No previous image to roll back to"
    return 1
  fi

  print_header "Rolling back to previous image"
  print_warning "Target: $rollback_image"

  export APP_IMAGE="$rollback_image"
  compose -f "$COMPOSE_FILE" pull app 2>/dev/null || true
  compose -f "$COMPOSE_FILE" up -d --no-deps app

  print_info "Waiting for rolled-back app to become healthy..."
  if wait_for_healthy app 30 && probe_app_http_health "$(resolve_app_port)" 12; then
    compose -f "$COMPOSE_FILE" up -d --no-deps email-worker scheduler-worker
    persist_app_image "$rollback_image"
    save_last_good_app_image "$rollback_image"
    print_success "Rollback complete — previous version is serving again"
    return 0
  fi

  print_error "Rollback failed — manual intervention required"
  return 1
}

# Writable staging dir for pg_dump before Spaces upload (override via LOCAL_BACKUP_DIR).
resolve_local_backup_dir() {
  LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-${PROJECT_ROOT}/.backups}"
  mkdir -p "$LOCAL_BACKUP_DIR"
}

generate_secret() {
  openssl rand -base64 48 | tr -d '/+=' | head -c 48
}

ensure_env_file() {
  local interactive="${1:-true}"

  if [ -f "$PROJECT_ROOT/$ENV_FILE" ]; then
    return 0
  fi

  print_warning "$ENV_FILE not found — creating from template"

  if [ ! -f "$PROJECT_ROOT/docker/env.production.template" ]; then
    print_error "Template missing: docker/env.production.template"
    exit 1
  fi

  cp "$PROJECT_ROOT/docker/env.production.template" "$PROJECT_ROOT/$ENV_FILE"

  # Auto-fill secrets so a fresh deploy can proceed non-interactively when AUTO_DEPLOY=true
  if [ "${AUTO_DEPLOY:-}" = "true" ] || [ "${GENERATE_SECRETS:-}" = "true" ]; then
    local db_pass jwt jwt_refresh
    db_pass="$(generate_secret)"
    jwt="$(generate_secret)"
    jwt_refresh="$(generate_secret)"

    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${db_pass}|" "$PROJECT_ROOT/$ENV_FILE"
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${jwt}|" "$PROJECT_ROOT/$ENV_FILE"
    sed -i "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${jwt_refresh}|" "$PROJECT_ROOT/$ENV_FILE"
    print_success "Generated DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET"
    print_warning "Save $ENV_FILE securely — secrets were auto-generated"
  elif [ "$interactive" = "true" ]; then
    print_info "Edit $ENV_FILE — required: DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, SSL_DOMAIN, BASE_URL"
    print_info "Generate secrets: openssl rand -base64 48"
    read -r -p "Press Enter after editing $ENV_FILE..."
  fi
}

validate_env() {
  local missing=()
  local var

  for var in DB_PASSWORD JWT_SECRET JWT_REFRESH_SECRET; do
    if ! grep -q "^${var}=" "$PROJECT_ROOT/$ENV_FILE" 2>/dev/null; then
      missing+=("$var")
      continue
    fi
    if grep -q "^${var}=your_" "$PROJECT_ROOT/$ENV_FILE" || grep -q "^${var}=$" "$PROJECT_ROOT/$ENV_FILE"; then
      missing+=("$var")
    fi
  done

  if grep -q "^DATABASE_URL=" "$PROJECT_ROOT/$ENV_FILE" 2>/dev/null; then
    print_warning "DATABASE_URL is set in $ENV_FILE but is ignored in production"
    print_info "Remove it — docker-compose builds DATABASE_URL from DB_USER/DB_PASSWORD/DB_NAME"
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    print_error "Missing or placeholder values in $ENV_FILE:"
    printf '  - %s\n' "${missing[@]}"
    exit 1
  fi
}

wait_for_healthy() {
  local service="$1"
  local max_attempts="${2:-30}"
  local i

  for i in $(seq 1 "$max_attempts"); do
    if compose -f "$COMPOSE_FILE" ps "$service" 2>/dev/null | grep -q "(healthy)"; then
      return 0
    fi
    echo "  Waiting for ${service}... (${i}/${max_attempts})"
    sleep 3
  done
  return 1
}

make_scripts_executable() {
  chmod +x "$PROJECT_ROOT"/scripts/*.sh 2>/dev/null || true
  chmod +x "$PROJECT_ROOT"/scripts/lib/*.sh 2>/dev/null || true
  chmod +x "$PROJECT_ROOT"/docker/*.sh 2>/dev/null || true
  chmod +x "$PROJECT_ROOT"/docker/nginx/docker-entrypoint.sh 2>/dev/null || true
  chmod +x "$PROJECT_ROOT"/docker/certbot-entrypoint.sh 2>/dev/null || true
}

print_service_status() {
  compose -f "$COMPOSE_FILE" ps
}

print_useful_commands() {
  load_env
  echo ""
  print_info "Useful commands:"
  echo "  Logs:     docker compose -f $COMPOSE_FILE logs -f app"
  echo "  Status:   docker compose -f $COMPOSE_FILE ps"
  echo "  Update:   ./scripts/update.sh"
  echo "  Health:   curl -s https://\${SSL_DOMAIN:-localhost}/health"
  echo "  SSL:      ./docker/ssl-init.sh"
}
