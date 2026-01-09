#!/bin/bash
# Debug script for Heroku Postgres SSL configuration
# Run this on Heroku: heroku run bash -a YOUR_APP_NAME
# Then: chmod +x debug-db-ssl.sh && ./debug-db-ssl.sh

echo "=== Heroku Postgres SSL Debug ==="
echo ""

echo "1. Environment Variables:"
echo "   NODE_ENV: ${NODE_ENV:-'(not set)'}"
echo "   DATABASE_SSL: ${DATABASE_SSL:-'(not set - will default to true)'}"
echo "   DATABASE_URL: ${DATABASE_URL:0:30}... (truncated for security)"
echo ""

echo "2. Migration Config (.node-pg-migraterc.cjs):"
if [ -f .node-pg-migraterc.cjs ]; then
    cat .node-pg-migraterc.cjs
else
    echo "   ERROR: .node-pg-migraterc.cjs not found!"
fi
echo ""

echo "3. SSL Configuration Logic:"
if [ "$DATABASE_SSL" = "false" ]; then
    echo "   SSL will be DISABLED (DATABASE_SSL=false)"
else
    echo "   SSL will be ENABLED (DATABASE_SSL not set or not 'false')"
fi
echo ""

echo "4. Testing Database Connection:"
node -e "
const pg = require('pg');
const { Pool } = pg;

// Same config as migration
const ssl = process.env.DATABASE_SSL === 'false' ? false : {
  rejectUnauthorized: false
};

console.log('   SSL Config:', JSON.stringify(ssl, null, 2));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ssl
});

pool.query('SELECT 1 as test')
  .then(() => {
    console.log('   ✓ Connection successful!');
    pool.end();
  })
  .catch(err => {
    console.error('   ✗ Connection failed:', err.message);
    pool.end();
    process.exit(1);
  });
"

echo ""
echo "=== End Debug ==="
