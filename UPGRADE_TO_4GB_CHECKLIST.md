# 4GB Upgrade Checklist

## ✅ After Your DigitalOcean Upgrade

Follow these steps after upgrading your droplet to 4GB RAM.

### Step 1: Verify Upgrade ✓

```bash
# SSH into your server
ssh root@your-server-ip

# Check RAM (should show ~4GB)
free -h

# Should see something like:
#               total        used        free      shared  buff/cache   available
# Mem:           3.9Gi       xxx         xxx         xxx         xxx        xxx
```

### Step 2: Remove Swap (No longer needed!) ✓

```bash
# Turn off swap
sudo swapoff /swapfile

# Delete swap file
sudo rm /swapfile

# Remove from fstab (so it doesn't come back)
sudo sed -i '/swapfile/d' /etc/fstab

# Verify it's gone
free -h
swapon --show  # Should show nothing
```

### Step 3: Clean Up Docker ✓

```bash
cd ~/quantum-sport-backend  # or your project path

# Stop containers
docker-compose -f docker-compose.prod.yml down

# Clean everything
docker system prune -a -f --volumes

# Check space freed
docker system df
```

### Step 4: Pull Latest Optimized Config ✓

```bash
# Pull the latest Docker configs I just optimized for 4GB
git pull origin main

# Or if you have local changes, stash first:
git stash
git pull origin main
git stash pop
```

### Step 5: Deploy! ✓

```bash
# Deploy with the new optimized config
./deploy.sh
```

**Expected time: 3-5 minutes** (much faster than before!)

### Step 6: Verify Everything Works ✓

```bash
# 1. Check all services are healthy
docker-compose -f docker-compose.prod.yml ps

# All should show "Up (healthy)"

# 2. Check memory usage
free -h
docker stats --no-stream

# Should use ~2-3GB, with 1-2GB free

# 3. Test the application
curl http://localhost:3000/health

# Should return health check response

# 4. Check logs for errors
docker-compose -f docker-compose.prod.yml logs --tail=50 app

# Should see startup messages, no errors
```

## 📊 What to Expect

### Before (2GB):
- Build time: 10-15 minutes 🐌
- Memory usage: 95%+ (swap heavily used)
- Risk of OOM kills
- Slow under load

### After (4GB):
- Build time: 3-5 minutes ⚡
- Memory usage: 60-75% (comfortable)
- No swap needed
- Fast and responsive

## ✨ Optimizations Applied

I've updated your configs for 4GB:

1. **Application**
   - Memory limit: 1GB → 2GB
   - Database connections: 10 → 20
   - Shared memory: 256MB → 512MB

2. **Email Worker**
   - Memory limit: 512MB → 1GB
   - Database connections: 5 → 10

3. **PostgreSQL**
   - Shared memory: 256MB → 512MB
   - Better caching

4. **Build Process**
   - Removed memory constraints
   - Removed swap requirement

## 🎯 Quick Test

After deployment, test your booking flow:

```bash
# 1. Open your application in browser
# http://your-server-ip:3000

# 2. Try creating a booking
# 3. Test payment processing
# 4. Check email notifications

# Monitor while testing:
watch -n 2 'free -h && echo && docker stats --no-stream'
```

## 🚨 If Something Goes Wrong

### Build fails
```bash
# Clean and retry
docker system prune -a -f
CLEAN_BUILD=true ./deploy.sh
```

### Services won't start
```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs

# Check specific service
docker-compose -f docker-compose.prod.yml logs app
```

### Memory still shows 2GB
```bash
# You might need to power off/on (not just reboot)
# In DigitalOcean dashboard: Power Off → Wait → Power On
```

## ✅ Success Indicators

You're good when you see:

- ✅ `free -h` shows ~4GB RAM
- ✅ No swap file: `swapon --show` is empty
- ✅ Build completed in 3-5 minutes
- ✅ All containers "Up (healthy)"
- ✅ Memory usage 60-75%
- ✅ Application responds quickly
- ✅ No errors in logs

## 📚 Next Steps

1. **Read the full guide:** [DEPLOY_4GB_SERVER.md](./DEPLOY_4GB_SERVER.md)
2. **Set up backups** (see backup section in guide)
3. **Monitor performance** for a day
4. **Test under load** to verify handling capacity
5. **Enjoy the speed!** 🚀

## 💡 Pro Tips

- Monitor memory for first 24h: `watch -n 60 free -h`
- Set up daily database backups
- Document your deployment process
- Consider setting up monitoring (Uptime Robot, etc.)

---

**Congratulations on the upgrade!** 🎉

Your booking system now runs on a proper production setup!

