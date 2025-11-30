#!/bin/bash
set -e

echo "🐳 Starting Docker services..."
docker-compose up -d

echo "⏳ Waiting for PostgreSQL to be ready..."
until docker exec buglens-postgres pg_isready -U buglens > /dev/null 2>&1; do
  sleep 1
done

echo "✅ PostgreSQL is ready"

echo "📦 Running database migrations..."
npm run migrate:up

echo "🌱 Seeding development data..."
docker exec -i buglens-postgres psql -U buglens -d buglens_dev < scripts/seed-dev-data.sql

echo "✅ Development environment ready!"
echo ""
echo "Database URL: postgresql://buglens:buglens_dev_password@localhost:5432/buglens_dev"
echo "Redis URL: redis://localhost:6379"
echo ""
echo "To stop services: docker-compose down"
