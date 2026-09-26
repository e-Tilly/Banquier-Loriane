/** Demand detection: find venues that people are saving but can't actually book. */
import type { Pool } from "pg";
import type { DemandSignal, TimeSlot } from "./types.ts";
import { RULES } from "./consent.ts";

/**
 * Venues with enough recent save activity to be worth writing about.
 *
 * Deliberately excludes venues that already publish sessions — the pitch is "your customers
 * can't act on this", which is false if they already can.
 */
const FIND_DEMAND = `
WITH recent AS (
  SELECT al.venue_id,
         s.activity_id,
         s.user_id,
         s.created_at
  FROM saves s
  JOIN activity_locations al ON al.activity_id = s.activity_id
  WHERE s.created_at > now() - ($1 || ' days')::interval
),
agg AS (
  SELECT venue_id,
         count(DISTINCT user_id)::int AS distinct_users,
         count(*)::int                AS saves_count,
         mode() WITHIN GROUP (ORDER BY activity_id) AS top_activity_id
  FROM recent
  GROUP BY venue_id
)
SELECT a.venue_id,
       v.name  AS venue_name,
       a.distinct_users,
       a.saves_count,
       a.top_activity_id,
       ac.title AS activity_title
FROM agg a
JOIN venues v ON v.id = a.venue_id
LEFT JOIN activity_content ac
       ON ac.activity_id = a.top_activity_id AND ac.locale = $4
WHERE a.distinct_users >= $2
  AND a.saves_count   >= $3
  AND v.operating_status = 'open'
  -- nothing to pitch if they already run sessions
  AND NOT EXISTS (
    SELECT 1 FROM outings o
    WHERE o.venue_id = a.venue_id
      AND o.mode = 'venue_session'
      AND o.starts_at > now()
  )
ORDER BY a.distinct_users DESC, a.saves_count DESC
LIMIT $5;
`;

/**
 * When the interested users are plausibly free.
 *
 * Stage 1–4 have no availability data, so this is derived from when they saved — a weak
 * proxy, but an honest one, and the message only ever says "this is when people looked",
 * never "this is when they're free".
 */
const SLOT_QUERY = `
SELECT EXTRACT(DOW FROM s.created_at AT TIME ZONE v.timezone)::int  AS weekday,
       EXTRACT(HOUR FROM s.created_at AT TIME ZONE v.timezone)::int AS hour,
       count(*)::int                                                AS weight
FROM saves s
JOIN activity_locations al ON al.activity_id = s.activity_id
JOIN venues v ON v.id = al.venue_id
WHERE al.venue_id = $1
  AND s.created_at > now() - ($2 || ' days')::interval
GROUP BY 1, 2
HAVING count(*) >= 2
ORDER BY weight DESC
LIMIT 3;
`;

/** Rallies at this venue that found no time: people wanted to go and could not get a group. */
const FAILED_RALLIES_QUERY = `
SELECT count(*)::int AS n FROM outings
 WHERE venue_id = $1 AND mode = 'rally' AND status = 'cancelled' AND cancel_reason = 'no_quorum'
   AND created_at > now() - ($2 || ' days')::interval;
`;

const SEGMENT_QUERY = `
SELECT count(DISTINCT s.user_id) FILTER (WHERE u.trust_level = 0)::int   AS new_to_app,
       count(DISTINCT s.user_id) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM outings o2 WHERE o2.host_user_id = s.user_id)
       )::int                                                            AS never_hosted
FROM saves s
JOIN users u ON u.id = s.user_id
JOIN activity_locations al ON al.activity_id = s.activity_id
WHERE al.venue_id = $1
  AND s.created_at > now() - ($2 || ' days')::interval;
`;

export interface FindDemandOptions {
  windowDays?: number;
  locale?: string;
  limit?: number;
}

export async function findDemandSignals(
  pool: Pool,
  opts: FindDemandOptions = {},
): Promise<Omit<DemandSignal, "id">[]> {
  const windowDays = opts.windowDays ?? 30;
  const locale = opts.locale ?? "fr-CA";
  const limit = opts.limit ?? 50;

  const { rows } = await pool.query(FIND_DEMAND, [
    windowDays, RULES.minDistinctUsers, RULES.minSaves, locale, limit,
  ]);

  const signals: Omit<DemandSignal, "id">[] = [];
  for (const row of rows) {
    const [slots, segments, failed] = await Promise.all([
      pool.query(SLOT_QUERY, [row.venue_id, windowDays]),
      pool.query(SEGMENT_QUERY, [row.venue_id, windowDays]),
      pool.query(FAILED_RALLIES_QUERY, [row.venue_id, windowDays]),
    ]);

    signals.push({
      venueId: row.venue_id,
      venueName: row.venue_name,
      activityId: row.top_activity_id ?? null,
      activityTitle: row.activity_title ?? null,
      windowDays,
      distinctUsers: row.distinct_users,
      savesCount: row.saves_count,
      failedRallies: failed.rows[0]?.n ?? 0,
      topSlots: slots.rows as TimeSlot[],
      segments: stripZeros(segments.rows[0] ?? {}),
      computedAt: new Date(),
    });
  }
  return signals;
}

/** A segment of zero is not a fact worth handing to a model. */
function stripZeros(row: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "number" && v > 0) out[k] = v;
  }
  return out;
}
