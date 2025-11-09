# Prisma Studio Docker Fix

## Problem Solved ✅

**Issue:** Prisma Studio container couldn't start with the following errors:

```
error: Failed to link typescript: EEXIST
error: Failed to link uuid: EEXIST
...
ReadOnlyFileSystem: failed opening node_modules/package dir
```

**Root Cause:** The `prisma-studio` service was mounting the app directory as read-only (`:ro`), which prevented `bun install` from creating symlinks in `node_modules`. The read-only filesystem also prevented npm/bun from properly linking native dependencies.

## Solution Applied

### Changed in `docker-compose.yml`

**Before (❌ Not working):**

```yaml
prisma-studio:
  image: oven/bun:1.3-alpine
  container_name: prisma-studio
  working_dir: /app
  volumes:
    - .:/app:ro # ❌ Read-only - prevents symlink creation
  command: >
    sh -c "bun install && bun db:studio"
```

**After (✅ Working):**

```yaml
prisma-studio:
  image: oven/bun:1.3-alpine
  container_name: prisma-studio
  working_dir: /app
  volumes:
    - .:/app # ✅ Read-write - allows symlink creation
    - /app/node_modules # ✅ Separate volume for node_modules
  command: >
    sh -c "bun install && bunx prisma studio"
```

### Key Changes

1. **Removed `:ro` flag** from app volume mount
   - Allows `bun install` to create symlinks for dependencies
   - Allows write access to node_modules directory

2. **Added separate volume** for `/app/node_modules`
   - Isolates node_modules from host filesystem
   - Improves performance with Docker volume caching
   - Prevents conflicts between host and container node_modules

3. **Changed command** from `bun db:studio` to `bunx prisma studio`
   - More explicit about running Prisma Studio directly
   - Uses bunx (Bun's package runner) for better compatibility

## How It Works Now

```
docker-compose up db prisma-studio
↓
PostgreSQL starts and becomes healthy
↓
Prisma Studio container starts
↓
bun install runs (can now create symlinks!)
↓
bunx prisma studio launches
↓
✅ Prisma Studio available at http://localhost:5555
```

## Verification

The fix was tested successfully:

```bash
$ docker-compose up db prisma-studio
...
prisma-studio  | ✔ Generated Prisma Client (v6.19.0) to ./node_modules/@prisma/client in 94ms
...
prisma-studio  | Prisma Studio is up on http://localhost:5555
```

✅ **Status: Working perfectly!**

## Usage

### Start Prisma Studio with Database

```bash
# Start both database and Prisma Studio
docker-compose up db prisma-studio

# Or start all services including app and worker
docker-compose up
```

### Access Prisma Studio

Open your browser and navigate to:

```
http://localhost:5555
```

### Interact with Database

In Prisma Studio, you can:

- Browse all database tables
- View records
- Add/edit/delete records
- Run raw database queries
- Monitor real-time changes

### Stop Services

```bash
# Stop all services gracefully
docker-compose down

# Stop and remove volumes (clean state)
docker-compose down -v
```

## Why This Matters

### Read-Only Filesystem Issues

When a Docker volume is mounted as read-only (`:ro`), operations that require write access fail:

- ❌ Creating symlinks in node_modules
- ❌ Writing package lock files
- ❌ Extracting native binaries
- ❌ Creating temporary files

### Separate node_modules Volume

By mounting `/app/node_modules` as a separate volume, we:

- ✅ Allow write access for npm/bun operations
- ✅ Prevent host filesystem pollution
- ✅ Enable Docker's volume caching for faster rebuilds
- ✅ Avoid conflicts between different installations

## Related Documentation

- [docker-compose.yml](../docker-compose.yml) - Complete Docker configuration
- [DOCKER_EMAIL_WORKER.md](./DOCKER_EMAIL_WORKER.md) - Email worker operations
- [VERIFICATION_CHECKLIST.md](./VERIFICATION_CHECKLIST.md) - Testing guide

## Best Practices Established

✅ Use separate volumes for node_modules in containerized Node/Bun applications
✅ Avoid read-only volumes for packages that need to create symlinks during install
✅ Use volume caching to improve Docker build and startup performance
✅ Test Docker configurations before committing to verify all services start cleanly

---

**Fix Applied:** November 2025
**Version:** 1.0.0
**Status:** ✅ Production Ready
