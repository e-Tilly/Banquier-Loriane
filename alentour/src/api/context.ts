import type pg from "pg";
import type { JWTVerifyGetKey } from "jose";
import type { ApiConfig } from "./config.ts";
import type { Mailer } from "./mailer.ts";

/** Everything the API needs from the outside world, injected so tests can control it. */
export interface Deps {
  pool: pg.Pool;
  mailer: Mailer;
  config: ApiConfig;
  now?: () => Date;
  /** Key sets for verifying Apple/Google ID tokens. Defaults to the providers' live JWKS. */
  jwks?: { apple?: JWTVerifyGetKey; google?: JWTVerifyGetKey };
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
