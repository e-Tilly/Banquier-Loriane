/**
 * The Alentour API. Stage 2 surface: accounts, sync, reports. Later stages mount more routes.
 *
 * Built on Hono so the same code runs on Node (Fly, Render, a $5 VPS) or, later, Cloudflare
 * Workers. Everything external is injected through `Deps`, which is what lets the tests drive
 * every route against a real database with no network.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv, Deps } from "./context.ts";
import { identify } from "./middleware.ts";
import { authRoutes } from "./routes/auth.ts";
import { meRoutes } from "./routes/me.ts";
import { libraryRoutes } from "./routes/library.ts";
import { reportRoutes } from "./routes/reports.ts";

export function createApp(d: Deps, opts: { trustProxy?: boolean } = {}) {
  const app = new Hono<AppEnv>();

  app.use("*", cors({
    origin: d.config.corsOrigins.includes("*") ? "*" : d.config.corsOrigins,
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  }));
  app.use("*", bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) }));
  app.use("*", identify(d, opts.trustProxy ?? false));

  app.get("/health", async (c) => {
    await d.pool.query("SELECT 1");
    return c.json({ ok: true });
  });

  app.route("/v1/auth", authRoutes(d));
  app.route("/v1/me", meRoutes(d));
  app.route("/v1/library", libraryRoutes(d));
  app.route("/v1/reports", reportRoutes(d));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
