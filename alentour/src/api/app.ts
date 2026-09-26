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
import { claimRoutes, ownerRoutes } from "./routes/claims.ts";
import { ownerPages } from "./pages/owner.ts";
import { outingRoutes } from "./routes/outings.ts";
import { communityRoutes } from "./routes/community.ts";
import { stripeRoutes } from "./routes/stripe.ts";
import { LocalStorage } from "../enrichment/storage.ts";

export function createApp(d: Deps, opts: { trustProxy?: boolean } = {}) {
  const app = new Hono<AppEnv>();

  app.use("*", cors({
    origin: d.config.corsOrigins.includes("*") ? "*" : d.config.corsOrigins,
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  }));
  // JSON bodies are small; only the owner pages accept photo uploads (8 photos × 8 MB, with room).
  const small = bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: "payload_too_large" }, 413) });
  const uploads = bodyLimit({ maxSize: 70 * 1024 * 1024, onError: (c) => c.text("Upload too large.", 413) });
  app.use("*", (c, next) =>
    (c.req.path.startsWith("/owner/") && (c.req.header("content-type") ?? "").startsWith("multipart/form-data") ? uploads : small)(c, next));
  app.use("*", identify(d, opts.trustProxy ?? false));

  app.get("/health", async (c) => {
    await d.pool.query("SELECT 1");
    return c.json({ ok: true });
  });

  app.route("/v1/auth", authRoutes(d));
  app.route("/v1/me", meRoutes(d));
  app.route("/v1/library", libraryRoutes(d));
  app.route("/v1/reports", reportRoutes(d));
  app.route("/v1/claims", claimRoutes(d));
  app.route("/v1/owner", ownerRoutes(d));
  app.route("/v1/outings", outingRoutes(d));
  app.route("/v1/stripe", stripeRoutes(d));
  app.route("/v1", communityRoutes(d));
  // Server-rendered pages for business owners — a web form, not an app (docs/alentour/02).
  app.route("/owner", ownerPages(d));

  // Development only: photos stored on disk are served from here. Production serves R2 directly.
  const storage = d.enrich?.storage;
  if (storage instanceof LocalStorage) {
    app.get("/media/*", (c) => {
      const key = c.req.path.slice("/media/".length);
      const body = storage.read(key);
      if (!body) return c.json({ error: "not_found" }, 404);
      const type = key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
      return c.body(new Uint8Array(body), 200, { "content-type": type, "cache-control": "public, max-age=86400" });
    });
  }

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });
  return app;
}
