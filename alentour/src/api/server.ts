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
import Anthropic from "@anthropic-ai/sdk";
import { NodeFetcher } from "../enrichment/net.ts";
import { NominatimGeocoder } from "../enrichment/geo.ts";
import { storageFromEnv } from "../enrichment/storage.ts";
import { startWorker, type EnrichDeps } from "../enrichment/pipeline.ts";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// Onboarding works without an API key — the owner just gets an empty draft to fill in.
const enrich: EnrichDeps = {
  client: process.env.ANTHROPIC_API_KEY ? new Anthropic() : null,
  fetcher: new NodeFetcher(),
  storage: storageFromEnv(),
  geocoder: new NominatimGeocoder(),
  perUserDaily: Number(process.env.ENRICH_PER_USER_DAILY ?? 5),
  globalDaily: Number(process.env.ENRICH_DAILY_LIMIT ?? 100),
};
const worker = startWorker(pool, enrich);
enrich.kick = worker.kick;
worker.kick();   // pick up anything a previous process left mid-way

const app = createApp(
  { pool, mailer: mailerFromEnv(), config: configFromEnv(), enrich },
  { trustProxy: process.env.TRUST_PROXY === "1" },
);
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => console.log(`Alentour API on http://localhost:${info.port}`));

const shutdown = async () => { worker.stop(); await pool.end(); process.exit(0); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
