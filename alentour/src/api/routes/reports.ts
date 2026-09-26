import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../context.ts";
import { parseBody } from "../http.ts";
import { hmac } from "../crypto.ts";
import { RateLimiter } from "../ratelimit.ts";
import { onReport } from "../../outings/safety.ts";
import { safetyDeps } from "./outings.ts";

const REASONS = ["closed", "hours", "price", "a11y", "missing", "dangerous", "other",
  "harassment", "spam", "inappropriate", "safety"] as const;

const Report = z.object({
  subjectType: z.enum(["activity", "venue", "user", "outing", "message", "photo"]),
  subjectId: z.string().min(1).max(100),
  reason: z.enum(REASONS),
  details: z.string().max(1000).optional().default(""),
});

/** Severity drives triage order. Anything involving a person's safety goes to the top. */
export function severityOf(reason: (typeof REASONS)[number]): number {
  if (reason === "safety" || reason === "harassment") return 4;
  if (reason === "dangerous") return 3;
  if (reason === "a11y" || reason === "inappropriate") return 2;
  return 1;
}

export function reportRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  const limiter = new RateLimiter(10, 60 * 60_000);

  // Signed-in or not: a closed venue is worth hearing about from anyone.
  app.post("/", async (c) => {
    if (!limiter.take(c.get("ip"))) return c.json({ error: "rate_limited" }, 429);
    const body = await parseBody(c, Report);
    if (!body.ok) return body.response;
    const { subjectType, subjectId, reason, details } = body.data;
    const { rows } = await d.pool.query(
      `INSERT INTO reports (reporter_id, subject_type, subject_id, reason, details, severity, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [c.get("user")?.id ?? null, subjectType, subjectId, reason, details || null,
       severityOf(reason), hmac(d.config.secret, c.get("ip"))]);
    // Fail-safe: anything about an outing, a chat message or a person pauses the outing now,
    // pending review, rather than waiting for a solo operator to wake up (docs/alentour/08).
    const paused = await onReport(d.pool, safetyDeps(d), {
      subjectType, subjectId, reporterId: c.get("user")?.id ?? null, severity: severityOf(reason),
    }, d.now ? d.now() : new Date());
    return c.json({ ok: true, id: rows[0].id, paused: paused.length > 0 }, 201);
  });

  return app;
}
