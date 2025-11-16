#!/bin/bash

# ============================================
# Production Deployment Script
# ============================================

set -e

# Prefer Docker Compose v2 (`docker compose`) with fallback to legacy `docker-compose`
compose() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        docker compose "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
        docker-compose "$@"
    else
        echo "Error: docker compose/docker-compose not found. Install Docker Engine and the compose plugin:"
        echo "  sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin"
        exit 1
    fi
}

echo "🚀 Starting Production Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo -e "${RED}Error: .env.production file not found!${NC}"
    echo "Please create .env.production from .env.production.example"
    exit 1
fi

# Confirm deployment
echo -e "${YELLOW}⚠️  This will deploy to PRODUCTION environment${NC}"
read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Deployment cancelled."
    exit 0
fi

# Load environment variables
source .env.production

# Pull latest code
echo -e "${GREEN}📥 Pulling latest code...${NC}"
git pull origin main

# Build and start containers
echo -e "${GREEN}🏗️  Building Docker images...${NC}"
compose -f docker-compose.prod.yml build --no-cache

echo -e "${GREEN}🗄️  Running database migrations...${NC}"
compose -f docker-compose.prod.yml run --rm app bunx prisma migrate deploy

echo -e "${GREEN}🌱 Generating Prisma Client...${NC}"
compose -f docker-compose.prod.yml run --rm app bunx prisma generate

echo -e "${GREEN}🚀 Starting production containers...${NC}"
compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo -e "${GREEN}⏳ Waiting for services to be healthy...${NC}"
sleep 10

# Check container status
echo -e "${GREEN}📊 Container Status:${NC}"
compose -f docker-compose.prod.yml ps

# Check logs
echo -e "${GREEN}📋 Recent logs:${NC}"
compose -f docker-compose.prod.yml logs --tail=50

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${GREEN}🌐 Application is running at: ${BASE_URL}${NC}"
echo ""
echo "Useful commands:"
echo "  View logs:       $(command -v docker >/dev/null 2>&1 && echo 'docker compose' || echo 'docker-compose') -f docker-compose.prod.yml logs -f"
echo "  Stop services:   $(command -v docker >/null 2>&1 && docker compose version >/dev/null 2>&1 && echo 'docker compose' || echo 'docker-compose') -f docker-compose.prod.yml down"
echo "  Restart service: $(command -v docker >/null 2>&1 && docker compose version >/dev/null 2>&1 && echo 'docker compose' || echo 'docker-compose') -f docker-compose.prod.yml restart app"
echo "  Shell access:    $(command -v docker >/null 2>&1 && docker compose version >/dev/null 2>&1 && echo 'docker compose' || echo 'docker-compose') -f docker-compose.prod.yml exec app sh"
