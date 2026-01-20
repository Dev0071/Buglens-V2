# Vercel Deployment Setup Guide

## Overview

The Buglens frontend (React + Vite) is deployed to Vercel with automatic deployments from GitHub.

## Initial Setup

### 1. Create Vercel Project

1. Visit [vercel.com](https://vercel.com) and sign in
2. Click **Add New Project**
3. Import your GitHub repository (`buglens/buglens`)
4. Configure project:
   - **Framework Preset:** Vite
   - **Root Directory:** `web`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm ci`

### 2. Configure Environment Variables

In Vercel Project Settings → Environment Variables:

**Production:**

```bash
VITE_API_URL=https://buglens-api.herokuapp.com
VITE_SENTRY_DSN=<your-sentry-frontend-dsn>
```

**Preview (Staging):**

```bash
VITE_API_URL=https://buglens-staging-api.herokuapp.com
VITE_SENTRY_DSN=<your-sentry-frontend-dsn>
```

**Development:**

```bash
VITE_API_URL=http://localhost:3000
VITE_SENTRY_DSN=<your-sentry-frontend-dsn>
```

### 3. Get Vercel Tokens

#### Deployment Token

1. Go to [Vercel Account Settings](https://vercel.com/account/tokens)
2. Create new token: **"GitHub Actions"**
3. Copy token → Add to GitHub Secrets as `VERCEL_TOKEN`

#### Organization ID

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Link project
cd web
vercel link

# Get org ID
cat .vercel/project.json | grep orgId
```

Copy `orgId` → Add to GitHub Secrets as `VERCEL_ORG_ID`

#### Project ID

```bash
cat .vercel/project.json | grep projectId
```

Copy `projectId` → Add to GitHub Secrets as `VERCEL_PROJECT_ID`

### 4. Configure Custom Domains

#### Staging Domain

1. Go to Vercel Project → Settings → Domains
2. Add domain: `staging.buglens.com`
3. Follow DNS instructions to add CNAME record:
   ```
   CNAME staging.buglens.com → cname.vercel-dns.com
   ```

#### Production Domain

1. Add domain: `app.buglens.com`
2. Set as production domain
3. Add DNS records:
   ```
   CNAME app.buglens.com → cname.vercel-dns.com
   ```

### 5. Add GitHub Secrets

In GitHub Repository → Settings → Secrets and variables → Actions:

```
VERCEL_TOKEN=<from-step-3>
VERCEL_ORG_ID=<from-step-3>
VERCEL_PROJECT_ID=<from-step-3>
VITE_SENTRY_DSN=<your-frontend-sentry-dsn>
```

## Deployment Flow

### Automatic Deployments

**Staging (Preview):**

- Trigger: Push to `staging` branch
- Deploys to: Preview URL + `staging.buglens.com` alias
- Environment: `preview`
- Variables: Uses "Preview" environment variables

**Production:**

- Trigger: Push to `main` branch
- Deploys to: `app.buglens.com`
- Environment: `production`
- Variables: Uses "Production" environment variables

### Manual Deployment

```bash
# Deploy to preview
cd web
vercel

# Deploy to production
vercel --prod
```

## Vercel CLI Commands

### Setup

```bash
# Install CLI
npm i -g vercel

# Login
vercel login

# Link existing project
cd web
vercel link
```

### Deployment

```bash
# Deploy to preview (staging)
vercel

# Deploy to production
vercel --prod

# Deploy with specific environment
vercel --target production
```

### Environment Variables

```bash
# List environment variables
vercel env ls

# Add environment variable
vercel env add VITE_API_URL production

# Pull environment variables locally
vercel env pull
```

### Project Info

```bash
# Get project details
vercel project ls

# Get deployment logs
vercel logs <deployment-url>

# List deployments
vercel ls
```

### Domains

```bash
# List domains
vercel domains ls

# Add domain
vercel domains add app.buglens.com

# Remove domain
vercel domains rm app.buglens.com
```

## GitHub Actions Integration

The deployment pipeline automatically:

1. **Installs Vercel CLI** globally
2. **Pulls environment** from Vercel for the target environment
3. **Builds the app** with `vercel build`
4. **Deploys** with `vercel deploy --prebuilt`
5. **Assigns alias** to `staging.buglens.com` (staging only)
6. **Health checks** the deployment URL

### Workflow Snippet

```yaml
- name: Deploy to Vercel
  run: |
    # Pull environment
    vercel pull --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}

    # Build
    vercel build --token=${{ secrets.VERCEL_TOKEN }}

    # Deploy
    DEPLOYMENT_URL=$(vercel deploy --prebuilt --token=${{ secrets.VERCEL_TOKEN }})

    # Assign alias
    vercel alias set $DEPLOYMENT_URL staging.buglens.com --token=${{ secrets.VERCEL_TOKEN }}
  working-directory: ./web
```

## Build Configuration

### vercel.json

Create `web/vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm ci",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

### Key Features:

- **SPA Routing:** All routes redirect to `/index.html`
- **Security Headers:** CSP, XSS protection, frame options
- **Caching:** Assets cached for 1 year (immutable)

## Monitoring

### Vercel Dashboard

1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Select your project
3. View:
   - **Deployments:** All deployment history
   - **Analytics:** Web Vitals, page views
   - **Logs:** Runtime and build logs
   - **Insights:** Performance metrics

### Deployment Status

Check deployment status:

```bash
# Get latest deployment
vercel ls --meta gitCommitSha=$(git rev-parse HEAD)

# Check deployment health
curl https://staging.buglens.com
```

### Web Vitals

Vercel automatically tracks:

- **LCP (Largest Contentful Paint):** <2.5s target
- **FID (First Input Delay):** <100ms target
- **CLS (Cumulative Layout Shift):** <0.1 target

View in: Project → Analytics → Web Vitals

## Troubleshooting

### Build Fails

**Error:** `Module not found`

```bash
# Check dependencies in web/package.json
cd web
npm ci
npm run build

# If local build works, check Vercel build logs
vercel logs <deployment-url>
```

**Error:** `Environment variable not set`

```bash
# Verify environment variables
vercel env ls

# Pull and check .env file
vercel env pull .env.local
cat .env.local
```

### Deployment URL Not Working

**Check DNS:**

```bash
# Verify DNS propagation
dig staging.buglens.com

# Should show CNAME to Vercel
# staging.buglens.com. 300 IN CNAME cname.vercel-dns.com.
```

**Check SSL:**

```bash
# Test HTTPS
curl -I https://staging.buglens.com

# Vercel automatically provisions SSL (may take 24h)
```

### API Connection Fails

**CORS Error:** Frontend can't connect to API

```typescript
// Check VITE_API_URL in environment
console.log(import.meta.env.VITE_API_URL);

// Should match Heroku API URL
// Staging: https://buglens-staging-api.herokuapp.com
// Production: https://buglens-api.herokuapp.com
```

**Fix:** Update Vercel environment variables

### Sentry Not Working

**Check tunnel configuration:**

```typescript
// web/src/main.tsx
const tunnelUrl = `${import.meta.env.VITE_API_URL}/api/sentry-tunnel`;
console.log("Sentry tunnel:", tunnelUrl);
```

**Verify in browser DevTools:**

- Network tab → Filter "sentry-tunnel"
- Should see POST requests with 200 status

## Performance Optimization

### Enable Compression

Vercel automatically gzips/brotli compresses responses.

### Image Optimization

Use Vercel's Image Optimization:

```tsx
import Image from "next/image"; // If using Next.js

// Or for Vite, use optimized formats
<img src="/logo.webp" alt="Logo" />;
```

### Code Splitting

Vite automatically code-splits. Verify in build output:

```bash
npm run build

# Should show multiple chunk files
dist/assets/index-[hash].js
dist/assets/vendor-[hash].js
```

### Edge Caching

Configure caching headers in `vercel.json` (see above).

## Cost Management

### Vercel Free Tier (Hobby)

- **Bandwidth:** 100 GB/month
- **Build Time:** 100 hours/month
- **Deployments:** Unlimited
- **Team Members:** 1

### Pro Tier ($20/month)

- **Bandwidth:** 1 TB/month
- **Build Time:** 400 hours/month
- **Team Members:** Unlimited
- **Analytics:** Included
- **Support:** Email

### Enterprise

- Custom bandwidth
- Dedicated support
- SSO/SAML
- SLA guarantees

### Monitoring Usage

1. Go to [Vercel Dashboard → Usage](https://vercel.com/dashboard/usage)
2. Check:
   - Bandwidth consumption
   - Build minutes
   - Function invocations (if using serverless)

## Security Best Practices

### Environment Variables

✅ **Do:**

- Store secrets in Vercel environment variables
- Use different values for preview/production
- Rotate tokens regularly

❌ **Don't:**

- Commit `.env` files to Git
- Expose API keys in frontend code
- Use production secrets in preview

### Headers

Already configured in `vercel.json`:

- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- X-XSS-Protection: 1; mode=block

### HTTPS

- Vercel forces HTTPS (auto-redirect)
- SSL certificates auto-renewed
- HSTS enabled by default

## Rollback

### Via Dashboard

1. Go to Vercel Project → Deployments
2. Find previous successful deployment
3. Click **Promote to Production**

### Via CLI

```bash
# List deployments
vercel ls

# Promote specific deployment
vercel promote <deployment-url>
```

### Via Git

```bash
# Revert commit
git revert <commit-sha>
git push origin main

# Triggers new deployment with reverted code
```

## Support

- **Vercel Docs:** https://vercel.com/docs
- **Vite Docs:** https://vitejs.dev/guide/
- **GitHub Actions:** `.github/workflows/deploy-staging.yml`
- **Slack:** #deployments channel
