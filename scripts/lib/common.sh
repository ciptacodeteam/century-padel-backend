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
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
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
