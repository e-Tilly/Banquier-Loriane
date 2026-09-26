/**
 * /v1/submissions — people adding what no database knows about — and the "still accurate?"
 * confirmations. See src/community/submissions.ts for the rules.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../context.ts";
import { parseBody, UUID_RE } from "../http.ts";
import { requireUser } from "../middleware.ts";
import { confirmAccuracy, findSimilar, submitActivity, suggestTags } from "../../community/submissions.ts";

const Suggest = z.object({ title: z.string().trim().min(3).max(90), description: z.string().max(1000).optional().default("") });
const Confirm = z.object({ accurate: z.boolean() });

export function communityRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  const now = () => (d.now ? d.now() : new Date());
  // Mounted at /v1, so auth is per route: a "*" middleware here would also catch other /v1 paths.

  app.get("/submissions/similar", requireUser, async (c) => {
    const title = c.req.query("title") ?? "";
    const lat = Number(c.req.query("lat")), lon = Number(c.req.query("lon"));
    if (title.length < 3 || !Number.isFinite(lat) || !Number.isFinite(lon)) return c.json({ error: "invalid" }, 400);
    return c.json({ similar: await findSimilar(d.pool, title, lat, lon) });
  });

  app.post("/submissions/suggest", requireUser, async (c) => {
    const body = await parseBody(c, Suggest);
    if (!body.ok) return body.response;
    return c.json(await suggestTags(d.enrich?.client ?? null, body.data.title, body.data.description));
  });

  app.post("/submissions", requireUser, async (c) => {
    const u = c.get("user")!;
    const raw = await c.req.json().catch(() => null);
    if (!raw || typeof raw !== "object") return c.json({ error: "invalid" }, 400);
    const { confirmNotDuplicate, ...submission } = raw as Record<string, unknown>;
    const r = await submitActivity(d.pool, d.enrich?.client ?? null, { id: u.id, trustLevel: u.trustLevel }, submission,
      { now: now(), confirmNotDuplicate: confirmNotDuplicate === true });
    if (r.ok) return c.json(r, 201);
    const status = r.error === "duplicate" ? 409 : r.error === "rate_limited" ? 429 : r.error === "not_found" ? 404 : 400;
    return c.json(r, status as 400);
  });

  app.get("/submissions/mine", requireUser, async (c) => {
    const { rows } = await d.pool.query(
      `SELECT a.id, a.status, a.review_note AS "reviewNote", a.created_at AS "createdAt", c.title
         FROM activities a JOIN activity_content c ON c.activity_id = a.id
        WHERE a.created_by = $1 ORDER BY a.created_at DESC LIMIT 50`, [c.get("user")!.id]);
    return c.json({ submissions: rows });
  });

  app.post("/activities/:id/confirm", requireUser, async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, Confirm);
    if (!body.ok) return body.response;
    const r = await confirmAccuracy(d.pool, c.get("user")!.id, id, body.data.accurate, now());
    return r.ok ? c.json(r) : c.json({ error: r.error }, 403);
  });

  return app;
}
