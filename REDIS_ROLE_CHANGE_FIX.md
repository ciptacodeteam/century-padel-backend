# Redis Role Change Error - Fixed

## Problem

The scheduler worker was experiencing intermittent errors in production:

```
ERROR [2025-12-19 07:40:11] (7 on d22b4147b4c1): Scheduler worker error: READONLY You can't write against a read only replica.
ERROR [2025-12-19 07:40:05] Scheduler worker error: UNBLOCKED force unblock from blocking operation, instance state changed (master -> replica?)
```

## Root Cause

Redis was switching roles from **master → replica** during runtime (likely due to automatic failover from your hosting provider or Redis Sentinel). When BullMQ tried to write to the queue (create repeatable jobs), it was connecting to a read-only replica and failed.

## Solution

Added automatic reconnection logic to handle Redis role changes:

### Changes Made

#### 1. **scheduler.service.ts**

- Changed `redisConnection` and `schedulerQueue` from `const` to mutable variables
- Added `reconnectRedis()` function to recreate Redis connections when role changes occur
- Added error handling in `scheduleExpiryCheck()` to detect READONLY/UNBLOCKED errors and reconnect
- Enhanced worker with:
  - `maxStalledCount`: Retry twice before giving up
  - `stalledInterval`: Check every 5 seconds
  - Better error event handling to detect role changes
  - Automatic reconnection attempt in error handler

#### 2. **scheduler.worker.ts**

- Added startup retry logic with exponential backoff
- Retries up to 5 times with delays: 2s, 4s, 8s, 16s, 32s
- Gracefully exits if unable to connect after max retries

## Debugging Commands

Run these commands on production to verify Redis status:

```bash
# Check if Redis container is running
docker ps | grep redis

# Verify Redis URL from scheduler container
docker exec quantum-sport-scheduler-worker-prod printenv | grep REDIS_URL

# Check Redis role (master or replica)
docker exec quantum-sport-redis-prod redis-cli INFO replication

# Check if replica-read-only is enabled
docker exec quantum-sport-redis-prod redis-cli CONFIG GET replica-read-only

# View Redis logs for role changes
docker logs --tail 100 quantum-sport-redis-prod

# View scheduler worker logs for reconnection attempts
docker logs --tail 100 quantum-sport-scheduler-worker-prod

# Test direct Redis write (should return OK)
docker exec quantum-sport-redis-prod redis-cli SET test-key "test-value"
docker exec quantum-sport-redis-prod redis-cli GET test-key
```

## Expected Behavior After Fix

1. **Startup**: Worker retries with exponential backoff if Redis is unavailable
2. **Normal Operation**: Jobs run every minute without issues
3. **Role Change Event**: When Redis switches to replica:
   - Error is caught: `READONLY You can't write against a read only replica`
   - Worker logs role change detection
   - Worker attempts automatic reconnection
   - Next job run uses new Redis connection
4. **Failed Jobs**: Logged but don't crash the worker

## Monitoring

Monitor these log patterns:

**Good (jobs running normally)**:

```
Running scheduled expiry check...
Expiry check completed: X payments, Y hold bookings expired
```

**Warning (role change detected)**:

```
Redis role change detected (master -> replica)
Attempting to reconnect to Redis...
Successfully reconnected to Redis
```

**Critical (unable to recover)**:

```
Failed to reconnect after role change
Failed to start scheduler worker after max retries
```

## If Issues Persist

### 1. Check Redis Configuration

```bash
docker exec quantum-sport-redis-prod redis-cli CONFIG GET "*slave*"
docker exec quantum-sport-redis-prod redis-cli CONFIG GET "*replica*"
```

### 2. If Using Managed Redis (AWS ElastiCache, etc.)

- Verify the primary endpoint is being used, not a read-replica endpoint
- Check if automatic failover is enabled (this causes role changes)
- Consider using read-replica for read-only operations only

### 3. If Using Redis Sentinel

- Ensure BullMQ is configured for Sentinel
- Verify Sentinel is detecting role changes properly
- Check Sentinel logs for failover events

### 4. Force Reconnect (if worker keeps failing)

```bash
# Restart scheduler worker container
docker restart quantum-sport-scheduler-worker-prod

# Or via docker-compose
docker-compose -f docker-compose.prod.yml restart scheduler-worker
```

## Architecture Notes

- **Database**: PostgreSQL with Prisma ORM
- **Queue**: BullMQ with Redis backend
- **Scheduler**: Cron pattern (`* * * * *`) runs every minute
- **Tasks**: Check for expired payments/bookings and update their statuses
- **Concurrency**: 1 (one job at a time to avoid race conditions)

## Files Modified

1. `src/services/scheduler.service.ts` - Added reconnection logic
2. `src/workers/scheduler.worker.ts` - Added startup retry logic
