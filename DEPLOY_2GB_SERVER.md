# Deployment Guide for 2GB RAM Servers

This guide is specifically for deploying on **2 vCPU, 2GB RAM** servers.

## ⚠️ Important: Memory Constraints

With only 2GB RAM, you **MUST** follow these steps carefully to avoid OOM (Out of Memory) errors.

## 🔧 Step 1: Add Swap Space (CRITICAL!)

**This is NOT optional.** Without swap, your build WILL fail.

```bash
# Check current swap
free -h
swapon --show

# Add 4GB swap space
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make it permanent (survives reboots)
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify swap is active
free -h
# You should see 4.0Gi in Swap row
```

**Expected output:**
```
              total        used        free      shared  buff/cache   available
Mem:           2.0Gi       500Mi       1.0Gi       10Mi        500Mi        1.4Gi
Swap:          4.0Gi       0B          4.0Gi
                          ^^^^^^^^^ This is what you want to see!
```

## 🧹 Step 2: Clean Up Before Building

```bash
cd /path/to/quantum-sport-backend

# Stop any running containers
docker stop $(docker ps -aq) 2>/dev/null || true

# Clean up everything to free memory
docker system prune -a -f --volumes

# Check freed space
docker system df
free -h
```

## 📝 Step 3: Configure Environment

```bash
# Create environment file
cp docker/env.production.template .env.production

# Edit with your secrets
nano .env.production
```

**Required variables:**
- `DB_PASSWORD` - Strong password
- `JWT_SECRET` - Min 32 characters
- `JWT_REFRESH_SECRET` - Min 32 characters

**Generate secrets:**
```bash
openssl rand -base64 32
```

## 🚀 Step 4: Deploy with Memory-Aware Settings

### Option A: Use Updated deploy.sh (Recommended)

```bash
# The script now handles 2GB RAM servers
./deploy.sh
```

### Option B: Manual Build with Memory Limits

```bash
# Stop other services to free memory
docker-compose -f docker-compose.prod.yml down

# Build with memory limits
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build \
  --memory 1500m \
  --memory-swap 3g

# Start services
docker-compose -f docker-compose.prod.yml up -d
```

## 🐛 If Build Still Fails

### 1. Free More Memory Before Building

```bash
# Stop nginx if running
sudo systemctl stop nginx

# Stop other services
sudo systemctl stop redis-server 2>/dev/null || true

# Clear package cache
sudo apt-get clean

# Check memory again
free -h
```

### 2. Build Without Running Services

```bash
# Make sure nothing else is running
docker ps -a

# If you see running containers, stop them:
docker stop $(docker ps -aq)

# Then try build again
DOCKER_BUILDKIT=1 docker-compose -f docker-compose.prod.yml build
```

### 3. Increase Swap if Needed

```bash
# Remove old swap
sudo swapoff /swapfile
sudo rm /swapfile

# Create 6GB swap (larger)
sudo fallocate -l 6G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Verify
free -h
```

## 📊 Resource Allocation on 2GB Server

Your 2GB RAM is allocated as:

| Service | Memory Limit | Purpose |
|---------|-------------|---------|
| PostgreSQL | ~300MB | Database |
| Redis | ~50MB | Cache & Queue |
| Application | ~1GB | Main app (can burst to 1GB) |
| Email Worker | ~512MB | Background jobs |
| System | ~200MB | OS and other processes |
| **Total** | **~2GB** | With swap for overflow |

## ✅ After Successful Deployment

### Verify Services

```bash
# Check all services are running
docker-compose -f docker-compose.prod.yml ps

# Should show all as "Up (healthy)"
```

### Monitor Memory Usage

```bash
# Check memory usage
free -h
docker stats --no-stream

# If swap is being used heavily, that's normal during builds
# Runtime should use minimal swap
```

### Check Logs

```bash
# Application logs
docker-compose -f docker-compose.prod.yml logs -f app

# All services
docker-compose -f docker-compose.prod.yml logs -f
```

## 🎯 Performance Optimization for 2GB Servers

### 1. Disable Nginx Container (Optional)

If you're tight on memory, comment out nginx in `docker-compose.prod.yml`:

```yaml
# nginx:
#   image: nginx:alpine
#   ... (comment out entire nginx section)
```

Then access the app directly on port 3000, or use system nginx.

### 2. Reduce PostgreSQL Memory

Add to `.env.production`:

```bash
# Optimize PostgreSQL for 2GB server
POSTGRES_SHARED_BUFFERS=128MB
POSTGRES_WORK_MEM=4MB
POSTGRES_MAINTENANCE_WORK_MEM=64MB
```

### 3. Monitor and Adjust

```bash
# Watch memory in real-time
watch -n 2 free -h

# Watch Docker containers
watch -n 2 'docker stats --no-stream'
```

## 🆘 Troubleshooting Common Issues

### Issue: "signal: killed" during build

**Cause:** Out of memory

**Solution:**
1. Verify swap is active: `swapon --show`
2. Stop all containers: `docker stop $(docker ps -aq)`
3. Free memory: `docker system prune -a -f`
4. Try again

### Issue: Services keep restarting

**Cause:** Not enough memory to run all services

**Solution:**
1. Check which service is restarting: `docker-compose -f docker-compose.prod.yml ps`
2. Check logs: `docker-compose -f docker-compose.prod.yml logs [service]`
3. Consider disabling nginx container
4. Reduce connection limits in DATABASE_URL

### Issue: Swap not being used

**Cause:** Swappiness too low

**Solution:**
```bash
# Check swappiness (should be 60 for servers)
cat /proc/sys/vm/swappiness

# Set swappiness to 60
sudo sysctl vm.swappiness=60

# Make permanent
echo 'vm.swappiness=60' | sudo tee -a /etc/sysctl.conf
```

### Issue: Build is extremely slow

**Cause:** Using swap heavily (normal on 2GB RAM)

**Solution:**
- Be patient! Build can take 10-15 minutes on 2GB RAM
- Don't interrupt the build
- Consider upgrading to 4GB RAM for better performance

## 💡 Pro Tips for 2GB Servers

1. **Build during off-peak hours** - Less memory pressure
2. **Close unnecessary SSH sessions** - Saves ~10MB per session
3. **Use `docker system prune` regularly** - Keep disk clean
4. **Monitor with `htop`** - Install: `sudo apt-get install htop`
5. **Consider upgrading to 4GB RAM** - Much smoother experience!

## 📈 When to Upgrade

Consider upgrading to 4GB RAM if:
- ❌ Builds take more than 15 minutes
- ❌ Services restart frequently due to memory
- ❌ Swap usage consistently > 2GB
- ❌ Application response time is slow
- ❌ You need to run additional services

## ✅ Success Checklist for 2GB Servers

Before declaring success, verify:

- [ ] Swap is active and 4GB+: `free -h`
- [ ] All containers are healthy: `docker-compose -f docker-compose.prod.yml ps`
- [ ] Application responds: `curl http://localhost:3000/health`
- [ ] Database migrations completed: Check logs
- [ ] Memory usage < 90%: `free -h`
- [ ] Swap usage < 50% during runtime
- [ ] No OOM kills in logs: `dmesg | grep -i "out of memory"`

## 🎓 Understanding the Limits

**What works well on 2GB:**
- ✅ Small to medium traffic (< 100 concurrent users)
- ✅ Development/staging environments
- ✅ Low-frequency background jobs
- ✅ Small databases (< 1GB)

**What struggles on 2GB:**
- ❌ High traffic (> 100 concurrent users)
- ❌ Large database operations
- ❌ Heavy background job processing
- ❌ Multiple concurrent Docker builds
- ❌ Running development tools (Prisma Studio, etc.)

---

**Remember:** 2GB RAM is the absolute minimum. For production with growth, plan to upgrade to 4GB+ RAM soon!

Need help? Check the troubleshooting section above or review logs with:
```bash
docker-compose -f docker-compose.prod.yml logs -f
```

