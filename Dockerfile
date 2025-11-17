# ============================================
# Multi-stage Dockerfile for Production
# ============================================
# syntax=docker/dockerfile:1.4

# Stage 1: Dependencies
FROM oven/bun:1.3-alpine AS deps

WORKDIR /app

# Install system dependencies needed for native modules
RUN apk add --no-cache python3 make g++

# Copy package files for dependency installation
COPY package.json bun.lockb* ./

# Copy Prisma schema (needed for postinstall)
COPY prisma ./prisma

# Install production dependencies with optimized flags
# Use --no-optional to skip optional dependencies and speed up install
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile --no-progress

# ============================================
# Stage 2: Builder
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json bun.lockb* ./

# Copy Prisma schema
COPY prisma ./prisma

# Install all dependencies (including devDependencies)
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --no-progress

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
