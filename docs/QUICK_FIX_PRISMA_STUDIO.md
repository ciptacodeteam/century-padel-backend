# Quick Fix Reference: Prisma Studio Docker Issue

## The Problem

```
error: Failed to link typescript: EEXIST
error: Failed to link uuid: EEXIST
ReadOnlyFileSystem: failed opening node_modules/package dir
```

## The Solution

Two simple changes in `docker-compose.yml`:

### 1️⃣ Change the volumes section:

```yaml
# FROM:
volumes:
  - .:/app:ro

# TO:
volumes:
  - .:/app
  - /app/node_modules
```

### 2️⃣ Change the command:

```yaml
# FROM:
command: >
  sh -c "bun install && bun db:studio"

# TO:
command: >
  sh -c "bun install && bunx prisma studio"
```

## Why It Works

- ✅ Removed `:ro` (read-only) flag - allows `bun install` to create symlinks
- ✅ Added separate `node_modules` volume - provides write access for dependencies
- ✅ Updated command - uses `bunx` for better compatibility

## Test It

```bash
# Start containers
docker-compose up -d

# Access Prisma Studio
open http://localhost:5555
```

## Success Indicators

✅ All services show as `Up` in `docker-compose ps`
✅ Database shows `(healthy)`
✅ Redis shows `(healthy)`
✅ Prisma Studio opens in browser
✅ No errors in logs

---

**Status:** ✅ Fixed and Tested
**Time to Deploy:** 2 minutes
**Impact:** All services now work correctly
