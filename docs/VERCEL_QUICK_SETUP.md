# Vercel Deployment Quick Setup Checklist

## Prerequisites

- [ ] GitHub repository with `staging` and `main` branches
- [ ] Vercel account ([vercel.com](https://vercel.com))
- [ ] Domain configured (optional): `staging.buglens.com`, `app.buglens.com`

## Step 1: Create Vercel Project

1. [ ] Go to [vercel.com/new](https://vercel.com/new)
2. [ ] Import GitHub repository
3. [ ] Configure settings:
   - **Root Directory:** `web`
   - **Framework:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`

## Step 2: Set Environment Variables

In Vercel Dashboard → Settings → Environment Variables:

### Production

```bash
VITE_API_URL=https://buglens-api.herokuapp.com
VITE_SENTRY_DSN=<your-sentry-dsn>
```

### Preview (Staging)

```bash
VITE_API_URL=https://buglens-staging-api.herokuapp.com
VITE_SENTRY_DSN=<your-sentry-dsn>
```

## Step 3: Get Vercel Credentials

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Link project
cd web
vercel link

# Get IDs
cat .vercel/project.json
```

- [ ] Copy `orgId`
- [ ] Copy `projectId`
- [ ] Create deployment token: [vercel.com/account/tokens](https://vercel.com/account/tokens)

## Step 4: Add GitHub Secrets

Go to GitHub → Settings → Secrets → Actions:

- [ ] `VERCEL_TOKEN` = <deployment-token>
- [ ] `VERCEL_ORG_ID` = <org-id-from-step-3>
- [ ] `VERCEL_PROJECT_ID` = <project-id-from-step-3>
- [ ] `VITE_SENTRY_DSN` = <your-frontend-sentry-dsn>

## Step 5: Configure Domains (Optional)

### Staging: staging.buglens.com

1. [ ] Vercel Dashboard → Domains → Add Domain
2. [ ] Add DNS record:
   ```
   CNAME staging.buglens.com → cname.vercel-dns.com
   ```

### Production: app.buglens.com

1. [ ] Vercel Dashboard → Domains → Add Domain
2. [ ] Set as production domain
3. [ ] Add DNS record:
   ```
   CNAME app.buglens.com → cname.vercel-dns.com
   ```

## Step 6: Test Deployment

```bash
# Push to staging
git checkout staging
git push origin staging
```

Watch GitHub Actions: `.github/workflows/deploy-staging.yml`

Expected results:

- [ ] Frontend builds successfully
- [ ] Deploys to Vercel
- [ ] Assigns `staging.buglens.com` alias
- [ ] Smoke tests pass
- [ ] URL accessible: https://staging.buglens.com

## Step 7: Verify Integration

1. [ ] Visit https://staging.buglens.com
2. [ ] Check browser console for errors
3. [ ] Verify API connection (should point to staging API)
4. [ ] Test Sentry integration (navigate to `/test-sentry`)
5. [ ] Check Network tab for `/api/sentry-tunnel` requests

## Troubleshooting

### Build Fails

```bash
# Test locally
cd web
npm ci
npm run build
```

### Environment Variables Not Working

```bash
# Pull from Vercel
cd web
vercel env pull .env.local
cat .env.local
```

### Domain Not Working

```bash
# Check DNS
dig staging.buglens.com

# Should return:
# staging.buglens.com. 300 IN CNAME cname.vercel-dns.com.
```

### API Connection Fails

Check `VITE_API_URL` in Vercel dashboard matches your Heroku API URL.

## Next Steps

- [ ] Review deployment logs in Vercel dashboard
- [ ] Set up analytics monitoring
- [ ] Configure production deployment for `main` branch
- [ ] Test rollback procedure

## Resources

- **Setup Guide:** `docs/VERCEL_SETUP_GUIDE.md`
- **Deployment Pipeline:** `docs/DEPLOYMENT_PIPELINE.md`
- **Vercel Docs:** https://vercel.com/docs
- **GitHub Workflow:** `.github/workflows/deploy-staging.yml`
