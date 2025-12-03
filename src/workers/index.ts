import { startDeterministicAnalyzerWorker } from "./deterministic-analyzer.worker.js";
import { logger } from "../utils/logger.js";

async function bootstrap() {
  startDeterministicAnalyzerWorker();
  logger.info("Deterministic analyzer worker online");
}

void bootstrap();
