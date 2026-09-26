import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../context.ts";
import { parseBody, UUID_RE } from "../http.ts";
import { requireUser } from "../middleware.ts";
import { startClaim, verifyClaimCode } from "../../claims/claims.ts";
import { applyOwnerEdit, confirmStillAccurate, ownerListings } from "../../claims/edits.ts";

const Start = z.object({
  venueId: z.string().regex(UUID_RE),
  businessName: z.string().trim().min(2).max(120),
  role: z.string().trim().min(2).max(60),
  contactEmail: z.string().max(254),
  contactPhone: z.string().max(30).optional(),
  message: z.string().max(2000).optional(),
  lang: z.string().max(10).optional(),
});
const Verify = z.object({ code: z.string().regex(/^\d{6}$/) });

export function claimRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  /** Find a venue to claim, by name. */
  app.get("/venues", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) return c.json({ venues: [] });
    const { rows } = await d.pool.query(
      `SELECT id, name, neighbourhood, website, provider_id IS NOT NULL AS claimed
         FROM venues WHERE name ILIKE $1 OR similarity(name, $2) > 0.3
        ORDER BY similarity(name, $2) DESC LIMIT 10`, [`%${q}%`, q]);
    return c.json({ venues: rows });
  });

  app.post("/", async (c) => {
    const body = await parseBody(c, Start);
    if (!body.ok) return body.response;
    const r = await startClaim(d, { ...body.data, userId: c.get("user")!.id });
    if (!r.ok) return c.json({ error: r.error }, r.error === "venue_not_found" ? 404 : 409);
    return c.json(r, 201);
  });

  app.post("/:id/verify", async (c) => {
    const body = await parseBody(c, Verify);
    if (!body.ok) return body.response;
    const r = await verifyClaimCode(d, c.req.param("id"), c.get("user")!.id, body.data.code);
    if (!r.ok) return c.json({ error: r.error }, r.error === "too_many_attempts" ? 429 : 400);
    return c.json(r);
  });

  app.get("/mine", async (c) => {
    const { rows } = await d.pool.query(
      `SELECT c.id, c.status, c.method, c.created_at, c.review_note, v.name AS venue_name
         FROM claims c JOIN venues v ON v.id = c.venue_id
        WHERE c.claimant_id = $1 ORDER BY c.created_at DESC`, [c.get("user")!.id]);
    return c.json({ claims: rows });
  });

  return app;
}

export function ownerRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  app.get("/listings", async (c) => c.json({ listings: await ownerListings(d.pool, c.get("user")!.id) }));

  app.patch("/activities/:id", async (c) => {
    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
    const r = await applyOwnerEdit(d.pool, c.get("user")!.id, c.req.param("id"), raw, d.now ? d.now() : new Date());
    if (!r.ok) {
      const status = r.error === "not_found" ? 404 : r.error === "forbidden" ? 403 : 400;
      return c.json({ error: r.error, issues: r.issues }, status);
    }
    return c.json(r);
  });

  app.post("/activities/:id/confirm", async (c) => {
    const ok = await confirmStillAccurate(d.pool, c.get("user")!.id, c.req.param("id"), d.now ? d.now() : new Date());
    return ok ? c.json({ ok: true }) : c.json({ error: "forbidden" }, 403);
  });

  return app;
}
