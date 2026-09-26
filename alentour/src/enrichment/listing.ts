/**
 * Turning drafts into listings, and photos into media rows.
 *
 * Onboarding: the owner reviewed every field, so what they submit is written as owner-sourced;
 * the model's draft is kept alongside as an 'ai' revision for provenance. A business whose
 * owner signed in with an address at the website's own domain publishes immediately; anyone
 * else's listing waits for the operator, exactly like a manual claim.
 *
 * Seeding: nobody reviewed anything, so every value is AI-sourced with its confidence, nothing is
 * marked verified, accessibility stays unknown, and every activity waits in pending_review.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { OwnerPatch, validatePatch } from "../claims/edits.ts";
import { emailMatchesDomain, siteDomain } from "../claims/claims.ts";
import { facet, loadTaxonomy } from "../taxonomy/load.ts";
import type { EnrichDeps, JobInput } from "./pipeline.ts";
import { processImage } from "./images.ts";
import { pickHero, safetyFor, triagePhoto, type Triage } from "./triage.ts";
import type { Draft, DraftActivity } from "./types.ts";

// ------------------------------------------------------------------ photos

export interface PhotoResult { id: string | null; name: string; safety: "approved" | "pending" | "rejected" | "error"; error?: string }

/** Free tier; Business Pro raises it (src/billing/stripe.ts entitlements). */
export const MAX_PHOTOS = 6;

/**
 * Store uploaded photos against a job or an activity: validate by content, strip metadata,
 * upload, triage. The licence grant is required: we store copies, so we need the right to.
 */
export async function storePhotos(
  pool: pg.Pool, deps: Pick<EnrichDeps, "client" | "storage">,
  target: { type: "job" | "activity"; id: string }, userId: string,
  files: { name: string; bytes: Buffer }[], now: Date, limit = MAX_PHOTOS,
): Promise<PhotoResult[]> {
  const existing = (await pool.query(
    `SELECT count(*)::int AS n, bool_or(is_hero) AS has_hero FROM media WHERE owner_type = $1 AND owner_id = $2`,
    [target.type, target.id])).rows[0];
  const room = Math.max(0, limit - existing.n);
  const results: PhotoResult[] = [];
  const stored: { id: string; triage: Triage | null; safety: "approved" | "pending" | "rejected" }[] = [];

  for (const [i, f] of files.entries()) {
    if (!f.bytes.length) continue;
    if (i >= room) { results.push({ id: null, name: f.name, safety: "error", error: "too_many" }); continue; }
    let img;
    try { img = processImage(f.bytes); } catch (err) {
      results.push({ id: null, name: f.name, safety: "error", error: (err as Error).message });
      continue;
    }
    let triage: Triage | null = null;
    if (deps.client) {
      try { triage = await triagePhoto(deps.client, img.bytes, img.type); } catch { triage = null; }
    }
    const safety = safetyFor(triage);
    const key = `m/${randomUUID()}.${img.ext}`;
    if (safety !== "rejected") await deps.storage.put(key, img.bytes, img.type);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO media (owner_type, owner_id, storage_key, kind, width, height, bytes, provenance, safety_status,
                          sort_order, imported_at, uploaded_by, content_type, triage, has_faces, licence_granted_at)
       VALUES ($1, $2, $3, 'photo', $4, $5, $6, 'owner_upload', $7, $8, $9, $10, $11, $12, $13, $9) RETURNING id`,
      [target.type, target.id, key, img.width, img.height, img.bytes.length, safety, existing.n + i, now, userId,
       img.type, triage ? JSON.stringify(triage) : null, triage?.has_faces ?? null]);
    stored.push({ id: rows[0]!.id, triage, safety });
    results.push({ id: rows[0]!.id, name: f.name, safety });
  }

  if (!existing.has_hero && stored.length) {
    const hero = pickHero(stored);
    if (hero >= 0) await pool.query(`UPDATE media SET is_hero = true WHERE id = $1`, [stored[hero]!.id]);
  }
  return results;
}

export async function deletePhoto(pool: pg.Pool, deps: Pick<EnrichDeps, "storage">, mediaId: string, activityId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `DELETE FROM media WHERE id = $1 AND owner_type = 'activity' AND owner_id = $2 RETURNING storage_key, is_hero`,
    [mediaId, activityId]);
  if (!rows[0]) return false;
  await deps.storage.delete(rows[0].storage_key).catch(() => {});
  if (rows[0].is_hero) {
    await pool.query(
      `UPDATE media SET is_hero = true WHERE id = (SELECT id FROM media WHERE owner_type = 'activity' AND owner_id = $1
         AND safety_status <> 'rejected' ORDER BY sort_order LIMIT 1)`, [activityId]);
  }
  return true;
}

// ------------------------------------------------------------------ onboarding publish

const KINDS = ["place", "scheduled_event", "recurring_program", "self_guided", "seasonal"] as const;

export const ReviewedActivity = z.object({
  key: z.string(),
  kind: z.enum(KINDS),
  primaryCategory: z.string(),
  patch: OwnerPatch,
});
export type ReviewedActivity = z.infer<typeof ReviewedActivity>;

export interface Review {
  activities: ReviewedActivity[];
  phone: string | null;
  confirmPrice: boolean;
  confirmA11y: boolean;
  expressConsent: boolean;
}

export type PublishResult =
  | { ok: true; venueId: string; activityIds: string[]; status: "published" | "pending_review" }
  | { ok: false; errors: string[] };

export function validateReview(r: Review): string[] {
  const errors: string[] = [];
  if (!r.activities.length) errors.push("activities: include at least one activity");
  if (!r.confirmPrice) errors.push("confirmPrice: please confirm the prices");
  if (!r.confirmA11y) errors.push("confirmA11y: please confirm the accessibility answers");
  const categories = new Set((facet(loadTaxonomy(), "category").tags ?? []).map((t) => t.slug));
  for (const a of r.activities) {
    const parsed = ReviewedActivity.safeParse(a);
    if (!parsed.success) { errors.push(...parsed.error.issues.map((i) => `${a.key}.${i.path.join(".")}: ${i.message}`)); continue; }
    if (!categories.has(a.primaryCategory)) errors.push(`${a.key}.category: choose a category`);
    if (!a.patch.content?.["fr-CA"]?.title) errors.push(`${a.key}.title: a French title is required`);
    errors.push(...validatePatch(a.patch).map((e) => `${a.key}.${e}`));
  }
  return errors;
}

export function e164(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export function slugify(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "activite";
}

async function uniqueSlug(client: pg.PoolClient, base: string): Promise<string> {
  const { rows } = await client.query<{ slug: string }>(`SELECT slug FROM activities WHERE slug = $1 OR slug LIKE $2`, [base, `${base}-%`]);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

function completeness(p: OwnerPatch): number {
  const has = [p.content?.["fr-CA"]?.summary, p.content?.["fr-CA"]?.description, p.content?.["en-CA"]?.title,
    p.isFree || p.priceMinCents != null, p.typicalDurationMinutes, p.openingHours,
    Object.values(p.a11y ?? {}).some((v) => v !== null), (p.tagsAdd ?? []).length >= 2];
  return Math.round((has.filter(Boolean).length / has.length) * 100) / 100;
}

export async function publishOnboarding(
  pool: pg.Pool, job: { id: string; input: JobInput; draft: Draft; requested_by: string },
  user: { id: string; email: string | null }, review: Review, now: Date,
): Promise<PublishResult> {
  const errors = validateReview(review);
  if (errors.length) return { ok: false, errors };

  const input = job.input;
  const verified = !!user.email && emailMatchesDomain(user.email, siteDomain(input.website ?? job.draft.website));
  const status = verified ? "published" : "pending_review";
  const tax = loadTaxonomy();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(`SELECT status FROM enrichment_jobs WHERE id = $1 FOR UPDATE`, [job.id]);
    if (locked.rows[0]?.status !== "ready") throw new Error(`job is ${locked.rows[0]?.status}, not ready`);

    const provider = await client.query<{ id: string }>(
      `INSERT INTO providers (display_name, claim_status, claim_method, claimed_at) VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.name, verified ? "verified" : "pending", verified ? "onboarding_email_domain" : "onboarding_manual", verified ? now : null]);
    const providerId = provider.rows[0]!.id;
    await client.query(`INSERT INTO provider_members (provider_id, user_id, role) VALUES ($1, $2, 'owner')`, [providerId, user.id]);

    const venue = await client.query<{ id: string }>(
      `INSERT INTO venues (name, lat, lon, address, neighbourhood, website, phone_e164, external_ids, provider_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [input.name, input.lat, input.lon, JSON.stringify(input.address ? { line1: input.address } : {}), input.neighbourhood ?? null,
       job.draft.website ?? input.website ?? null, e164(review.phone ?? job.draft.phone), JSON.stringify(job.draft.socials ?? {}), providerId]);
    const venueId = venue.rows[0]!.id;

    const activityIds: string[] = [];
    for (const r of review.activities) {
      const d = job.draft.activities.find((a) => a.key === r.key);
      const p = r.patch;
      const slug = await uniqueSlug(client, slugify(p.content!["fr-CA"]!.title!));
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO activities (slug, kind, status, provider_id, primary_category, secondary_categories,
            price_min_cents, price_max_cents, price_unit, is_free, typical_duration_minutes, opening_hours,
            min_age, weather_dependency, physical_demand, skill_required, icebreaker_score, risk_tier, months_open,
            quality_score, completeness, taxonomy_version, last_verified_at, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,0.6,$20,$21,$22,'onboarding')
         RETURNING id`,
        [slug, r.kind, status, providerId, r.primaryCategory, (d?.secondaryCategories ?? []).filter((c) => c !== r.primaryCategory),
         p.priceMinCents ?? null, p.priceMaxCents ?? null, d?.price?.value.unit ?? null, p.isFree ?? false,
         p.typicalDurationMinutes ?? null, p.openingHours || null, p.minAge ?? null, p.weather ?? null,
         d?.physicalDemand?.value ?? null, d?.skillRequired?.value ?? null, d?.icebreakerScore?.value ?? null,
         d?.riskTier?.value ?? 0, d?.monthsOpen?.value ?? 4095, completeness(p), tax.version, now]);
      const activityId = rows[0]!.id;
      activityIds.push(activityId);
      await client.query(`INSERT INTO activity_locations (activity_id, venue_id, is_primary) VALUES ($1, $2, true)`, [activityId, venueId]);

      for (const [loc, c] of Object.entries(p.content ?? {})) {
        if (!c?.title) continue;
        await client.query(
          `INSERT INTO activity_content (activity_id, locale, title, summary, description, what_to_bring, source)
           VALUES ($1, $2, $3, $4, $5, $6, 'owner')`,
          [activityId, loc, c.title, c.summary ?? null, c.description ?? null, c.whatToBring ?? null]);
      }
      // The owner confirmed these on the review screen, so they are the owner's answers.
      for (const slug of new Set([r.primaryCategory, ...(p.tagsAdd ?? [])])) {
        await client.query(
          `INSERT INTO activity_tags (activity_id, tag_slug, value, source, confidence, verified_at)
           VALUES ($1, $2, true, 'owner', 1, $3)`, [activityId, slug, now]);
      }
      for (const [slug, value] of Object.entries(p.a11y ?? {})) {
        if (value === null) continue;
        await client.query(
          `INSERT INTO activity_tags (activity_id, tag_slug, value, source, confidence, verified_at)
           VALUES ($1, $2, $3, 'owner', 1, $4)`, [activityId, slug, value, now]);
      }
      if (d) {
        await client.query(
          `INSERT INTO activity_revisions (activity_id, author_type, patch, previous, created_at) VALUES ($1, 'ai', $2, '{}', $3)`,
          [activityId, JSON.stringify({ job: job.id, draft: d }), now]);
      }
      await client.query(
        `INSERT INTO activity_revisions (activity_id, author_type, author_id, patch, previous, created_at)
         VALUES ($1, 'owner', $2, $3, '{}', $4)`,
        [activityId, user.id, JSON.stringify({ created: true, job: job.id, ...p }), now]);
    }

    // Photos uploaded during review hang off the job; they belong to the first activity.
    await client.query(
      `UPDATE media SET owner_type = 'activity', owner_id = $2 WHERE owner_type = 'job' AND owner_id = $1`,
      [job.id, activityIds[0]]);

    if (review.expressConsent && user.email) {
      const contact = await client.query<{ id: string }>(
        `INSERT INTO business_contacts (provider_id, venue_id, email, locale) VALUES ($1, $2, $3, 'fr-CA')
         ON CONFLICT (email) DO UPDATE SET provider_id = EXCLUDED.provider_id, venue_id = EXCLUDED.venue_id
         RETURNING id`, [providerId, venueId, user.email]);
      await client.query(
        `INSERT INTO consent_records (contact_id, basis, event_type, event_at, event_detail)
         VALUES ($1, 'express_consent', 'opt_in_form', $2, $3)`,
        [contact.rows[0]!.id, now, JSON.stringify({ job: job.id, form: "owner_onboarding" })]);
    }

    await client.query(`UPDATE enrichment_jobs SET status = 'published', venue_id = $2, updated_at = $3 WHERE id = $1`, [job.id, venueId, now]);
    await client.query("COMMIT");
    return { ok: true, venueId, activityIds, status };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------------ seeding

/**
 * A ready seed job becomes a venue and activities waiting for the operator. AI-sourced values,
 * confidence kept, no verification date, accessibility untouched.
 */
export async function materializeSeedJob(pool: pg.Pool, jobId: string, now = new Date()): Promise<{ venueId: string; activityIds: string[] } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = (await client.query(`SELECT * FROM enrichment_jobs WHERE id = $1 AND origin = 'seed' FOR UPDATE`, [jobId])).rows[0];
    if (!job || job.status !== "ready" || !job.draft) { await client.query("ROLLBACK"); return null; }
    const input = job.input as JobInput;
    const draft = job.draft as Draft;
    const usable = draft.activities.filter((a) => a.primaryCategory);
    if (!draft.isActivityBusiness || !usable.length) {
      await client.query(`UPDATE enrichment_jobs SET status = 'discarded', error = $2, updated_at = $3 WHERE id = $1`,
        [jobId, draft.isActivityBusiness ? "no activity with a category" : "not an activity business", now]);
      await client.query("COMMIT");
      return null;
    }
    const tax = loadTaxonomy();
    const venue = await client.query<{ id: string }>(
      `INSERT INTO venues (name, lat, lon, address, neighbourhood, website, phone_e164, external_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [input.name, input.lat, input.lon, JSON.stringify(input.address ? { line1: input.address } : {}),
       input.neighbourhood ?? null, draft.website ?? input.website ?? null, e164(draft.phone ?? input.phone),
       JSON.stringify(draft.socials ?? {})]);
    const venueId = venue.rows[0]!.id;
    const activityIds: string[] = [];
    for (const a of usable) activityIds.push(await insertAiActivity(client, venueId, a, tax.version, jobId, now));
    await client.query(`UPDATE enrichment_jobs SET status = 'published', venue_id = $2, updated_at = $3 WHERE id = $1`, [jobId, venueId, now]);
    await client.query("COMMIT");
    return { venueId, activityIds };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function insertAiActivity(client: pg.PoolClient, venueId: string, a: DraftActivity, taxonomyVersion: number, jobId: string, now: Date): Promise<string> {
  const title = a.copy["fr-CA"]?.title ?? a.name;
  const slug = await uniqueSlug(client, slugify(title));
  const price = a.price?.value;
  const conf = [a.primaryCategory?.confidence ?? 0, ...a.tags.map((t) => t.confidence)];
  const quality = Math.round(Math.min(0.7, 0.4 + 0.3 * (conf.reduce((x, y) => x + y, 0) / conf.length)) * 100) / 100;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO activities (slug, kind, status, primary_category, secondary_categories, price_min_cents, price_max_cents,
        price_unit, is_free, typical_duration_minutes, opening_hours, min_age, weather_dependency, physical_demand,
        skill_required, icebreaker_score, risk_tier, months_open, quality_score, completeness, taxonomy_version, origin)
     VALUES ($1,$2,'pending_review',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,0.5,$19,'seed_ai') RETURNING id`,
    [slug, a.kind, a.primaryCategory!.value, a.secondaryCategories, price?.minCents ?? null, price?.maxCents ?? null,
     price?.unit ?? null, price?.isFree ?? false, a.durationMinutes?.value ?? null, a.openingHours?.value ?? null,
     a.minAge?.value ?? null, a.weather?.value ?? null, a.physicalDemand?.value ?? null, a.skillRequired?.value ?? null,
     a.icebreakerScore?.value ?? null, a.riskTier?.value ?? 0, a.monthsOpen?.value ?? 4095, quality, taxonomyVersion]);
  const id = rows[0]!.id;
  await client.query(`INSERT INTO activity_locations (activity_id, venue_id, is_primary) VALUES ($1, $2, true)`, [id, venueId]);
  for (const [loc, c] of Object.entries(a.copy)) {
    if (!c?.title) continue;
    await client.query(
      `INSERT INTO activity_content (activity_id, locale, title, summary, what_to_bring, source) VALUES ($1, $2, $3, $4, $5, 'ai')`,
      [id, loc, c.title, c.summary ?? null, loc === "fr-CA" ? a.whatToBring?.value ?? null : null]);
  }
  await client.query(
    `INSERT INTO activity_tags (activity_id, tag_slug, value, source, confidence) VALUES ($1, $2, true, 'ai', $3)`,
    [id, a.primaryCategory!.value, a.primaryCategory!.confidence]);
  for (const t of a.tags) {
    await client.query(
      `INSERT INTO activity_tags (activity_id, tag_slug, value, source, confidence) VALUES ($1, $2, true, 'ai', $3)
       ON CONFLICT DO NOTHING`, [id, t.slug, t.confidence]);
  }
  await client.query(
    `INSERT INTO activity_revisions (activity_id, author_type, patch, previous, created_at) VALUES ($1, 'ai', $2, '{}', $3)`,
    [id, JSON.stringify({ job: jobId, draft: a }), now]);
  return id;
}
