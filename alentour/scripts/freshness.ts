/**
 * Monthly freshness run.   npm run freshness [-- --dry-run]
 * Schedule it (cron, or the publish workflow) once a week; the 30-day spacing is enforced in SQL.
 */
import pg from "pg";
import { mailerFromEnv } from "../src/api/mailer.ts";
import { sendNudges } from "../src/freshness/nudge.ts";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const dryRun = process.argv.includes("--dry-run");
sendNudges(pool, mailerFromEnv(), { baseUrl: process.env.PUBLIC_URL ?? "http://localhost:8787", dryRun })
  .then((r) => console.log(`${dryRun ? "[dry run] " : ""}${r.sent} business(es) nudged`))
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
