/**
 * /v1/outings — venue sessions, rallies and hosted outings. Every read and write goes through
 * src/outings, where blocks, eligibility, capacity and the operator's pause switch are enforced.
 * A blocked outing answers 404, exactly like one that does not exist: blocks give no signal.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../context.ts";
import { parseBody, UUID_RE } from "../http.ts";
import { requireUser } from "../middleware.ts";
import { eligibility, getSettings, MIN_AGE, QUORUM } from "../../outings/core.ts";
import {
  checkIn, createFixed, feedback, join, leave, listOutings, outingDetail, proposeRally, vote, type Fail,
} from "../../outings/outings.ts";
import { pickInvitees } from "../../outings/concierge.ts";
import { blockUser, listMessages, postMessage, type SafetyDeps } from "../../outings/safety.ts";

export function safetyDeps(d: Deps): SafetyDeps {
  return { client: d.enrich?.client ?? null, pusher: d.pusher, mailer: d.mailer, operatorEmail: d.operatorEmail ?? null };
}

const STATUS: Record<string, number> = {
  not_found: 404, ineligible: 403, not_invited: 403, paused: 423, closed: 409, full: 409,
  rate_limited: 429, invalid: 400, too_risky: 422, no_slots: 422,
};
function fail(c: Context<AppEnv>, f: Fail) {
  return c.json({ error: f.error, ...("missing" in f ? { missing: f.missing } : {}), ...("detail" in f && f.detail ? { detail: f.detail } : {}) },
    (STATUS[f.error] ?? 400) as 400);
}

const Propose = z.object({
  activityId: z.string().regex(UUID_RE),
  mode: z.enum(["rally", "fixed"]),
  startsAt: z.string().datetime({ offset: true }).optional(),
  capacity: z.number().int().min(3).max(8).optional(),
});
const Votes = z.object({ answers: z.record(z.string().regex(UUID_RE), z.enum(["yes", "maybe", "no"])) });
const Message = z.object({ body: z.string().max(2000) });
const Feedback = z.object({ rating: z.number().int().min(1).max(5), again: z.boolean() });

export function outingRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => (d.now ? d.now() : new Date());
  app.use("*", requireUser);

  const id = (c: Context<AppEnv>) => {
    const v = c.req.param("id");
    return v && UUID_RE.test(v) ? v : null;
  };

  /** What the app needs to decide which screen to show: may this person take part, and is the feature on? */
  app.get("/eligibility", async (c) => {
    const u = c.get("user")!;
    const [e, s, profile] = await Promise.all([
      eligibility(d.pool, u.id, now()), getSettings(d.pool),
      d.pool.query(`SELECT outings_opt_in, phone_e164, birth_year, adult_attested_at FROM users WHERE id = $1`, [u.id]),
    ]);
    const p = profile.rows[0];
    return c.json({
      ...e, minAge: MIN_AGE, paused: s.paused, creationPaused: s.creationPaused,
      optIn: p.outings_opt_in, birthYear: p.birth_year, adultAttested: !!p.adult_attested_at,
      phone: p.phone_e164 ? `•••-•••-${p.phone_e164.slice(-4)}` : null,
    });
  });

  app.get("/", async (c) => {
    const u = c.get("user")!;
    if ((await getSettings(d.pool)).paused) return c.json({ outings: [], paused: true });
    const activityId = c.req.query("activityId");
    if (activityId && !UUID_RE.test(activityId)) return c.json({ error: "invalid" }, 400);
    const rows = await listOutings(d.pool, u.id, now(), { activityId, mine: c.req.query("mine") === "1" });
    return c.json({
      paused: false,
      outings: rows.map((o: any) => ({
        id: o.id, mode: o.mode, organizer: o.organizer, status: o.status, activityId: o.activity_id,
        startsAt: o.starts_at, decisionDeadline: o.decision_deadline, capacity: o.capacity_max,
        going: o.going, venue: { id: o.venue_id, name: o.venue_name },
        me: { status: o.my_status, invited: o.invited, hosting: o.hosting },
      })),
    });
  });

  app.post("/", async (c) => {
    const u = c.get("user")!;
    const body = await parseBody(c, Propose);
    if (!body.ok) return body.response;
    const { activityId, mode, startsAt, capacity } = body.data;
    if (mode === "fixed") {
      if (!startsAt) return c.json({ error: "invalid", detail: "startsAt is required" }, 400);
      const r = await createFixed(d.pool, u.id, activityId, new Date(startsAt), now(), capacity);
      return r.ok ? c.json({ id: r.outingId }, 201) : fail(c, r);
    }
    // A person-started rally invites others who saved the same thing and asked to be invited.
    const { rows } = await d.pool.query(
      `SELECT s.user_id FROM saves s JOIN users x ON x.id = s.user_id
        WHERE s.activity_id = $1 AND s.user_id <> $2 AND x.status = 'active' AND x.outings_opt_in
          AND x.phone_verified_at IS NOT NULL AND x.adult_attested_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $2 AND b.blocked_id = s.user_id) OR (b.blocked_id = $2 AND b.blocker_id = s.user_id))
        ORDER BY s.created_at DESC LIMIT 30`, [activityId, u.id]);
    const invitees = await pickInvitees(d.pool, [u.id, ...rows.map((r) => r.user_id as string)]);
    // A rally nobody else can join is a guaranteed cancellation: say so now instead.
    if (invitees.length < QUORUM) return c.json({ error: "not_enough_interest" }, 422);
    const r = await proposeRally(d.pool, u.id, activityId, now(), invitees.filter((x) => x !== u.id));
    return r.ok ? c.json({ id: r.outingId, options: r.options, invited: invitees.length - 1 }, 201) : fail(c, r);
  });

  app.get("/:id", async (c) => {
    const oid = id(c);
    if (!oid) return c.json({ error: "not_found" }, 404);
    const o = await outingDetail(d.pool, c.get("user")!.id, oid, now());
    return o ? c.json({ outing: o }) : c.json({ error: "not_found" }, 404);
  });

  app.post("/:id/votes", async (c) => {
    const oid = id(c);
    if (!oid) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, Votes);
    if (!body.ok) return body.response;
    const r = await vote(d.pool, c.get("user")!.id, oid, body.data.answers, now());
    return r.ok ? c.json({ ok: true }) : fail(c, r);
  });

  app.post("/:id/join", async (c) => {
    const oid = id(c);
    if (!oid) return c.json({ error: "not_found" }, 404);
    const r = await join(d.pool, c.get("user")!.id, oid, now());
    return r.ok ? c.json({ ok: true, status: r.status }) : fail(c, r);
  });

  app.post("/:id/leave", async (c) => {
    const oid = id(c);
    if (!oid) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: await leave(d.pool, c.get("user")!.id, oid) });
  });

  app.post("/:id/checkin", async (c) => {
    const oid = id(c);
    if (!oid) return c.json({ error: "not_found" }, 404);
    const ok = await checkIn(d.pool, c.get("user")!.id, oid, now());
    return ok ? c.json({ ok }) : c.json({ error: "closed" }, 409);
  });

  app.post("/:id/feedback", async (c) => {
    const oid = id(c);
    if (!oid) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, Feedback);
    if (!body.ok) return body.response;
    const ok = await feedback(d.pool, c.get("user")!.id, oid, body.data.rating, body.data.again, now());
    return ok ? c.json({ ok }) : c.json({ error: "closed" }, 409);
  });

  app.get("/:id/messages", async (c) => {
    const oid = id(c);
    if (!oid) return c.json({ error: "not_found" }, 404);
    const u = c.get("user")!;
    const o = await outingDetail(d.pool, u.id, oid, now());
    const member = o && (o.me.status === "going" || o.me.status === "maybe" || o.me.hosting);
    if (!o || !member) return c.json({ error: "not_found" }, 404);
    const after = Number(c.req.query("after") ?? 0) || 0;
    return c.json({ messages: await listMessages(d.pool, u.id, oid, after), open: o.chatOpen });
  });

  app.post("/:id/messages", async (c) => {
    const oid = id(c);
    if (!oid) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, Message);
    if (!body.ok) return body.response;
    const r = await postMessage(d.pool, safetyDeps(d), c.get("user")!.id, oid, body.data.body, now());
    if (r.ok) return c.json(r, 201);
    const code = r.error === "not_found" ? 404 : r.error === "rate_limited" ? 429 : r.error === "closed" ? 409 : 400;
    return c.json({ error: r.error }, code as 400);
  });

  /** Block the author of a message. Silent: they are not told, and the outing disappears for both. */
  app.post("/:id/messages/:mid/block", async (c) => {
    const oid = id(c);
    const mid = c.req.param("mid");
    if (!oid || !/^\d+$/.test(mid)) return c.json({ error: "not_found" }, 404);
    const u = c.get("user")!;
    const { rows } = await d.pool.query(
      `SELECT m.author_id FROM outing_messages m
        WHERE m.id = $1 AND m.outing_id = $2 AND m.kind = 'user'
          AND EXISTS (SELECT 1 FROM outing_members om WHERE om.outing_id = m.outing_id AND om.user_id = $3)`, [mid, oid, u.id]);
    const author = rows[0]?.author_id;
    if (!author || author === u.id) return c.json({ error: "not_found" }, 404);
    await blockUser(d.pool, u.id, author);
    return c.json({ ok: true });
  });

  return app;
}
