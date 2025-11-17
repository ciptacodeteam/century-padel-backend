# Quick Start for 2GB RAM Server

## 🚨 Critical First Steps

### 1. Add Swap (REQUIRED - Do this first!)

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h  # Verify 4GB swap shows up
```

### 2. Clean Docker

```bash
docker stop $(docker ps -aq) 2>/dev/null || true
docker system prune -a -f --volumes
```

### 3. Setup Environment

```bash
cp docker/env.production.template .env.production
nano .env.production  # Set DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET
```

### 4. Deploy

```bash
./deploy.sh
```

## ⏱️ Expected Timeline

- Swap setup: 1 minute
- Cleanup: 2 minutes
- Build: **10-15 minutes** (be patient!)
- Total: ~15-20 minutes

## ✅ Verify Success

```bash
free -h                    # Check swap is being used
docker-compose -f docker-compose.prod.yml ps  # All should be "Up (healthy)"
curl http://localhost:3000/health              # Should return 200 OK
```

## 🆘 If Build Fails with "signal: killed"

```bash
# 1. Verify swap is active
swapon --show  # Should show 4G

# 2. Free more memory
sudo systemctl stop nginx 2>/dev/null || true
docker stop $(docker ps -aq)
docker system prune -a -f

# 3. Try again
./deploy.sh
```

## 📚 Full Guide

See [DEPLOY_2GB_SERVER.md](./DEPLOY_2GB_SERVER.md) for complete documentation.

