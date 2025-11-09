# Email Worker Docker Guide

## Overview

The email worker is now fully integrated into the Docker setup and runs as a separate service alongside the main application.

## Architecture

```
┌─────────────────┐
│   Application   │
│   (Port 8000)   │
│                 │
│ Queues Jobs → │
│                 │
└────────┬────────┘
         │
         ↓
    ┌─────────┐
    │  Redis  │
    │ (Queue) │
    └────┬────┘
         │
         ↓
┌──────────────────┐
│ Email Worker     │
│ (Background)     │
│                  │
│ Processes Jobs → │
└─────────┬────────┘
          │
          ↓
    ┌──────────────┐
    │ SMTP Service │
    │ (Email Send) │
    └──────────────┘
```

## Running Services

### Option 1: Start All Services (Recommended)

```bash
# Start everything including email worker
docker compose up -d

# Verify all services are running
docker compose ps

# Expected output:
# NAME                    STATUS
# quantum-sport-db        Up (healthy)
# quantum-sport-redis     Up (healthy)
# quantum-sport-app       Up
# quantum-sport-email-worker  Up
# quantum-sport-prisma-studio Up
```

### Option 2: Start Only App (Without Worker)

```bash
# Start without email worker (for testing)
docker compose up -d db redis app prisma-studio

# Then manually run worker on your machine
bun run worker:email
```

### Option 3: Start Individual Services

```bash
# Start just database
docker compose up -d db

# Start just Redis
docker compose up -d redis

# Start just app
docker compose up -d app

# Start just email worker
docker compose up -d email-worker

# Start just Prisma Studio
docker compose up -d prisma-studio
```

## Monitoring Email Worker

### View Logs

```bash
# Real-time logs
docker compose logs -f email-worker

# Last 100 lines
docker compose logs --tail=100 email-worker

# With timestamps
docker compose logs -f --timestamps email-worker
```

### View All Logs

```bash
# All services
docker compose logs -f

# Specific time range
docker compose logs --since 10m email-worker
```

### Check Service Status

```bash
# Detailed service info
docker compose ps email-worker

# Docker stats
docker stats quantum-sport-email-worker

# Process info
docker compose exec email-worker ps aux
```

## Troubleshooting

### Email Worker Not Starting

```bash
# Check logs for errors
docker compose logs email-worker

# Common issues:
# 1. Redis not running
docker compose up -d redis

# 2. Database not running
docker compose up -d db

# 3. Missing environment variables
# Verify .env.local has SMTP settings
```

### Email Worker Exiting

```bash
# Check exit code
docker compose logs email-worker | grep -i error

# Restart worker
docker compose restart email-worker

# Force rebuild and restart
docker compose up -d --build email-worker
```

### Redis Connection Errors

```bash
# Verify Redis is running
docker compose logs redis

# Test Redis connection
docker compose exec redis redis-cli ping
# Should return: PONG

# If not, restart Redis
docker compose restart redis
```

### SMTP Connection Errors

```bash
# Verify SMTP settings in .env.local
cat .env.local | grep SMTP

# Test SMTP connection from container
docker compose exec email-worker bun -e "
  import nodemailer from 'nodemailer'
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    }
  })
  await transporter.verify()
  console.log('SMTP connected!')
"
```

## Queue Management

### View Queue Statistics

```bash
# Connect to Redis
docker compose exec redis redis-cli

# In Redis CLI:
# Check email queue
HGETALL "bull:email:meta"

# View queue length
LLEN "bull:email:wait"

# Monitor in real-time
MONITOR
```

### Clear Queue (Emergency Only)

```bash
# WARNING: This deletes all pending emails!
docker compose exec redis redis-cli DEL "bull:email:*"
```

## Performance Monitoring

### View Worker Memory Usage

```bash
# Real-time stats
docker stats quantum-sport-email-worker --no-stream

# Continuous monitoring
docker stats quantum-sport-email-worker
```

### View CPU Usage

```bash
# Top processes in container
docker compose exec email-worker top
```

## Scaling Workers

### Run Multiple Worker Instances

```bash
# Create docker-compose.override.yml to run 3 workers
cat > docker-compose.override.yml << 'EOF'
version: '3.9'
services:
  email-worker-2:
    extends:
      service: email-worker
    container_name: quantum-sport-email-worker-2

  email-worker-3:
    extends:
      service: email-worker
    container_name: quantum-sport-email-worker-3
EOF

# Start all services
docker compose up -d

# Verify 3 workers running
docker compose ps | grep email-worker
```

## Development Workflow

### Iterate on Worker Code

```bash
# 1. Make code changes in src/workers/email.worker.ts or src/services/email.service.ts

# 2. Rebuild and restart worker
docker compose up -d --build email-worker

# 3. Watch logs
docker compose logs -f email-worker

# 4. Test by sending password reset from admin endpoint
curl -X POST http://localhost:8000/admin/users/{userId}/send-reset-password
```

### Debug Worker

```bash
# Run with debug output
docker compose exec email-worker bun --inspect-brk src/workers/email.worker.ts

# Or add debug env var
docker compose exec -e DEBUG=* email-worker bun run worker:email
```

## Environment Variables

### Required for Email Worker

```env
# Database
DATABASE_URL=postgresql://user:pass@db:5432/quantum_sport

# Redis
REDIS_URL=redis://redis:6379

# SMTP
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_username
SMTP_PASS=your_password
SMTP_FROM=noreply@quantumsport.com

# Logging
LOG_LEVEL=debug
```

### Optional

```env
# For development
NODE_ENV=development

# For debugging
DEBUG=bullmq:*
```

## Production Deployment

### 1. Update docker-compose.yml

```yaml
# Change restart policy
restart: always

# Add resource limits
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 512M
    reservations:
      cpus: '0.5'
      memory: 256M
```

### 2. Setup Monitoring

```bash
# Add healthcheck
healthcheck:
  test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
  interval: 30s
  timeout: 10s
  retries: 3
```

### 3. Setup Logging

```bash
# Persist logs
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "10"
```

### 4. Production Environment

```env
NODE_ENV=production
LOG_LEVEL=info

# Use strong SMTP credentials
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASS=your_sendgrid_api_key

# Increase worker concurrency for production
# (Modify in src/services/email-queue.service.ts)
```

## Health Checks

### Verify Worker Health

```bash
# Check if Redis can connect
docker compose exec email-worker redis-cli ping

# Check logs for errors
docker compose logs email-worker | grep -i error

# Monitor queue depth
docker compose exec redis redis-cli LLEN "bull:email:wait"
```

### Automated Health Check Script

```bash
#!/bin/bash
# check-worker.sh

REDIS_HEALTHY=$(docker compose exec -T redis redis-cli ping)
DB_HEALTHY=$(docker compose exec -T db pg_isready -U postgres)
WORKER_RUNNING=$(docker compose ps | grep email-worker | grep -c Up)

if [ "$REDIS_HEALTHY" == "PONG" ] && [ "$DB_HEALTHY" == "accepting connections" ] && [ "$WORKER_RUNNING" -gt 0 ]; then
  echo "✅ All systems healthy"
  exit 0
else
  echo "❌ System unhealthy"
  exit 1
fi
```

## Tips & Best Practices

✅ **Always start with `docker compose up -d`** - Ensures all dependencies are running
✅ **Monitor logs regularly** - Catch issues early with `docker compose logs -f`
✅ **Set resource limits** - Prevent runaway processes
✅ **Use health checks** - Automatic recovery on failure
✅ **Scale horizontally** - Run multiple workers under load
✅ **Log rotation** - Use json-file driver with max-size
✅ **Regular backups** - Backup Redis persistence data
✅ **Rate limiting** - Configure SMTP provider limits

## Quick Commands Reference

```bash
# Start everything
docker compose up -d

# View all logs
docker compose logs -f

# View worker logs only
docker compose logs -f email-worker

# Stop everything
docker compose down

# Stop and remove volumes
docker compose down -v

# Rebuild everything
docker compose up -d --build

# Just email worker
docker compose up -d email-worker

# Remove and restart worker
docker compose rm -f email-worker && docker compose up -d email-worker

# Check service health
docker compose ps

# Execute command in worker
docker compose exec email-worker bun -v

# Attach to running worker
docker compose logs -f --tail=0 email-worker
```
