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

export const MIN_AGE = 18;

const Patch = z.object({
  displayName: z.string().trim().min(1).max(40).nullable().optional(),
  birthYear: z.number().int().min(1900).optional(),
  locale: z.enum(["fr-CA", "en-CA"]).optional(),
});

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
         locale       = COALESCE($5, locale)
       WHERE id = $1
       RETURNING id, email, display_name, birth_year, locale, trust_level`,
      [u.id, body.data.displayName !== undefined, body.data.displayName ?? null,
       body.data.birthYear ?? null, body.data.locale ?? null]);
    const r = rows[0];
    return c.json({ user: publicUser({
      id: r.id, email: r.email, displayName: r.display_name, birthYear: r.birth_year,
      locale: r.locale, trustLevel: r.trust_level,
    }) });
  });

  /** Everything we hold about you, as JSON (Law 25 portability). */
  app.get("/export", async (c) => {
    const u = c.get("user")!;
    const [user, identities, library, reports] = await Promise.all([
      d.pool.query(`SELECT id, email, display_name, birth_year, locale, trust_level, created_at FROM users WHERE id = $1`, [u.id]),
      d.pool.query(`SELECT provider, email, created_at FROM user_identities WHERE user_id = $1`, [u.id]),
      d.pool.query(`SELECT data, updated_at FROM libraries WHERE user_id = $1`, [u.id]),
      d.pool.query(`SELECT subject_type, subject_id, reason, details, status, created_at FROM reports WHERE reporter_id = $1`, [u.id]),
    ]);
    c.header("content-disposition", `attachment; filename="alentour-export-${u.id}.json"`);
    return c.json({
      exportedAt: new Date().toISOString(),
      user: user.rows[0],
      signInMethods: identities.rows,
      library: library.rows[0] ?? null,
      reports: reports.rows,
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
      await client.query(
        `UPDATE users SET email = NULL, phone_e164 = NULL, auth_subject = NULL, display_name = NULL,
                birth_year = NULL, status = 'deleted', deleted_at = now()
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
