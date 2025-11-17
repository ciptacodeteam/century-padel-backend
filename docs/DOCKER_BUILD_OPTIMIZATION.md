# Docker Build Optimization Guide

## Why `bun install` Takes Long

The build process can be slow due to several factors:

1. **`--no-cache` flag** - Forces complete rebuild, ignoring Docker layer cache
2. **Two separate `bun install` runs** - One for production deps, one for all deps
3. **Network speed** - Downloading packages from npm registry
4. **No layer caching** - Docker can't reuse cached layers

## Optimizations Applied

### 1. Docker Layer Caching

The Dockerfile now:
- Copies `bun.lock*` first for better cache hits
- Uses `--frozen-lockfile` for faster, deterministic installs
- Separates dependency installation from source code copying

### 2. Conditional Clean Builds

The `deploy.sh` script now:
- Uses Docker cache by default (much faster)
- Only uses `--no-cache` when `CLEAN_BUILD=true` is set

### 3. .dockerignore File

Excludes unnecessary files from build context:
- `node_modules` (will be installed fresh)
- Documentation files
- Test files
- Development configs
- Git files

This reduces the build context size and speeds up the `COPY` operations.

## Usage

### Normal Deployment (Fast - Uses Cache)

```bash
./deploy.sh
```

This will:
- Use Docker layer cache
- Only rebuild changed layers
- Much faster (typically 1-2 minutes vs 5-10 minutes)

### Clean Build (Slow - No Cache)

If you need a completely fresh build:

```bash
CLEAN_BUILD=true ./deploy.sh
```

Or manually:

```bash
docker-compose -f docker-compose.prod.yml build --no-cache
```

## Build Time Comparison

| Scenario | Time | Notes |
|----------|------|-------|
| First build | ~5-10 min | No cache, downloads all packages |
| Cached build (no deps change) | ~30-60 sec | Only rebuilds changed layers |
| Cached build (deps change) | ~2-5 min | Reinstalls dependencies |
| Clean build | ~5-10 min | Forces complete rebuild |

## Further Optimizations

### 1. Use BuildKit (Recommended)

Enable Docker BuildKit for faster builds:

```bash
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

./deploy.sh
```

Or add to your shell profile:

```bash
echo 'export DOCKER_BUILDKIT=1' >> ~/.bashrc
echo 'export COMPOSE_DOCKER_CLI_BUILD=1' >> ~/.bashrc
```

### 2. Use Build Cache Mount (Advanced)

For even faster builds, you can mount the Bun cache:

```dockerfile
# In Dockerfile, replace:
RUN bun install --production --frozen-lockfile

# With:
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile
```

### 3. Parallel Stage Builds

The multi-stage build already runs stages in parallel where possible.

### 4. Reduce Dependencies

Review your `package.json`:
- Remove unused dependencies
- Use lighter alternatives where possible
- Consider splitting into smaller packages

## Troubleshooting

### Build Still Slow?

1. **Check network speed:**
   ```bash
   ping registry.npmjs.org
   ```

2. **Check Docker cache:**
   ```bash
   docker system df
   ```

3. **Clear old cache (if needed):**
   ```bash
   docker builder prune
   ```

4. **Check build logs:**
   ```bash
   docker-compose -f docker-compose.prod.yml build --progress=plain
   ```

### Cache Not Working?

1. Ensure `bun.lock` is committed to git
2. Don't use `--no-cache` unless necessary
3. Check that Docker BuildKit is enabled

## Best Practices

1. **Commit lock files** - `bun.lock` should be in git
2. **Use cache by default** - Only use `--no-cache` when debugging
3. **Update dependencies carefully** - Changes trigger dependency rebuilds
4. **Monitor build times** - Track improvements over time

## Additional Resources

- [Docker BuildKit Documentation](https://docs.docker.com/build/buildkit/)
- [Bun Installation Guide](https://bun.sh/docs/installation)
- [Docker Layer Caching Best Practices](https://docs.docker.com/build/cache/)

