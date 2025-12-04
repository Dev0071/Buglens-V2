import { Pool } from "pg";
import { enqueueDeterministicJob } from "../src/workers/queues/deterministic.js";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://buglens:buglens_dev@localhost:5432/buglens_dev",
});

async function requeueJobs() {
  const result = await pool.query(`
    SELECT j.id, j.event_id, j.org_id
    FROM rca_jobs j
    WHERE j.status = 'pending'
  `);

  console.log("Found", result.rows.length, "pending jobs");

  for (const row of result.rows) {
    await enqueueDeterministicJob({
      jobId: row.id,
      eventId: row.event_id,
      orgId: row.org_id,
    });
    console.log("Enqueued:", row.id);
  }

  await pool.end();
  console.log("Done!");
  process.exit(0);
}

requeueJobs().catch((err) => {
  console.error(err);
  process.exit(1);
});
