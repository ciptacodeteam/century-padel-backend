#!/bin/bash

# ============================================
# Resolve Failed Prisma Migration
# ============================================
# This script helps resolve stuck migrations in production

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Prisma Migration Recovery Tool${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}❌ DATABASE_URL environment variable is not set!${NC}"
    echo ""
    echo "Usage:"
    echo "  # In Docker:"
    echo "  docker compose -f docker-compose.prod.yml exec app /bin/sh /app/scripts/resolve-migration.sh"
    echo ""
    echo "  # Locally:"
    echo "  DATABASE_URL='your_connection_string' ./scripts/resolve-migration.sh"
    exit 1
fi

# Check migration status
echo -e "${BLUE}📋 Checking current migration status...${NC}"
echo ""

bunx prisma migrate status || true

echo ""
echo -e "${YELLOW}⚠️  This will mark failed migrations as rolled back${NC}"
echo -e "${YELLOW}   and allow new migrations to be applied.${NC}"
echo ""
read -p "Continue? (yes/no): " -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo -e "${YELLOW}Operation cancelled${NC}"
    exit 0
fi

# Mark failed migrations as rolled back
echo -e "${BLUE}🔄 Marking failed migrations as rolled back...${NC}"

SQL_QUERY="UPDATE \"_prisma_migrations\" SET rolled_back_at = NOW() WHERE finished_at IS NULL AND rolled_back_at IS NULL;"

if echo "$SQL_QUERY" | bunx prisma db execute --stdin --url "$DATABASE_URL"; then
    echo -e "${GREEN}✅ Failed migrations marked as rolled back${NC}"
else
    echo -e "${RED}❌ Failed to update migration status${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}🔄 Deploying migrations...${NC}"
echo ""

if bunx prisma migrate deploy; then
    echo ""
    echo -e "${GREEN}✅ Migrations deployed successfully!${NC}"
else
    echo ""
    echo -e "${RED}❌ Migration deployment failed${NC}"
    echo ""
    echo -e "${YELLOW}Manual steps:${NC}"
    echo "1. Check migration files in prisma/migrations/"
    echo "2. Review the failed migration: 20251114161611_add_club_join_request"
    echo "3. Manually apply or fix the migration SQL"
    echo "4. Update _prisma_migrations table manually if needed"
    exit 1
fi

echo ""
echo -e "${BLUE}📋 Final migration status:${NC}"
echo ""
bunx prisma migrate status

echo ""
echo -e "${GREEN}✅ Migration recovery completed!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
