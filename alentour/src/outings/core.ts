/**
 * Outings: the shared rules. Everything here is a constraint that stands in for the moderation
 * team a solo operator does not have (docs/alentour/08):
 *
 *  - 18+ only; phone verification to join; max 8 people;
 *  - venue-anchored only — an outing hangs off a listed venue, never a typed-in address;
 *  - blocks are total, silent, and enforced in the SQL of every read and write;
 *  - an operator switch pauses everything, or just new outings, in one command.
 */
import type pg from "pg";
import { openStateAt } from "../catalog/hours.ts";
import { fromLocal, localDay } from "./time.ts";

export const MAX_GROUP = 8;
export const QUORUM = 3;
export const MIN_AGE = 18;

type Q = pg.Pool | pg.PoolClient;

// ------------------------------------------------------------------ operator switches

export interface OutingSettings { paused: boolean; creationPaused: boolean }

export async function getSettings(pool: Q): Promise<OutingSettings> {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'outings'`);
  return { paused: false, creationPaused: false, ...(rows[0]?.value ?? {}) };
}

export async function setSettings(pool: Q, patch: Partial<OutingSettings>): Promise<OutingSettings> {
  const next = { ...(await getSettings(pool)), ...patch };
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('outings', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`, [JSON.stringify(next)]);
  return next;
}

// ------------------------------------------------------------------ who may take part

export type Missing = "account" | "age" | "phone" | "restricted";

export interface Eligibility { ok: boolean; missing: Missing[] }

/**
 * Year-only birth dates (we never store a full DOB) cannot prove someone turned 18 this year,
 * so eligibility needs both: a birth year at least 18 years back AND an explicit "I am 18 or
 * older" attestation.
 */
export async function eligibility(pool: Q, userId: string, now: Date): Promise<Eligibility> {
  const { rows } = await pool.query(
    `SELECT status, birth_year, adult_attested_at, phone_verified_at, restricted_until FROM users WHERE id = $1`, [userId]);
  const u = rows[0];
  if (!u || u.status !== "active") return { ok: false, missing: ["account"] };
  const missing: Missing[] = [];
  if (!u.birth_year || now.getUTCFullYear() - u.birth_year < MIN_AGE || !u.adult_attested_at) missing.push("age");
  if (!u.phone_verified_at) missing.push("phone");
  if (u.restricted_until && new Date(u.restricted_until) > now) missing.push("restricted");
  return { ok: missing.length === 0, missing };
}

/**
 * SQL: true when $user and anyone attached to outing `o` have blocked each other, in either
 * direction. Used as `AND NOT (${blockedSql("o", "$2")})` — never filtered in JavaScript, where a
 * forgotten check would leak an outing to someone it must stay invisible to.
 */
export function blockedSql(outingAlias: string, userParam: string): string {
  return `EXISTS (SELECT 1 FROM outing_members m JOIN blocks b
            ON (b.blocker_id = ${userParam} AND b.blocked_id = m.user_id)
            OR (b.blocked_id = ${userParam} AND b.blocker_id = m.user_id)
          WHERE m.outing_id = ${outingAlias}.id)`;
}

export async function isBlockedFrom(pool: Q, outingId: string, userId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT ${blockedSql("o", "$2")} AS blocked FROM outings o WHERE o.id = $1`, [outingId, userId]);
  return rows[0]?.blocked === true;
}

// ------------------------------------------------------------------ when to meet

export interface SlotInput { openingHours: string | null; kind: string; durationMinutes: number | null; tz: string }

/**
 * Three candidate times from the venue's REAL opening hours: weekday evenings and weekend
 * afternoons, on distinct days 3–10 days out, only when the place is open for the whole visit.
 * Deterministic — no model decides when people meet.
 */
export function proposeSlots(a: SlotInput, now: Date, count = 3): Date[] {
  const duration = Math.min(a.durationMinutes ?? 120, 180);
  const slots: Date[] = [];
  for (let offset = 3; offset <= 10 && slots.length < count; offset++) {
    const day = localDay(now, a.tz, offset);
    const weekend = day.dow === 0 || day.dow === 6;
    const candidates = weekend ? [[14, 0], [11, 0], [19, 0]] : [[19, 0], [18, 30], [12, 0]];
    for (const [h, m] of candidates) {
      const start = h! * 60 + m!;
      if (!fits(a, day.dow, start, duration)) continue;
      slots.push(fromLocal(day.y, day.m, day.d, h!, m!, a.tz));
      break;
    }
  }
  return slots;
}

function fits(a: SlotInput, dow: number, start: number, duration: number): boolean {
  if (!a.openingHours) return a.kind === "self_guided";     // a trail with no hours is always "open"
  const end = start + duration - 1;
  const endDow = end >= 1440 ? (dow + 1) % 7 : dow;
  return openStateAt(a.openingHours, dow, start) === "open" && openStateAt(a.openingHours, endDow, end % 1440) === "open";
}

/** The facts about an activity every outing needs: its venue, timezone, hours and duration. */
export async function activityFacts(pool: Q, activityId: string) {
  const { rows } = await pool.query(
    `SELECT a.id, a.kind, a.status, a.opening_hours, a.typical_duration_minutes, a.risk_tier, a.provider_id,
            l.venue_id, v.name AS venue_name, v.address->>'line1' AS venue_address, v.timezone, v.lat, v.lon,
            (SELECT jsonb_object_agg(c.locale, jsonb_build_object('title', c.title, 'bring', c.what_to_bring))
               FROM activity_content c WHERE c.activity_id = a.id) AS content,
            a.price_min_cents, a.is_free
       FROM activities a
       JOIN activity_locations l ON l.activity_id = a.id AND l.is_primary
       JOIN venues v ON v.id = l.venue_id
      WHERE a.id = $1`, [activityId]);
  return rows[0] ?? null;
}
