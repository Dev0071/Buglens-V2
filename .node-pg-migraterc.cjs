const url = process.env.DATABASE_URL;

if (!url) {
  console.error('❌ DATABASE_URL is not set — cannot run migrations');
  process.exit(1);
}

// Log the host only (no credentials) so we can verify which DB is being targeted
try {
  const parsed = new URL(url);
  console.log(`🔍 Migration target: ${parsed.hostname}:${parsed.port || 5432}${parsed.pathname}`);
} catch {
  console.error('❌ DATABASE_URL is set but is not a valid URL:', url.slice(0, 30) + '...');
  process.exit(1);
}

// Parse SSL from the URL itself (?sslmode=require) or the DATABASE_SSL flag.
// Cloud databases (Neon, RDS, DO managed) require SSL.
// Local dev URLs (localhost) should not force SSL.
const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
const sslFromFlag = process.env.DATABASE_SSL === 'true';
const sslFromUrl = url.includes('sslmode=require') || url.includes('sslmode=verify');
const useSSL = !isLocal && (sslFromFlag || sslFromUrl);

module.exports = {
  databaseUrl: {
    connectionString: url,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  },
  migrationsTable: 'pgmigrations',
  dir: 'migrations',
  direction: 'up',
  count: Infinity,
};
