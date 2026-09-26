/**
 * Seeding through the Message Batches API: half price, results within 24 hours, which is the
 * right trade for a non-interactive job (docs/alentour/07: ~$0.14 per listing).
 *
 *   prepareSeedJobs → fetch every website politely, store the source text on the job
 *   submitBatch     → one extraction request per job, custom_id = job id
 *   collectBatch    → gate each result, mark the job ready, materialize it as pending_review
 */
import type Anthropic from "@anthropic-ai/sdk";
import type pg from "pg";
import type { Fetcher } from "./net.ts";
import { readSite, sourceText } from "./site.ts";
import { extractionParams } from "./extract.ts";
import { gate } from "./gate.ts";
import { materializeSeedJob } from "./listing.ts";
import { sumUsage } from "./pipeline.ts";
import type { JobInput } from "./pipeline.ts";
import type { Draft, Usage } from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read each queued seed job's website and keep the source text for the batch request. */
export async function prepareSeedJobs(pool: pg.Pool, fetcher: Fetcher, opts: { limit?: number; delayMs?: number; log?: (s: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const { rows } = await pool.query(
    `SELECT id, input FROM enrichment_jobs WHERE origin = 'seed' AND status = 'queued' AND batch_id IS NULL
      AND NOT (input ? 'source') ORDER BY created_at LIMIT $1`, [opts.limit ?? 500]);
  for (const job of rows) {
    const input = job.input as JobInput & { source?: string };
    let site = null;
    const sources: { url: string; chars: number }[] = [];
    if (input.website) {
      try {
        site = await readSite(fetcher, input.website);
        site.pages.forEach((p) => sources.push({ url: p.url, chars: p.text.length }));
      } catch (err) { log(`  ! ${input.name}: ${(err as Error).message}`); }
    }
    const source = sourceText(site, { name: input.name, pitch: input.pitch });
    await pool.query(
      `UPDATE enrichment_jobs SET input = input || jsonb_build_object('source', $2::text), sources = $3,
              draft = jsonb_build_object('website', $4::text, 'socials', $5::jsonb, 'phone', $6::text)
        WHERE id = $1`,
      [job.id, source, JSON.stringify(sources), site?.url ?? input.website ?? null, JSON.stringify(site?.socials ?? {}), site?.phones[0] ?? null]);
    log(`  ✓ read ${input.name} (${source.length} chars)`);
    await sleep(opts.delayMs ?? 1000);   // one site at a time, politely
  }
  return rows.length;
}

export async function submitBatch(pool: pg.Pool, client: Anthropic, opts: { limit?: number } = {}): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT id, input FROM enrichment_jobs WHERE origin = 'seed' AND status = 'queued' AND batch_id IS NULL
      AND input ? 'source' ORDER BY created_at LIMIT $1`, [opts.limit ?? 1000]);
  if (!rows.length) return null;
  const requests = rows.map((j: any) => ({ custom_id: j.id as string, params: extractionParams(j.input.source).params }));
  const batch = await client.messages.batches.create({ requests: requests as any });
  await pool.query(
    `UPDATE enrichment_jobs SET batch_id = $1, status = 'extracting', updated_at = now() WHERE id = ANY($2::uuid[])`,
    [batch.id, rows.map((r: any) => r.id)]);
  return batch.id;
}

export async function collectBatch(pool: pg.Pool, client: Anthropic, batchId: string, log: (s: string) => void = () => {}) {
  const batch = await client.messages.batches.retrieve(batchId);
  if (batch.processing_status !== "ended") return { ended: false, counts: batch.request_counts };
  const summary = { ready: 0, failed: 0, listings: 0 };
  for await (const entry of await client.messages.batches.results(batchId)) {
    const job = (await pool.query(`SELECT * FROM enrichment_jobs WHERE id = $1 AND batch_id = $2`, [entry.custom_id, batchId])).rows[0];
    if (!job || job.status !== "extracting") continue;
    if (entry.result.type !== "succeeded") {
      // Errored or expired requests go back in the queue for the next batch.
      await pool.query(
        `UPDATE enrichment_jobs SET status = CASE WHEN attempts >= 2 THEN 'failed' ELSE 'queued' END,
                attempts = attempts + 1, batch_id = NULL, error = $2 WHERE id = $1`,
        [job.id, entry.result.type]);
      summary.failed++;
      continue;
    }
    const message = entry.result.message;
    const text = message.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    try {
      const { parse } = extractionParams(job.input.source);
      const extraction = parse(text);
      const gated = gate({ extraction, source: job.input.source });
      const base = (job.draft ?? {}) as Partial<Draft>;
      const draft: Draft = {
        isActivityBusiness: extraction.is_activity_business,
        phone: gated.phone ?? base.phone ?? null,
        website: base.website ?? null,
        socials: base.socials ?? {},
        ai: true,
        activities: gated.activities,
      };
      await pool.query(
        `UPDATE enrichment_jobs SET status = 'ready', draft = $2, dropped = $3, usage = $4, updated_at = now() WHERE id = $1`,
        [job.id, JSON.stringify(draft), JSON.stringify(gated.dropped), JSON.stringify(sumUsage([message.usage as Usage]))]);
      summary.ready++;
      const made = await materializeSeedJob(pool, job.id);
      if (made) { summary.listings += made.activityIds.length; log(`  ✓ ${job.input.name}: ${made.activityIds.length} activities`); }
      else log(`  – ${job.input.name}: discarded`);
    } catch (err) {
      await pool.query(`UPDATE enrichment_jobs SET status = 'failed', error = $2 WHERE id = $1`, [job.id, (err as Error).message.slice(0, 1000)]);
      summary.failed++;
    }
  }
  return { ended: true, ...summary };
}
