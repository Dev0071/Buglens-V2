# Sentry Testing Guide

## Overview

Buglens integrates Sentry for error tracking in both frontend and backend. This guide covers how to test both automatic and manual error capturing.

## Architecture

### Sentry Tunnel (Ad Blocker Bypass)

All frontend Sentry events are routed through the backend tunnel at `/api/sentry-tunnel` to bypass ad blockers.

```
Frontend Error → /api/sentry-tunnel → Sentry.io
```

**Implementation:**

- Frontend: `web/src/main.tsx` configures tunnel URL
- Backend: `src/api/routes/sentry-tunnel.ts` proxies to Sentry
- Content-Type: `application/x-sentry-envelope`

## Backend Testing

### Running Tests

```bash
npx tsx scripts/test-sentry.ts
```

### Test Coverage

The backend test suite covers:

1. **Manual Capture** - `Sentry.captureException(error)`
2. **Try-Catch Automatic** - Errors caught in try-catch blocks
3. **Promise Rejection** - Async error handling
4. **Message Capture** - `Sentry.captureMessage()`
5. **Error with Context** - Tags, user context, extra data

### Expected Output

```
✅ All tests complete! Check your Sentry dashboard.
   You should see 5 events (4 errors + 1 message)

📊 Summary:
   - 1 manual capture (red circle)
   - 1 try-catch automatic (yellow circle)
   - 1 promise rejection (orange circle)
   - 1 message (blue circle)
   - 1 error with context (purple circle)
```

### Backend Configuration

**File:** `src/utils/sentry.ts`

```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: NODE_ENV,
  enabled: true, // Set to NODE_ENV !== 'development' in production
  debug: true, // Disable in production
  tracesSampleRate: 0.1, // 10% sampling in production
  profilesSampleRate: 0.1,
});
```

## Frontend Testing

### Test Page

Navigate to: **http://localhost:5173/test-sentry**

### Test Coverage

The frontend test page (`web/src/pages/TestSentry.tsx`) covers:

1. **Manual Capture** - Explicit `captureException()` call
2. **Automatic (Click Handler)** - Uncaught error in event handler
3. **Async Error** - Promise rejection handling
4. **Undefined Access** - Common TypeError (`undefined.property`)
5. **Network Error** - Failed fetch requests
6. **Message Capture** - Info-level messages
7. **Error with Context** - User tags and metadata
8. **Render Error** - Caught by React ErrorBoundary

### Frontend Configuration

**File:** `web/src/main.tsx`

```typescript
Sentry.init({
  dsn: VITE_SENTRY_DSN,
  tunnel: `${API_URL}/api/sentry-tunnel`, // Bypass ad blockers
  environment: import.meta.env.MODE,
  enabled: true,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});
```

## Automatic vs Manual Capturing

### Automatic Capturing ✅

Sentry automatically captures:

**Backend:**

- Uncaught exceptions
- Unhandled promise rejections
- Console errors (if `captureConsoleIntegration` enabled)

**Frontend:**

- Uncaught JavaScript errors
- Unhandled promise rejections
- React component errors (via ErrorBoundary)

### Manual Capturing

Use manual capture when you need:

**Error Context:**

```typescript
Sentry.captureException(error, {
  extra: { userId, action: "checkout" },
  tags: { feature: "payments" },
});
```

**Controlled Error Handling:**

```typescript
try {
  await riskyOperation();
} catch (error) {
  // Log and handle gracefully
  Sentry.captureException(error);
  showUserFriendlyError();
}
```

**Non-Error Events:**

```typescript
Sentry.captureMessage("Important user action", "info");
```

## Verification

### Browser DevTools

1. **Network Tab** - Check for requests to `/api/sentry-tunnel`
2. **Console** - Look for Sentry debug logs (when `debug: true`)

### Backend Logs

Look for:

```
📤 Sentry sending event: <event-id>
✅ Sentry event captured: <event-id>
```

### Sentry Dashboard

1. Navigate to your Sentry project
2. Check **Issues** for new events
3. Verify event metadata (tags, context, breadcrumbs)
4. Check **Performance** for transactions (if enabled)

## Production Considerations

### Environment Variables

**Backend (.env):**

```bash
SENTRY_DSN=https://xxxxx@o4510676293517312.ingest.us.sentry.io/4510691114287104
NODE_ENV=production
```

**Frontend (web/.env.production):**

```bash
VITE_SENTRY_DSN=https://xxxxx@o4510676293517312.ingest.us.sentry.io/4510691114287104
VITE_API_URL=https://api.buglens.com
```

### Sampling Rates

**Production Settings:**

- `tracesSampleRate: 0.1` (10% of transactions)
- `profilesSampleRate: 0.1` (10% of profiles)
- `replaysSessionSampleRate: 0.1` (10% of sessions)
- `replaysOnErrorSampleRate: 1.0` (100% of errors)

**Why:** Reduces Sentry costs while maintaining error visibility.

### Sensitive Data

**Auto-scrubbed:**

- `authorization` headers
- `cookie` headers
- `x-api-key` headers

**Manual scrubbing:**

```typescript
beforeSend(event) {
  // Remove PII
  delete event.user?.email;

  // Filter health checks
  if (event.request?.url?.includes('/health')) {
    return null;
  }

  return event;
}
```

## Troubleshooting

### Events Not Appearing

1. **Check DSN** - Verify `SENTRY_DSN` is set correctly
2. **Check Network** - Look for 200 responses to `/api/sentry-tunnel`
3. **Check Logs** - Look for "beforeSend triggered" messages
4. **Verify Enabled** - Ensure `enabled: true` in Sentry.init()

### Tunnel Errors (415)

If you see `Unsupported Media Type: undefined`:

```typescript
// src/api/app.ts - Add content-type parser
server.addContentTypeParser(
  "application/x-sentry-envelope",
  { parseAs: "string" },
  (request, body, done) => done(null, body)
);
```

### Rate Limiting

Sentry has quota limits. Monitor usage:

- Dashboard → Settings → Quotas
- Set alerts for quota consumption

### Source Maps

For minified production code:

1. **Build with source maps:**

   ```bash
   npm run build -- --sourcemap
   ```

2. **Upload to Sentry:**
   ```bash
   sentry-cli releases files <version> upload-sourcemaps ./dist
   ```

## Testing Checklist

Before deploying:

- [ ] Backend test script passes (5 events)
- [ ] Frontend test page works (8 test cases)
- [ ] Tunnel returns 200 status codes
- [ ] Events appear in Sentry dashboard
- [ ] Source maps resolve correctly (production)
- [ ] Sensitive data is scrubbed
- [ ] Sampling rates are appropriate
- [ ] Rate limits won't be exceeded

## Cost Estimation

**Free Tier:** 5,000 events/month
**Team Tier:** $26/month for 50,000 events

**Our Usage (estimated):**

- Development: ~1,000 events/month
- Staging: ~2,000 events/month
- Production: ~10,000 events/month (with 10% sampling)

**Total:** ~13,000 events/month = **Team tier required**

## Support

- **Sentry Docs:** https://docs.sentry.io/platforms/javascript/
- **Issue Tracker:** Report Sentry integration issues in GitHub
- **Slack:** #engineering-alerts channel
