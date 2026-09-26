/**
 * User-created activities (docs/alentour/07 §3). The community knows about the swimming hole,
 * the free Tuesday, the sledding hill — and a catalog that lets anyone add anything degrades in
 * a month. So:
 *
 *  - dedup first: "Did you mean …?" before anything is created;
 *  - trust gates what publishes instantly: new people's submissions go to review; people with
 *    a track record publish at once, but never a brand-new place (a pin could be someone's home);
 *  - deterministic rules refuse contact details and prohibited activities; a small model scores
 *    the text; anything doubtful waits for a human;
 *  - community-created places cannot host outings until a human has reviewed them.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type pg from "pg";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { aiAssertableSlugs, facet, loadTaxonomy } from "../taxonomy/load.ts";
import { hasContactDetails, classify, route } from "../outings/safety.ts";
import { inMontreal } from "../enrichment/geo.ts";
import { slugify } from "../enrichment/listing.ts";

export const TRUSTED = 2;

/** Activities the ToS forbids listing, whoever submits them. */
const PROHIBITED = /(cliff ?jump|saut de falaise|urbex|urban explor|exploration urbaine|trespass|entrée par effraction|sur les toits|onto the roof|train ?surf|ice on the river|glace (sur|du) (le )?fleuve|b[aâ]timent abandonn|abandoned (building|factory|hospital)|chantier de construction|construction site)/i;

export const Submission = z.object({
  title: z.string().trim().min(3).max(90),
  description: z.string().trim().max(1000).optional().default(""),
  category: z.string(),
  tags: z.array(z.string()).max(3).default([]),
  kind: z.enum(["place", "self_guided", "recurring_program", "seasonal"]).default("place"),
  isFree: z.boolean().default(true),
  priceDollars: z.number().min(0).max(1000).nullable().optional(),
  locale: z.enum(["fr-CA", "en-CA"]).default("fr-CA"),
  venueId: z.string().uuid().optional(),
  place: z.object({ name: z.string().trim().min(2).max(90), lat: z.number(), lon: z.number() }).optional(),
}).refine((s) => !!s.venueId !== !!s.place, { message: "give either venueId or place" });
export type Submission = z.infer<typeof Submission>;

export interface Similar { id: string; title: string; venue: string; distanceM: number }

/** "Did you mean …?" — similar titles within 400 m, or the same title anywhere nearby. */
export async function findSimilar(pool: pg.Pool, title: string, lat: number, lon: number): Promise<Similar[]> {
  const { rows } = await pool.query(
    `SELECT a.id, c.title, v.name AS venue,
            round(6371000 * 2 * asin(sqrt(power(sin(radians(l.lat - $2) / 2), 2) +
                  cos(radians($2)) * cos(radians(l.lat)) * power(sin(radians(l.lon - $3) / 2), 2))))::int AS dist,
            greatest(similarity(lower(c.title), lower($1)), similarity(lower(v.name), lower($1))) AS sim
       FROM activities a
       JOIN activity_content c ON c.activity_id = a.id
       JOIN activity_locations l ON l.activity_id = a.id AND l.is_primary
       JOIN venues v ON v.id = l.venue_id
      WHERE a.status IN ('published', 'pending_review')`, [title, lat, lon]);
  const best = new Map<string, Similar & { sim: number }>();
  for (const r of rows) {
    if (!((r.sim > 0.35 && r.dist < 400) || (r.sim > 0.6 && r.dist < 3000))) continue;
    const prev = best.get(r.id);
    if (!prev || r.sim > prev.sim) best.set(r.id, { id: r.id, title: r.title, venue: r.venue, distanceM: r.dist, sim: r.sim });
  }
  return [...best.values()].sort((a, b) => b.sim - a.sim).slice(0, 3).map(({ sim: _s, ...x }) => x);
}

// ------------------------------------------------------------------ AI tag suggestions

/** Up to three tags and a category, from the title and description, constrained to the taxonomy. */
export async function suggestTags(client: Anthropic | null, title: string, description: string): Promise<{ category: string | null; tags: string[] }> {
  if (!client) return { category: null, tags: [] };
  const tax = loadTaxonomy();
  const categories = (facet(tax, "category").tags ?? []).map((t) => t.slug);
  const tags = aiAssertableSlugs(tax).filter((s) => !s.startsWith("category.") && !s.startsWith("price."));
  const Schema = z.object({
    category: z.enum(categories as [string, ...string[]]),
    tags: z.array(z.enum(tags as [string, ...string[]])),
  });
  try {
    const r = await client.messages.parse({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      system: [{ type: "text", text: "Suggest a category and up to three tags for a community-submitted activity in Montréal. Use only what the text supports. The person will confirm or remove each one.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `TITLE: ${title}\nDESCRIPTION: ${description}` }],
      output_config: { format: zodOutputFormat(Schema) },
    });
    const out = r.parsed_output;
    if (!out) return { category: null, tags: [] };
    return { category: out.category, tags: [...new Set(out.tags)].slice(0, 3) };
  } catch {
    return { category: null, tags: [] };
  }
}

// ------------------------------------------------------------------ submitting

export type SubmitResult =
  | { ok: true; activityId: string; status: "published" | "pending_review" }
  | { ok: false; error: "duplicate"; similar: Similar[] }
  | { ok: false; error: "invalid" | "not_found" | "outside_city" | "contact_details" | "prohibited" | "rate_limited"; issues?: string[] };

export async function submitActivity(
  pool: pg.Pool, client: Anthropic | null, user: { id: string; trustLevel: number },
  raw: unknown, opts: { now: Date; confirmNotDuplicate?: boolean },
): Promise<SubmitResult> {
  const parsed = Submission.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const s = parsed.data;
  const tax = loadTaxonomy();
  const known = new Set(aiAssertableSlugs(tax));
  const issues: string[] = [];
  if (!s.category.startsWith("category.") || !known.has(s.category)) issues.push("category: unknown");
  for (const t of s.tags) if (!known.has(t) || t.startsWith("category.") || t.startsWith("price.")) issues.push(`tags: ${t} is not allowed`);
  if (issues.length) return { ok: false, error: "invalid", issues };

  const recent = await pool.query(`SELECT count(*)::int AS n FROM activities WHERE created_by = $1 AND created_at > $2`,
    [user.id, new Date(opts.now.getTime() - 86_400_000)]);
  if (recent.rows[0].n >= 5) return { ok: false, error: "rate_limited" };

  const text = `${s.title}\n${s.description}\n${s.place?.name ?? ""}`;
  if (hasContactDetails(text)) return { ok: false, error: "contact_details" };
  if (PROHIBITED.test(text)) return { ok: false, error: "prohibited" };

  let lat: number, lon: number, venueName: string;
  if (s.venueId) {
    const v = (await pool.query(`SELECT name, lat, lon FROM venues WHERE id = $1 AND operating_status = 'open'`, [s.venueId])).rows[0];
    if (!v) return { ok: false, error: "not_found" };
    ({ lat, lon } = v); venueName = v.name;
  } else {
    ({ lat, lon } = s.place!); venueName = s.place!.name;
    if (!inMontreal(lat, lon)) return { ok: false, error: "outside_city" };
  }

  if (!opts.confirmNotDuplicate) {
    const similar = await findSimilar(pool, s.title, lat, lon);
    if (similar.length) return { ok: false, error: "duplicate", similar };
  }

  // Layer 2: the same classifier as chat. Doubtful text never publishes on its own.
  let decision = "visible";
  let scores = null;
  if (client) {
    try { scores = await classify(client, text); decision = route(scores); } catch { decision = "flagged"; }
  }
  if (decision === "critical" || decision === "held") return { ok: false, error: "prohibited" };

  const instant = user.trustLevel >= TRUSTED && !!s.venueId && decision === "visible";
  const status = instant ? "published" : "pending_review";

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    let venueId = s.venueId;
    if (!venueId) {
      venueId = (await c.query<{ id: string }>(
        `INSERT INTO venues (name, lat, lon, origin, created_by) VALUES ($1, $2, $3, 'community', $4) RETURNING id`,
        [s.place!.name, lat, lon, user.id])).rows[0]!.id;
    }
    const base = slugify(s.title);
    const taken = new Set((await c.query<{ slug: string }>(`SELECT slug FROM activities WHERE slug = $1 OR slug LIKE $2`, [base, `${base}-%`])).rows.map((r) => r.slug));
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    const cents = s.isFree ? null : s.priceDollars != null ? Math.round(s.priceDollars * 100) : null;
    const id = (await c.query<{ id: string }>(
      `INSERT INTO activities (slug, kind, status, primary_category, price_min_cents, is_free, taxonomy_version, origin, created_by,
                               quality_score, completeness, last_verified_at, risk_tier, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'community', $8, 0.45, 0.3, $9, 0, $10, $10) RETURNING id`,
      [slug, s.kind, status, s.category, cents, s.isFree, tax.version, user.id, instant ? opts.now : null, opts.now])).rows[0]!.id;
    await c.query(`INSERT INTO activity_locations (activity_id, venue_id, is_primary) VALUES ($1, $2, true)`, [id, venueId]);
    await c.query(
      `INSERT INTO activity_content (activity_id, locale, title, description, source) VALUES ($1, $2, $3, $4, 'community')`,
      [id, s.locale, s.title, s.description || null]);
    for (const slugTag of new Set([s.category, ...s.tags])) {
      await c.query(`INSERT INTO activity_tags (activity_id, tag_slug, value, source, confidence) VALUES ($1, $2, true, 'community', 0.8)`, [id, slugTag]);
    }
    await c.query(
      `INSERT INTO activity_revisions (activity_id, author_type, author_id, patch, previous, status) VALUES ($1, 'community', $2, $3, '{}', 'applied')`,
      [id, user.id, JSON.stringify({ created: true, submission: s, moderation: { decision, scores }, venue: venueName })]);
    await c.query("COMMIT");
    return { ok: true, activityId: id, status };
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

/**
 * Trust from track record: 2+ approved submissions and nothing upheld against you → trusted.
 * Recomputed whenever the operator publishes or rejects something.
 */
export async function recomputeTrust(pool: pg.Pool, userId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE a.status = 'published')::int AS ok,
            count(*) FILTER (WHERE a.status = 'removed')::int AS bad
       FROM activities a WHERE a.created_by = $1`, [userId]);
  const { ok, bad } = rows[0];
  const level = bad > 0 ? 0 : ok >= 2 ? TRUSTED : ok >= 1 ? 1 : 0;
  await pool.query(`UPDATE users SET trust_level = GREATEST(trust_level, $2) WHERE id = $1 AND $2 > 0`, [userId, level]);
  if (bad > 0) await pool.query(`UPDATE users SET trust_level = 0 WHERE id = $1`, [userId]);
  return level;
}

export async function rejectSubmission(pool: pg.Pool, activityId: string, note: string): Promise<string | null> {
  const { rows } = await pool.query(
    `UPDATE activities SET status = 'removed', review_note = $2, updated_at = now()
      WHERE id = $1 AND origin = 'community' AND status = 'pending_review' RETURNING created_by`, [activityId, note.slice(0, 500)]);
  const by = rows[0]?.created_by ?? null;
  if (by) await recomputeTrust(pool, by);
  return by;
}

// ------------------------------------------------------------------ the confirmation loop

export async function confirmAccuracy(pool: pg.Pool, userId: string, activityId: string, accurate: boolean, now: Date) {
  // Only people with a reason to know: they saved it or went on an outing there.
  const eligible = await pool.query(
    `SELECT 1 FROM saves WHERE user_id = $1 AND activity_id = $2
     UNION SELECT 1 FROM outing_participants p JOIN outings o ON o.id = p.outing_id
      WHERE p.user_id = $1 AND o.activity_id = $2 AND p.status = 'going'`, [userId, activityId]);
  if (!eligible.rowCount) return { ok: false as const, error: "not_eligible" as const };
  await pool.query(
    `INSERT INTO activity_confirmations (activity_id, user_id, accurate, created_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (activity_id, user_id) DO UPDATE SET accurate = $3, created_at = $4`, [activityId, userId, accurate, now]);
  const since = new Date(now.getTime() - 180 * 86_400_000);
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE accurate)::int AS yes, count(*) FILTER (WHERE NOT accurate)::int AS no
       FROM activity_confirmations WHERE activity_id = $1 AND created_at > $2`, [activityId, since]);
  const { yes, no } = rows[0];
  let effect: "verified" | "flagged" | null = null;
  if (accurate && yes >= 2) {
    await pool.query(`UPDATE activities SET last_verified_at = $2 WHERE id = $1`, [activityId, now]);
    effect = "verified";
  }
  if (!accurate && no >= 2) {
    const open = await pool.query(`SELECT 1 FROM reports WHERE subject_type = 'activity' AND subject_id = $1 AND reason = 'other' AND details = 'two people say this is no longer accurate' AND status = 'open'`, [activityId]);
    if (!open.rowCount) {
      await pool.query(`INSERT INTO reports (subject_type, subject_id, reason, details, severity) VALUES ('activity', $1, 'other', 'two people say this is no longer accurate', 2)`, [activityId]);
    }
    effect = "flagged";
  }
  return { ok: true as const, effect };
}
