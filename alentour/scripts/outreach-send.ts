/**
 * Send approved outreach.   npm run outreach:send
 * Refuses while OUTREACH_DRY_RUN is on (the default) — turn it off only after the lawyer review.
 */
import pg from "pg";
import { mailerFromEnv } from "../src/api/mailer.ts";
import { senderFromEnv } from "../src/outreach/render.ts";
import { sendApproved } from "../src/outreach/send.ts";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
sendApproved(pool, mailerFromEnv(), senderFromEnv(), {
  now: new Date(), dryRun: process.env.OUTREACH_DRY_RUN !== "0", dailyCap: Number(process.env.OUTREACH_DAILY_CAP ?? 20), log: console.log,
})
  .then((r) => console.log(JSON.stringify(r)))
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => pool.end());
