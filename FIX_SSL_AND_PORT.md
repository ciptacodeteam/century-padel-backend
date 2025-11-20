# Fix SSL Certificate & Port Configuration

## ✅ What I Fixed

1. **Port 8000**: Nginx now proxies `api.quantumsocialclub.id` → `app:8000`
2. **SSL Setup**: New script that properly handles initial certificate request
3. **Access**: You can now use `https://api.quantumsocialclub.id` (no port needed!)

## 🚀 Steps to Apply Fixes

### Step 1: Update Your Environment File

```bash
# Edit .env.production and set PORT=8000
nano .env.production
```

Make sure it has:
```bash
PORT=8000
```

### Step 2: Stop Current SSL Setup (if stuck)

```bash
# Stop any stuck processes
docker stop quantum-sport-certbot quantum-sport-nginx-prod 2>/dev/null || true
docker rm quantum-sport-certbot 2>/dev/null || true
```

### Step 3: Restart Services with New Config

```bash
cd ~/quantum-sport-backend

# Pull latest changes
git pull origin main

# Restart services
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d db redis app

# Wait for app to start
sleep 10
```

### Step 4: Run Fixed SSL Setup

```bash
# Make script executable
chmod +x docker/setup-ssl-fixed.sh

# Run the fixed SSL setup
./docker/setup-ssl-fixed.sh
```

This new script:
- ✅ Starts nginx with HTTP-only config first
- ✅ Requests SSL certificate properly
- ✅ Switches to HTTPS after certificate is obtained
- ✅ Tests the connection

**Expected time: 2-3 minutes**

## 🌐 After Setup

Your API will be accessible at:

```
✅ https://api.quantumsocialclub.id/health
✅ https://api.quantumsocialclub.id/api/courts
✅ https://api.quantumsocialclub.id/api/bookings
```

**No port number needed!** Nginx handles the routing:
- `https://api.quantumsocialclub.id` (port 443) → `app:8000` (internal)
- `http://api.quantumsocialclub.id` (port 80) → redirects to HTTPS

## 🔍 Verify It's Working

```bash
# Test HTTPS
curl https://api.quantumsocialclub.id/health

# Should return: {"status":"ok",...}

# Check services
docker-compose -f docker-compose.prod.yml ps

# Check nginx logs
docker-compose -f docker-compose.prod.yml logs nginx
```

## 🐛 If SSL Setup Still Fails

### Check Port 80 is Available

```bash
# See what's using port 80
sudo netstat -tlnp | grep :80

# If something else is using it, stop it:
sudo systemctl stop apache2  # if Apache
sudo systemctl stop nginx     # if system nginx
```

### Check Firewall

```bash
# Allow ports
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

### Manual SSL Setup (if automated script fails)

```bash
# 1. Start services without SSL
docker-compose -f docker-compose.prod.yml up -d db redis app nginx

# 2. Create directory for certbot
docker-compose -f docker-compose.prod.yml run --rm certbot sh -c "mkdir -p /var/www/certbot"

# 3. Request certificate
docker-compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email admin@quantumsocialclub.id \
  --agree-tos \
  --no-eff-email \
  -d api.quantumsocialclub.id

# 4. Restart nginx
docker-compose -f docker-compose.prod.yml restart nginx
```

## 📝 Configuration Summary

### Ports
- **External (internet)**: 80 (HTTP), 443 (HTTPS)
- **Internal (Docker)**: 8000 (app)
- **User accesses**: `api.quantumsocialclub.id` (no port!)

### Flow
```
User → https://api.quantumsocialclub.id (443)
  ↓
Nginx (Docker container)
  ↓
App (port 8000 inside Docker)
```

### Files Changed
- ✅ `docker/nginx/conf.d/default.conf` - Updated to port 8000
- ✅ `docker-compose.prod.yml` - App uses PORT env var (8000)
- ✅ `docker/env.production.template` - Default PORT=8000
- ✅ `docker/setup-ssl-fixed.sh` - New SSL setup script

## ✅ Quick Verification Checklist

After running the setup:

- [ ] App is running: `docker-compose -f docker-compose.prod.yml ps`
- [ ] Port 8000 exposed: `docker-compose -f docker-compose.prod.yml ps | grep 8000`
- [ ] Nginx is running: `docker-compose -f docker-compose.prod.yml ps | grep nginx`
- [ ] HTTP works: `curl http://api.quantumsocialclub.id/health`
- [ ] HTTPS works: `curl https://api.quantumsocialclub.id/health`
- [ ] HTTP redirects to HTTPS: `curl -I http://api.quantumsocialclub.id`
- [ ] Certificate is valid: `echo | openssl s_client -connect api.quantumsocialclub.id:443 2>/dev/null | grep 'Verify return code'`

## 🎉 Success!

Once setup completes, your booking system will be:
- 🌐 Accessible at `https://api.quantumsocialclub.id`
- 🔐 Secured with SSL/TLS
- ⚡ Running on port 8000 internally
- 🚀 Ready for production!

---

**Ready?** Follow the steps above to fix SSL and port configuration!

