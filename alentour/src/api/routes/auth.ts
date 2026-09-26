import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../context.ts";
import { startEmailSignIn, verifyEmailCode, verifyIdToken, revokeSession } from "../auth.ts";
import { hmac } from "../crypto.ts";
import { RateLimiter } from "../ratelimit.ts";
import { parseBody } from "../http.ts";

const Start = z.object({ email: z.string().max(254), lang: z.string().max(10).optional() });
const Verify = z.object({ email: z.string().max(254), code: z.string().regex(/^\d{6}$/) });
const IdToken = z.object({ provider: z.enum(["apple", "google"]), idToken: z.string().max(8192) });

export function authRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  // Per-IP ceilings on top of the per-email limit held in the database.
  const startLimit = new RateLimiter(20, 60 * 60_000);
  const verifyLimit = new RateLimiter(30, 15 * 60_000);

  app.post("/email/start", async (c) => {
    if (!startLimit.take(c.get("ip"))) return c.json({ error: "rate_limited" }, 429);
    const body = await parseBody(c, Start);
    if (!body.ok) return body.response;
    const r = await startEmailSignIn(d, body.data.email, body.data.lang ?? "fr", hmac(d.config.secret, c.get("ip")));
    if (!r.ok) return c.json({ error: r.error }, r.error === "rate_limited" ? 429 : 400);
    // Same answer whether or not an account exists: this endpoint must not reveal who uses the app.
    return c.json({ ok: true });
  });

  app.post("/email/verify", async (c) => {
    if (!verifyLimit.take(c.get("ip"))) return c.json({ error: "rate_limited" }, 429);
    const body = await parseBody(c, Verify);
    if (!body.ok) return body.response;
    const r = await verifyEmailCode(d, body.data.email, body.data.code, c.req.header("user-agent"));
    if (!r.ok) return c.json({ error: r.error }, r.error === "too_many_attempts" ? 429 : 400);
    return c.json({ token: r.token, user: publicUser(r.user), created: r.created });
  });

  app.post("/id-token", async (c) => {
    if (!verifyLimit.take(c.get("ip"))) return c.json({ error: "rate_limited" }, 429);
    const body = await parseBody(c, IdToken);
    if (!body.ok) return body.response;
    const r = await verifyIdToken(d, body.data.provider, body.data.idToken, c.req.header("user-agent"));
    if (!r.ok) return c.json({ error: r.error }, 401);
    return c.json({ token: r.token, user: publicUser(r.user), created: r.created });
  });

  app.post("/logout", async (c) => {
    const user = c.get("user");
    if (user) await revokeSession(d, user.sessionId);
    return c.json({ ok: true });
  });

  return app;
}

export function publicUser(u: { id: string; email: string | null; displayName: string | null; birthYear: number | null; locale: string; trustLevel: number }) {
  return {
    id: u.id, email: u.email, displayName: u.displayName,
    birthYear: u.birthYear, locale: u.locale, trustLevel: u.trustLevel,
  };
}
