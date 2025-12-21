# Redis Security & Performance Fix

## Critical Issues Found

### 1. **Security Attack Detected** 🚨

```
# Possible SECURITY ATTACK detected. It looks like somebody is sending POST or Host: commands to Redis.
Connection from 172.236.228.218:61578 aborted.
```

**Problem**: Your Redis port (6379) is exposed publicly and attackers are attempting Cross Protocol Scripting (CPS) attacks.

### 2. **Disk I/O Performance Issue** ⚠️

```
Asynchronous AOF fsync is taking too long (disk is busy?).
Writing the AOF buffer without waiting for fsync to complete, this may slow down Redis.
```

**Problem**: Disk is slow, Redis persistence (AOF) is causing I/O bottlenecks.

---

## Solutions Applied

### Changes Made to Secure Redis

#### 1. **docker/redis.conf** - Security Hardening

```conf
# OLD: bind 0.0.0.0  (publicly exposed)
# NEW: bind 127.0.0.1  (internal only)

# Added password requirement
requirepass YOUR_STRONG_PASSWORD_HERE

# Disabled dangerous commands
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""

# Improved disk I/O performance
# Changed appendfsync from 'everysec' to 'no'
appendfsync no
```

#### 2. **docker-compose.prod.yml** - Network Isolation

```yaml
# OLD: Exposed port publicly
ports:
  - '${REDIS_PORT:-6379}:6379'
# NEW: No public exposure - only Docker internal network
# Redis is now only accessible from app/email/scheduler containers
```

---

## Implementation Steps

### Step 1: Generate a Strong Redis Password

```bash
# Generate a 32-character random password
redis_password=$(openssl rand -base64 32)
echo "REDIS_PASSWORD=$redis_password"
```

### Step 2: Update `.env.production`

Add or update the Redis URL with password:

```bash
# Old format (insecure)
REDIS_URL=redis://redis:6379

# New format (with password)
REDIS_URL=redis://:YOUR_PASSWORD_HERE@redis:6379
```

**Example with generated password:**

```bash
REDIS_URL=redis://:aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV@redis:6379
```

### Step 3: Update redis.conf Password

Edit `docker/redis.conf`:

```conf
# Security
requirepass YOUR_PASSWORD_HERE
```

Use the same password from Step 1.

### Step 4: Rebuild and Deploy

```bash
# Build new image with updated config
docker-compose -f docker-compose.prod.yml build --no-cache redis

# Stop old containers and start new ones
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d

# Verify Redis is running
docker logs quantum-sport-redis-prod

# Test connection from app
docker exec quantum-sport-app-prod redis-cli -h redis -a YOUR_PASSWORD_HERE ping
# Should return: PONG
```

### Step 5: Monitor for More Attacks

```bash
# Check for more attack attempts
docker logs quantum-sport-redis-prod | grep "SECURITY ATTACK"

# Watch logs in real-time
docker logs -f quantum-sport-redis-prod
```

---

## Verification Checklist

- [ ] Generated strong Redis password (32 chars, alphanumeric + special)
- [ ] Updated `REDIS_URL` in `.env.production` with password
- [ ] Updated `docker/redis.conf` with `requirepass`
- [ ] Removed Redis port from public exposure in `docker-compose.prod.yml`
- [ ] Rebuilt Docker image
- [ ] Deployed and tested
- [ ] Verified no "SECURITY ATTACK" messages in Redis logs
- [ ] Verified all containers can connect (app, email, scheduler)
- [ ] Tested job processing works without errors

---

## Performance Improvements

### appendfsync Change: everysec → no

**Why this helps:**

- `everysec`: Forces disk sync every second (heavy I/O)
- `no`: Lets OS decide when to sync (efficient, less disk pressure)

**Trade-off:**

- **Pros**: Reduced disk I/O, lower latency, faster persistence
- **Cons**: Potential data loss if OS crashes (acceptable for BullMQ job queue, not critical data)

**For BullMQ specifically:**

- Jobs are stored in memory and persisted to disk
- If a job crashes, the queue will retry on restart
- The tradeoff is acceptable since jobs aren't critical persistent data like payments

### loglevel Change: notice → warning

**Why this helps:**

- Reduces log noise from routine operations
- Easier to spot security issues (like CPS attacks)
- Less disk I/O for logging

---

## Security Settings Explained

### bind 127.0.0.1

- **Before**: Listened on all interfaces (0.0.0.0), exposed publicly
- **After**: Only listens internally within Docker container
- **Effect**: Only containers on internal network can access Redis

### requirepass

- **Effect**: All Redis commands require authentication
- **Protected**: Without password, anyone with network access could flush all data

### rename-command FLUSHDB, FLUSHALL, CONFIG

- **Effect**: Disables dangerous commands that could:
  - `FLUSHDB`: Delete all data in current database
  - `FLUSHALL`: Delete all data in all databases
  - `CONFIG`: Allow remote configuration changes
- **Trade-off**: You can't use these commands via Redis CLI, but they're admin-level operations anyway

---

## Firewall Rules (Optional but Recommended)

If you have Linux firewall (iptables/UFW), ensure Redis port isn't exposed:

```bash
# Check if port 6379 is listening publicly
netstat -tlnp | grep 6379
# Should show: tcp  0  0 127.0.0.1:6379  (NOT 0.0.0.0:6379)

# Or use ss command
ss -tlnp | grep 6379
```

---

## Troubleshooting

### "Connection refused" from app containers

```bash
# Check if Redis is running
docker ps | grep redis

# Verify healthcheck is passing
docker ps --filter "name=quantum-sport-redis-prod" --format "{{.Status}}"
# Should show: healthy

# Test connection with password
docker exec quantum-sport-redis-prod redis-cli -a YOUR_PASSWORD_HERE ping
```

### "Wrong number of arguments for 'auth' command"

```bash
# Verify REDIS_URL format in .env.production
# Correct: redis://:password@host:port
# Wrong: redis://password@host:port (missing colon)
```

### Still seeing "SECURITY ATTACK" messages

1. Verify firewall isn't exposing port 6379
2. Check if you have a reverse proxy accidentally exposing Redis
3. Consider rate-limiting connections at firewall level
4. Check Docker host's security group/firewall rules

---

## Related Files Modified

1. `docker/redis.conf` - Security hardening + performance tuning
2. `docker-compose.prod.yml` - Removed public port exposure
3. `src/lib/redis.ts` - Already supports password authentication (no changes needed)

---

## Performance Expectations After Changes

| Metric         | Before                  | After                                       |
| -------------- | ----------------------- | ------------------------------------------- |
| Disk I/O       | Heavy (fsync every sec) | Light (OS-managed)                          |
| CPU Usage      | Higher                  | Lower                                       |
| Redis Latency  | Slightly higher         | Slightly lower                              |
| Attack Surface | Public port exposed     | Internal only                               |
| Security       | Vulnerable              | Protected (password + command restrictions) |

---

## Monitoring Commands

```bash
# Check Redis memory usage
docker exec quantum-sport-redis-prod redis-cli -a PASSWORD_HERE INFO memory

# Check connected clients
docker exec quantum-sport-redis-prod redis-cli -a PASSWORD_HERE INFO clients

# Check replication status
docker exec quantum-sport-redis-prod redis-cli -a PASSWORD_HERE INFO replication

# View slow log (queries taking >10ms)
docker exec quantum-sport-redis-prod redis-cli -a PASSWORD_HERE SLOWLOG GET 10

# Check current master/slave role
docker exec quantum-sport-redis-prod redis-cli -a PASSWORD_HERE INFO replication | grep role

# List all keys (for debugging)
docker exec quantum-sport-redis-prod redis-cli -a PASSWORD_HERE KEYS "*" | head -20
```

---

## Summary

✅ **Fixed**: Security vulnerability (exposed Redis port)  
✅ **Fixed**: Attack vector (no authentication required)  
✅ **Improved**: Disk I/O performance  
✅ **Hardened**: Disabled dangerous commands  
✅ **Isolated**: Redis only accessible from internal Docker network

**Next deploy will be more secure and performant!**
