# 🚨 URGENT: Redis Security Action Items

## Status: Critical Security Issue Detected

**Attack from IP**: `172.236.228.218` attempting Cross Protocol Scripting (CPS)  
**Issue**: Redis port 6379 is publicly exposed with no authentication  
**Risk Level**: 🔴 CRITICAL - Data breach/ransomware possible

---

## Action Items (Do Immediately)

### ⚡ STEP 1: Generate Password (5 minutes)

```bash
redis_password=$(openssl rand -base64 32)
echo "Copy this password: $redis_password"
```

**Save this password securely** - you'll need it in next steps.

---

### 🔐 STEP 2: Update .env.production (2 minutes)

Edit `.env.production` and update Redis URL:

```bash
# BEFORE (insecure):
REDIS_URL=redis://redis:6379

# AFTER (secure):
REDIS_URL=redis://:YOUR_GENERATED_PASSWORD@redis:6379
```

Replace `YOUR_GENERATED_PASSWORD` with password from STEP 1.

**Example:**

```bash
REDIS_URL=redis://:aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV@redis:6379
```

---

### 📝 STEP 3: Update docker/redis.conf (2 minutes)

Find this line:

```conf
# requirepass yourpassword  # Uncomment and set strong password in production
```

Replace with:

```conf
requirepass YOUR_GENERATED_PASSWORD

# Additional security settings
# Disable dangerous commands
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

Use the SAME password from STEP 1.

---

### 🚀 STEP 4: Deploy (10 minutes)

```bash
# Stop everything
docker-compose -f docker-compose.prod.yml down

# Rebuild Redis with new config
docker-compose -f docker-compose.prod.yml build --no-cache redis

# Start everything
docker-compose -f docker-compose.prod.yml up -d

# Wait 30 seconds for startup
sleep 30

# Verify Redis is healthy
docker ps | grep redis
# Should show: healthy status

# Test connection
docker exec quantum-sport-app-prod redis-cli -h redis -a YOUR_PASSWORD_HERE ping
# Should return: PONG
```

---

### ✅ STEP 5: Verify (5 minutes)

```bash
# Check for attack messages in logs
docker logs quantum-sport-redis-prod | grep "SECURITY ATTACK" | wc -l
# If count is 0: No new attacks ✅
# If count > 0: Attacks still happening ❌

# Check all containers are healthy
docker-compose -f docker-compose.prod.yml ps
# All should show: healthy or running
```

---

## Quick Reference

**Password**: Use `openssl rand -base64 32` to generate  
**URL Format**: `redis://:PASSWORD@redis:6379`  
**Config File**: `docker/redis.conf`  
**Env File**: `.env.production`  
**Redis Port**: DO NOT expose publicly (remove from docker-compose)

---

## Timeline

- **Now**: Someone is actively attacking your Redis ⚠️
- **5 mins**: Generate password
- **10 mins**: Update config files
- **20 mins**: Deploy and verify
- **After deploy**: Attacks should stop immediately

---

## What Changes Do

| Change                 | Effect                                   |
| ---------------------- | ---------------------------------------- |
| `requirepass`          | Requires authentication (blocks attacks) |
| `bind 127.0.0.1`       | Only internal Docker access              |
| Remove `ports` mapping | No public exposure                       |
| `rename-command`       | Disables dangerous operations            |
| `appendfsync no`       | Better disk performance                  |

---

## Verification Commands

```bash
# Is Redis listening internally only?
docker exec quantum-sport-redis-prod redis-cli -a PASSWORD INFO | grep "#\|Listening\|bind"

# Can external IPs connect? (Should fail)
redis-cli -h YOUR_PRODUCTION_IP -p 6379 ping
# Should timeout/refuse (not connect)

# Can internal containers connect? (Should work)
docker exec quantum-sport-app-prod redis-cli -h redis -a PASSWORD PING
# Should return: PONG
```

---

## If Attacks Continue After Deploy

1. **Check firewall**: `sudo iptables -L | grep 6379`
2. **Check if port still exposed**: `netstat -tlnp | grep 6379`
3. **Verify new config loaded**: `docker exec quantum-sport-redis-prod redis-cli -a PASSWORD CONFIG GET requirepass`
4. **Check env file**: Ensure `REDIS_URL` has password

---

## Documentation

See `REDIS_SECURITY_FIX.md` for complete details and troubleshooting.

---

## 🎯 Success Criteria

- [ ] Password generated and stored securely
- [ ] `.env.production` updated with password in URL
- [ ] `docker/redis.conf` has `requirepass` set
- [ ] `docker-compose.prod.yml` built and deployed
- [ ] All containers healthy and running
- [ ] No "SECURITY ATTACK" messages in new logs
- [ ] App/email/scheduler containers connect successfully
- [ ] Jobs processing normally

---

**⏰ Recommended**: Do this immediately - don't wait. Attacks are happening now.
