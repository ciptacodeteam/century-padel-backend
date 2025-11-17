# ============================================
# Multi-stage Dockerfile for Production
# ============================================
# Enable BuildKit for cache mounts (requires: DOCKER_BUILDKIT=1)
# syntax=docker/dockerfile:1.4

# Stage 1: Dependencies
FROM oven/bun:1.3-alpine AS deps

WORKDIR /app

# Copy package files first (for better layer caching)
# Only package files change should invalidate this layer
COPY package.json bun.lock* ./

# Install production dependencies with cache mount for faster rebuilds
# Cache mount persists Bun's install cache across builds
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile

# Copy Prisma schema AFTER dependencies are installed
# This way Prisma changes don't invalidate the expensive bun install layer
COPY prisma ./prisma

# Generate Prisma Client
RUN bunx prisma generate

# ============================================
# Stage 2: Builder
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Copy package files first (for better layer caching)
COPY package.json bun.lock* ./

# Install all dependencies (including devDependencies for build)
# Use cache mount to speed up repeated builds
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# Copy Prisma schema AFTER dependencies are installed
COPY prisma ./prisma

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src
COPY serve.ts ./

# Build TypeScript
RUN bun run build

# ============================================
# Stage 3: Production Runtime
FROM oven/bun:1.3-alpine AS runner

WORKDIR /app

# Install runtime system dependencies
RUN apk add --no-cache \
    postgresql-client \
    ca-certificates \
    dumb-init \
    && rm -rf /var/cache/apk/*

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy necessary files from previous stages
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./

# Copy entrypoint script and make it executable (must be done as root)
COPY docker/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && \
    chown nodejs:nodejs /app/docker-entrypoint.sh

# Create storage directories with proper permissions
RUN mkdir -p /app/storage/logs /app/storage/uploads && \
    chown -R nodejs:nodejs /app/storage

# Switch to non-root user
USER nodejs

# Expose application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD bun run --bun /app/dist/healthcheck.js || exit 1

# Use dumb-init to handle signals properly, then run entrypoint script
ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]

# Start application (will be executed by entrypoint script)
CMD ["bun", "run", "start"]
