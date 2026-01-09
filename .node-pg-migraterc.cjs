module.exports = {
  databaseUrl: {
    connectionString: process.env.DATABASE_URL,
    // Enable SSL for Heroku Postgres by default
    // Heroku requires SSL on all paid tiers (Essential, Premium)
    ssl: process.env.DATABASE_SSL === 'false' ? false : {
      rejectUnauthorized: false
    }
  },
  migrationsTable: 'pgmigrations',
  dir: 'migrations',
  direction: 'up',
  count: Infinity,
};
