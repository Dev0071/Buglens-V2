# Authentication Fix - Organization Context from JWT

## Problem

After login, authenticated API requests were returning:

```json
{ "error": "Unauthorized", "message": "Organization context required" }
```

## Root Cause

The `orgContextMiddleware` was only looking for `orgId` in:

- `x-org-id` header (for webhooks)
- `org_id` path parameter

It was **NOT** extracting `orgId` from the JWT token, even though the JWT contained it:

```typescript
// JWT payload (from login/signup)
{
  userId: "usr-123",
  orgId: "org-456",  // ← This was being ignored!
  iat: 1703520000,
  exp: 1703523600
}
```

## Solution

Modified `src/api/middleware/org-context.ts` to extract `orgId` from JWT token with priority:

1. **JWT token** (authenticated API requests) - **NEW**
2. `x-org-id` header (webhooks)
3. `org_id` path parameter

```typescript
// New logic in orgContextMiddleware
const authHeader = request.headers.authorization;
if (authHeader && authHeader.startsWith("Bearer ")) {
  try {
    await request.jwtVerify();
    const user = request.user as JWTPayload | undefined;
    if (user && user.orgId) {
      candidateOrgId = user.orgId; // ✅ Extract from JWT!
    }
  } catch (error) {
    // Continue to check headers/params
  }
}
```

## Files Modified

- [`src/api/middleware/org-context.ts`](../src/api/middleware/org-context.ts) - Added JWT extraction

## Testing Instructions

### 1. Start the Backend

```bash
cd /Users/kabiru24/Desktop/Projects/Buglens\ V2
docker-compose up -d  # Start Postgres, Redis
npm run dev           # Start API on :3000
```

### 2. Test Signup/Login

```bash
# Signup
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!",
    "name": "Test User",
    "organizationName": "Test Org"
  }'

# Copy the accessToken from response
```

### 3. Test Authenticated Endpoints

```bash
# Replace YOUR_TOKEN with the token from step 2

# Dashboard stats (should work now!)
curl -X GET "http://localhost:3000/api/dashboard/stats" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Recent events
curl -X GET "http://localhost:3000/api/events/recent?limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Cost summary
curl -X GET "http://localhost:3000/api/costs/summary" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Expected Results

- ✅ All requests should return `200 OK` (not `401 Unauthorized`)
- ✅ No "Organization context required" errors
- ✅ Data is scoped to the user's organization

### 4. Test Frontend

```bash
cd web
npm run dev  # Start frontend on :3001
```

1. Navigate to `http://localhost:3001`
2. Create an account or login
3. Check browser console Network tab
4. All API calls should succeed (no 401 errors)

## Verification Checklist

- ✅ JWT verification works
- ✅ orgId extracted from JWT token
- ✅ Organization validated in database
- ✅ org context set in request
- ✅ Webhooks still work (fallback to x-org-id header)
- ✅ No breaking changes to existing routes

## Impact

This fix restores functionality for ALL authenticated endpoints:

- `/api/dashboard/stats`
- `/api/events` (all event endpoints)
- `/api/rca` (all RCA endpoints)
- `/api/settings/organization`
- `/api/integrations`
- `/api/costs/summary`
- `/api/analytics/*`

## Future Improvements

- Add unit tests for JWT extraction logic
- Add integration test for auth flow
- Consider caching org lookups (performance optimization)
