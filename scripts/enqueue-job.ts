#!/usr/bin/env tsx
import { enqueueDeterministicJob } from "../src/workers/queues/deterministic.js";

async function main(): Promise<void> {
  const [jobId, eventId, orgId] = process.argv.slice(2);
  if (!jobId || !eventId || !orgId) {
    console.error(
      "Usage: tsx scripts/enqueue-job.ts <jobId> <eventId> <orgId>"
    );
    process.exit(1);
  }

  await enqueueDeterministicJob({ jobId, eventId, orgId });
  console.log(`Enqueued deterministic job ${jobId} for event ${eventId}`);
  process.exit(0);
}

void main();
