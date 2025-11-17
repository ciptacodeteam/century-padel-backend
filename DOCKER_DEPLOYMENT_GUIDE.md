# Docker Deployment Guide

This guide will help you deploy the Quantum Sport Backend using Docker in production.

## 📋 Prerequisites

- Docker Engine 20.10+ installed
- Docker Compose V2 installed
- Ubuntu/Debian server (or similar Linux distribution)
- At least 2GB RAM and 10GB disk space

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd quantum-sport-backend
```

### 2. Set Up Environment Variables

Copy the environment template and fill in your values:

```bash
cp docker/env.production.template .env.production
```

**Important:** Edit `.env.production` and set the following **required** variables:

```bash
# REQUIRED: Set a strong database password
DB_PASSWORD=your_super_secure_password_here

# REQUIRED: Set JWT secrets (min 32 characters)
JWT_SECRET=your_jwt_secret_min_32_chars_here
JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars_here

# REQUIRED: Set your payment gateway credentials
XENDIT_SECRET_KEY=your_xendit_secret_key

# REQUIRED: Set your email credentials
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

### 3. Build and Start Services

**Option A: Automated Deployment (Recommended)**
```bash
# Make script executable (first time only)
chmod +x deploy.sh

# Run deployment script
./deploy.sh
```

The script will:
- ✅ Validate your environment configuration
- ✅ Pull latest code from git
- ✅ Build Docker images with optimization
- ✅ Start all services
- ✅ Run migrations automatically
- ✅ Verify health status

**Option B: Manual Deployment**
```bash
# Build the Docker image (with BuildKit for better caching)
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build

# Start all services
docker-compose -f docker-compose.prod.yml up -d
```

### 4. Verify Deployment

```bash
# Check if all services are running
docker-compose -f docker-compose.prod.yml ps

# View application logs
docker-compose -f docker-compose.prod.yml logs -f app

# Check database connection
docker-compose -f docker-compose.prod.yml exec app bunx prisma db execute --stdin <<< "SELECT 1"
```

## 🔧 Common Issues & Solutions

### Issue 1: DB_PASSWORD Not Found

**Error:** `DB_PASSWORD is required`

**Solution:**
```bash
# Ensure .env.production exists and has DB_PASSWORD set
echo "DB_PASSWORD=your_secure_password" >> .env.production

# Restart services
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

### Issue 2: Migration Failures

**Error:** Migration fails during startup

**Solution:**
The migrations are now idempotent (safe to run multiple times). If you encounter issues:

```bash
# Check migration status
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate status

# Mark failed migrations as resolved
docker-compose -f docker-compose.prod.yml exec app sh -c \
  "echo \"UPDATE _prisma_migrations SET rolled_back_at = NOW() WHERE finished_at IS NULL;\" | bunx prisma db execute --stdin"

# Retry migrations
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy

# Restart the app
docker-compose -f docker-compose.prod.yml restart app
```

### Issue 3: Slow Build Times

**Solution:**
- Use BuildKit: `export DOCKER_BUILDKIT=1`
- Enable build cache: The Dockerfile uses cache mounts
- Ensure `bun.lockb` file exists (committed to git)

```bash
# Build with maximum cache utilization
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build --build-arg BUILDKIT_INLINE_CACHE=1
```

### Issue 4: Port Already in Use

**Error:** `port 80 is already allocated`

**Solution:**
```bash
# Option 1: Stop system nginx if running
sudo systemctl stop nginx

# Option 2: Change port in .env.production
echo "PORT=3001" >> .env.production

# Option 3: Comment out nginx service in docker-compose.prod.yml
# and use system nginx as reverse proxy
```

## 📊 Monitoring & Logs

### View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f app
docker-compose -f docker-compose.prod.yml logs -f db
docker-compose -f docker-compose.prod.yml logs -f redis

# Last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100 app
```

### Check Service Health

```bash
# Check health status
docker-compose -f docker-compose.prod.yml ps

# Check application health endpoint
curl http://localhost:3000/health
```

### Resource Usage

```bash
# Check resource usage
docker stats

# Check disk usage
docker system df
```

## 🔄 Updates & Maintenance

### Update Application

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build app
docker-compose -f docker-compose.prod.yml up -d app
```

### Backup Database

```bash
# Create backup
docker-compose -f docker-compose.prod.yml exec db pg_dump -U postgres quantum_sport > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
docker-compose -f docker-compose.prod.yml exec -T db psql -U postgres quantum_sport < backup.sql
```

### Clean Up

```bash
# Remove unused images and containers
docker system prune -a

# Remove volumes (⚠️ DANGER: This deletes data!)
docker-compose -f docker-compose.prod.yml down -v
```

## 🔐 Security Best Practices

1. **Never commit `.env.production`** to version control
2. **Use strong passwords** for DB_PASSWORD (min 16 characters)
3. **Regularly update** Docker images and dependencies
4. **Enable firewall** and only expose necessary ports
5. **Use SSL/TLS** certificates (configure nginx with Let's Encrypt)
6. **Monitor logs** for suspicious activity
7. **Regular backups** of database and volumes

## 🌐 Production Checklist

- [ ] `.env.production` configured with all required variables
- [ ] Strong passwords set (DB_PASSWORD, JWT secrets)
- [ ] SSL certificates configured (if using nginx)
- [ ] Firewall configured (only expose 80, 443, and SSH)
- [ ] Database backups scheduled
- [ ] Monitoring/alerting set up
- [ ] Log rotation configured
- [ ] Resource limits tested under load
- [ ] Health checks verified

## 📞 Support

If you encounter issues not covered in this guide:

1. Check container logs: `docker-compose -f docker-compose.prod.yml logs`
2. Verify environment variables: `docker-compose -f docker-compose.prod.yml config`
3. Check database connectivity: `docker-compose -f docker-compose.prod.yml exec app bunx prisma db execute --stdin <<< "SELECT 1"`
4. Review migration status: `docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate status`

## 🎯 Performance Tips

1. **Use BuildKit** for faster builds
2. **Enable cache mounts** in Dockerfile (already configured)
3. **Optimize database** with proper indexes (check Prisma schema)
4. **Use Redis** for caching and job queues (already configured)
5. **Monitor resource usage** and adjust limits in docker-compose.prod.yml
6. **Use nginx** for static file serving and SSL termination

## 🔄 Zero-Downtime Deployment

For production updates without downtime:

```bash
# Scale up with new version
docker-compose -f docker-compose.prod.yml up -d --scale app=2 --no-recreate

# Wait for new instance to be healthy
sleep 30

# Remove old instance
docker-compose -f docker-compose.prod.yml up -d --scale app=1
```

---

**Last Updated:** 2025-01-17

