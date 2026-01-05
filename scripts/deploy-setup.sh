#!/bin/bash
# Buglens Deployment Setup Script
# Run this to set up staging infrastructure on DigitalOcean

set -e

echo "🚀 Buglens Deployment Setup"
echo "==========================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
check_prerequisites() {
    echo "📋 Checking prerequisites..."

    # Check doctl
    if ! command -v doctl &> /dev/null; then
        echo -e "${RED}❌ doctl not found. Install with: brew install doctl${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} doctl installed"

    # Check doctl auth
    if ! doctl account get &> /dev/null; then
        echo -e "${YELLOW}⚠️  doctl not authenticated. Running 'doctl auth init'...${NC}"
        doctl auth init
    fi
    echo -e "${GREEN}✓${NC} doctl authenticated"

    # Check Docker
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker not found. Please install Docker Desktop.${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Docker installed"

    echo ""
}

# Create DigitalOcean Spaces bucket
create_spaces_bucket() {
    BUCKET_NAME=${1:-buglens-cache-staging}
    REGION=${2:-nyc3}

    echo "📦 Creating Spaces bucket: $BUCKET_NAME..."

    # Check if bucket exists
    if doctl spaces list | grep -q "$BUCKET_NAME"; then
        echo -e "${YELLOW}⚠️  Bucket $BUCKET_NAME already exists${NC}"
    else
        # Note: doctl doesn't support creating Spaces, use s3cmd or console
        echo -e "${YELLOW}⚠️  Create Spaces bucket manually:${NC}"
        echo "   1. Go to: https://cloud.digitalocean.com/spaces"
        echo "   2. Create Space named: $BUCKET_NAME"
        echo "   3. Region: $REGION"
        echo "   4. File Listing: Restricted"
    fi
    echo ""
}

# Generate Spaces access keys
create_spaces_keys() {
    echo "🔑 Spaces Access Keys..."
    echo "Create keys at: https://cloud.digitalocean.com/account/api/spaces"
    echo ""
}

# Deploy App Platform
deploy_app_platform() {
    echo "🚀 Deploying to App Platform..."

    APP_SPEC=".do/app.yaml"

    if [ ! -f "$APP_SPEC" ]; then
        echo -e "${RED}❌ App spec not found: $APP_SPEC${NC}"
        exit 1
    fi

    # Check if app exists
    APP_ID=$(doctl apps list --format ID,Spec.Name --no-header | grep "buglens-staging" | awk '{print $1}')

    if [ -n "$APP_ID" ]; then
        echo -e "${YELLOW}⚠️  App already exists: $APP_ID${NC}"
        echo "   Updating app..."
        doctl apps update $APP_ID --spec $APP_SPEC
    else
        echo "Creating new app..."
        APP_ID=$(doctl apps create --spec $APP_SPEC --format ID --no-header)
        echo -e "${GREEN}✓${NC} App created: $APP_ID"
    fi

    echo ""
    echo "📝 Save this App ID for GitHub Secrets:"
    echo "   DO_APP_ID_STAGING=$APP_ID"
    echo ""
}

# Set up GitHub secrets reminder
setup_github_secrets() {
    echo "🔐 GitHub Secrets Required"
    echo "=========================="
    echo ""
    echo "Add these secrets to your GitHub repository:"
    echo "(Settings → Secrets and variables → Actions)"
    echo ""
    echo "Required secrets:"
    echo "  DIGITALOCEAN_ACCESS_TOKEN - From https://cloud.digitalocean.com/account/api/tokens"
    echo "  DO_APP_ID_STAGING - App ID from above"
    echo "  SENTRY_AUTH_TOKEN - From https://sentry.io/settings/auth-tokens/"
    echo "  SLACK_WEBHOOK_URL - From Slack App settings"
    echo ""
    echo "Required variables (Settings → Variables):"
    echo "  STAGING_API_URL - e.g., https://buglens-staging-xxxxx.ondigitalocean.app"
    echo "  SENTRY_ORG - Your Sentry organization slug"
    echo "  SENTRY_PROJECT - Your Sentry project slug"
    echo ""
}

# Main menu
main() {
    check_prerequisites

    echo "What would you like to do?"
    echo "1) Full setup (recommended for first time)"
    echo "2) Create Spaces bucket only"
    echo "3) Deploy App Platform only"
    echo "4) Show GitHub secrets reminder"
    echo "5) Exit"
    echo ""
    read -p "Select option (1-5): " choice

    case $choice in
        1)
            create_spaces_bucket
            create_spaces_keys
            deploy_app_platform
            setup_github_secrets
            echo -e "${GREEN}✅ Setup complete!${NC}"
            ;;
        2)
            create_spaces_bucket
            ;;
        3)
            deploy_app_platform
            ;;
        4)
            setup_github_secrets
            ;;
        5)
            echo "Goodbye!"
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            exit 1
            ;;
    esac
}

# Run main
main
