#!/bin/bash

# ============================================
# PostgreSQL Database Restore Script
# ============================================
# This script restores a PostgreSQL backup

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/quantum-sport-db}"

# Database configuration from environment
DB_NAME="${DB_NAME:-quantum_sport}"
DB_USER="${DB_USER:-postgres}"
PGPASSWORD="${DB_PASSWORD}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Function to list available backups
list_backups() {
    echo -e "${BLUE}📋 Available backups:${NC}"
    echo ""
    ls -lht "${BACKUP_DIR}"/quantum-sport-backup-*.sql.gz 2>/dev/null | nl -w2 -s'. ' | awk '{print $1 " " $10 " (" $6 ")"}'
    echo ""
}

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Database Restore Tool${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if backup directory exists
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${RED}❌ Backup directory not found: ${BACKUP_DIR}${NC}"
    exit 1
fi

# List available backups
list_backups

# Check if specific backup file is provided as argument
if [ -n "$1" ]; then
    BACKUP_FILE="$1"
    
    # If it's just a filename, prepend the backup directory
    if [[ ! "$BACKUP_FILE" =~ ^/ ]]; then
        BACKUP_FILE="${BACKUP_DIR}/${BACKUP_FILE}"
    fi
else
    # Use the most recent backup
    BACKUP_FILE=$(ls -t "${BACKUP_DIR}"/quantum-sport-backup-*.sql.gz 2>/dev/null | head -n 1)
    
    if [ -z "$BACKUP_FILE" ]; then
        echo -e "${RED}❌ No backup files found${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}⚠️  No backup file specified, using most recent:${NC}"
    echo -e "   $(basename "$BACKUP_FILE")"
    echo ""
fi

# Verify backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}❌ Backup file not found: ${BACKUP_FILE}${NC}"
    exit 1
fi

# Confirmation prompt
echo -e "${YELLOW}⚠️  WARNING: This will OVERWRITE the current database!${NC}"
echo -e "   Database: ${DB_NAME}"
echo -e "   Backup: $(basename "$BACKUP_FILE")"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
echo ""

if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo -e "${YELLOW}Restore cancelled${NC}"
    exit 0
fi

# Export password for psql
export PGPASSWORD

echo -e "${BLUE}🔄 Starting restore...${NC}"
echo ""

# Drop existing connections
echo -e "${YELLOW}   Terminating active connections...${NC}"
psql -h localhost -U "$DB_USER" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" || true

# Drop and recreate database
echo -e "${YELLOW}   Recreating database...${NC}"
psql -h localhost -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};"
psql -h localhost -U "$DB_USER" -d postgres -c "CREATE DATABASE ${DB_NAME};"

# Restore from backup
echo -e "${YELLOW}   Restoring from backup...${NC}"
if gunzip -c "$BACKUP_FILE" | psql -h localhost -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
    echo ""
    echo -e "${GREEN}✅ Database restored successfully${NC}"
    echo -e "   From: $(basename "$BACKUP_FILE")"
else
    echo ""
    echo -e "${RED}❌ Restore failed!${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Restore completed${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
