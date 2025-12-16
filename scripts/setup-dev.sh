#!/bin/bash
set -e

echo "🐳 Starting Docker services..."
docker-compose up -d

echo "⏳ Waiting for PostgreSQL to be ready..."
until docker exec buglens-postgres pg_isready -U buglens > /dev/null 2>&1; do
  sleep 1
done

echo "✅ PostgreSQL is ready"

echo "⏳ Waiting for LocalStack to be ready..."
until docker exec buglens-localstack curl -sf http://localhost:4566/_localstack/health > /dev/null 2>&1; do
  sleep 1
done

echo "✅ LocalStack is ready"

echo "🪣 Creating S3 bucket in LocalStack..."
docker exec buglens-localstack awslocal s3 mb s3://buglens-cache 2>/dev/null || echo "   Bucket already exists"

echo "📦 Running database migrations..."
npm run migrate:up

echo "🌱 Seeding development data..."
docker exec -i buglens-postgres psql -U buglens -d buglens_dev < scripts/seed-dev-data.sql

echo "✅ Development environment ready!"
echo ""
echo "Database URL: postgresql://buglens:buglens_dev_password@localhost:5432/buglens_dev"
echo "Redis URL: redis://localhost:6379"
echo "LocalStack S3: http://localhost:4566 (bucket: buglens-cache)"
echo ""
echo "To stop services: docker-compose down"
