/** API configuration from the environment. Fails fast on anything unsafe in production. */
export interface ApiConfig {
  /** HMAC key for one-time codes and IP hashing. 32+ random bytes in production. */
  secret: string;
  sessionDays: number;
  codeTtlMinutes: number;
  corsOrigins: string[];
  appleAudience: string[];        // iOS bundle id(s)
  googleAudience: string[];       // OAuth client id(s)
  production: boolean;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env.NODE_ENV === "production";
  const secret = env.API_SECRET ?? (production ? "" : "dev-only-secret-change-me-dev-only-secret");
  if (secret.length < 32) {
    throw new Error("API_SECRET must be at least 32 characters (generate: openssl rand -hex 32)");
  }
  const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    secret,
    sessionDays: Number(env.SESSION_DAYS ?? 180),
    codeTtlMinutes: 10,
    corsOrigins: list(env.CORS_ORIGINS ?? (production ? "" : "*")),
    appleAudience: list(env.APPLE_AUDIENCE ?? "app.alentour.mobile"),
    googleAudience: list(env.GOOGLE_AUDIENCE),
    production,
  };
}
