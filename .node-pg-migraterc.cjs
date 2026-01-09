module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  migrationsTable: 'pgmigrations',
  dir: 'migrations',
  direction: 'up',
  count: Infinity,
  // Enable SSL for Heroku (production and staging)
  // Heroku Postgres requires SSL connections
  ssl: process.env.NODE_ENV !== 'development' ? {
    rejectUnauthorized: false
  } : false,
};
