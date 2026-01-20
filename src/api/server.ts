import { server } from "./app.js";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
import { pool } from "../db/client.js";
import { initSentry } from "../utils/sentry.js";

// Initialize Sentry FIRST (before any other imports)
initSentry();

async function start() {
  try {
    // Test database connection
    await pool.query("SELECT 1");
    logger.info("✅ Database connection established");

    // Start server
    await server.listen({
      port: config.PORT,
      host: "0.0.0.0",
    });

    logger.info(`🚀 Server listening on port ${config.PORT}`);
    logger.info(`📝 Environment: ${config.NODE_ENV}`);
  } catch (error) {
    logger.error(error, "❌ Failed to start server");
    process.exit(1);
  }
}

start();
