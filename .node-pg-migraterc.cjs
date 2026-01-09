module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  migrationsTable: 'pgmigrations',
  dir: 'migrations',
  direction: 'up',
  count: Infinity,
  // Enable SSL for Heroku Postgres by default
  // Heroku requires SSL on all paid tiers (Essential, Premium)
  // Set DATABASE_SSL=false in local .env to disable
  ssl: process.env.DATABASE_SSL === 'false' ? false : {
    rejectUnauthorized: false
  },
};
