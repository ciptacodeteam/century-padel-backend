# ============================================
# Multi-stage Dockerfile for Production
# ============================================

# Stage 1: Dependencies
FROM oven/bun:1.3-alpine AS deps

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY prisma ./prisma

# Install production dependencies only
RUN bun install --production --frozen-lockfile

# Generate Prisma Client
RUN bunx prisma generate

# ============================================
# Stage 2: Builder
FROM oven/bun:1.3-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY prisma ./prisma

# Install all dependencies (including devDependencies for build)
RUN bun install --frozen-lockfile

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src
COPY serve.ts ./
COPY index.ts ./

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

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["bun", "run", "start"]
