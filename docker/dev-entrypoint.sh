#!/bin/sh
set -e

echo "Waiting for database..."
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_PORT=${DB_PORT:-5432}

RETRY=0
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -q 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge 30 ]; then
    echo "Database not ready after 30 attempts"
    exit 1
  fi
  sleep 2
done

echo "Applying database schema..."
bunx prisma db push

echo "Starting: $*"
exec "$@"
