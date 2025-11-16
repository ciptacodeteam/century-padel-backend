# Docker Production Deployment Guide

This guide covers deploying the Quantum Sport Backend using Docker in production.

## 📋 Prerequisites

- Docker Engine 20.10+ and Docker Compose 2.0+
- Git
- Domain name with SSL certificate (recommended)
- Minimum 2GB RAM, 2 CPU cores

## 🚀 Quick Start

### 1. Clone and Setup

```bash
git clone <repository-url>
cd quantum-sport-backend
```

### 2. Configure Environment

```bash
# Copy and edit production environment file
cp .env.production.example .env.production
nano .env.production
```

**Important variables to configure:**

- `DB_PASSWORD`: Strong PostgreSQL password
- `JWT_SECRET` & `JWT_REFRESH_SECRET`: Random secure strings
- `XENDIT_API_KEY`: Live Xendit API key
- `SMTP_*`: Production email credentials
- `BASE_URL` & `FRONT_END_URL`: Your domain URLs
- `PWD_PEPPER`: Random secure string

### 3. Deploy

```bash
# Make deploy script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

## 🏗️ Architecture

```
┌─────────────┐
│   Nginx     │ :80/:443 (Reverse Proxy + SSL)
└─────┬───────┘
      │
┌─────▼───────┐
│     App     │ :3000 (Node.js/Bun Backend)
└─────┬───────┘
      │
┌─────▼───────┬─────────────┐
│ PostgreSQL  │    Redis    │
│   :5432     │    :6379    │
└─────────────┴─────────────┘
```

## 🐳 Docker Compose Services

### Core Services

1. **db** - PostgreSQL 16 database
   - Port: 5432 (internal)
   - Volume: `postgres_data`
   - Health checks enabled

2. **redis** - Redis 7 cache/queue
   - Port: 6379 (internal)
   - Volume: `redis_data`
   - AOF persistence enabled

3. **app** - Main application
   - Port: 3000
   - Multi-stage build
   - Non-root user
   - Health checks enabled
   - Resource limits: 2 CPU, 2GB RAM

4. **email-worker** - Background email processor
   - No exposed ports
   - Connects to Redis queue
   - Resource limits: 1 CPU, 1GB RAM

5. **nginx** - Reverse proxy (optional)
   - Ports: 80, 443
   - Rate limiting
   - SSL termination
   - Static file caching

## 🔒 Security Features

- ✅ Multi-stage builds (smaller images)
- ✅ Non-root container user
- ✅ Read-only root filesystem
- ✅ No new privileges flag
- ✅ Resource limits (CPU/Memory)
- ✅ Health checks
- ✅ Rate limiting (Nginx)
- ✅ Security headers
- ✅ Network isolation

## 📦 Production Dockerfile

The production Dockerfile uses multi-stage builds:

1. **Stage 1: deps** - Install production dependencies
2. **Stage 2: builder** - Build TypeScript code
3. **Stage 3: runner** - Minimal runtime image

Benefits:

- Smaller image size (~200MB vs ~1GB)
- No dev dependencies in production
- Faster deployments
- Improved security

## 🔄 Common Operations

### View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f app

# Last 100 lines
docker-compose -f docker-compose.prod.yml logs --tail=100
```

### Restart Services

```bash
# Restart all
docker-compose -f docker-compose.prod.yml restart

# Restart specific service
docker-compose -f docker-compose.prod.yml restart app
```

### Access Container Shell

```bash
docker-compose -f docker-compose.prod.yml exec app sh
```

### Database Operations

```bash
# Run migrations
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy

# Open Prisma Studio (development only)
docker-compose -f docker-compose.prod.yml exec app bunx prisma studio

# Database backup
docker-compose -f docker-compose.prod.yml exec db pg_dump -U postgres quantum_sport > backup.sql

# Database restore
docker-compose -f docker-compose.prod.yml exec -T db psql -U postgres quantum_sport < backup.sql
```

### Update Application

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose -f docker-compose.prod.yml up -d --build app

# Or use deploy script
./deploy.sh
```

### Scale Services

```bash
# Run multiple app instances
docker-compose -f docker-compose.prod.yml up -d --scale app=3
```

## 🔧 SSL/TLS Configuration

### Using Let's Encrypt

```bash
# Install certbot
sudo apt-get install certbot

# Generate certificate
sudo certbot certonly --standalone -d yourdomain.com

# Copy certificates
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem docker/nginx/ssl/cert.pem
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem docker/nginx/ssl/key.pem
```

### Update Nginx Config

Uncomment SSL configuration in `docker/nginx/conf.d/default.conf`

## 📊 Monitoring

### Container Stats

```bash
docker stats
```

### Health Status

```bash
docker-compose -f docker-compose.prod.yml ps
```

### Application Health

```bash
curl http://localhost:3000/health
```

## 🔥 Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs app

# Check if port is in use
netstat -tulpn | grep 3000

# Rebuild without cache
docker-compose -f docker-compose.prod.yml build --no-cache
```

### Database Connection Issues

```bash
# Check database is running
docker-compose -f docker-compose.prod.yml ps db

# Test connection
docker-compose -f docker-compose.prod.yml exec db psql -U postgres -c "SELECT 1"

# Check DATABASE_URL format
docker-compose -f docker-compose.prod.yml exec app env | grep DATABASE_URL
```

### Out of Memory

```bash
# Check memory usage
docker stats

# Increase container limits in docker-compose.prod.yml
# Or increase host memory
```

## 🧹 Maintenance

### Cleanup

```bash
# Remove stopped containers
docker-compose -f docker-compose.prod.yml down

# Remove volumes (WARNING: deletes data)
docker-compose -f docker-compose.prod.yml down -v

# Prune unused images
docker image prune -a

# Full system cleanup
docker system prune -a --volumes
```

### Backup

```bash
# Database
docker-compose -f docker-compose.prod.yml exec db pg_dump -U postgres quantum_sport | gzip > backup_$(date +%Y%m%d).sql.gz

# Volumes
docker run --rm -v quantum-sport-backend_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_backup.tar.gz /data
```

## 🚦 Performance Optimization

1. **Enable Redis persistence** - Already configured in `redis.conf`
2. **Database connection pooling** - Configured in DATABASE_URL
3. **Nginx caching** - Configured for static files
4. **Resource limits** - Set in docker-compose
5. **Log rotation** - Configured via Docker logging driver

## 📝 Environment Variables

See `.env.production.example` for all available variables.

## 🆘 Support

For issues or questions:

1. Check logs: `docker-compose -f docker-compose.prod.yml logs`
2. Review this documentation
3. Check application health endpoint
4. Contact DevOps team

## 📚 Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Prisma Production Best Practices](https://www.prisma.io/docs/guides/deployment)
- [Nginx Configuration Guide](https://nginx.org/en/docs/)
