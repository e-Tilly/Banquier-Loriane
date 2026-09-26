/**
 * Outing operations. Three kinds, all venue-anchored (docs/alentour/06):
 *
 *   venue_session  a program the venue runs anyway (trivia night, beginner climb). No quorum,
 *                  no host: the venue is the host. The default, and the safest.
 *   rally          three proposed times, invitees vote, the best-supported time with at least
 *                  three "yes" locks at the deadline — or it quietly cancels.
 *   fixed          a person proposes one time at a listed venue and hosts it.
 *
 * Capacity is counted under a row lock on the outing, so two people cannot take the last spot.
 */
import type pg from "pg";
import { openStateAt } from "../catalog/hours.ts";
import {
  MAX_GROUP, QUORUM, activityFacts, blockedSql, eligibility, getSettings, proposeSlots, type Missing,
} from "./core.ts";
import { localDay, fromLocal, localParts } from "./time.ts";
import { openSpansOn } from "../catalog/hours.ts";

export type Fail =
  | { ok: false; error: "not_found" | "paused" | "closed" | "full" | "not_invited" | "rate_limited" | "invalid" | "too_risky" | "no_slots"; detail?: string }
  | { ok: false; error: "ineligible"; missing: Missing[] };
type Q = pg.Pool | pg.PoolClient;

async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

// ------------------------------------------------------------------ creating

export async function createRally(
  pool: pg.Pool,
  o: { activityId: string; organizer: "user" | "concierge"; hostUserId?: string | null; invitees: string[]; now: Date },
): Promise<{ ok: true; outingId: string; options: Date[] } | Fail> {
  const a = await activityFacts(pool, o.activityId);
  if (!a || a.status !== "published") return { ok: false, error: "not_found" };
  // Risk tier 2+ needs waivers and verified hosts; 3 cannot be community-organized at all.
  if (a.risk_tier >= 2) return { ok: false, error: "too_risky" };
  const options = proposeSlots({ openingHours: a.opening_hours, kind: a.kind, durationMinutes: a.typical_duration_minutes, tz: a.timezone }, o.now);
  if (options.length < 2) return { ok: false, error: "no_slots" };
  const deadline = new Date(Math.min(o.now.getTime() + 48 * 3_600_000, options[0]!.getTime() - 24 * 3_600_000));

  const outingId = await tx(pool, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO outings (activity_id, venue_id, host_user_id, mode, organizer, status, capacity_min, capacity_max, decision_deadline, created_at, updated_at)
       VALUES ($1, $2, $3, 'rally', $4, 'voting', $5, $6, $7, $8, $8) RETURNING id`,
      [a.id, a.venue_id, o.organizer === "user" ? o.hostUserId : null, o.organizer, QUORUM, MAX_GROUP, deadline, o.now]);
    const id = rows[0]!.id;
    const optionIds: string[] = [];
    for (const [i, t] of options.entries()) {
      const r = await c.query<{ id: string }>(`INSERT INTO outing_time_options (outing_id, starts_at, position) VALUES ($1, $2, $3) RETURNING id`, [id, t, i]);
      optionIds.push(r.rows[0]!.id);
    }
    for (const u of new Set(o.invitees)) {
      await c.query(`INSERT INTO outing_invites (outing_id, user_id, reason) VALUES ($1, $2, 'saved') ON CONFLICT DO NOTHING`, [id, u]);
    }
    if (o.organizer === "user" && o.hostUserId) {
      await c.query(
        `INSERT INTO outing_invites (outing_id, user_id, reason) VALUES ($1, $2, 'proposer')
         ON CONFLICT (outing_id, user_id) DO UPDATE SET reason = 'proposer'`, [id, o.hostUserId]);
      for (const opt of optionIds) {
        await c.query(`INSERT INTO outing_votes (option_id, user_id, answer, updated_at) VALUES ($1, $2, 'yes', $3)`, [opt, o.hostUserId, o.now]);
      }
    }
    return id;
  });
  return { ok: true, outingId, options };
}

/** A person proposes a rally for something they saved; others who saved it are invited. */
export async function proposeRally(pool: pg.Pool, userId: string, activityId: string, now: Date, invitees: string[]) {
  const guard = await creationGuard(pool, userId, now);
  if (guard) return guard;
  return createRally(pool, { activityId, organizer: "user", hostUserId: userId, invitees, now });
}

export async function createFixed(pool: pg.Pool, userId: string, activityId: string, startsAt: Date, now: Date, capacityMax = MAX_GROUP) {
  const guard = await creationGuard(pool, userId, now);
  if (guard) return guard;
  const a = await activityFacts(pool, activityId);
  if (!a || a.status !== "published") return { ok: false, error: "not_found" } as Fail;
  if (a.risk_tier >= 2) return { ok: false, error: "too_risky" } as Fail;
  const lead = startsAt.getTime() - now.getTime();
  if (lead < 2 * 3_600_000 || lead > 30 * 86_400_000) return { ok: false, error: "invalid", detail: "starts_at must be 2 hours to 30 days away" } as Fail;
  const l = localParts(startsAt, a.timezone);
  const open = openStateAt(a.opening_hours, l.dow, l.h * 60 + l.min);
  if (open === "closed" || (open === "unknown" && a.kind !== "self_guided")) {
    return { ok: false, error: "invalid", detail: "the venue is not open then" } as Fail;
  }
  const cap = Math.max(QUORUM, Math.min(MAX_GROUP, capacityMax));
  const id = await tx(pool, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO outings (activity_id, venue_id, host_user_id, mode, organizer, status, starts_at, ends_at, capacity_min, capacity_max, created_at, updated_at)
       VALUES ($1, $2, $3, 'fixed', 'user', 'confirmed', $4, $5, 2, $6, $7, $7) RETURNING id`,
      [a.id, a.venue_id, userId, startsAt, new Date(startsAt.getTime() + (a.typical_duration_minutes ?? 120) * 60_000), cap, now]);
    await c.query(`INSERT INTO outing_participants (outing_id, user_id, status, joined_at) VALUES ($1, $2, 'going', $3)`, [rows[0]!.id, userId, now]);
    return rows[0]!.id;
  });
  return { ok: true as const, outingId: id };
}

async function creationGuard(pool: pg.Pool, userId: string, now: Date): Promise<Fail | null> {
  const s = await getSettings(pool);
  if (s.paused || s.creationPaused) return { ok: false, error: "paused" };
  const e = await eligibility(pool, userId, now);
  if (!e.ok) return { ok: false, error: "ineligible", missing: e.missing };
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM outings WHERE host_user_id = $1 AND created_at > $2`, [userId, new Date(now.getTime() - 7 * 86_400_000)]);
  if (rows[0].n >= 3) return { ok: false, error: "rate_limited" };
  return null;
}

/**
 * Sessions for programs venues run anyway, for the next `days` days: one per day the program
 * runs, starting when it opens. Idempotent (unique on activity + start).
 */
export async function generateVenueSessions(pool: pg.Pool, now: Date, days = 7): Promise<number> {
  const { rows } = await pool.query(
    `SELECT a.id, a.provider_id, a.opening_hours, a.typical_duration_minutes, l.venue_id, v.timezone
       FROM activities a
       JOIN activity_locations l ON l.activity_id = a.id AND l.is_primary
       JOIN venues v ON v.id = l.venue_id AND v.operating_status = 'open'
      WHERE a.status = 'published' AND a.kind = 'recurring_program' AND a.opening_hours IS NOT NULL AND a.risk_tier < 3`);
  let created = 0;
  for (const a of rows) {
    for (let d = 0; d < days; d++) {
      const day = localDay(now, a.timezone, d);
      const span = openSpansOn(a.opening_hours, day.dow)[0];
      if (!span) continue;
      const starts = fromLocal(day.y, day.m, day.d, Math.floor(span.from / 60), span.from % 60, a.timezone);
      if (starts.getTime() < now.getTime() + 3_600_000) continue;
      const ends = new Date(starts.getTime() + Math.min(a.typical_duration_minutes ?? 120, span.to - span.from) * 60_000);
      const r = await pool.query(
        `INSERT INTO outings (activity_id, venue_id, host_provider_id, mode, organizer, status, starts_at, ends_at, capacity_min, capacity_max, created_at, updated_at)
         VALUES ($1, $2, $3, 'venue_session', 'venue', 'confirmed', $4, $5, 2, $6, $7, $7)
         ON CONFLICT (activity_id, starts_at) WHERE mode = 'venue_session' DO NOTHING`,
        [a.id, a.venue_id, a.provider_id, starts, ends, MAX_GROUP, now]);
      created += r.rowCount ?? 0;
    }
  }
  return created;
}

// ------------------------------------------------------------------ taking part

export async function vote(
  pool: pg.Pool, userId: string, outingId: string, answers: Record<string, "yes" | "maybe" | "no">, now: Date,
): Promise<{ ok: true } | Fail> {
  const e = await eligibility(pool, userId, now);
  if (!e.ok) return { ok: false, error: "ineligible", missing: e.missing };
  if ((await getSettings(pool)).paused) return { ok: false, error: "paused" };
  return tx(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT o.*, ${blockedSql("o", "$2")} AS blocked,
              EXISTS (SELECT 1 FROM outing_invites i WHERE i.outing_id = o.id AND i.user_id = $2) AS invited
         FROM outings o WHERE o.id = $1 FOR UPDATE OF o`, [outingId, userId]);
    const o = rows[0];
    if (!o || o.blocked || o.mode !== "rally") return { ok: false, error: "not_found" } as Fail;
    if (!o.invited) return { ok: false, error: "not_found" } as Fail;   // a rally is invisible to non-invitees
    if (o.status === "paused") return { ok: false, error: "paused" } as Fail;
    if (o.status !== "voting" || new Date(o.decision_deadline) <= now) return { ok: false, error: "closed" } as Fail;
    const opts = (await c.query(`SELECT id FROM outing_time_options WHERE outing_id = $1`, [outingId])).rows.map((r) => r.id);
    for (const [optionId, answer] of Object.entries(answers)) {
      if (!opts.includes(optionId) || !["yes", "maybe", "no"].includes(answer)) return { ok: false, error: "invalid" } as Fail;
    }
    for (const [optionId, answer] of Object.entries(answers)) {
      await c.query(
        `INSERT INTO outing_votes (option_id, user_id, answer, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (option_id, user_id) DO UPDATE SET answer = $3, updated_at = $4`, [optionId, userId, answer, now]);
    }
    return { ok: true } as const;
  });
}

export async function join(pool: pg.Pool, userId: string, outingId: string, now: Date): Promise<{ ok: true; status: "going" } | Fail> {
  const e = await eligibility(pool, userId, now);
  if (!e.ok) return { ok: false, error: "ineligible", missing: e.missing };
  if ((await getSettings(pool)).paused) return { ok: false, error: "paused" };
  const recent = await pool.query(
    `SELECT count(*)::int AS n FROM outing_participants WHERE user_id = $1 AND joined_at > $2 AND status = 'going'`,
    [userId, new Date(now.getTime() - 86_400_000)]);
  if (recent.rows[0].n >= 5) return { ok: false, error: "rate_limited" };
  return tx(pool, async (c) => {
    const { rows } = await c.query(
      `SELECT o.*, ${blockedSql("o", "$2")} AS blocked,
              EXISTS (SELECT 1 FROM outing_invites i WHERE i.outing_id = o.id AND i.user_id = $2) AS invited
         FROM outings o WHERE o.id = $1 FOR UPDATE OF o`, [outingId, userId]);
    const o = rows[0];
    if (!o || o.blocked) return { ok: false, error: "not_found" } as Fail;
    if (o.mode === "rally" && !o.invited) return { ok: false, error: "not_found" } as Fail;
    if (o.status === "paused") return { ok: false, error: "paused" } as Fail;
    if (o.status !== "confirmed" || new Date(o.starts_at) <= now) return { ok: false, error: "closed" } as Fail;
    const going = (await c.query(
      `SELECT count(*)::int AS n FROM outing_participants WHERE outing_id = $1 AND status = 'going' AND user_id <> $2`, [outingId, userId])).rows[0].n;
    if (going >= o.capacity_max) return { ok: false, error: "full" } as Fail;
    await c.query(
      `INSERT INTO outing_participants (outing_id, user_id, status, joined_at) VALUES ($1, $2, 'going', $3)
       ON CONFLICT (outing_id, user_id) DO UPDATE SET status = 'going', joined_at = $3`, [outingId, userId, now]);
    return { ok: true, status: "going" } as const;
  });
}

export async function leave(pool: pg.Pool, userId: string, outingId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE outing_participants SET status = 'left' WHERE outing_id = $1 AND user_id = $2 AND status IN ('going', 'maybe')`, [outingId, userId]);
  return (r.rowCount ?? 0) > 0;
}

export async function checkIn(pool: pg.Pool, userId: string, outingId: string, now: Date): Promise<boolean> {
  const r = await pool.query(
    `UPDATE outing_participants p SET checked_in_at = COALESCE(checked_in_at, $3)
       FROM outings o
      WHERE p.outing_id = o.id AND o.id = $1 AND p.user_id = $2 AND p.status = 'going' AND o.status = 'confirmed'
        AND $3 BETWEEN o.starts_at - interval '30 minutes' AND COALESCE(o.ends_at, o.starts_at + interval '3 hours')`,
    [outingId, userId, now]);
  return (r.rowCount ?? 0) > 0;
}

export async function feedback(pool: pg.Pool, userId: string, outingId: string, rating: number, again: boolean, now: Date): Promise<boolean> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return false;
  const r = await pool.query(
    `UPDATE outing_participants p SET rating = $3, would_repeat = $4 FROM outings o
      WHERE p.outing_id = o.id AND o.id = $1 AND p.user_id = $2 AND p.status = 'going' AND o.starts_at < $5`,
    [outingId, userId, rating, again, now]);
  return (r.rowCount ?? 0) > 0;
}

// ------------------------------------------------------------------ resolving rallies

export interface Tally { optionId: string; startsAt: Date; yes: string[]; maybe: string[] }

/** Score = 2·yes + maybe; only options with at least QUORUM yes can win. Earliest wins ties. */
export function pickOption(tallies: Tally[]): Tally | null {
  const viable = tallies.filter((t) => t.yes.length >= QUORUM);
  if (!viable.length) return null;
  return viable.sort((a, b) => (2 * b.yes.length + b.maybe.length) - (2 * a.yes.length + a.maybe.length)
    || a.startsAt.getTime() - b.startsAt.getTime())[0]!;
}

export type Resolution =
  | { outcome: "confirmed"; outingId: string; startsAt: Date; going: string[]; maybe: string[]; overflow: string[] }
  | { outcome: "cancelled"; outingId: string; voters: string[] };

export async function resolveRally(pool: pg.Pool, outingId: string, now: Date): Promise<Resolution | null> {
  return tx(pool, async (c) => {
    const o = (await c.query(`SELECT * FROM outings WHERE id = $1 FOR UPDATE`, [outingId])).rows[0];
    if (!o || o.mode !== "rally" || o.status !== "voting" || new Date(o.decision_deadline) > now) return null;
    // Only votes from people still eligible count: a vote is a promise to show up.
    const { rows } = await c.query(
      `SELECT t.id, t.starts_at, v.user_id, v.answer
         FROM outing_time_options t
         LEFT JOIN outing_votes v ON v.option_id = t.id AND v.answer <> 'no'
         LEFT JOIN users u ON u.id = v.user_id
        WHERE t.outing_id = $1 AND (v.user_id IS NULL OR (u.status = 'active' AND u.phone_verified_at IS NOT NULL
              AND (u.restricted_until IS NULL OR u.restricted_until < $2)))
        ORDER BY t.position, v.updated_at`, [outingId, now]);
    const tallies = new Map<string, Tally>();
    for (const r of rows) {
      if (!tallies.has(r.id)) tallies.set(r.id, { optionId: r.id, startsAt: new Date(r.starts_at), yes: [], maybe: [] });
      if (r.user_id) tallies.get(r.id)![r.answer === "yes" ? "yes" : "maybe"].push(r.user_id);
    }
    const voters = [...new Set(rows.filter((r) => r.user_id).map((r) => r.user_id as string))];
    const best = pickOption([...tallies.values()]);
    if (!best) {
      await c.query(`UPDATE outings SET status = 'cancelled', cancel_reason = 'no_quorum', updated_at = $2 WHERE id = $1`, [outingId, now]);
      return { outcome: "cancelled", outingId, voters };
    }
    const going = best.yes.slice(0, o.capacity_max);
    const overflow = best.yes.slice(o.capacity_max);
    const maybe = best.maybe.filter((u) => !going.includes(u));
    const a = (await c.query(`SELECT typical_duration_minutes FROM activities WHERE id = $1`, [o.activity_id])).rows[0];
    await c.query(
      `UPDATE outings SET status = 'confirmed', starts_at = $2, ends_at = $3, updated_at = $4 WHERE id = $1`,
      [outingId, best.startsAt, new Date(best.startsAt.getTime() + (a?.typical_duration_minutes ?? 120) * 60_000), now]);
    for (const u of going) {
      await c.query(`INSERT INTO outing_participants (outing_id, user_id, status, joined_at) VALUES ($1, $2, 'going', $3) ON CONFLICT DO NOTHING`, [outingId, u, now]);
    }
    for (const u of maybe) {
      await c.query(`INSERT INTO outing_participants (outing_id, user_id, status, joined_at) VALUES ($1, $2, 'maybe', $3) ON CONFLICT DO NOTHING`, [outingId, u, now]);
    }
    return { outcome: "confirmed", outingId, startsAt: best.startsAt, going, maybe, overflow };
  });
}

// ------------------------------------------------------------------ reading

/** Outings this user may see: public (sessions, fixed) or theirs (invited, member), never blocked. */
export async function listOutings(pool: Q, userId: string, now: Date, opts: { activityId?: string; mine?: boolean } = {}) {
  const { rows } = await pool.query(
    `SELECT o.id, o.mode, o.organizer, o.status, o.starts_at, o.ends_at, o.decision_deadline, o.capacity_max,
            o.activity_id, v.name AS venue_name, v.id AS venue_id,
            (SELECT count(*)::int FROM outing_participants p WHERE p.outing_id = o.id AND p.status = 'going') AS going,
            (SELECT p.status FROM outing_participants p WHERE p.outing_id = o.id AND p.user_id = $1) AS my_status,
            EXISTS (SELECT 1 FROM outing_invites i WHERE i.outing_id = o.id AND i.user_id = $1) AS invited,
            o.host_user_id = $1 AS hosting
       FROM outings o JOIN venues v ON v.id = o.venue_id
      WHERE o.status IN ('voting', 'confirmed', 'paused')
        AND (o.starts_at IS NULL OR o.starts_at > $2::timestamptz - interval '3 hours')
        AND (o.starts_at IS NULL OR o.starts_at < $2::timestamptz + interval '14 days')
        AND ($3::uuid IS NULL OR o.activity_id = $3)
        AND (
          (o.mode IN ('venue_session', 'fixed') AND o.status = 'confirmed' AND NOT $4::boolean)
          OR EXISTS (SELECT 1 FROM outing_invites i WHERE i.outing_id = o.id AND i.user_id = $1)
          OR EXISTS (SELECT 1 FROM outing_participants p WHERE p.outing_id = o.id AND p.user_id = $1 AND p.status IN ('going', 'maybe'))
        )
        AND NOT ${blockedSql("o", "$1")}
      ORDER BY COALESCE(o.starts_at, o.decision_deadline)
      LIMIT 100`, [userId, now, opts.activityId ?? null, opts.mine ?? false]);
  return rows;
}

export async function outingDetail(pool: Q, userId: string, outingId: string, now: Date = new Date()) {
  const { rows } = await pool.query(
    `SELECT o.*, v.name AS venue_name, v.address->>'line1' AS venue_address, v.lat, v.lon, v.timezone,
            (SELECT count(*)::int FROM outing_participants p WHERE p.outing_id = o.id AND p.status = 'going') AS going,
            (SELECT p.status FROM outing_participants p WHERE p.outing_id = o.id AND p.user_id = $2) AS my_status,
            (SELECT p.checked_in_at FROM outing_participants p WHERE p.outing_id = o.id AND p.user_id = $2) AS my_checkin,
            EXISTS (SELECT 1 FROM outing_invites i WHERE i.outing_id = o.id AND i.user_id = $2) AS invited,
            ${blockedSql("o", "$2")} AS blocked
       FROM outings o JOIN venues v ON v.id = o.venue_id WHERE o.id = $1`, [outingId, userId]);
  const o = rows[0];
  if (!o || o.blocked) return null;
  const isPublic = (o.mode === "venue_session" || o.mode === "fixed") && ["confirmed", "paused", "completed"].includes(o.status);
  const member = o.invited || o.my_status === "going" || o.my_status === "maybe" || o.host_user_id === userId;
  if (!isPublic && !member) return null;
  const options = o.mode === "rally" ? (await pool.query(
    `SELECT t.id, t.starts_at,
            count(*) FILTER (WHERE v.answer = 'yes')::int AS yes,
            count(*) FILTER (WHERE v.answer = 'maybe')::int AS maybe,
            max(v.answer) FILTER (WHERE v.user_id = $2) AS mine
       FROM outing_time_options t LEFT JOIN outing_votes v ON v.option_id = t.id
      WHERE t.outing_id = $1 GROUP BY t.id ORDER BY t.position`, [outingId, userId])).rows : [];
  return {
    id: o.id, mode: o.mode, organizer: o.organizer, status: o.status, activityId: o.activity_id,
    startsAt: o.starts_at, endsAt: o.ends_at, decisionDeadline: o.decision_deadline,
    capacity: o.capacity_max, quorum: o.capacity_min, going: o.going,
    venue: { id: o.venue_id, name: o.venue_name, address: o.venue_address, lat: o.lat, lon: o.lon },
    me: { status: o.my_status, invited: o.invited, hosting: o.host_user_id === userId, checkedIn: !!o.my_checkin },
    options,
    chatOpen: chatOpen(o, now) && (o.my_status === "going" || o.my_status === "maybe" || o.host_user_id === userId),
    pausedReason: o.status === "paused" ? "report" : null,
  };
}

export function chatOpen(o: { status: string; starts_at: Date | null; purged_at?: Date | null }, now: Date): boolean {
  if (o.status !== "confirmed" || !o.starts_at || o.purged_at) return false;
  return now.getTime() < new Date(o.starts_at).getTime() + 48 * 3_600_000;
}
