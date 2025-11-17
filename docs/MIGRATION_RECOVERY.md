# Migration Recovery Guide

## Issue: Failed Migration `20251114161611_add_club_join_request`

### Problem
The migration `20251114161611_add_club_join_request` failed during deployment. The migration was trying to:
1. Alter the `BookingStatus` enum to remove `DRAFT` value
2. Drop `tournament_registrations` and `tournament_registration_members` tables
3. Create new tables `club_join_requests` and `password_reset_tokens`

### Root Cause
The migration was attempting to alter `tournament_registrations.status` column before dropping the table, which is unnecessary and can cause failures.

### Fix Applied
- Removed the unnecessary `ALTER TABLE "public"."tournament_registrations" ALTER COLUMN "status" DROP DEFAULT;` line from the migration

## Quick Fix (Recommended)

The easiest way to resolve this is to use the automated resolution script:

```bash
# Run the resolution script directly (since it may not be in the built image)
docker-compose -f docker-compose.prod.yml run --rm app bunx tsx prisma/resolve-failed-migration.ts

# Or if the script is in package.json and image is rebuilt:
docker-compose -f docker-compose.prod.yml run --rm app bun run db:resolve-failed

# Or if using bun directly locally
bun run db:resolve-failed
```

This script will:
1. Check the migration status
2. Clean up any partial migration state
3. Mark the failed migration as rolled back
4. Check for DRAFT status records that need to be updated

After running the script, you can re-run migrations:
```bash
docker-compose -f docker-compose.prod.yml run --rm app bunx prisma migrate deploy
```

## Manual Recovery Steps

If you prefer to do it manually:

### Step 1: Check Migration Status

Connect to your production database and check the migration status:

```bash
# Connect to the database container
docker-compose -f docker-compose.prod.yml exec db psql -U postgres -d quantum_sport

# Check migration status
SELECT * FROM "_prisma_migrations" WHERE migration_name = '20251114161611_add_club_join_request';
```

### Step 2: Check for Partial Migration State

Check if the migration partially completed:

```sql
-- Check if enum was partially altered
SELECT typname FROM pg_type WHERE typname LIKE 'BookingStatus%';

-- Check if tables were dropped
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('tournament_registrations', 'tournament_registration_members');

-- Check if new tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('club_join_requests', 'password_reset_tokens');
```

### Step 3: Check for DRAFT Status Records

Before re-running the migration, check if there are any records with `DRAFT` status:

```sql
-- Check bookings table
SELECT COUNT(*) FROM bookings WHERE status = 'DRAFT';

-- Check class_bookings table
SELECT COUNT(*) FROM class_bookings WHERE status = 'DRAFT';
```

**If you find records with DRAFT status**, you need to update them first:

```sql
-- Update DRAFT bookings to HOLD (or CANCELLED if appropriate)
UPDATE bookings SET status = 'HOLD' WHERE status = 'DRAFT';
UPDATE class_bookings SET status = 'HOLD' WHERE status = 'DRAFT';
```

### Step 4: Clean Up Failed Migration (if needed)

If the migration partially completed, you may need to manually clean up:

#### Case A: Enum was partially altered but tables not dropped

```sql
-- Check current enum state
SELECT typname FROM pg_type WHERE typname LIKE 'BookingStatus%';

-- If BookingStatus_old exists, clean it up
DROP TYPE IF EXISTS "BookingStatus_old" CASCADE;

-- If BookingStatus_new exists but wasn't renamed, fix it
-- (This is unlikely, but check first)
```

#### Case B: Tables were partially dropped

```sql
-- If tournament_registrations still exists but foreign keys were dropped
DROP TABLE IF EXISTS "tournament_registration_members" CASCADE;
DROP TABLE IF EXISTS "tournament_registrations" CASCADE;

-- If invoices still has the column
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "tournamentRegistrationId";
```

#### Case C: Mark migration as rolled back

```sql
-- Remove the failed migration record (if it exists)
DELETE FROM "_prisma_migrations" WHERE migration_name = '20251114161611_add_club_join_request' AND finished_at IS NULL;
```

### Step 5: Re-run the Fixed Migration

After cleaning up, re-run the migration:

```bash
# Pull the latest code with the fixed migration
git pull origin main

# Re-run migrations
docker-compose -f docker-compose.prod.yml run --rm app bunx prisma migrate deploy
```

### Step 6: Verify Migration Success

```sql
-- Verify new tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('club_join_requests', 'password_reset_tokens');

-- Verify enum was updated
SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'BookingStatus');

-- Should show: HOLD, CONFIRMED, CANCELLED (no DRAFT)

-- Verify old tables are gone
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('tournament_registrations', 'tournament_registration_members');
-- Should return no rows
```

## Alternative: Manual Migration Execution

If `prisma migrate deploy` still fails, you can manually execute the fixed migration:

```bash
# Connect to database
docker-compose -f docker-compose.prod.yml exec db psql -U postgres -d quantum_sport

# Copy and paste the fixed migration SQL
# (from prisma/migrations/20251114161611_add_club_join_request/migration.sql)

# After successful execution, mark it as applied
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (
  gen_random_uuid(),
  'checksum_here',  -- You can get this from Prisma
  NOW(),
  '20251114161611_add_club_join_request',
  NULL,
  NULL,
  NOW(),
  1
);
```

## Prevention

To prevent similar issues in the future:

1. **Always test migrations in a staging environment** that mirrors production data
2. **Check for data dependencies** before running migrations (e.g., DRAFT status records)
3. **Review migration SQL** before deploying to production
4. **Take database backups** before running migrations
5. **Use transactions** where possible (though Prisma handles this automatically)

## Emergency Rollback

If you need to rollback this migration:

```sql
-- WARNING: This will lose data in the new tables
DROP TABLE IF EXISTS "password_reset_tokens" CASCADE;
DROP TABLE IF EXISTS "club_join_requests" CASCADE;

-- Restore enum (if needed)
-- This is complex and depends on current state - contact DBA if needed

-- Restore tournament tables (if you have backups)
-- Restore from backup if needed
```

## Getting Help

If you're stuck:

1. Check Prisma migration logs: `docker-compose -f docker-compose.prod.yml logs app | grep -i migration`
2. Check database logs: `docker-compose -f docker-compose.prod.yml logs db`
3. Review the migration file: `prisma/migrations/20251114161611_add_club_join_request/migration.sql`
4. Contact the development team with:
   - Migration status query results
   - Error messages from logs
   - Current database schema state

