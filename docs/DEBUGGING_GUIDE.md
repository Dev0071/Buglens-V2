# Buglens Debugging Guide

## VS Code Debugging Setup

This guide covers how to use breakpoints and debug the Buglens application using VS Code's built-in debugger.

---

## Quick Start

### 1. Launch Configurations Available

Press `F5` or go to **Run and Debug** panel (⇧⌘D) and select:

- **🔴 Backend: Attach to Node** - Attach to running backend server (requires `--inspect` flag)
- **🔴 Backend: Launch Server** - Start backend with debugger attached
- **🔵 Frontend: Chrome Debugger** - Debug React app in Chrome
- **🔵 Frontend: Edge Debugger** - Debug React app in Edge
- **🚀 Full Stack (Backend + Frontend)** - Debug both simultaneously

### 2. Start Debugging

**Option A: Full Stack (Recommended)**

```bash
# In terminal 1: Start backend with debugging
npm run dev -- --inspect

# In terminal 2: Start frontend
cd web && npm run dev

# In VS Code: Press F5 → Select "🚀 Full Stack (Backend + Frontend)"
```

**Option B: Frontend Only**

```bash
# Start frontend dev server
cd web && npm run dev

# In VS Code: Press F5 → Select "🔵 Frontend: Chrome Debugger"
```

**Option C: Backend Only**

```bash
# Start backend with debugging
npm run dev -- --inspect

# In VS Code: Press F5 → Select "🔴 Backend: Attach to Node"
```

---

## Setting Breakpoints

### Frontend (React/TypeScript)

1. **In VS Code**: Click in the gutter (left of line numbers) to add a red dot
2. **Common locations for login issue**:
   - [web/src/store/auth.ts](web/src/store/auth.ts#L240) - `onRehydrateStorage` callback
   - [web/src/store/auth.ts](web/src/store/auth.ts#L191) - `refreshSession` function
   - [web/src/pages/auth/LoginPage.tsx](web/src/pages/auth/LoginPage.tsx#L16) - Component initialization
   - [web/src/App.tsx](web/src/App.tsx#L113) - `PublicRoute` component

3. **Conditional breakpoints**: Right-click → "Add Conditional Breakpoint"

   ```javascript
   // Example: Break only when isLoading is true
   isLoading === true;

   // Example: Break only for specific users
   email === "test@example.com";
   ```

### Backend (Node.js/Fastify)

1. **Common locations**:
   - [src/api/routes/webhooks.ts](src/api/routes/webhooks.ts#L50) - Sentry webhook handler
   - [src/api/routes/profile.ts](src/api/routes/profile.ts#L30) - Profile endpoints
   - [src/workers/queues/llm-reasoning.ts](src/workers/queues/llm-reasoning.ts#L100) - LLM worker
   - [src/api/middleware/org-context.ts](src/api/middleware/org-context.ts#L15) - Org context middleware

2. **Logpoints** (log without stopping): Right-click → "Add Logpoint"
   ```javascript
   // Example
   User authenticated: {user.email}, Org: {organization.name}
   ```

---

## Debugging the Login Loading Issue

### Problem

Login page shows only header and loader, form doesn't appear.

### Root Cause

The auth store's `isLoading` state was stuck at `true` because `onRehydrateStorage` callback wasn't properly setting it to `false` when no access token exists.

### How to Verify the Fix

1. **Set breakpoints**:

   ```typescript
   // web/src/store/auth.ts - Line ~241
   onRehydrateStorage: () => (state) => {
     if (state?.accessToken) {
       // BREAKPOINT HERE
       if (state.user && state.organization) {
         useAuthStore.setState({ isAuthenticated: true });
       }
       state.refreshSession();
     } else {
       // BREAKPOINT HERE ← Should hit this when not logged in
       useAuthStore.setState({ isLoading: false, isAuthenticated: false });
     }
   };
   ```

2. **Launch debugger**:
   - Press `F5` → "🔵 Frontend: Chrome Debugger"
   - Navigate to `http://localhost:5173/login`
   - Chrome opens with DevTools attached

3. **Check execution flow**:
   - Breakpoint should hit in the `else` block (no token)
   - Step through with `F10` (Step Over)
   - Verify `isLoading` becomes `false` in the store
   - Continue execution (`F5`)
   - Login form should now render

### Debug Variables to Watch

Add these to the **Watch** panel:

```
useAuthStore.getState().isLoading
useAuthStore.getState().isAuthenticated
useAuthStore.getState().accessToken
useAuthStore.getState().user
```

---

## Common Debugging Scenarios

### Scenario 1: API Call Fails

**Backend Breakpoint**:

```typescript
// src/api/routes/profile.ts
fastify.get("/profile", async (request, reply) => {
  // BREAKPOINT HERE
  const userId = request.userId; // Check if userId exists
  const orgId = request.orgId; // Check if orgId exists

  const user = await query(
    "SELECT * FROM users WHERE id = $1 AND org_id = $2",
    [userId, orgId]
  );
  // BREAKPOINT HERE - Check query result

  return user.rows[0];
});
```

**Frontend Breakpoint**:

```typescript
// web/src/lib/hooks.ts
export function useProfile() {
  return useQuery({
    queryKey: apiClient.queryKeys.profile(),
    queryFn: async () => {
      // BREAKPOINT HERE
      const response = await apiClient.get("/profile");
      // BREAKPOINT HERE - Check response
      return response;
    },
  });
}
```

### Scenario 2: State Not Updating

**Watch these values**:

```
store.getState()
props
state
```

**React DevTools**: Install "React Developer Tools" Chrome extension

- Inspect component tree
- View props/state in real-time
- Track re-renders

### Scenario 3: Worker Job Fails

**Backend**:

```typescript
// src/workers/queues/llm-reasoning.ts
async function processLLMReasoning(job: Job) {
  // BREAKPOINT HERE
  const { eventId, orgId } = job.data;

  const evidence = await collectEvidence(eventId, orgId);
  // BREAKPOINT HERE - Check evidence

  const rcaResult = await orchestrator.generateRCA(evidence);
  // BREAKPOINT HERE - Check RCA result

  return rcaResult;
}
```

---

## Debugging Tools

### 1. VS Code Debug Console

While paused at breakpoint, evaluate expressions:

```javascript
// Check state
useAuthStore.getState();

// Modify variables
user.email = "test@example.com";

// Call functions
console.log(evidence);
```

### 2. Browser DevTools

- **Console**: View logs, errors, warnings
- **Network**: Check API requests/responses
- **Application → Local Storage**: View persisted auth state
- **React DevTools**: Inspect component tree

### 3. Chrome Sources Panel

- Set breakpoints directly in Chrome
- Pretty-print minified code
- Blackbox scripts (hide library code)

### 4. Network Monitoring

**Check API calls**:

1. Open DevTools → Network tab
2. Filter: XHR/Fetch
3. Click request → Preview/Response tabs
4. Check:
   - Status code (200, 401, 500?)
   - Request headers (Authorization token present?)
   - Response body (error messages?)

---

## Troubleshooting

### Breakpoints Not Hitting

**Frontend**:

- Ensure dev server is running (`cd web && npm run dev`)
- Check source maps are enabled (`vite.config.ts`: `sourcemap: true`)
- Reload Chrome debugger (⇧⌘R)

**Backend**:

- Start with `--inspect` flag: `npm run dev -- --inspect`
- Check port 9229 is not in use: `lsof -i :9229`
- Restart debugger attachment

### "Source not found" Error

**Fix**: Add path mapping to `launch.json`:

```json
"sourceMapPathOverrides": {
  "webpack:///src/*": "${webRoot}/src/*"
}
```

### Debugger Disconnects

**Frontend**: Chrome auto-closes → Use `runtimeArgs: ["--auto-open-devtools-for-tabs"]`

**Backend**: Server restarts → Use `"restart": true` in attach config (already set)

---

## Performance Debugging

### Find Slow Code

**Chrome Performance Tab**:

1. Record → Interact with app → Stop
2. Analyze flame chart
3. Look for long tasks (>50ms)

**React Profiler**:

```tsx
import { Profiler } from "react";

<Profiler
  id="LoginPage"
  onRender={(id, phase, actualDuration) => {
    console.log(`${id} (${phase}) took ${actualDuration}ms`);
  }}
>
  <LoginPage />
</Profiler>;
```

### Memory Leaks

**Chrome Memory Tab**:

1. Take heap snapshot
2. Interact with app
3. Take another snapshot
4. Compare → Look for detached DOM nodes

---

## Advanced: Remote Debugging

### Debug Production Build Locally

```bash
# Build frontend with source maps
cd web && npm run build

# Serve production build
npx serve -s dist -p 5173

# Attach Chrome debugger to http://localhost:5173
```

### Debug in Docker Container

```bash
# docker-compose.yml
services:
  backend:
    command: node --inspect=0.0.0.0:9229 dist/api/server.js
    ports:
      - "9229:9229"

# Attach VS Code debugger to localhost:9229
```

---

## Keyboard Shortcuts

| Action            | macOS  | Windows/Linux   |
| ----------------- | ------ | --------------- |
| Start/Continue    | `F5`   | `F5`            |
| Step Over         | `F10`  | `F10`           |
| Step Into         | `F11`  | `F11`           |
| Step Out          | `⇧F11` | `Shift+F11`     |
| Restart           | `⇧⌘F5` | `Ctrl+Shift+F5` |
| Stop              | `⇧F5`  | `Shift+F5`      |
| Toggle Breakpoint | `F9`   | `F9`            |

---

## Best Practices

1. **Start with logs** - Use `console.log` / `logger.info` first
2. **Reproduce consistently** - Ensure bug happens every time
3. **Binary search** - Set breakpoints to divide problem space in half
4. **Watch expressions** - Don't rely on mouse hover alone
5. **Conditional breakpoints** - Avoid manual "continue" clicking
6. **Log points over console.log** - No code changes needed
7. **Record steps** - Document what you did to trigger the bug

---

## Next Steps

- **Install Chrome DevTools Extension**: React Developer Tools, Redux DevTools
- **Learn Chrome DevTools**: [https://developer.chrome.com/docs/devtools/](https://developer.chrome.com/docs/devtools/)
- **VS Code Debugging Docs**: [https://code.visualstudio.com/docs/editor/debugging](https://code.visualstudio.com/docs/editor/debugging)

---

## Quick Reference: Login Loading Bug Fix

**File**: [web/src/store/auth.ts](web/src/store/auth.ts#L240)

**Before** (Bug):

```typescript
} else {
  state?.setLoading(false); // ❌ Doesn't work reliably
}
```

**After** (Fixed):

```typescript
} else {
  // No token = not authenticated, stop loading immediately
  useAuthStore.setState({ isLoading: false, isAuthenticated: false }); // ✅ Works
}
```

**Why it failed**: The `state` object in `onRehydrateStorage` callback might be null or the method call might not trigger reactivity properly.

**Why it works now**: Directly calling `useAuthStore.setState()` ensures the state update happens synchronously and triggers all subscribers.

---

For more help, see:

- [PROGRESS.md](../PROGRESS.md) - Project progress and known issues
- [docs/API_DOCUMENTATION.md](API_DOCUMENTATION.md) - API reference
- [Buglens Architecture UPDATED.md](../Buglens%20Architecture%20UPDATED.md) - System architecture
