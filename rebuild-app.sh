#!/bin/bash

# ============================================
# Quick App Rebuild Script
# ============================================
# Rebuilds only the app service after code changes

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Prefer Docker Compose v2 (`docker compose`) with fallback to legacy `docker-compose`
compose() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        docker compose "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose "$@"
    else
        print_error "docker compose/docker-compose not found"
        exit 1
    fi
}

# Enable Docker BuildKit
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

echo ""
print_info "Rebuilding application after code changes..."
echo ""

# Check if clean build is requested
if [ "${CLEAN_BUILD:-}" = "true" ]; then
    print_warning "Performing clean build (no cache)..."
    compose -f docker-compose.prod.yml build --no-cache app
else
    print_info "Building with cache (faster)..."
    print_info "Tip: Set CLEAN_BUILD=true for a clean build"
    compose -f docker-compose.prod.yml build app
fi

print_success "Build completed"
echo ""

# Restart services that use the app image
print_info "Restarting app and email-worker services..."
compose -f docker-compose.prod.yml up -d app email-worker

print_success "Services restarted"
echo ""

# Show logs
print_info "Recent app logs (press Ctrl+C to exit):"
sleep 2
compose -f docker-compose.prod.yml logs --tail=50 -f app

