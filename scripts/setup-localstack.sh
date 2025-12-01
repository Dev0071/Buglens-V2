#!/bin/bash
# Setup LocalStack S3 bucket for Buglens development

set -e

BUCKET_NAME="${S3_BUCKET_NAME:-buglens-cache-dev}"
LOCALSTACK_ENDPOINT="${S3_ENDPOINT:-http://localhost:4566}"

echo "🪣 Setting up LocalStack S3 bucket: $BUCKET_NAME"

# Wait for LocalStack to be ready
echo "⏳ Waiting for LocalStack to be ready..."
until curl -s "$LOCALSTACK_ENDPOINT/_localstack/health" | grep -q '"s3": "running"'; do
  sleep 1
done
echo "✅ LocalStack is ready"

# Create the bucket
echo "📦 Creating S3 bucket..."
aws --endpoint-url="$LOCALSTACK_ENDPOINT" \
    s3 mb "s3://$BUCKET_NAME" \
    --region us-east-1 2>/dev/null || echo "Bucket already exists"

# Verify bucket exists
echo "🔍 Verifying bucket..."
aws --endpoint-url="$LOCALSTACK_ENDPOINT" \
    s3 ls | grep "$BUCKET_NAME"

echo "✅ LocalStack S3 setup complete!"
echo ""
echo "Add these to your .env file:"
echo "  S3_BUCKET_NAME=$BUCKET_NAME"
echo "  S3_ENDPOINT=$LOCALSTACK_ENDPOINT"
echo "  AWS_ACCESS_KEY_ID=test"
echo "  AWS_SECRET_ACCESS_KEY=test"
echo "  AWS_REGION=us-east-1"
