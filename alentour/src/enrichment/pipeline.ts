/**
 * Enrichment jobs: queued, leased, idempotent and re-runnable (docs/alentour/07).
 *
 *   queued → fetching (website) → extracting (model + gate) → writing (copy) → ready
 *
 * An onboarding job never dead-ends: if the website cannot be read or the model fails, the owner
 * still gets a draft — an emptier one, with a note saying why — and fills in the rest. A seed job
 * that fails is marked failed for the operator to look at.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type pg from "pg";
import type { Fetcher } from "./net.ts";
import { FetchError } from "./net.ts";
import type { Storage } from "./storage.ts";
import type { Geocoder } from "./geo.ts";
import { readSite, sourceText, type SiteSnapshot } from "./site.ts";
import { extract } from "./extract.ts";
import { emptyDraft, gate } from "./gate.ts";
import { writeCopy } from "./copy.ts";
import type { Draft, Dropped, Usage } from "./types.ts";

export interface EnrichDeps {
  /** null = no API key: drafts are built without a model and the owner fills them in. */
  client: Anthropic | null;
  fetcher: Fetcher;
  storage: Storage;
  geocoder: Geocoder;
  /** Called after a job is queued, to wake the worker. Tests leave it unset and run jobs directly. */
  kick?: () => void;
  /** Daily ceilings — the API key is the one resource here that costs money per request. */
  perUserDaily?: number;
  globalDaily?: number;
}

export interface JobInput {
  name: string;
  pitch?: string | null;
  website?: string | null;
  address?: string | null;
  lat: number;
  lon: number;
  neighbourhood?: string | null;
  phone?: string | null;
}

const LEASE_MINUTES = 10;
const MAX_ATTEMPTS = 3;

export async function createJob(
  pool: pg.Pool, origin: "onboarding" | "seed", input: JobInput, userId: string | null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO enrichment_jobs (origin, requested_by, input) VALUES ($1, $2, $3) RETURNING id`,
    [origin, userId, JSON.stringify(input)]);
  return rows[0]!.id;
}

/** How many more onboarding jobs this user, and everyone, may start today. */
export async function jobAllowance(pool: pg.Pool, deps: EnrichDeps, userId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - 86_400_000);
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE requested_by = $1)::int AS mine, count(*)::int AS total
       FROM enrichment_jobs WHERE origin = 'onboarding' AND created_at > $2`, [userId, since]);
  return rows[0].mine < (deps.perUserDaily ?? 5) && rows[0].total < (deps.globalDaily ?? 100);
}

/** Take the lease on one runnable job (queued, or abandoned by a crashed worker). */
async function lease(pool: pg.Pool, now: Date, jobId?: string, origin?: "onboarding" | "seed"): Promise<any | null> {
  const stale = new Date(now.getTime() - LEASE_MINUTES * 60_000);
  const { rows } = await pool.query(
    `UPDATE enrichment_jobs SET status = 'fetching', locked_at = $1, attempts = attempts + 1, updated_at = $1
      WHERE id = (
        SELECT id FROM enrichment_jobs
         WHERE (status = 'queued' OR (status IN ('fetching', 'extracting', 'writing') AND locked_at < $2))
           AND batch_id IS NULL
           AND ($3::uuid IS NULL OR id = $3)
           AND ($4::text IS NULL OR origin = $4)
         ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING *`, [now, stale, jobId ?? null, origin ?? null]);
  return rows[0] ?? null;
}

const setStatus = (pool: pg.Pool, id: string, status: string, now: Date) =>
  pool.query(`UPDATE enrichment_jobs SET status = $2, updated_at = $3 WHERE id = $1`, [id, status, now]);

/** Run queued jobs until none are left (or `limit` ran). Returns how many ran. */
export async function runQueuedJobs(
  pool: pg.Pool, deps: EnrichDeps, opts: { limit?: number; now?: () => Date; origin?: "onboarding" | "seed" } = {},
): Promise<number> {
  const now = opts.now ?? (() => new Date());
  let n = 0;
  while (n < (opts.limit ?? 20)) {
    const job = await lease(pool, now(), undefined, opts.origin);
    if (!job) break;
    await runLeasedJob(pool, deps, job, now);
    n++;
  }
  return n;
}

export async function runJob(pool: pg.Pool, deps: EnrichDeps, jobId: string, now: () => Date = () => new Date()): Promise<boolean> {
  const job = await lease(pool, now(), jobId);
  if (!job) return false;
  await runLeasedJob(pool, deps, job, now);
  return true;
}

async function runLeasedJob(pool: pg.Pool, deps: EnrichDeps, job: any, now: () => Date): Promise<void> {
  const input = job.input as JobInput;
  const usage: Usage[] = [];
  const dropped: Dropped[] = [];
  const sources: { url: string; fetchedAt: string; chars: number }[] = [];
  const notes: string[] = [];

  try {
    // 1. The website, when there is one.
    let site: SiteSnapshot | null = null;
    if (input.website) {
      try {
        site = await readSite(deps.fetcher, input.website);
        for (const p of site.pages) sources.push({ url: p.url, fetchedAt: now().toISOString(), chars: p.text.length });
      } catch (err) {
        const code = err instanceof FetchError ? err.code : "network";
        notes.push(code === "robots" ? "website_robots" : code === "private_address" || code === "bad_url" ? "website_invalid" : "website_unreadable");
        dropped.push({ field: "website", reason: (err as Error).message });
      }
    }
    const source = sourceText(site, { name: input.name, pitch: input.pitch });

    // 2. Extraction and the gate.
    let draft: Draft;
    if (!deps.client) {
      draft = emptyDraft(input.name, "no_ai");
    } else {
      await setStatus(pool, job.id, "extracting", now());
      try {
        const { extraction, usage: u } = await extract(deps.client, source);
        usage.push(u as Usage);
        const gated = gate({ extraction, source });
        dropped.push(...gated.dropped);
        draft = {
          isActivityBusiness: extraction.is_activity_business,
          phone: gated.phone ?? site?.phones[0] ?? input.phone ?? null,
          website: site?.url ?? input.website ?? null,
          socials: site?.socials ?? {},
          ai: true,
          activities: gated.activities.length ? gated.activities : emptyDraft(input.name).activities,
        };
        // 3. Copy, for onboarding only: seeded listings carry facts, not marketing prose.
        if (job.origin === "onboarding" && gated.activities.length) {
          await setStatus(pool, job.id, "writing", now());
          const copy = await writeCopy(deps.client, { name: input.name, pitch: input.pitch }, draft.activities);
          usage.push(...copy.usage);
          draft.activities = copy.activities;
          for (const p of copy.problems) dropped.push({ field: "copy", reason: p });
        }
      } catch (err) {
        if (job.origin === "seed" && job.attempts < MAX_ATTEMPTS) {
          await pool.query(`UPDATE enrichment_jobs SET status = 'queued', error = $2, updated_at = $3 WHERE id = $1`, [job.id, (err as Error).message, now()]);
          return;
        }
        if (job.origin === "seed") throw err;
        draft = emptyDraft(input.name, "ai_failed");
        dropped.push({ field: "model", reason: (err as Error).message });
      }
    }
    if (notes.length && !draft.note) draft.note = notes[0];
    draft.website ??= input.website ?? null;
    draft.phone ??= input.phone ?? null;

    await pool.query(
      `UPDATE enrichment_jobs SET status = 'ready', draft = $2, dropped = $3, sources = $4, usage = $5,
              error = NULL, locked_at = NULL, updated_at = $6 WHERE id = $1`,
      [job.id, JSON.stringify(draft), JSON.stringify(dropped), JSON.stringify(sources), JSON.stringify(sumUsage(usage)), now()]);
  } catch (err) {
    await pool.query(
      `UPDATE enrichment_jobs SET status = 'failed', error = $2, dropped = $3, locked_at = NULL, updated_at = $4 WHERE id = $1`,
      [job.id, (err as Error).message.slice(0, 1000), JSON.stringify(dropped), now()]);
  }
}

export function sumUsage(list: Usage[]): Usage {
  return list.reduce<Usage>((acc, u) => ({
    input_tokens: acc.input_tokens + (u?.input_tokens ?? 0),
    output_tokens: acc.output_tokens + (u?.output_tokens ?? 0),
    cache_read_input_tokens: (acc.cache_read_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0),
  }), { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 });
}

/** A small in-process worker: one run at a time, woken by kick() and by a slow timer. */
export function startWorker(pool: pg.Pool, deps: EnrichDeps, intervalMs = 15_000): { kick: () => void; stop: () => void } {
  let running = false, again = false;
  const tick = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      // The API process only runs onboarding jobs; seeding is the operator's CLI job.
      do { again = false; await runQueuedJobs(pool, deps, { origin: "onboarding" }); } while (again);
    } catch (err) {
      console.error("enrichment worker:", (err as Error).message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return { kick: () => { void tick(); }, stop: () => clearInterval(timer) };
}
