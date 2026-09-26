/**
 * Seeding the catalog with the enrichment pipeline, from the operator's laptop.
 *
 *   npm run enrich -- load db/seed-input/montreal-sample.jsonl   queue one job per venue (skips duplicates)
 *   npm run enrich -- run [--limit 20]                           direct mode: full price, minutes
 *   npm run enrich -- batch:prepare                              read every website (1 per second)
 *   npm run enrich -- batch:submit                               send one Batch API request, half price
 *   npm run enrich -- batch:collect <batch-id>                   gate the results, create listings
 *   npm run enrich -- status
 *
 * Every listing this creates is pending_review with AI-sourced fields; `npm run admin -- pending`
 * and `npm run admin -- publish <venue-id>` are the human half of the pipeline.
 *
 * Input: JSON Lines, one venue per line —
 *   {"name":"…","website":"…","lat":45.52,"lon":-73.58,"address":"…","neighbourhood":"Plateau"}
 * docs/alentour/07 describes producing this from Overture Places with one DuckDB query.
 */
import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import { NodeFetcher } from "../src/enrichment/net.ts";
import { createJob, runQueuedJobs, type JobInput } from "../src/enrichment/pipeline.ts";
import { materializeSeedJob } from "../src/enrichment/listing.ts";
import { findDuplicateVenues, inMontreal } from "../src/enrichment/geo.ts";
import { collectBatch, prepareSeedJobs, submitBatch } from "../src/enrichment/batch.ts";
import { MemoryStorage } from "../src/enrichment/storage.ts";

export async function loadSeedFile(pool: pg.Pool, file: string, log = console.log) {
  let queued = 0, skipped = 0;
  for (const [n, line] of readFileSync(file, "utf8").split("\n").entries()) {
    if (!line.trim()) continue;
    let v: JobInput;
    try { v = JSON.parse(line); } catch { log(`  ! line ${n + 1}: not JSON`); skipped++; continue; }
    if (!v.name || typeof v.lat !== "number" || typeof v.lon !== "number" || !inMontreal(v.lat, v.lon)) {
      log(`  ! line ${n + 1}: needs name, lat, lon inside Montréal`); skipped++; continue;
    }
    const dup = await findDuplicateVenues(pool, v);
    if (dup.length) { log(`  – ${v.name}: already in the catalog as ${dup[0]!.name} (${dup[0]!.reason})`); skipped++; continue; }
    const pending = await pool.query(
      `SELECT 1 FROM enrichment_jobs WHERE origin = 'seed' AND input->>'name' = $1 AND status NOT IN ('failed', 'discarded')`, [v.name]);
    if (pending.rowCount) { skipped++; continue; }
    await createJob(pool, "seed", v, null);
    queued++;
  }
  return { queued, skipped };
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || undefined;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const needClient = () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    return new Anthropic();
  };
  try {
    if (cmd === "load") {
      if (!arg) throw new Error("usage: enrich load <file.jsonl>");
      const r = await loadSeedFile(pool, arg);
      console.log(`queued ${r.queued}, skipped ${r.skipped}`);
    } else if (cmd === "run") {
      const deps = { client: needClient(), fetcher: new NodeFetcher(), storage: new MemoryStorage(), geocoder: { search: async () => [] } };
      const ran = await runQueuedJobs(pool, deps, { origin: "seed", limit: limit ?? 20 });
      const ready = await pool.query(`SELECT id, input->>'name' AS name FROM enrichment_jobs WHERE origin = 'seed' AND status = 'ready'`);
      for (const j of ready.rows) {
        const made = await materializeSeedJob(pool, j.id);
        console.log(made ? `  ✓ ${j.name}: ${made.activityIds.length} activities (pending review)` : `  – ${j.name}: discarded`);
      }
      console.log(`ran ${ran} job(s)`);
    } else if (cmd === "batch:prepare") {
      const n = await prepareSeedJobs(pool, new NodeFetcher(), { limit, log: console.log });
      console.log(`prepared ${n} job(s); next: npm run enrich -- batch:submit`);
    } else if (cmd === "batch:submit") {
      const id = await submitBatch(pool, needClient(), { limit });
      console.log(id ? `submitted ${id}; results within 24h: npm run enrich -- batch:collect ${id}` : "nothing to submit (run batch:prepare first)");
    } else if (cmd === "batch:collect") {
      if (!arg) throw new Error("usage: enrich batch:collect <batch-id>");
      const r = await collectBatch(pool, needClient(), arg, console.log);
      console.log(JSON.stringify(r));
    } else if (cmd === "status") {
      const { rows } = await pool.query(
        `SELECT origin, status, count(*)::int AS n, sum((usage->>'input_tokens')::int) AS input_tokens,
                sum((usage->>'output_tokens')::int) AS output_tokens
           FROM enrichment_jobs GROUP BY 1, 2 ORDER BY 1, 2`);
      console.table(rows);
    } else {
      console.log("commands: load <file> | run [--limit N] | batch:prepare | batch:submit | batch:collect <id> | status");
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exitCode = 1; });
}
