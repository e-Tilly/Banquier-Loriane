/**
 * The signed-in user: profile, data export and account deletion.
 *
 * Deletion is required in-app by Apple and is a right under Québec's Law 25. It removes
 * personal data immediately and revokes every session; the row survives only as an anonymous
 * tombstone so history elsewhere (outings, reports) keeps referential integrity.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../context.ts";
import { parseBody } from "../http.ts";
import { publicUser } from "./auth.ts";
import { requireUser } from "../middleware.ts";
import { ConsoleSms, startPhoneVerification, verifyPhone } from "../../outings/phone.ts";

export const MIN_AGE = 18;

const Patch = z.object({
  displayName: z.string().trim().min(1).max(40).nullable().optional(),
  birthYear: z.number().int().min(1900).optional(),
  locale: z.enum(["fr-CA", "en-CA"]).optional(),
  /** "I am 18 or older" — required, with the birth year, to take part in outings. */
  adultAttested: z.literal(true).optional(),
  /** May the concierge invite me to rallies for things I save? Off until the person turns it on. */
  outingsOptIn: z.boolean().optional(),
});
const Phone = z.object({ phone: z.string().min(7).max(25) });
const Code = z.object({ code: z.string().regex(/^\d{6}$/) });
const PushToken = z.object({ token: z.string().min(10).max(300), platform: z.enum(["ios", "android", "web"]).optional() });

export function meRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  app.get("/", (c) => c.json({ user: publicUser(c.get("user")!) }));

  app.patch("/", async (c) => {
    const body = await parseBody(c, Patch);
    if (!body.ok) return body.response;
    const u = c.get("user")!;
    const year = (d.now ? d.now() : new Date()).getFullYear();
    if (body.data.birthYear !== undefined && body.data.birthYear > year) {
      return c.json({ error: "invalid_birth_year" }, 400);
    }
    const { rows } = await d.pool.query(
      `UPDATE users SET
         display_name = CASE WHEN $2::boolean THEN $3 ELSE display_name END,
         birth_year   = COALESCE($4, birth_year),
         locale       = COALESCE($5, locale),
         adult_attested_at = CASE WHEN $6::boolean THEN COALESCE(adult_attested_at, $8) ELSE adult_attested_at END,
         outings_opt_in = COALESCE($7, outings_opt_in)
       WHERE id = $1
       RETURNING id, email, display_name, birth_year, locale, trust_level`,
      [u.id, body.data.displayName !== undefined, body.data.displayName ?? null,
       body.data.birthYear ?? null, body.data.locale ?? null, body.data.adultAttested === true,
       body.data.outingsOptIn ?? null, d.now ? d.now() : new Date()]);
    const r = rows[0];
    return c.json({ user: publicUser({
      id: r.id, email: r.email, displayName: r.display_name, birthYear: r.birth_year,
      locale: r.locale, trustLevel: r.trust_level,
    }) });
  });

  // ---------------------------------------------------------------- Stage 5: outings profile
  app.post("/phone", async (c) => {
    const body = await parseBody(c, Phone);
    if (!body.ok) return body.response;
    const u = c.get("user")!;
    const r = await startPhoneVerification(d.pool, d.sms ?? new ConsoleSms(), d.config.secret, u.id, body.data.phone, u.locale, d.now ? d.now() : new Date());
    if (r.ok) return c.json({ ok: true });
    return c.json({ error: r.error }, r.error === "rate_limited" ? 429 : r.error === "phone_in_use" ? 409 : 400);
  });

  app.post("/phone/verify", async (c) => {
    const body = await parseBody(c, Code);
    if (!body.ok) return body.response;
    const ok = await verifyPhone(d.pool, d.config.secret, c.get("user")!.id, body.data.code, d.now ? d.now() : new Date());
    return ok ? c.json({ ok: true }) : c.json({ error: "invalid_code" }, 400);
  });

  app.post("/push-tokens", async (c) => {
    const body = await parseBody(c, PushToken);
    if (!body.ok) return body.response;
    await d.pool.query(
      `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = $2, platform = $3`, [body.data.token, c.get("user")!.id, body.data.platform ?? null]);
    return c.json({ ok: true });
  });

  app.get("/notifications", async (c) => {
    const { rows } = await d.pool.query(
      `SELECT id, kind, outing_id AS "outingId", title, body, read_at AS "readAt", created_at AS "createdAt"
         FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 50`, [c.get("user")!.id]);
    return c.json({ notifications: rows });
  });

  app.post("/notifications/read", async (c) => {
    await d.pool.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [c.get("user")!.id]);
    return c.json({ ok: true });
  });

  app.get("/blocks", async (c) => {
    const { rows } = await d.pool.query(
      `SELECT b.blocked_id AS "userId", COALESCE(u.display_name, 'Membre') AS name, b.created_at AS "createdAt"
         FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`, [c.get("user")!.id]);
    return c.json({ blocks: rows });
  });

  app.delete("/blocks/:userId", async (c) => {
    await d.pool.query(`DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id::text = $2`, [c.get("user")!.id, c.req.param("userId")]);
    return c.json({ ok: true });
  });

  /** Everything we hold about you, as JSON (Law 25 portability). */
  app.get("/export", async (c) => {
    const u = c.get("user")!;
    const [user, identities, library, reports, outings, messages, blocks] = await Promise.all([
      d.pool.query(`SELECT id, email, display_name, birth_year, locale, trust_level, created_at FROM users WHERE id = $1`, [u.id]),
      d.pool.query(`SELECT provider, email, created_at FROM user_identities WHERE user_id = $1`, [u.id]),
      d.pool.query(`SELECT data, updated_at FROM libraries WHERE user_id = $1`, [u.id]),
      d.pool.query(`SELECT subject_type, subject_id, reason, details, status, created_at FROM reports WHERE reporter_id = $1`, [u.id]),
      d.pool.query(`SELECT p.outing_id, p.status, p.joined_at, p.checked_in_at, p.rating, p.would_repeat, o.starts_at
                      FROM outing_participants p JOIN outings o ON o.id = p.outing_id WHERE p.user_id = $1`, [u.id]),
      d.pool.query(`SELECT outing_id, body, status, created_at FROM outing_messages WHERE author_id = $1`, [u.id]),
      d.pool.query(`SELECT blocked_id, created_at FROM blocks WHERE blocker_id = $1`, [u.id]),
    ]);
    c.header("content-disposition", `attachment; filename="alentour-export-${u.id}.json"`);
    return c.json({
      exportedAt: new Date().toISOString(),
      user: user.rows[0],
      signInMethods: identities.rows,
      library: library.rows[0] ?? null,
      reports: reports.rows,
      outings: outings.rows,
      outingMessages: messages.rows,
      blocks: blocks.rows,
    });
  });

  app.delete("/", async (c) => {
    const u = c.get("user")!;
    const client = await d.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM sessions WHERE user_id = $1`, [u.id]);
      await client.query(`DELETE FROM user_identities WHERE user_id = $1`, [u.id]);
      await client.query(`DELETE FROM libraries WHERE user_id = $1`, [u.id]);
      await client.query(`DELETE FROM saves WHERE user_id = $1`, [u.id]);
      if (u.email) await client.query(`DELETE FROM auth_codes WHERE email = $1`, [u.email]);
      await client.query(`UPDATE reports SET reporter_id = NULL WHERE reporter_id = $1`, [u.id]);
      // Outings: leave anything upcoming, withdraw votes, erase what they wrote. Past attendance
      // stays as an anonymous tombstone so other people's outing history still adds up.
      await client.query(
        `UPDATE outing_participants p SET status = 'left' FROM outings o
          WHERE p.outing_id = o.id AND p.user_id = $1 AND o.status IN ('voting', 'confirmed', 'paused')`, [u.id]);
      await client.query(`DELETE FROM outing_votes WHERE user_id = $1`, [u.id]);
      await client.query(`DELETE FROM outing_invites WHERE user_id = $1`, [u.id]);
      await client.query(`UPDATE outing_messages SET body = '[supprimé / deleted]', status = 'removed' WHERE author_id = $1`, [u.id]);
      for (const t of ["blocks WHERE blocker_id = $1 OR blocked_id = $1", "push_tokens WHERE user_id = $1",
                       "notifications WHERE user_id = $1", "phone_codes WHERE user_id = $1"]) {
        await client.query(`DELETE FROM ${t}`, [u.id]);
      }
      await client.query(
        `UPDATE users SET email = NULL, phone_e164 = NULL, auth_subject = NULL, display_name = NULL,
                birth_year = NULL, adult_attested_at = NULL, outings_opt_in = false, phone_verified_at = NULL,
                verified_phone = false, status = 'deleted', deleted_at = now()
          WHERE id = $1`, [u.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    return c.json({ ok: true, deleted: true });
  });

  return app;
}
