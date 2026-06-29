#!/bin/bash
# Obtain the initial Let's Encrypt certificate (fully containerized setup).
# Safe to re-run — skips if a valid certificate already exists.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE="docker-compose"
else
  print_error "Docker Compose not found"
  exit 1
fi

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DOMAIN="${SSL_DOMAIN:-api.centurypadel.id}"
EMAIL="${SSL_EMAIL:-admin@${DOMAIN#api.}}"

print_info "SSL domain: ${DOMAIN}"
print_info "SSL email:  ${EMAIL}"

# Ensure core services are up (nginx entrypoint auto-selects HTTP-only when no cert)
print_info "Starting db, redis, app, nginx..."
$DOCKER_COMPOSE -f "$COMPOSE_FILE" up -d db redis app nginx

print_info "Waiting for app to become healthy..."
for i in $(seq 1 20); do
  if $DOCKER_COMPOSE -f "$COMPOSE_FILE" ps app 2>/dev/null | grep -q "(healthy)"; then
    break
  fi
  sleep 3
done

# Check for existing certificate in the certbot volume
if $DOCKER_COMPOSE -f "$COMPOSE_FILE" run --rm --entrypoint certbot certbot certificates 2>/dev/null | grep -q "Certificate Name: ${DOMAIN}"; then
  print_success "Certificate already exists for ${DOMAIN}"
  print_info "Restarting nginx to ensure HTTPS config is active..."
  $DOCKER_COMPOSE -f "$COMPOSE_FILE" restart nginx
  exit 0
fi

print_info "Requesting initial certificate from Let's Encrypt..."
$DOCKER_COMPOSE -f "$COMPOSE_FILE" run --rm --entrypoint certbot certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

print_success "Certificate obtained"
print_info "Restarting nginx to switch from HTTP-only to HTTPS..."
$DOCKER_COMPOSE -f "$COMPOSE_FILE" restart nginx

sleep 3

print_info "Starting certbot renewal service..."
$DOCKER_COMPOSE -f "$COMPOSE_FILE" up -d certbot

print_success "SSL setup complete for https://${DOMAIN}"
