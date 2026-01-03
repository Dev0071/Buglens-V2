# Sentry Webhook URL Fix

## Issue

The Sentry integration configuration modal was showing an **incomplete webhook URL** that was missing the required `org_id` parameter.

### Before (WRONG)

```
http://localhost:3002/api/v1/webhooks/sentry
```

### After (CORRECT)

```
http://localhost:3002/api/v1/webhooks/sentry/{org_id}
```

---

## Root Cause

The backend webhook handler **requires** `org_id` in the URL path for:

1. **Multi-tenancy**: Identify which organization the webhook belongs to
2. **Validation**: Verify the organization exists in the database
3. **Row-Level Security**: Set org context for database queries (`SET app.current_org_id`)
4. **Rate Limiting**: Apply per-organization rate limits

### Backend Endpoint

```typescript
// src/api/routes/webhooks.ts
server.post(
  "/webhooks/sentry/:org_id",  // ← org_id REQUIRED in path
  async (request, reply) => {
    const { org_id } = request.params;

    // Validate UUID format
    if (!uuidRegex.test(org_id)) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "Invalid organization ID",
      });
    }

    // Verify org exists
    const result = await pool.query(
      "SELECT id, plan FROM organizations WHERE id = $1",
      [org_id]
    );

    if (result.rows.length === 0) {
      return reply.status(404).send({
        error: "Not Found",
        message: "Organization does not exist",
      });
    }

    // Set org context for RLS
    request.orgContext = { orgId: org_id, ... };

    // Process webhook...
  }
);
```

### Frontend Issue

The modal was hardcoding the URL without including the user's `orgId`:

```typescript
// WRONG (before)
const webhookUrl = `${window.location.origin}/api/v1/webhooks/sentry`;
```

---

## Fix Applied

### Changes Made

**File: `web/src/pages/settings/SettingsPage.tsx`**

1. **Added import** for auth store:

   ```typescript
   import { useAuthStore } from "@/store/auth";
   ```

2. **Updated webhook URL generation** to include `orgId`:

   ```typescript
   // Get orgId from authenticated user
   const user = useAuthStore((state) => state.user);
   const webhookUrl = `${window.location.origin}/api/v1/webhooks/sentry/${user?.orgId || "{YOUR_ORG_ID}"}`;
   ```

3. **Added helpful instructions** in the modal:

   ```tsx
   <p className="text-xs text-gray-600 dark:text-gray-400">
     In Sentry: Go to{" "}
     <strong>
       Settings → Integrations → Internal Integrations → Create New Integration
     </strong>
     . Add this webhook URL under <strong>Webhooks</strong> and subscribe to{" "}
     <strong>error.created</strong> events.
   </p>
   ```

4. **Improved input styling**:
   - Added `font-mono` for better readability of the URL
   - Added `whitespace-nowrap` to Copy button
   - Added spacing between input and instructions

---

## Verification

### Expected Behavior

When a user opens the Sentry configuration modal:

1. ✅ Webhook URL includes their organization ID
2. ✅ URL is in the correct format: `http://localhost:3002/api/v1/webhooks/sentry/{uuid}`
3. ✅ User can copy the complete URL
4. ✅ Instructions guide them on where to add it in Sentry

### Example

For user with `orgId = "e455698a-1ff3-4f2c-8414-7343984c758f"`:

```
http://localhost:3002/api/v1/webhooks/sentry/e455698a-1ff3-4f2c-8414-7343984c758f
```

---

## Testing the Fix

1. **Open Settings**: Navigate to `/settings/integrations`
2. **Click "Connect"** on Sentry integration
3. **Verify webhook URL** includes your org ID
4. **Copy the URL** and test it:

   ```bash
   # Generate test payload
   PAYLOAD='{"event_id": "test", "timestamp": 1735344000, "exception": {"values": [{"type": "Error", "value": "Test", "stacktrace": {"frames": [{"filename": "test.js", "lineno": 1}]}}]}, "environment": "production"}'

   # Calculate HMAC signature
   SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "YOUR_SECRET" | cut -d' ' -f2)

   # Send webhook
   curl -X POST "http://localhost:3000/api/v1/webhooks/sentry/YOUR_ORG_ID" \
     -H "Content-Type: application/json" \
     -H "sentry-hook-signature: sha256=$SIGNATURE" \
     -d "$PAYLOAD"
   ```

5. **Expected Response**:
   ```json
   {
     "status": "received",
     "event_id": "uuid"
   }
   ```

---

## Related Files

- **Backend Webhook Handler**: `src/api/routes/webhooks.ts` (line 218-500)
- **Org Context Middleware**: `src/api/middleware/org-context.ts` (line 95-145)
- **Frontend Modal**: `web/src/pages/settings/SettingsPage.tsx` (line 1240-1370)
- **Auth Store**: `web/src/store/auth.ts` (line 1-30)

---

## Impact

### Before Fix

- ❌ Webhooks would fail with `400 Bad Request` or `404 Not Found`
- ❌ Users couldn't successfully configure Sentry integration
- ❌ No clear guidance on URL format

### After Fix

- ✅ Webhook URL is correct and complete
- ✅ Backend can validate and route webhooks properly
- ✅ Users have clear instructions for Sentry configuration
- ✅ Multi-tenant isolation works correctly

---

## Additional Notes

### Why org_id in Path vs Header?

The backend supports org context from multiple sources (priority order):

1. **JWT token** (for authenticated API requests)
2. **x-org-id header** (for webhooks)
3. **org_id path parameter** (for webhooks) ← Used by Sentry

Using the path parameter is preferred for Sentry webhooks because:

- ✅ More explicit and discoverable
- ✅ Easier to validate (part of route schema)
- ✅ Clearer error messages
- ✅ Sentry can't easily set custom headers, but URL is straightforward

### Fallback Behavior

If the user isn't logged in (edge case), the webhook URL shows:

```
http://localhost:3002/api/v1/webhooks/sentry/{YOUR_ORG_ID}
```

This makes it clear that the org ID is required rather than showing a broken URL.
