# Source Map Resolution Guide

> **Buglens Technical Documentation**
> Understanding how Buglens resolves minified production code back to original source

## Overview

Modern JavaScript/TypeScript applications are bundled and minified for production, transforming readable code into compressed single-character variables. When errors occur in production, stack traces point to minified code locations that are impossible to debug.

Buglens automatically resolves these minified stack frames back to original source locations using **source maps** — enabling accurate root cause analysis on production errors.

## How It Works

### The Problem

When you see a production error like this:

```
TypeError: Cannot read property 'name' of undefined
    at o.getUserData (app.min.js:1:2847)
    at o.processUser (app.min.js:1:2901)
    at HTMLButtonElement.<anonymous> (app.min.js:1:3102)
```

The minified locations (`app.min.js:1:2847`) tell you nothing about where the bug actually is.

### The Solution

Buglens uses source maps to transform this into:

```
TypeError: Cannot read property 'name' of undefined
    at getUserData (src/services/user-service.ts:42:12)
    at processUser (src/services/user-service.ts:58:20)
    at handleClick (src/components/UserCard.tsx:23:5)
```

Now you can see exactly where in your original TypeScript code the error occurred.

## Supported Bundlers

Buglens supports source maps from all major JavaScript bundlers:

| Bundler          | Source Path Format                 | Example                           |
| ---------------- | ---------------------------------- | --------------------------------- |
| **Webpack**      | `webpack://app-name/./src/file.ts` | `webpack://my-app/./src/utils.ts` |
| **Vite**         | Absolute paths                     | `/Users/dev/project/src/utils.ts` |
| **Rollup**       | Relative paths                     | `../src/utils.ts`                 |
| **esbuild**      | Relative or absolute               | `src/utils.ts`                    |
| **Parcel**       | Relative paths                     | `./src/utils.ts`                  |
| **React Native** | `app:///` protocol                 | `app:///src/screens/Home.tsx`     |

## Source Map Types

### External Source Maps (Recommended)

The bundle references an external `.map` file:

```javascript
// app.min.js
(function(){var e=...})();
//# sourceMappingURL=app.min.js.map
```

Buglens fetches `app.min.js.map` from:

1. Same directory as the bundle
2. Your source map server (if configured)
3. Build artifact storage

### Inline Source Maps

The source map is embedded in the bundle as base64:

```javascript
// app.min.js
(function(){var e=...})();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLC...
```

Buglens automatically extracts and parses inline source maps.

### Hidden Source Maps

For security, you may not want source maps publicly accessible. Buglens supports:

1. **Private source map server** - Configure a URL with authentication
2. **Build artifact integration** - Fetch from CI/CD artifact storage
3. **Sentry source maps** - If uploaded to Sentry, Buglens can retrieve them

## Configuration

### Basic Setup

No configuration needed for standard setups. Buglens automatically:

- Detects source map references in minified code
- Fetches external `.map` files from your repository
- Extracts inline source maps
- Normalizes bundler-specific paths

### Advanced Configuration

For private source maps or custom setups:

```typescript
// Organization settings (via API or dashboard)
{
  "sourceMapConfig": {
    // Custom source map server
    "sourceMapServer": "https://sourcemaps.yourcompany.com",

    // Authentication header
    "authHeader": "X-SourceMap-Token",

    // Path mapping (for monorepos)
    "pathMappings": {
      "webpack://my-app/": "packages/frontend/",
      "@myorg/shared/": "packages/shared/"
    },

    // Ignore patterns (skip resolution for these)
    "ignorePatterns": [
      "node_modules/",
      "vendor/"
    ]
  }
}
```

## Best Practices

### 1. Generate Source Maps in Production Builds

**Webpack:**

```javascript
// webpack.config.js
module.exports = {
  devtool: "source-map", // or 'hidden-source-map'
  // ...
};
```

**Vite:**

```javascript
// vite.config.js
export default {
  build: {
    sourcemap: true, // or 'hidden'
  },
};
```

**Rollup:**

```javascript
// rollup.config.js
export default {
  output: {
    sourcemap: true,
  },
};
```

### 2. Upload Source Maps to Sentry

If you're using Sentry, upload source maps with your releases:

```bash
# Using Sentry CLI
sentry-cli releases files $VERSION upload-sourcemaps ./dist
```

Buglens can then retrieve them automatically.

### 3. Include `sourcesContent` in Source Maps

Ensure your build includes original source code in the map:

```javascript
// webpack.config.js
module.exports = {
  devtool: "source-map", // Includes sourcesContent
  // NOT 'nosources-source-map' (excludes sourcesContent)
};
```

This allows Buglens to show the exact code context without fetching from GitHub.

### 4. Use Consistent Naming

Keep bundle and source map names consistent:

- `app.min.js` → `app.min.js.map`
- `chunk-abc123.js` → `chunk-abc123.js.map`

### 5. For Private Repos: Configure GitHub Integration

Ensure Buglens has access to your repository:

1. Install the Buglens GitHub App
2. Grant access to relevant repositories
3. Buglens will fetch source maps from your release artifacts

## Path Resolution Details

### Webpack Protocol Normalization

Webpack uses the `webpack://` protocol with various formats:

```
webpack://app-name/./src/file.ts
webpack://app-name/src/file.ts
webpack:///./src/file.ts
webpack:///src/file.ts
```

All normalized to: `src/file.ts`

### Absolute Path Extraction

Vite often produces absolute paths:

```
/Users/dev/project/src/components/Button.tsx
/home/ci/build/src/components/Button.tsx
C:\projects\app\src\components\Button.tsx
```

Buglens extracts the repository-relative path: `src/components/Button.tsx`

### Relative Path Resolution

Rollup uses relative paths from the output directory:

```
../src/utils.ts
../../packages/shared/src/helpers.ts
```

Resolved relative to your repository structure.

## Troubleshooting

### Source Maps Not Resolving

1. **Check source map exists:**

   ```bash
   curl -I https://your-app.com/app.min.js.map
   ```

2. **Verify sourceMappingURL comment:**

   ```bash
   tail -1 dist/app.min.js
   # Should show: //# sourceMappingURL=app.min.js.map
   ```

3. **Check GitHub access:**
   - Verify Buglens GitHub App is installed
   - Confirm repository access is granted

### Wrong Source Locations

1. **Verify source map freshness:**
   - Ensure deployed source map matches deployed bundle
   - Check build timestamps

2. **Check bundler configuration:**
   - Ensure `devtool: 'source-map'` (not `'eval-source-map'`)
   - Verify `sourcesContent` is included

### "Cannot find original source" Errors

The source map exists but doesn't contain the original source:

1. **Check `sourcesContent` field:**

   ```bash
   cat app.min.js.map | jq '.sourcesContent'
   ```

   Should contain your original source code.

2. **Rebuild with `sourcesContent`:**
   ```javascript
   // webpack.config.js
   devtool: "source-map"; // NOT 'nosources-source-map'
   ```

## Integration with RCA

When analyzing an error, Buglens:

1. **Detects minified code** — Short variable names, single-line bundles
2. **Fetches source map** — External file or inline base64
3. **Resolves each frame** — Maps minified locations to originals
4. **Fetches original source** — Gets the actual code from GitHub
5. **Analyzes in context** — AST analysis on original, readable code

This enables Buglens to:

- Identify the exact line causing null reference errors
- Trace data flow through your original code
- Suggest fixes in your actual source files

## Technical Reference

### Source Map Spec

Buglens implements the [Source Map Revision 3](https://sourcemaps.info/spec.html) specification.

### Supported Fields

| Field            | Required | Description                        |
| ---------------- | -------- | ---------------------------------- |
| `version`        | Yes      | Must be `3`                        |
| `file`           | No       | Name of generated file             |
| `sources`        | Yes      | Array of original source paths     |
| `sourcesContent` | No       | Original source code (recommended) |
| `names`          | No       | Symbol names used in mappings      |
| `mappings`       | Yes      | VLQ-encoded position mappings      |

### Performance

- Source map parsing: <50ms for typical bundles
- Position resolution: <1ms per frame
- Full stack trace (10 frames): <100ms total

---

## Related Documentation

- [Architecture Guide](./Buglens%20Architecture%20UPDATED.md) — System architecture overview
- [Integration Guide](./INTEGRATION_GUIDE.md) — Setting up integrations
- [Testing Guide](./TESTING_GUIDE.md) — Testing source map resolution

---

_Last updated: 2025_
