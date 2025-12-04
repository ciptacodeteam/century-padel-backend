# Database Backup System

Automated PostgreSQL backup system using Docker and cron.

## Features

- ✅ Automated daily backups at 00:10
- ✅ Keeps only the 3 most recent backups
- ✅ Stores backups outside Docker volumes (on VM storage)
- ✅ Compressed backups (gzip) to save space
- ✅ Easy restore functionality

## Configuration

### Environment Variables

Add to your `.env.production` file:

```bash
# Database credentials (already required)
DB_NAME=quantum_sport
DB_USER=postgres
DB_PASSWORD=your_secure_password

# Backup directory on VM storage (outside Docker)
BACKUP_PATH=/var/backups/quantum-sport-db
```

### Backup Location

By default, backups are stored at `/var/backups/quantum-sport-db` on the VM host.

**Important:** This directory must exist and be writable:

```bash
sudo mkdir -p /var/backups/quantum-sport-db
sudo chown $USER:$USER /var/backups/quantum-sport-db
```

## Usage

### Start Backup Service

The backup service starts automatically with docker-compose:

```bash
docker compose -f docker-compose.prod.yml up -d db-backup
```

### Check Backup Logs

```bash
docker compose -f docker-compose.prod.yml logs -f db-backup
```

### Manual Backup

Trigger a manual backup anytime:

```bash
docker compose -f docker-compose.prod.yml exec db-backup /bin/sh /backup-db.sh
```

### List Backups

```bash
ls -lht /var/backups/quantum-sport-db/
```

### Restore from Backup

#### Restore from most recent backup:

```bash
docker compose -f docker-compose.prod.yml exec db-backup /bin/sh /restore-db.sh
```

#### Restore from specific backup:

```bash
docker compose -f docker-compose.prod.yml exec db-backup /bin/sh /restore-db.sh quantum-sport-backup-20251204_001000.sql.gz
```

## Backup Schedule

- **Time:** 00:10 daily (12:10 AM)
- **Retention:** 3 most recent backups
- **Format:** `quantum-sport-backup-YYYYMMDD_HHMMSS.sql.gz`

## Backup File Naming

Example: `quantum-sport-backup-20251204_001000.sql.gz`

- `20251204` - Date (December 4, 2025)
- `001000` - Time (00:10:00)
- `.sql.gz` - Compressed SQL dump

## Storage Management

### Backup Retention

The system automatically keeps only the 3 most recent backups. Older backups are automatically deleted during each backup run.

To change retention (e.g., keep 7 backups):

```yaml
# In docker-compose.prod.yml
environment:
  BACKUP_RETENTION: 7
```

### Disk Space

Typical backup sizes:

- Small database (<100MB): ~5-20MB compressed
- Medium database (100MB-1GB): ~20-200MB compressed
- Large database (>1GB): ~200MB+ compressed

Monitor disk usage:

```bash
du -sh /var/backups/quantum-sport-db/
```

## Troubleshooting

### Backup not running

1. Check if container is running:

   ```bash
   docker compose -f docker-compose.prod.yml ps db-backup
   ```

2. Check cron logs:
   ```bash
   docker compose -f docker-compose.prod.yml exec db-backup cat /var/log/backup.log
   ```

### Permission denied

Ensure backup directory has correct permissions:

```bash
sudo chown -R $USER:$USER /var/backups/quantum-sport-db
```

### Database connection failed

Verify database credentials in `.env.production`:

```bash
docker compose -f docker-compose.prod.yml exec db-backup env | grep DB_
```

## Security Recommendations

1. **Secure backup directory:**

   ```bash
   sudo chmod 700 /var/backups/quantum-sport-db
   ```

2. **Encrypt sensitive backups** (optional):

   ```bash
   gpg --symmetric --cipher-algo AES256 quantum-sport-backup-*.sql.gz
   ```

3. **Off-site backups:** Consider syncing to cloud storage:
   ```bash
   # Example with rsync to remote server
   rsync -avz /var/backups/quantum-sport-db/ user@backup-server:/backups/
   ```

## Recovery Testing

Regularly test your backups:

```bash
# 1. Restore to a test database
docker compose -f docker-compose.prod.yml exec db-backup /bin/sh /restore-db.sh

# 2. Verify data integrity
docker compose -f docker-compose.prod.yml exec app bunx prisma db pull
```

## Manual Operations

### Copy backup to local machine

```bash
scp user@server:/var/backups/quantum-sport-db/quantum-sport-backup-*.sql.gz ./
```

### Restore backup manually

```bash
# On the server
gunzip -c /var/backups/quantum-sport-db/quantum-sport-backup-YYYYMMDD_HHMMSS.sql.gz | \
  psql -h localhost -U postgres -d quantum_sport
```

## Monitoring

Set up monitoring alerts for:

- Backup failures (check exit codes)
- Disk space warnings
- Old backups (age > 3 days might indicate backup failure)

Example monitoring script:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/quantum-sport-db"
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/quantum-sport-backup-*.sql.gz 2>/dev/null | head -n 1)

if [ -z "$LATEST_BACKUP" ]; then
    echo "ERROR: No backups found!"
    exit 1
fi

AGE=$(( ($(date +%s) - $(stat -c %Y "$LATEST_BACKUP")) / 3600 ))
if [ $AGE -gt 48 ]; then
    echo "WARNING: Latest backup is $AGE hours old!"
    exit 1
fi

echo "OK: Latest backup is $AGE hours old"
```
