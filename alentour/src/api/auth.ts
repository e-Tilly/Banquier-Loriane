/**
 * Authentication: email one-time codes, Apple/Google ID tokens, and opaque sessions.
 *
 * Deliberate choices:
 *  - Codes are stored only as an HMAC. A database leak does not leak live codes.
 *  - The start endpoint answers identically whether or not the email has an account, so it
 *    cannot be used to discover who uses the app.
 *  - Sessions are random tokens stored hashed, looked up per request. Deleting an account
 *    revokes every session at once — a stateless JWT could not.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type pg from "pg";
import type { Deps, SessionUser } from "./context.ts";
import { hmac, randomToken, safeEqual, sha256, sixDigitCode } from "./crypto.ts";

export const MAX_CODE_ATTEMPTS = 5;
export const MAX_CODES_PER_HOUR = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normalizeEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => EMAIL_RE.test(e) && e.length <= 254;

const nowOf = (d: Deps) => (d.now ? d.now() : new Date());

// ------------------------------------------------------------------ email codes

export type StartResult = { ok: true } | { ok: false; error: "invalid_email" | "rate_limited" };

export async function startEmailSignIn(d: Deps, rawEmail: string, lang: string, ipHash: string | null): Promise<StartResult> {
  const email = normalizeEmail(rawEmail);
  if (!isEmail(email)) return { ok: false, error: "invalid_email" };
  const now = nowOf(d);

  const { rows } = await d.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM auth_codes WHERE email = $1 AND created_at > $2`,
    [email, new Date(now.getTime() - 3_600_000)],
  );
  if ((rows[0]?.n ?? 0) >= MAX_CODES_PER_HOUR) return { ok: false, error: "rate_limited" };

  const code = sixDigitCode();
  await d.pool.query(
    `INSERT INTO auth_codes (email, code_hash, expires_at, ip_hash) VALUES ($1, $2, $3, $4)`,
    [email, hmac(d.config.secret, `${email}:${code}`),
     new Date(now.getTime() + d.config.codeTtlMinutes * 60_000), ipHash],
  );

  const fr = lang.startsWith("fr");
  await d.mailer.send({
    to: email,
    subject: fr ? `Ton code Alentour : ${code}` : `Your Alentour code: ${code}`,
    text: fr
      ? `Ton code de connexion est ${code}.\nIl expire dans ${d.config.codeTtlMinutes} minutes.\n\nSi tu n'as rien demandé, ignore ce courriel.`
      : `Your sign-in code is ${code}.\nIt expires in ${d.config.codeTtlMinutes} minutes.\n\nIf you didn't ask for this, ignore this email.`,
  });
  return { ok: true };
}

export type VerifyResult =
  | { ok: true; token: string; user: SessionUser; created: boolean }
  | { ok: false; error: "invalid_code" | "expired" | "too_many_attempts" };

export async function verifyEmailCode(d: Deps, rawEmail: string, code: string, userAgent?: string): Promise<VerifyResult> {
  const email = normalizeEmail(rawEmail);
  const now = nowOf(d);
  const { rows } = await d.pool.query<{ id: string; code_hash: string; expires_at: Date; attempts: number }>(
    `SELECT id, code_hash, expires_at, attempts FROM auth_codes
      WHERE email = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "invalid_code" };
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, error: "too_many_attempts" };
  if (row.expires_at.getTime() < now.getTime()) return { ok: false, error: "expired" };

  const candidate = hmac(d.config.secret, `${email}:${String(code).trim()}`);
  if (!safeEqual(candidate, row.code_hash)) {
    await d.pool.query(`UPDATE auth_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
    return { ok: false, error: row.attempts + 1 >= MAX_CODE_ATTEMPTS ? "too_many_attempts" : "invalid_code" };
  }

  // Consume atomically, so a code can never be used twice even under a race.
  const consumed = await d.pool.query(
    `UPDATE auth_codes SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL`, [row.id, now]);
  if (consumed.rowCount !== 1) return { ok: false, error: "invalid_code" };

  const { userId, created } = await findOrCreateUser(d.pool, "email", email, email);
  const token = await createSession(d, userId, userAgent);
  const user = await sessionUser(d, token);
  return { ok: true, token, user: user!, created };
}

// ------------------------------------------------------------------ Apple / Google

const APPLE_ISS = "https://appleid.apple.com";
const GOOGLE_ISS = ["https://accounts.google.com", "accounts.google.com"];
let appleJwks: JWTVerifyGetKey | undefined;
let googleJwks: JWTVerifyGetKey | undefined;

export async function verifyIdToken(
  d: Deps, provider: "apple" | "google", idToken: string, userAgent?: string,
): Promise<{ ok: true; token: string; user: SessionUser; created: boolean } | { ok: false; error: "invalid_token" }> {
  try {
    const keys = provider === "apple"
      ? d.jwks?.apple ?? (appleJwks ??= createRemoteJWKSet(new URL(`${APPLE_ISS}/auth/keys`)))
      : d.jwks?.google ?? (googleJwks ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")));
    const audience = provider === "apple" ? d.config.appleAudience : d.config.googleAudience;
    if (!audience.length) return { ok: false, error: "invalid_token" };

    const { payload } = await jwtVerify(idToken, keys, {
      issuer: provider === "apple" ? APPLE_ISS : GOOGLE_ISS,
      audience,
      currentDate: nowOf(d),
    });
    if (!payload.sub) return { ok: false, error: "invalid_token" };
    const email = typeof payload.email === "string" ? normalizeEmail(payload.email) : null;
    // Only trust a provider email the provider itself has verified.
    const verifiedEmail = email && (payload.email_verified === true || payload.email_verified === "true") ? email : null;

    const { userId, created } = await findOrCreateUser(d.pool, provider, payload.sub, verifiedEmail);
    const token = await createSession(d, userId, userAgent);
    return { ok: true, token, user: (await sessionUser(d, token))!, created };
  } catch {
    return { ok: false, error: "invalid_token" };
  }
}

// ------------------------------------------------------------------ users & sessions

/**
 * Find the user behind an identity, or create one. An email identity and a provider identity
 * carrying the same VERIFIED email resolve to the same person — otherwise someone who signed up
 * by email and later taps "Sign in with Apple" would silently get a second, empty account.
 */
export async function findOrCreateUser(
  pool: pg.Pool, provider: string, subject: string, email: string | null,
): Promise<{ userId: string; created: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ user_id: string }>(
      `SELECT i.user_id FROM user_identities i JOIN users u ON u.id = i.user_id
        WHERE i.provider = $1 AND i.subject = $2 AND u.status <> 'deleted'`, [provider, subject]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { userId: existing.rows[0].user_id, created: false };
    }

    let userId: string | null = null;
    if (email) {
      const byEmail = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1 AND status <> 'deleted'`, [email]);
      userId = byEmail.rows[0]?.id ?? null;
    }
    const created = !userId;
    if (!userId) {
      const u = await client.query<{ id: string }>(
        `INSERT INTO users (email, auth_subject) VALUES ($1, $2) RETURNING id`,
        [email, `${provider}:${subject}`]);
      userId = u.rows[0]!.id;
    }
    await client.query(
      `INSERT INTO user_identities (user_id, provider, subject, email) VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, subject) DO NOTHING`, [userId, provider, subject, email]);
    await client.query("COMMIT");
    return { userId, created };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createSession(d: Deps, userId: string, userAgent?: string): Promise<string> {
  const token = randomToken(32);
  const now = nowOf(d);
  await d.pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent) VALUES ($1, $2, $3, $4)`,
    [userId, sha256(token), new Date(now.getTime() + d.config.sessionDays * 86_400_000),
     userAgent?.slice(0, 200) ?? null]);
  return token;
}

export async function sessionUser(d: Deps, token: string): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const now = nowOf(d);
  const { rows } = await d.pool.query(
    `SELECT s.id AS session_id, s.last_seen_at, u.id, u.email, u.display_name, u.birth_year,
            u.locale, u.trust_level
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status = 'active'`,
    [sha256(token), now]);
  const r = rows[0];
  if (!r) return null;
  // Touch at most hourly: a write on every request is wasted I/O.
  if (now.getTime() - new Date(r.last_seen_at).getTime() > 3_600_000) {
    void d.pool.query(`UPDATE sessions SET last_seen_at = $2 WHERE id = $1`, [r.session_id, now]).catch(() => {});
  }
  return {
    id: r.id, email: r.email, displayName: r.display_name, birthYear: r.birth_year,
    locale: r.locale, trustLevel: r.trust_level, sessionId: r.session_id,
  };
}

export async function revokeSession(d: Deps, sessionId: string): Promise<void> {
  await d.pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}
