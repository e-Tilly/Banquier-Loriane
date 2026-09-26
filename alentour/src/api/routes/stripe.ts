/**
 * POST /v1/stripe/webhook — the only way a business's tier changes. The raw body is verified
 * against Stripe-Signature before it is parsed; events are applied once each.
 */
import { Hono } from "hono";
import type { AppEnv, Deps } from "../context.ts";
import { handleEvent, verifySignature } from "../../billing/stripe.ts";

export function stripeRoutes(d: Deps) {
  const app = new Hono<AppEnv>();
  app.post("/webhook", async (c) => {
    if (!d.stripe) return c.json({ error: "not_configured" }, 404);
    const raw = await c.req.text();
    if (!verifySignature(raw, c.req.header("stripe-signature"), d.stripe.webhookSecret, d.now ? d.now() : new Date())) {
      return c.json({ error: "bad_signature" }, 400);
    }
    let event: any;
    try { event = JSON.parse(raw); } catch { return c.json({ error: "bad_json" }, 400); }
    const applied = await handleEvent(d.pool, event);
    return c.json({ received: true, duplicate: !applied });
  });
  return app;
}
