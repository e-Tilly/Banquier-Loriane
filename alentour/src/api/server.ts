/**
 * Node entry point.   npm run api:dev
 *
 * Environment: DATABASE_URL, API_SECRET (32+ chars), PORT, CORS_ORIGINS, RESEND_API_KEY,
 * MAIL_FROM, APPLE_AUDIENCE, GOOGLE_AUDIENCE, TRUST_PROXY=1 behind a load balancer.
 */
import { serve } from "@hono/node-server";
import pg from "pg";
import { createApp } from "./app.ts";
import { configFromEnv } from "./config.ts";
import { mailerFromEnv } from "./mailer.ts";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const app = createApp(
  { pool, mailer: mailerFromEnv(), config: configFromEnv() },
  { trustProxy: process.env.TRUST_PROXY === "1" },
);
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => console.log(`Alentour API on http://localhost:${info.port}`));

const shutdown = async () => { await pool.end(); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
