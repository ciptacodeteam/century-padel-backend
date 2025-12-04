#!/bin/bash

# ============================================
# PostgreSQL Database Backup Script
# ============================================
# This script performs automated PostgreSQL backups
# - Runs daily at 00:10 via cron
# - Keeps only the latest 3 backups
# - Stores backups outside Docker volumes (on VM storage)

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/quantum-sport-db}"
BACKUP_RETENTION="${BACKUP_RETENTION:-3}"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="quantum-sport-backup-${DATE}.sql.gz"

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

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Database Backup Started${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Create backup directory if it doesn't exist
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${YELLOW}📁 Creating backup directory: ${BACKUP_DIR}${NC}"
    mkdir -p "$BACKUP_DIR"
fi

# Perform database backup
echo -e "${BLUE}💾 Starting backup: ${BACKUP_FILE}${NC}"
echo -e "   Database: ${DB_NAME}"
echo -e "   User: ${DB_USER}"
echo ""

# Export password for pg_dump
export PGPASSWORD

# Perform backup with pg_dump and compress with gzip
if pg_dump -h localhost -U "$DB_USER" "$DB_NAME" | gzip > "${BACKUP_DIR}/${BACKUP_FILE}"; then
    BACKUP_SIZE=$(du -h "${BACKUP_DIR}/${BACKUP_FILE}" | cut -f1)
    echo -e "${GREEN}✅ Backup completed successfully${NC}"
    echo -e "   File: ${BACKUP_FILE}"
    echo -e "   Size: ${BACKUP_SIZE}"
    echo ""
else
    echo -e "${RED}❌ Backup failed!${NC}"
    exit 1
fi

# Cleanup old backups (keep only the latest N backups)
echo -e "${BLUE}🧹 Cleaning up old backups (keeping ${BACKUP_RETENTION} most recent)${NC}"

BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/quantum-sport-backup-*.sql.gz 2>/dev/null | wc -l)
echo -e "   Total backups: ${BACKUP_COUNT}"

if [ "$BACKUP_COUNT" -gt "$BACKUP_RETENTION" ]; then
    # List backups sorted by modification time, skip the newest N, delete the rest
    BACKUPS_TO_DELETE=$(ls -1t "${BACKUP_DIR}"/quantum-sport-backup-*.sql.gz | tail -n +$((BACKUP_RETENTION + 1)))
    
    if [ -n "$BACKUPS_TO_DELETE" ]; then
        echo -e "${YELLOW}   Deleting old backups:${NC}"
        echo "$BACKUPS_TO_DELETE" | while read -r backup; do
            echo -e "   - $(basename "$backup")"
            rm -f "$backup"
        done
    fi
else
    echo -e "${GREEN}   No cleanup needed${NC}"
fi

echo ""
echo -e "${BLUE}📋 Current backups:${NC}"
ls -lht "${BACKUP_DIR}"/quantum-sport-backup-*.sql.gz | head -n "$BACKUP_RETENTION" | awk '{print "   " $9 " (" $5 ")"}'

echo ""
echo -e "${GREEN}✅ Backup process completed${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
