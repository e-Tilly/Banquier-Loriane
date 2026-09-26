/**
 * The outing clock. Run every few minutes by the API process (or a cron):
 *
 *   sessions   generate the next 7 days of venue sessions                 (hourly)
 *   concierge  notice latent demand, open rallies, invite                  (hourly)
 *   nudge      the day before a rally's deadline, remind people who haven't voted
 *   resolve    lock the best time at the deadline, or cancel gently
 *   cards      T−24h logistics, T−2h meeting point, check-in, after
 *   purge      chat deleted 90 days after the outing
 *
 * Every step is idempotent: cards_sent records what went out, statuses gate the rest.
 */
import type pg from "pg";
import { getSettings } from "./core.ts";
import { createRally, generateVenueSessions, resolveRally } from "./outings.ts";
import { cardText, findLatentDemand, pickInvitees, writeInvite, type Facts } from "./concierge.ts";
import { notify } from "./notify.ts";
import { conciergeMessage, outingFacts, type SafetyDeps } from "./safety.ts";

export interface TickResult { sessions: number; rallies: number; resolved: number; cards: number; purged: number }

const HOUR = 3_600_000;

function fmtWhen(d: Date, tz: string): Facts["when"] {
  const f = (locale: string) => new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(d);
  return { fr: f("fr-CA"), en: f("en-CA") };
}

async function hourly(pool: pg.Pool, key: string, now: Date): Promise<boolean> {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  const last = rows[0]?.value?.at ? new Date(rows[0].value.at) : null;
  if (last && now.getTime() - last.getTime() < HOUR) return false;
  await pool.query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, JSON.stringify({ at: now.toISOString() })]);
  return true;
}

async function facts(pool: pg.Pool, outingId: string) {
  const f = await outingFacts(pool, outingId);
  const o = (await pool.query(
    `SELECT o.starts_at, v.timezone, a.price_min_cents, a.is_free,
            (SELECT jsonb_object_agg(c.locale, c.what_to_bring) FROM activity_content c WHERE c.activity_id = a.id) AS bring
       FROM outings o JOIN venues v ON v.id = o.venue_id JOIN activities a ON a.id = o.activity_id WHERE o.id = $1`, [outingId])).rows[0];
  const price = o.is_free ? { fr: "gratuit", en: "free" }
    : o.price_min_cents != null ? { fr: `à partir de ${(o.price_min_cents / 100).toFixed(2).replace(".", ",")} $`, en: `from $${(o.price_min_cents / 100).toFixed(2)}` } : null;
  const bring = o.bring?.["fr-CA"] ? { fr: o.bring["fr-CA"], en: o.bring["en-CA"] ?? o.bring["fr-CA"] } : null;
  return { ...f, when: o.starts_at ? fmtWhen(new Date(o.starts_at), o.timezone) : undefined, price, bring } as Facts & { members: string[] };
}

async function goingIds(pool: pg.Pool, outingId: string, statuses = ["going"]) {
  const { rows } = await pool.query(
    `SELECT user_id FROM outing_participants WHERE outing_id = $1 AND status = ANY($2::text[])`, [outingId, statuses]);
  return rows.map((r) => r.user_id as string);
}

export async function runOutingsTick(pool: pg.Pool, deps: SafetyDeps, now: Date): Promise<TickResult> {
  const out: TickResult = { sessions: 0, rallies: 0, resolved: 0, cards: 0, purged: 0 };
  const settings = await getSettings(pool);

  if (!settings.paused && !settings.creationPaused) {
    if (await hourly(pool, "tick.sessions", now)) out.sessions = await generateVenueSessions(pool, now);
    if (await hourly(pool, "tick.concierge", now)) out.rallies = await runConcierge(pool, deps, now);
  }

  // Nudge: a day before the deadline, invitees who haven't said yes/maybe anywhere.
  const nudge = await pool.query(
    `SELECT id FROM outings WHERE mode = 'rally' AND status = 'voting' AND NOT ('nudge' = ANY(cards_sent))
       AND decision_deadline - interval '24 hours' <= $1::timestamptz AND decision_deadline > $1::timestamptz`, [now]);
  for (const { id } of nudge.rows) {
    const { rows } = await pool.query(
      `SELECT i.user_id FROM outing_invites i WHERE i.outing_id = $1 AND NOT EXISTS (
         SELECT 1 FROM outing_votes v JOIN outing_time_options t ON t.id = v.option_id
          WHERE t.outing_id = $1 AND v.user_id = i.user_id AND v.answer = 'yes')`, [id]);
    await notify(pool, deps.pusher, rows.map((r) => r.user_id), { kind: "nudge", outingId: id, ...cardText("nudge", await facts(pool, id)) });
    await pool.query(`UPDATE outings SET cards_sent = array_append(cards_sent, 'nudge') WHERE id = $1`, [id]);
    out.cards++;
  }

  // Resolve rallies at their deadline.
  const due = await pool.query(`SELECT id FROM outings WHERE mode = 'rally' AND status = 'voting' AND decision_deadline <= $1`, [now]);
  for (const { id } of due.rows) {
    const r = await resolveRally(pool, id, now);
    if (!r) continue;
    out.resolved++;
    const f = await facts(pool, id);
    if (r.outcome === "cancelled") {
      await notify(pool, deps.pusher, r.voters, { kind: "cancelled", outingId: id, ...cardText("cancelled", f) });
    } else {
      await notify(pool, deps.pusher, r.going, { kind: "confirmed", outingId: id, ...cardText("confirmed", f) });
      await notify(pool, deps.pusher, r.maybe, { kind: "confirmed", outingId: id, ...cardText("confirmed", f) });
      await notify(pool, deps.pusher, r.overflow, { kind: "full", outingId: id, ...cardText("full", f) });
      const c = cardText("confirmed", f);
      await conciergeMessage(pool, id, `${c.body.fr}\n\n${c.body.en}`, now);
    }
  }

  // Pre-show and after cards for confirmed outings.
  const cards: [string, string, string][] = [
    ["t24", "starts_at - interval '24 hours' <= $1::timestamptz AND starts_at > $1::timestamptz + interval '2 hours'", "t24"],
    ["t2", "starts_at - interval '2 hours' <= $1::timestamptz AND starts_at > $1::timestamptz", "t2"],
    ["checkin", "starts_at - interval '15 minutes' <= $1::timestamptz AND starts_at + interval '1 hour' > $1::timestamptz", "checkin"],
  ];
  for (const [card, when] of cards) {
    const { rows } = await pool.query(
      `SELECT id FROM outings WHERE status = 'confirmed' AND mode <> 'venue_session' AND NOT ($2 = ANY(cards_sent)) AND ${when}`, [now, card]);
    for (const { id } of rows) {
      const f = await facts(pool, id);
      const c = cardText(card as "t24", f);
      await notify(pool, deps.pusher, await goingIds(pool, id), { kind: card, outingId: id, ...c });
      await conciergeMessage(pool, id, `${c.body.fr}\n\n${c.body.en}`, now);
      await pool.query(`UPDATE outings SET cards_sent = array_append(cards_sent, $2) WHERE id = $1`, [id, card]);
      out.cards++;
    }
  }
  // Venue sessions get the day-before reminder only, for people who joined.
  const sessions = await pool.query(
    `SELECT o.id FROM outings o WHERE o.status = 'confirmed' AND o.mode = 'venue_session' AND NOT ('t24' = ANY(o.cards_sent))
        AND o.starts_at - interval '24 hours' <= $1::timestamptz AND o.starts_at > $1::timestamptz
        AND EXISTS (SELECT 1 FROM outing_participants p WHERE p.outing_id = o.id AND p.status = 'going')`, [now]);
  for (const { id } of sessions.rows) {
    await notify(pool, deps.pusher, await goingIds(pool, id), { kind: "t24", outingId: id, ...cardText("t24", await facts(pool, id)) });
    await pool.query(`UPDATE outings SET cards_sent = array_append(cards_sent, 't24') WHERE id = $1`, [id]);
    out.cards++;
  }

  // After: rate it, and the outing is complete.
  const ended = await pool.query(
    `SELECT id FROM outings WHERE status = 'confirmed' AND COALESCE(ends_at, starts_at + interval '3 hours') + interval '1 hour' <= $1::timestamptz`, [now]);
  for (const { id } of ended.rows) {
    const going = await goingIds(pool, id);
    if (going.length) await notify(pool, deps.pusher, going, { kind: "after", outingId: id, ...cardText("after", await facts(pool, id)) });
    await pool.query(`UPDATE outings SET status = 'completed', cards_sent = array_append(cards_sent, 'after'), updated_at = $2 WHERE id = $1`, [id, now]);
    out.cards++;
  }

  // Purge chat 90 days after the outing.
  const purge = await pool.query(
    `WITH old AS (SELECT id FROM outings WHERE purged_at IS NULL AND starts_at < $1::timestamptz - interval '90 days'),
          del AS (DELETE FROM outing_messages m USING old WHERE m.outing_id = old.id RETURNING m.id)
     UPDATE outings SET purged_at = $1 WHERE id IN (SELECT id FROM old) RETURNING id`, [now]);
  out.purged = purge.rowCount ?? 0;
  return out;
}

/** Open a rally for each activity with latent demand, and invite the people who saved it. */
export async function runConcierge(pool: pg.Pool, deps: SafetyDeps, now: Date): Promise<number> {
  let n = 0;
  for (const d of await findLatentDemand(pool, now)) {
    const invitees = await pickInvitees(pool, d.users);
    if (invitees.length < 4) continue;
    const r = await createRally(pool, { activityId: d.activity_id, organizer: "concierge", invitees, now });
    if (!r.ok) continue;
    n++;
    const f = await facts(pool, r.outingId);
    const invite = await writeInvite(deps.client ?? null, { ...f, savers: d.users.length });
    await notify(pool, deps.pusher, invitees, { kind: "invite", outingId: r.outingId, title: invite.title, body: invite.body });
  }
  return n;
}

export function startOutingsClock(pool: pg.Pool, deps: SafetyDeps, intervalMs = 60_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runOutingsTick(pool, deps, new Date()); } catch (err) { console.error("outings tick:", (err as Error).message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return { stop: () => clearInterval(timer) };
}
