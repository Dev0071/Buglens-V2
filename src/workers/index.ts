import { startDeterministicAnalyzerWorker } from "./deterministic-analyzer.worker.js";
import { startEvidenceWorker } from "./queues/evidence.js";
import { logger } from "../utils/logger.js";

const WORKER_STARTUP_BANNER = `
╔══════════════════════════════════════════════════════════════╗
║                    BUGLENS WORKERS                           ║
╚══════════════════════════════════════════════════════════════╝`;

async function bootstrap() {
  console.log(WORKER_STARTUP_BANNER);
  logger.info(
    { version: process.env.npm_package_version || "dev" },
    "Starting Buglens workers"
  );

  // Start deterministic analyzer worker
  const deterministicWorker = startDeterministicAnalyzerWorker();
  logger.info(
    { worker: "deterministic-analyzer", concurrency: 1 },
    "Worker online: deterministic-analyzer"
  );

  // Start evidence assembly worker
  const evidenceWorker = startEvidenceWorker();
  logger.info(
    { worker: "evidence-assembly", concurrency: 5 },
    "Worker online: evidence-assembly"
  );

  logger.info(
    { workersStarted: 2 },
    "All workers online and ready to process jobs"
  );

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received, closing workers...");
    await Promise.all([deterministicWorker.close(), evidenceWorker.close()]);
    logger.info("All workers stopped gracefully");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void bootstrap();
