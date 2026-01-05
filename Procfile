# Buglens Procfile for Heroku

# Defines process types for the application

# Run migrations automatically before deployment

release: npm run migrate:up

# API server (Fastify)

web: node dist/api/server.js

# Background worker (BullMQ)

worker: node dist/workers/rca-worker.js
