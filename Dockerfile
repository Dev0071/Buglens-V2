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
# Stage 3: Python Analyzers
# ============================================
FROM python:3.11-alpine AS python-deps

WORKDIR /python

# gcc + musl-dev are required to compile tree-sitter's native C extension (_binding.so)
# Alpine doesn't support manylinux wheels, so pip must build from source
RUN apk add --no-cache gcc musl-dev python3-dev

COPY python/requirements.txt ./
RUN pip install --no-cache-dir --target=/python/packages -r requirements.txt

# ============================================
# Stage 4: Production Runner
# ============================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install Python runtime (no pip needed)
RUN apk add --no-cache python3

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 buglens

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy Python analyzers and dependencies
COPY python/ ./python/
COPY --from=python-deps /python/packages /usr/local/lib/python3.11/site-packages

# Copy migrations for runtime execution
COPY migrations/ ./migrations/

# Set Python path
ENV PYTHONPATH=/usr/local/lib/python3.11/site-packages

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
