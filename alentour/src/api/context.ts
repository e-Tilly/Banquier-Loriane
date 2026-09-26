import type pg from "pg";
import type { JWTVerifyGetKey } from "jose";
import type { ApiConfig } from "./config.ts";
import type { Mailer } from "./mailer.ts";
import type { EnrichDeps } from "../enrichment/pipeline.ts";
import type { Sms } from "../outings/phone.ts";
import type { Pusher } from "../outings/notify.ts";
import type { StripeConfig } from "../billing/stripe.ts";

/** Everything the API needs from the outside world, injected so tests can control it. */
export interface Deps {
  pool: pg.Pool;
  mailer: Mailer;
  config: ApiConfig;
  now?: () => Date;
  /** Key sets for verifying Apple/Google ID tokens. Defaults to the providers' live JWKS. */
  jwks?: { apple?: JWTVerifyGetKey; google?: JWTVerifyGetKey };
  /** Stage 4: the enrichment pipeline, photo storage and geocoding. Absent: onboarding is off. */
  enrich?: EnrichDeps;
  /** Stage 5: SMS for phone verification, push for outing notifications, the operator's alerts. */
  sms?: Sms;
  pusher?: Pusher;
  operatorEmail?: string | null;
  /** Stage 6: Business Pro billing. Absent: the billing page says Pro isn't available yet. */
  stripe?: StripeConfig | null;
  /** Outbound HTTP for Stripe calls; tests replace it. */
  fetch?: typeof fetch;
}

export interface SessionUser {
  id: string;
  email: string | null;
  displayName: string | null;
  birthYear: number | null;
  locale: string;
  trustLevel: number;
  sessionId: string;
}

export type AppEnv = { Variables: { user: SessionUser | null; ip: string } };
