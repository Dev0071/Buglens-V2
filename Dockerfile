# Buglens API Dockerfile
# Multi-stage build for production

# ============================================
# Stage 1: Builder
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY migrations/ ./migrations/

# Build TypeScript
RUN npm run build

# ============================================
# Stage 2: Production Dependencies
# ============================================
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# ============================================
# Stage 3: Production Runner
# ============================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install Python + build toolchain, install deps, then strip toolchain.
# Building in the same stage as runtime avoids Python ABI mismatches
# (the .so files must match the exact Python version that loads them).
COPY python/requirements.txt /tmp/py-requirements.txt
RUN apk add --no-cache python3 py3-pip && \
    apk add --no-cache --virtual .build-deps gcc musl-dev python3-dev && \
    pip3 install --no-cache-dir --break-system-packages -r /tmp/py-requirements.txt && \
    apk del .build-deps && \
    rm -f /tmp/py-requirements.txt

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 buglens

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy Python analyzers
COPY python/ ./python/

# Copy migrations for runtime execution
COPY migrations/ ./migrations/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Switch to non-root user
USER buglens

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Run migrations then start API + workers in one process (staging)
# For production, override with: node dist/src/api/server.js (separate worker container)
CMD ["sh", "-c", "npm run migrate:up && node dist/src/main.js"]
