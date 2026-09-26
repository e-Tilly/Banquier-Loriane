/**
 * Business Pro through Stripe Checkout (docs/alentour/12): $29/month or $290/year.
 *
 * No SDK: three REST calls (Checkout Session, Billing Portal Session, nothing else) and webhook
 * signature verification. The webhook is the only thing that changes a business's tier, and it
 * is verified, timestamp-checked and idempotent — a forged or replayed event changes nothing.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceMonthly: string;
  priceYearly?: string | null;
  publicUrl: string;           // where Checkout sends people back
}

export function stripeFromEnv(env: NodeJS.ProcessEnv = process.env): StripeConfig | null {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_PRICE_PRO_MONTHLY) return null;
  return {
    secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    priceMonthly: env.STRIPE_PRICE_PRO_MONTHLY, priceYearly: env.STRIPE_PRICE_PRO_YEARLY ?? null,
    publicUrl: (env.PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, ""),
  };
}

async function stripePost(cfg: StripeConfig, path: string, form: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`Stripe ${path}: ${data?.error?.message ?? res.status}`);
  return data;
}

export async function createCheckout(
  cfg: StripeConfig, provider: { id: string; stripeCustomerId: string | null }, email: string | null,
  plan: "monthly" | "yearly", fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const price = plan === "yearly" && cfg.priceYearly ? cfg.priceYearly : cfg.priceMonthly;
  const form: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: provider.id,
    "metadata[provider_id]": provider.id,
    "subscription_data[metadata][provider_id]": provider.id,
    success_url: `${cfg.publicUrl}/owner/billing?done=1`,
    cancel_url: `${cfg.publicUrl}/owner/billing`,
    allow_promotion_codes: "true",
    "automatic_tax[enabled]": "true",          // GST/QST: let Stripe Tax compute it
    locale: "auto",
  };
  if (provider.stripeCustomerId) form.customer = provider.stripeCustomerId;
  else if (email) form.customer_email = email;
  const session = await stripePost(cfg, "checkout/sessions", form, fetchImpl);
  return session.url as string;
}

export async function createPortal(cfg: StripeConfig, customerId: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const s = await stripePost(cfg, "billing_portal/sessions", { customer: customerId, return_url: `${cfg.publicUrl}/owner/billing` }, fetchImpl);
  return s.url as string;
}

/** Stripe-Signature: t=<unix>,v1=<hex hmac of "t.body">. Five-minute tolerance against replay. */
export function verifySignature(rawBody: string, header: string | undefined, secret: string, now = new Date(), toleranceS = 300): boolean {
  if (!header) return false;
  const parts = header.split(",").map((kv) => kv.split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(now.getTime() / 1000 - t) > toleranceS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return sigs.some((s) => { const b = Buffer.from(s); return b.length === expected.length && timingSafeEqual(b, expected); });
}

/** For tests and local tooling: a header Stripe would send for this body. */
export function signPayload(rawBody: string, secret: string, now = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);   // past_due keeps Pro while Stripe retries

/** Apply one verified event. Returns false for a replay. */
export async function handleEvent(pool: pg.Pool, event: any): Promise<boolean> {
  const inserted = await pool.query(
    `INSERT INTO stripe_events (id, type, payload) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [event.id, event.type, JSON.stringify(event)]);
  if (!inserted.rowCount) return false;
  const o = event.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed": {
      const providerId = o.client_reference_id ?? o.metadata?.provider_id;
      if (!providerId) break;
      await pool.query(
        `UPDATE providers SET stripe_customer_id = COALESCE($2, stripe_customer_id), stripe_subscription_id = COALESCE($3, stripe_subscription_id)
          WHERE id = $1`, [providerId, o.customer ?? null, o.subscription ?? null]);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const status: string = event.type === "customer.subscription.deleted" ? "canceled" : o.status;
      const periodEnd = o.current_period_end ?? o.items?.data?.[0]?.current_period_end ?? null;
      const tier = PRO_STATUSES.has(status) ? "pro" : "free";
      await pool.query(
        `UPDATE providers SET subscription_tier = $3, subscription_status = $4, stripe_subscription_id = $5,
                pro_until = $6, stripe_customer_id = COALESCE(stripe_customer_id, $2)
          WHERE id = $1 OR (stripe_customer_id IS NOT NULL AND stripe_customer_id = $2)`,
        [o.metadata?.provider_id ?? "00000000-0000-0000-0000-000000000000", o.customer ?? null, tier, status, o.id ?? null,
         periodEnd ? new Date(periodEnd * 1000) : null]);
      break;
    }
    default:
      break;
  }
  return true;
}

// ------------------------------------------------------------------ entitlements

export interface Entitlements { tier: "free" | "pro"; maxPhotos: number; hostSessions: boolean; bookingLink: boolean; fullStats: boolean }

export function entitlementsFor(tier: string | null | undefined): Entitlements {
  return tier === "pro"
    ? { tier: "pro", maxPhotos: 30, hostSessions: true, bookingLink: true, fullStats: true }
    : { tier: "free", maxPhotos: 6, hostSessions: false, bookingLink: false, fullStats: false };
}

export async function providerEntitlements(pool: pg.Pool | pg.PoolClient, providerId: string | null): Promise<Entitlements> {
  if (!providerId) return entitlementsFor("free");
  const { rows } = await pool.query(`SELECT subscription_tier FROM providers WHERE id = $1`, [providerId]);
  return entitlementsFor(rows[0]?.subscription_tier);
}
