#!/bin/sh
set -e

echo "🚀 Starting application entrypoint..."

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
  until bunx prisma db execute --stdin <<< "SELECT 1" > /dev/null 2>&1 || [ $RETRY_COUNT -ge $MAX_RETRIES ]; do
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
if bunx prisma migrate deploy; then
  echo "✅ Migrations completed successfully"
else
  echo "❌ Migration failed!"
  echo "⚠️  Attempting to resolve failed migration..."
  
  # Try to resolve failed migration if the script exists
  if [ -f "/app/prisma/resolve-failed-migration.ts" ]; then
    echo "   Running migration recovery script..."
    # Try to run the script (tsx should be available via bunx)
    if bunx tsx /app/prisma/resolve-failed-migration.ts 2>/dev/null || bun run /app/prisma/resolve-failed-migration.ts 2>/dev/null; then
      echo "   ✅ Recovery script completed"
      echo "   Retrying migrations..."
      if bunx prisma migrate deploy; then
        echo "✅ Migrations completed after recovery"
      else
        echo "❌ Migration retry failed. Please check the logs and resolve manually."
        exit 1
      fi
    else
      echo "   ⚠️  Could not run recovery script (tsx may not be available)"
      echo "   Please resolve the migration manually and restart the container."
      exit 1
    fi
  else
    echo "❌ Migration failed and recovery script not found."
    echo "   Please check the migration status and resolve manually."
    exit 1
  fi
fi

# Generate Prisma Client (in case it wasn't generated during build)
echo "🔧 Ensuring Prisma Client is generated..."
bunx prisma generate

# Start the application
echo "🚀 Starting application..."
exec "$@"

