#!/bin/sh
# Don't use set -e here, we want to handle errors gracefully
set +e

echo "🚀 Starting application entrypoint..."
echo "📋 Environment check:"
echo "   NODE_ENV: ${NODE_ENV:-not set}"
echo "   DATABASE_URL: ${DATABASE_URL:+set (hidden)}${DATABASE_URL:-not set}"
echo "   PORT: ${PORT:-not set}"

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL environment variable is not set!"
  exit 1
fi

# Extract host and port from DATABASE_URL for pg_isready
# Format: postgresql://user:password@host:port/database
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p' || echo "5432")

# Use pg_isready if we can extract host, otherwise use migration retry logic
MAX_RETRIES=30
RETRY_COUNT=0

if [ -n "$DB_HOST" ] && command -v pg_isready > /dev/null 2>&1; then
  echo "   Using pg_isready to check database connection..."
  until pg_isready -h "$DB_HOST" -p "${DB_PORT:-5432}" -U postgres > /dev/null 2>&1 || [ $RETRY_COUNT -ge $MAX_RETRIES ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "   Database is unavailable - sleeping... (attempt $RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  done
else
  # Fallback: try to run a simple Prisma command
  echo "   Testing database connection with Prisma..."
  until echo "SELECT 1" | bunx prisma db execute --stdin > /dev/null 2>&1 || [ $RETRY_COUNT -ge $MAX_RETRIES ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "   Database is unavailable - sleeping... (attempt $RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  done
fi

if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
  echo "❌ Database connection timeout after $MAX_RETRIES attempts"
  exit 1
fi

echo "✅ Database is ready!"

# Run Prisma migrations
echo "🔄 Running database migrations..."
MIGRATION_OUTPUT=$(bunx prisma migrate deploy 2>&1)
MIGRATION_EXIT=$?

if [ $MIGRATION_EXIT -eq 0 ]; then
  echo "✅ Migrations completed successfully"
else
  echo "❌ Migration failed with exit code $MIGRATION_EXIT"
  echo "Migration output:"
  echo "$MIGRATION_OUTPUT"
  echo ""
  echo "⚠️  Attempting to resolve failed migration..."
  
  # Try to resolve failed migration if the script exists
  # Try force-rollback script first (more aggressive), then fallback to resolve script
  if [ -f "/app/prisma/force-rollback-migration.ts" ]; then
    echo "   Running force rollback script..."
    RECOVERY_OUTPUT=$(bunx tsx /app/prisma/force-rollback-migration.ts 2>&1 || bun run /app/prisma/force-rollback-migration.ts 2>&1)
    RECOVERY_EXIT=$?
  elif [ -f "/app/prisma/resolve-failed-migration.ts" ]; then
    echo "   Running migration recovery script..."
    RECOVERY_OUTPUT=$(bunx tsx /app/prisma/resolve-failed-migration.ts 2>&1 || bun run /app/prisma/resolve-failed-migration.ts 2>&1)
    RECOVERY_EXIT=$?
  else
    echo "❌ No recovery scripts found. Attempting manual rollback..."
    # Try to manually mark migration as rolled back
    RECOVERY_OUTPUT=$(echo "UPDATE \"_prisma_migrations\" SET rolled_back_at = NOW() WHERE migration_name = '20251114161611_add_club_join_request' AND finished_at IS NULL;" | bunx prisma db execute --stdin 2>&1)
    RECOVERY_EXIT=$?
  fi
  
  if [ $RECOVERY_EXIT -eq 0 ]; then
    echo "   ✅ Recovery script completed"
    echo "   Waiting 2 seconds before retrying migrations..."
    sleep 2
    echo "   Retrying migrations..."
    RETRY_OUTPUT=$(bunx prisma migrate deploy 2>&1)
    RETRY_EXIT=$?
    
    if [ $RETRY_EXIT -eq 0 ]; then
      echo "✅ Migrations completed after recovery"
    else
      echo "❌ Migration retry failed with exit code $RETRY_EXIT"
      echo "Retry output:"
      echo "$RETRY_OUTPUT"
      echo ""
      echo "The migration may need manual intervention."
      echo "You can try running this manually:"
      echo "  docker-compose -f docker-compose.prod.yml exec app bunx tsx /app/prisma/force-rollback-migration.ts"
      echo "  docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy"
      exit 1
    fi
  else
    echo "   ⚠️  Recovery script failed (exit code $RECOVERY_EXIT)"
    echo "Recovery output:"
    echo "$RECOVERY_OUTPUT"
    echo ""
    echo "Please resolve the migration manually:"
    echo "  1. Connect to the database"
    echo "  2. Run: UPDATE \"_prisma_migrations\" SET rolled_back_at = NOW() WHERE migration_name = '20251114161611_add_club_join_request' AND finished_at IS NULL;"
    echo "  3. Restart the container"
    exit 1
  fi
fi

# Generate Prisma Client (in case it wasn't generated during build)
echo "🔧 Ensuring Prisma Client is generated..."
GENERATE_OUTPUT=$(bunx prisma generate 2>&1)
GENERATE_EXIT=$?

if [ $GENERATE_EXIT -ne 0 ]; then
  echo "⚠️  Prisma Client generation failed (exit code $GENERATE_EXIT)"
  echo "Generate output:"
  echo "$GENERATE_OUTPUT"
  echo "Continuing anyway..."
fi

# Start the application
echo "🚀 Starting application..."
echo "Command: $@"
exec "$@"

