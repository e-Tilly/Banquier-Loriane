/**
 * Owner edits. Owner-set fields beat community-set beat AI-set (docs/alentour/04-data-model.md),
 * so an owner's change applies immediately — but every change is a revision carrying both the
 * new and previous values, so anything can be reverted exactly.
 *
 * An owner saving the form also counts as re-verifying the listing: that is the 90-day
 * "still accurate?" loop that keeps the catalog from rotting.
 */
import type pg from "pg";
import { z } from "zod";
import { parseOpeningHours } from "../catalog/hours.ts";
import { allSlugs, loadTaxonomy } from "../taxonomy/load.ts";
import { providerEntitlements } from "../billing/stripe.ts";

const Content = z.object({
  title: z.string().trim().min(2).max(90),
  summary: z.string().trim().max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  whatToBring: z.string().trim().max(300).optional(),
}).partial();

export const OwnerPatch = z.object({
  content: z.partialRecord(z.enum(["fr-CA", "en-CA"]), Content).optional(),
  isFree: z.boolean().optional(),
  priceMinCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  priceMaxCents: z.number().int().min(0).max(1_000_000).nullable().optional(),
  typicalDurationMinutes: z.number().int().min(5).max(24 * 60).nullable().optional(),
  openingHours: z.string().trim().max(300).nullable().optional(),
  minAge: z.number().int().min(0).max(99).nullable().optional(),
  weather: z.enum(["indoor", "covered", "outdoor", "either"]).nullable().optional(),
  /** Business Pro only: a "Book" button in the app. https only. */
  bookingUrl: z.string().trim().max(300).regex(/^https:\/\/[^\s]+$/).nullable().optional(),
  /** Tri-state: true / false / null (= "I don't know", which removes any claim). */
  a11y: z.record(z.string(), z.boolean().nullable()).optional(),
  tagsAdd: z.array(z.string()).max(20).optional(),
  tagsRemove: z.array(z.string()).max(20).optional(),
}).strict();
export type OwnerPatch = z.infer<typeof OwnerPatch>;

export type EditResult =
  | { ok: true; revisionId: number }
  | { ok: false; error: "not_found" | "forbidden" | "invalid"; issues?: string[] };

export async function canEdit(pool: pg.Pool, userId: string, activityId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM activities a JOIN provider_members m ON m.provider_id = a.provider_id
      WHERE a.id = $1 AND m.user_id = $2`, [activityId, userId]);
  return rows.length > 0;
}

/** Validation beyond the schema: hours must parse, tags must exist, prices must be coherent. */
export function validatePatch(p: OwnerPatch): string[] {
  const issues: string[] = [];
  if (p.openingHours && !parseOpeningHours(p.openingHours)) {
    issues.push(`openingHours: "${p.openingHours}" is not valid (e.g. "Mo-Fr 09:00-17:00; Sa 10:00-14:00")`);
  }
  if (p.priceMinCents != null && p.priceMaxCents != null && p.priceMaxCents < p.priceMinCents) {
    issues.push("priceMaxCents: must be at least priceMinCents");
  }
  const known = new Set(allSlugs(loadTaxonomy()));
  for (const slug of [...(p.tagsAdd ?? []), ...(p.tagsRemove ?? [])]) {
    if (!known.has(slug)) issues.push(`tags: unknown tag ${slug}`);
    // Accessibility is tri-state and has its own field; as a plain tag it would read as "no".
    if (slug.startsWith("a11y.")) issues.push(`tags: ${slug} must be set through a11y, not tags`);
  }
  for (const slug of Object.keys(p.a11y ?? {})) {
    if (!slug.startsWith("a11y.") || !known.has(slug)) issues.push(`a11y: unknown accessibility tag ${slug}`);
  }
  return issues;
}

export async function applyOwnerEdit(
  pool: pg.Pool, userId: string, activityId: string, raw: unknown, now = new Date(),
): Promise<EditResult> {
  const parsed = OwnerPatch.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const p = parsed.data;
  const issues = validatePatch(p);
  if (issues.length) return { ok: false, error: "invalid", issues };

  const exists = await pool.query(`SELECT 1 FROM activities WHERE id = $1`, [activityId]);
  if (!exists.rowCount) return { ok: false, error: "not_found" };
  if (!(await canEdit(pool, userId, activityId))) return { ok: false, error: "forbidden" };
  if (p.bookingUrl) {
    const owner = (await pool.query(`SELECT provider_id FROM activities WHERE id = $1`, [activityId])).rows[0];
    if (!(await providerEntitlements(pool, owner?.provider_id ?? null)).bookingLink) {
      return { ok: false, error: "invalid", issues: ["bookingUrl: a booking link is part of Business Pro"] };
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = (await client.query(
      `SELECT is_free, price_min_cents, price_max_cents, typical_duration_minutes, opening_hours,
              min_age, weather_dependency, booking_url
         FROM activities WHERE id = $1 FOR UPDATE`, [activityId])).rows[0];
    const patch: Record<string, unknown> = {};
    const previous: Record<string, unknown> = {};
    const set = (field: string, column: string, value: unknown) => {
      if (value === undefined || cur[column] === value) return;
      patch[field] = value;
      previous[field] = cur[column];
    };
    set("isFree", "is_free", p.isFree);
    set("priceMinCents", "price_min_cents", p.priceMinCents);
    set("priceMaxCents", "price_max_cents", p.priceMaxCents);
    set("typicalDurationMinutes", "typical_duration_minutes", p.typicalDurationMinutes);
    set("openingHours", "opening_hours", p.openingHours);
    set("minAge", "min_age", p.minAge);
    set("weather", "weather_dependency", p.weather);
    set("bookingUrl", "booking_url", p.bookingUrl);

    await client.query(
      `UPDATE activities SET
         is_free = COALESCE($2, is_free),
         price_min_cents = CASE WHEN $3::boolean THEN $4 ELSE price_min_cents END,
         price_max_cents = CASE WHEN $5::boolean THEN $6 ELSE price_max_cents END,
         typical_duration_minutes = CASE WHEN $7::boolean THEN $8 ELSE typical_duration_minutes END,
         opening_hours = CASE WHEN $9::boolean THEN $10 ELSE opening_hours END,
         last_verified_at = $11, updated_at = $11,
         min_age = CASE WHEN $12::boolean THEN $13 ELSE min_age END,
         weather_dependency = CASE WHEN $14::boolean THEN $15 ELSE weather_dependency END,
         booking_url = CASE WHEN $16::boolean THEN $17 ELSE booking_url END
       WHERE id = $1`,
      [activityId, p.isFree ?? null,
       p.priceMinCents !== undefined, p.priceMinCents ?? null,
       p.priceMaxCents !== undefined, p.priceMaxCents ?? null,
       p.typicalDurationMinutes !== undefined, p.typicalDurationMinutes ?? null,
       p.openingHours !== undefined, p.openingHours || null,
       now,
       p.minAge !== undefined, p.minAge ?? null,
       p.weather !== undefined, p.weather ?? null,
       p.bookingUrl !== undefined, p.bookingUrl ?? null]);

    for (const [locale, c] of Object.entries(p.content ?? {})) {
      if (!c) continue;
      const before = (await client.query(
        `SELECT title, summary, description, what_to_bring FROM activity_content WHERE activity_id = $1 AND locale = $2`,
        [activityId, locale])).rows[0] ?? null;
      if (!before && !c.title) continue;               // cannot create a locale without a title
      await client.query(
        `INSERT INTO activity_content (activity_id, locale, title, summary, description, what_to_bring, source)
         VALUES ($1, $2, $3, $4, $5, $6, 'owner')
         ON CONFLICT (activity_id, locale) DO UPDATE SET
           title = COALESCE($3, activity_content.title),
           summary = COALESCE($4, activity_content.summary),
           description = COALESCE($5, activity_content.description),
           what_to_bring = COALESCE($6, activity_content.what_to_bring),
           source = 'owner'`,
        [activityId, locale, c.title ?? null, c.summary ?? null, c.description ?? null, c.whatToBring ?? null]);
      patch[`content.${locale}`] = c;
      previous[`content.${locale}`] = before;
    }

    for (const [slug, value] of Object.entries(p.a11y ?? {})) {
      const before = (await client.query(
        `SELECT value FROM activity_tags WHERE activity_id = $1 AND tag_slug = $2`, [activityId, slug])).rows[0];
      if (value === null) {
        await client.query(`DELETE FROM activity_tags WHERE activity_id = $1 AND tag_slug = $2`, [activityId, slug]);
      } else {
        await client.query(
          `INSERT INTO activity_tags (activity_id, tag_slug, value, source, confidence, verified_at)
           VALUES ($1, $2, $3, 'owner', 1, $4)
           ON CONFLICT (activity_id, tag_slug) DO UPDATE SET value = $3, source = 'owner', confidence = 1, verified_at = $4`,
          [activityId, slug, value, now]);
      }
      patch[`a11y.${slug}`] = value;
      previous[`a11y.${slug}`] = before ? before.value : null;
    }

    for (const slug of p.tagsAdd ?? []) {
      await client.query(
        `INSERT INTO activity_tags (activity_id, tag_slug, value, source, confidence, verified_at)
         VALUES ($1, $2, true, 'owner', 1, $3)
         ON CONFLICT (activity_id, tag_slug) DO UPDATE SET value = true, source = 'owner', verified_at = $3`,
        [activityId, slug, now]);
      patch[`tag.${slug}`] = true;
    }
    for (const slug of p.tagsRemove ?? []) {
      await client.query(`DELETE FROM activity_tags WHERE activity_id = $1 AND tag_slug = $2`, [activityId, slug]);
      patch[`tag.${slug}`] = false;
    }

    const rev = await client.query<{ id: string }>(
      `INSERT INTO activity_revisions (activity_id, author_type, author_id, patch, previous)
       VALUES ($1, 'owner', $2, $3, $4) RETURNING id`,
      [activityId, userId, JSON.stringify(patch), JSON.stringify(previous)]);
    await client.query("COMMIT");
    return { ok: true, revisionId: Number(rev.rows[0]!.id) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** The 90-day nudge: one tap to say nothing changed. */
export async function confirmStillAccurate(pool: pg.Pool, userId: string, activityId: string, now = new Date()): Promise<boolean> {
  if (!(await canEdit(pool, userId, activityId))) return false;
  await pool.query(`UPDATE activities SET last_verified_at = $2 WHERE id = $1`, [activityId, now]);
  await pool.query(
    `INSERT INTO activity_revisions (activity_id, author_type, author_id, patch, previous)
     VALUES ($1, 'owner', $2, '{"confirmed":true}', '{}')`, [activityId, userId]);
  return true;
}

/** Everything an owner needs to render their dashboard and edit form. */
export async function ownerListings(pool: pg.Pool, userId: string) {
  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.status, a.is_free, a.price_min_cents, a.price_max_cents,
            a.typical_duration_minutes, a.opening_hours, a.last_verified_at,
            a.min_age, a.weather_dependency, a.primary_category, a.kind, a.booking_url, a.provider_id,
            (SELECT subscription_tier FROM providers pr WHERE pr.id = a.provider_id) AS tier,
            v.id AS venue_id, v.name AS venue_name,
            (SELECT jsonb_object_agg(c.locale, jsonb_build_object('title', c.title, 'summary', c.summary,
                     'description', c.description, 'whatToBring', c.what_to_bring))
               FROM activity_content c WHERE c.activity_id = a.id) AS content,
            (SELECT jsonb_object_agg(t.tag_slug, t.value) FROM activity_tags t
              WHERE t.activity_id = a.id AND t.tag_slug LIKE 'a11y.%') AS a11y,
            (SELECT array_agg(t.tag_slug ORDER BY t.tag_slug) FROM activity_tags t
              WHERE t.activity_id = a.id AND t.value AND t.tag_slug NOT LIKE 'a11y.%') AS tags,
            (SELECT jsonb_agg(jsonb_build_object('id', m.id, 'key', m.storage_key, 'status', m.safety_status,
                                                 'hero', m.is_hero) ORDER BY m.is_hero DESC, m.sort_order)
               FROM media m WHERE m.owner_type = 'activity' AND m.owner_id = a.id) AS photos
       FROM activities a
       JOIN provider_members m ON m.provider_id = a.provider_id AND m.user_id = $1
       JOIN activity_locations l ON l.activity_id = a.id AND l.is_primary
       JOIN venues v ON v.id = l.venue_id
      ORDER BY v.name, a.slug`, [userId]);
  return rows;
}
