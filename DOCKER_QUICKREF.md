# Docker Quick Reference

## 🚀 Quick Start

### Development

```bash
docker-compose up -d          # Start all services
docker-compose logs -f        # View logs
docker-compose down           # Stop services
```

### Production

```bash
./deploy.sh                   # Full deployment
make prod-up                  # Start production
make prod-logs                # View production logs
make prod-down                # Stop production
```

## 📦 Common Commands

### Service Management

```bash
# Start specific service
docker-compose up -d app

# Restart service
docker-compose restart app

# Stop service
docker-compose stop app

# Remove service and volumes
docker-compose down -v
```

### Logs

```bash
# Follow all logs
docker-compose logs -f

# Service-specific logs
docker-compose logs -f app

# Last 100 lines
docker-compose logs --tail=100 app
```

### Shell Access

```bash
# App container
docker-compose exec app sh

# Database container
docker-compose exec db psql -U postgres -d quantum_sport

# Redis container
docker-compose exec redis redis-cli
```

### Database Operations

```bash
# Run migrations
docker-compose exec app bunx prisma migrate dev

# Deploy migrations (production)
docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy

# Generate Prisma Client
docker-compose exec app bunx prisma generate

# Open Prisma Studio
docker-compose exec app bunx prisma studio

# Backup database
docker-compose exec db pg_dump -U postgres quantum_sport > backup.sql

# Restore database
docker-compose exec -T db psql -U postgres quantum_sport < backup.sql

# Reset database
docker-compose exec app bunx prisma db push --force-reset
```

### Container Management

```bash
# List running containers
docker-compose ps

# View resource usage
docker stats

# Inspect container
docker inspect quantum-sport-app-prod

# View container logs
docker logs quantum-sport-app-prod -f
```

### Image Management

```bash
# Build images
docker-compose build

# Build without cache
docker-compose build --no-cache

# Pull latest images
docker-compose pull

# List images
docker images

# Remove unused images
docker image prune -a
```

### Volume Management

```bash
# List volumes
docker volume ls

# Inspect volume
docker volume inspect quantum-sport-backend_postgres_data

# Backup volume
docker run --rm -v quantum-sport-backend_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_backup.tar.gz /data

# Remove volume
docker volume rm quantum-sport-backend_postgres_data

# Remove all unused volumes
docker volume prune
```

### Network Management

```bash
# List networks
docker network ls

# Inspect network
docker network inspect quantum-sport-network

# Remove network
docker network rm quantum-sport-network
```

## 🔍 Debugging

### Check Service Health

```bash
# Check container health
docker-compose ps

# Check app health endpoint
curl http://localhost:3000/health

# Check Nginx status
docker-compose exec nginx nginx -t
```

### View Configuration

```bash
# View current config
docker-compose config

# View production config
docker-compose -f docker-compose.prod.yml config
```

### Troubleshooting

```bash
# View container logs
docker-compose logs app

# Check container processes
docker-compose exec app ps aux

# Check network connectivity
docker-compose exec app ping db
docker-compose exec app ping redis

# Test database connection
docker-compose exec app bunx prisma db execute --stdin <<< "SELECT 1"

# Check environment variables
docker-compose exec app env
```

## 🧹 Cleanup

### Light Cleanup

```bash
# Stop and remove containers
docker-compose down

# Stop and remove containers + networks
docker-compose down --remove-orphans
```

### Full Cleanup

```bash
# Remove everything including volumes
docker-compose down -v

# Remove all stopped containers
docker container prune -f

# Remove unused images
docker image prune -a -f

# Remove unused volumes
docker volume prune -f

# Full system cleanup
docker system prune -a --volumes -f
```

## 🔧 Performance

### Resource Monitoring

```bash
# Real-time stats
docker stats

# Container resource usage
docker-compose top

# Disk usage
docker system df
```

### Optimization

```bash
# Build with BuildKit
DOCKER_BUILDKIT=1 docker-compose build

# Multi-platform build
docker buildx build --platform linux/amd64,linux/arm64 -t myapp .
```

## 🔐 Security

### Security Scanning

```bash
# Scan image for vulnerabilities
docker scan quantum-sport-backend:latest

# Check image history
docker history quantum-sport-backend:latest

# Check running processes
docker-compose exec app ps aux
```

### User Permissions

```bash
# Check user in container
docker-compose exec app whoami

# Check file permissions
docker-compose exec app ls -la /app
```

## 📊 Production Monitoring

### Production Commands

```bash
# Check production status
make prod-logs

# View production metrics
docker stats $(docker ps -q -f name=quantum-sport)

# Production health check
curl https://yourdomain.com/health

# Database connection count
docker-compose -f docker-compose.prod.yml exec db psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# Redis info
docker-compose -f docker-compose.prod.yml exec redis redis-cli INFO
```

## 🚀 CI/CD

### GitHub Actions

```bash
# Trigger workflow manually
gh workflow run docker-production.yml

# View workflow status
gh run list

# View workflow logs
gh run view <run-id> --log
```

### Manual Deploy

```bash
# SSH to server
ssh user@production-server

# Navigate to project
cd /opt/quantum-sport-backend

# Pull latest
git pull origin main

# Deploy
./deploy.sh
```

## 📝 Useful Aliases

Add to your `.bashrc` or `.zshrc`:

```bash
# Docker Compose shortcuts
alias dc='docker-compose'
alias dcu='docker-compose up -d'
alias dcd='docker-compose down'
alias dcl='docker-compose logs -f'
alias dce='docker-compose exec'
alias dcr='docker-compose restart'

# Production shortcuts
alias dcp='docker-compose -f docker-compose.prod.yml'
alias dcpu='docker-compose -f docker-compose.prod.yml up -d'
alias dcpd='docker-compose -f docker-compose.prod.yml down'
alias dcpl='docker-compose -f docker-compose.prod.yml logs -f'

# Docker shortcuts
alias dps='docker ps'
alias dpsa='docker ps -a'
alias di='docker images'
alias drm='docker rm'
alias drmi='docker rmi'
alias dclean='docker system prune -af --volumes'
```

## 🆘 Emergency Commands

### App Not Responding

```bash
# Restart app
docker-compose restart app

# View app logs
docker-compose logs --tail=200 app

# Check app health
docker-compose exec app curl localhost:3000/health
```

### Database Issues

```bash
# Check database status
docker-compose exec db pg_isready

# Check connections
docker-compose exec db psql -U postgres -c "SELECT * FROM pg_stat_activity;"

# Kill long-running queries
docker-compose exec db psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid();"
```

### Out of Memory

```bash
# Check memory usage
docker stats

# Restart service with more memory
docker-compose up -d --force-recreate --no-deps app
```

### Disk Full

```bash
# Check disk usage
docker system df

# Cleanup
docker system prune -a --volumes -f
```

---

**For more details, see [DOCKER_PRODUCTION.md](./DOCKER_PRODUCTION.md)**
