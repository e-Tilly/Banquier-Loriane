/**
 * The freshness loop (docs/alentour/02, Stage 4). Stale data is the failure mode that kills
 * catalog apps, and it happens silently, so:
 *
 *  - owners whose listings have not been confirmed in 90 days get one short email a month with a
 *    link to the one-tap "still accurate" button;
 *  - listings unverified for a year are demoted in ranking at export time (catalog/export.ts)
 *    and listed by `npm run admin -- stale` for a human look.
 *
 * These emails are transactional (about an account the owner holds), not commercial, so CASL's
 * consent rules do not apply — but they still stop when the owner removes their listings.
 */
import type pg from "pg";
import type { Mailer } from "../api/mailer.ts";

export const NUDGE_AFTER_DAYS = 90;
export const NUDGE_EVERY_DAYS = 30;
export const STALE_AFTER_DAYS = 365;

export async function sendNudges(pool: pg.Pool, mailer: Mailer, opts: { now?: Date; baseUrl: string; dryRun?: boolean }) {
  const now = opts.now ?? new Date();
  const staleSince = new Date(now.getTime() - NUDGE_AFTER_DAYS * 86_400_000);
  const nudgedSince = new Date(now.getTime() - NUDGE_EVERY_DAYS * 86_400_000);
  const { rows } = await pool.query(
    `SELECT p.id AS provider_id, p.display_name,
            array_agg(DISTINCT u.email) FILTER (WHERE u.email IS NOT NULL) AS emails,
            array_agg(DISTINCT u.locale) AS locales,
            jsonb_agg(DISTINCT jsonb_build_object('id', a.id, 'title', c.title)) AS listings
       FROM providers p
       JOIN provider_members m ON m.provider_id = p.id
       JOIN users u ON u.id = m.user_id AND u.status = 'active'
       JOIN activities a ON a.provider_id = p.id AND a.status = 'published'
       JOIN activity_content c ON c.activity_id = a.id AND c.locale = 'fr-CA'
      WHERE (a.last_verified_at IS NULL OR a.last_verified_at < $1)
        AND (p.last_nudged_at IS NULL OR p.last_nudged_at < $2)
      GROUP BY p.id`, [staleSince, nudgedSince]);

  let sent = 0;
  for (const r of rows) {
    const fr = (r.locales as string[]).some((x) => x?.startsWith("fr")) || !(r.locales as string[]).length;
    const list = (r.listings as { id: string; title: string }[]).map((x) => `• ${x.title} — ${opts.baseUrl}/owner/activities/${x.id}`).join("\n");
    const subject = fr ? `${r.display_name} : est-ce que tout est encore exact ?` : `${r.display_name}: is everything still accurate?`;
    const text = fr
      ? `Bonjour,\n\nÇa fait trois mois qu'on n'a pas confirmé ces fiches sur Alentour :\n\n${list}\n\nSi rien n'a changé, un clic sur « Tout est encore exact » suffit. Sinon, corrigez ce qui a bougé (prix, heures, saison).\n\nMerci !\nAlentour`
      : `Hi,\n\nThese Alentour listings haven't been confirmed in three months:\n\n${list}\n\nIf nothing changed, one click on "Everything is still accurate" is enough. Otherwise, fix what moved (prices, hours, season).\n\nThanks!\nAlentour`;
    if (!opts.dryRun) {
      for (const to of r.emails ?? []) await mailer.send({ to, subject, text });
      await pool.query(`UPDATE providers SET last_nudged_at = $2 WHERE id = $1`, [r.provider_id, now]);
    }
    sent++;
  }
  return { providers: rows.length, sent };
}

/** Published listings nobody has confirmed in a year. */
export async function staleListings(pool: pg.Pool, now = new Date()) {
  const { rows } = await pool.query(
    `SELECT a.id, a.slug, a.origin, a.last_verified_at, c.title, p.display_name AS provider
       FROM activities a
       JOIN activity_content c ON c.activity_id = a.id AND c.locale = 'fr-CA'
       LEFT JOIN providers p ON p.id = a.provider_id
      WHERE a.status = 'published' AND (a.last_verified_at IS NULL OR a.last_verified_at < $1)
      ORDER BY a.last_verified_at NULLS FIRST`, [new Date(now.getTime() - STALE_AFTER_DAYS * 86_400_000)]);
  return rows;
}
