/**
 * Business claims.
 *
 * A seeded listing must be claimable, or owners create duplicates. Two verification paths:
 *  - email_domain: the claimant proves control of an address AT THE VENUE'S OWN WEBSITE DOMAIN
 *    by entering a code sent there. Instant, and the strongest cheap signal available.
 *  - manual: everything else, reviewed by a person (npm run admin -- claims).
 *
 * Approval makes the claimant an owner, attaches the venue and its activities to a provider,
 * and records a claimed_listing event as an existing business relationship — which upgrades
 * the outreach agent's CASL consent basis (docs/alentour/14-outreach-agent.md).
 */
import type pg from "pg";
import type { Deps } from "../api/context.ts";
import { hmac, safeEqual, sixDigitCode } from "../api/crypto.ts";
import { isEmail, normalizeEmail } from "../api/auth.ts";

export const MAX_CLAIM_CODE_ATTEMPTS = 5;

/** Addresses anyone can create. They can never prove control of a business domain. */
const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.ca", "outlook.com", "live.com", "live.ca",
  "msn.com", "yahoo.com", "yahoo.ca", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me",
  "protonmail.com", "gmx.com", "videotron.ca", "sympatico.ca", "bell.net", "mail.com", "zoho.com",
]);

export function siteDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** True when `email` is at `domain` or one of its subdomains, and not a free-mail address. */
export function emailMatchesDomain(email: string, domain: string | null): boolean {
  if (!domain) return false;
  const at = normalizeEmail(email).split("@")[1] ?? "";
  if (!at || FREE_MAIL.has(at) || FREE_MAIL.has(domain)) return false;
  return at === domain || at.endsWith(`.${domain}`);
}

export interface ClaimInput {
  userId: string;
  venueId: string;
  businessName: string;
  role: string;
  contactEmail: string;
  contactPhone?: string | null;
  message?: string | null;
  lang?: string;
}

export type StartClaimResult =
  | { ok: true; claimId: string; method: "email_domain" | "manual" }
  | { ok: false; error: "venue_not_found" | "already_owner" | "claim_pending" | "invalid_email" };

export async function startClaim(d: Deps, input: ClaimInput): Promise<StartClaimResult> {
  const email = normalizeEmail(input.contactEmail);
  if (!isEmail(email)) return { ok: false, error: "invalid_email" };

  const venue = await d.pool.query<{ id: string; name: string; website: string | null; provider_id: string | null }>(
    `SELECT id, name, website, provider_id FROM venues WHERE id = $1`, [input.venueId]);
  const v = venue.rows[0];
  if (!v) return { ok: false, error: "venue_not_found" };

  if (v.provider_id) {
    const member = await d.pool.query(
      `SELECT 1 FROM provider_members WHERE provider_id = $1 AND user_id = $2`, [v.provider_id, input.userId]);
    if (member.rowCount) return { ok: false, error: "already_owner" };
  }

  const now = d.now ? d.now() : new Date();
  const method = emailMatchesDomain(email, siteDomain(v.website)) ? "email_domain" : "manual";
  const code = method === "email_domain" ? sixDigitCode() : null;

  let claimId: string;
  try {
    const { rows } = await d.pool.query<{ id: string }>(
      `INSERT INTO claims (venue_id, claimant_id, business_name, role, contact_email, contact_phone,
                           message, method, code_hash, code_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [v.id, input.userId, input.businessName.trim().slice(0, 120), input.role.trim().slice(0, 60),
       email, input.contactPhone?.trim().slice(0, 30) || null, input.message?.trim().slice(0, 2000) || null,
       method, code ? hmac(d.config.secret, `claim:${email}:${code}`) : null,
       code ? new Date(now.getTime() + 30 * 60_000) : null]);
    claimId = rows[0]!.id;
  } catch (err) {
    if (/claims_one_open_per_claimant/.test(String(err))) return { ok: false, error: "claim_pending" };
    throw err;
  }

  if (code) {
    const fr = (input.lang ?? "fr").startsWith("fr");
    await d.mailer.send({
      to: email,
      subject: fr ? `Vérifier ${v.name} sur Alentour : ${code}` : `Verify ${v.name} on Alentour: ${code}`,
      text: fr
        ? `Pour confirmer que tu gères ${v.name}, entre ce code : ${code}\nIl expire dans 30 minutes.`
        : `To confirm you manage ${v.name}, enter this code: ${code}\nIt expires in 30 minutes.`,
    });
  }
  return { ok: true, claimId, method };
}

export type VerifyClaimResult =
  | { ok: true; providerId: string }
  | { ok: false; error: "not_found" | "invalid_code" | "expired" | "too_many_attempts" | "not_pending" };

export async function verifyClaimCode(d: Deps, claimId: string, userId: string, code: string): Promise<VerifyClaimResult> {
  const { rows } = await d.pool.query(
    `SELECT id, contact_email, code_hash, code_expires_at, code_attempts, status, method
       FROM claims WHERE id = $1 AND claimant_id = $2`, [claimId, userId]);
  const c = rows[0];
  if (!c || c.method !== "email_domain") return { ok: false, error: "not_found" };
  if (c.status !== "pending") return { ok: false, error: "not_pending" };
  if (c.code_attempts >= MAX_CLAIM_CODE_ATTEMPTS) return { ok: false, error: "too_many_attempts" };
  const now = d.now ? d.now() : new Date();
  if (new Date(c.code_expires_at).getTime() < now.getTime()) return { ok: false, error: "expired" };

  if (!safeEqual(hmac(d.config.secret, `claim:${c.contact_email}:${String(code).trim()}`), c.code_hash)) {
    await d.pool.query(`UPDATE claims SET code_attempts = code_attempts + 1 WHERE id = $1`, [claimId]);
    return { ok: false, error: "invalid_code" };
  }
  const providerId = await approveClaim(d.pool, claimId, "system:email_domain", now);
  return { ok: true, providerId };
}

/**
 * Approve a claim: one transaction that creates (or reuses) the provider, attaches the venue and
 * every activity located there, makes the claimant an owner, and records the business
 * relationship for CASL. Other pending claims on the same venue are left for a human to settle.
 */
export async function approveClaim(pool: pg.Pool, claimId: string, reviewer: string, now = new Date()): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT c.*, v.provider_id AS venue_provider FROM claims c JOIN venues v ON v.id = c.venue_id
        WHERE c.id = $1 FOR UPDATE OF c`, [claimId]);
    const c = rows[0];
    if (!c) throw new Error("claim not found");
    if (c.status !== "pending") throw new Error(`claim is ${c.status}, not pending`);

    let providerId: string = c.venue_provider;
    if (!providerId) {
      const p = await client.query<{ id: string }>(
        `INSERT INTO providers (display_name, claim_status, claim_method, claimed_at)
         VALUES ($1, 'verified', $2, $3) RETURNING id`, [c.business_name, c.method, now]);
      providerId = p.rows[0]!.id;
      await client.query(`UPDATE venues SET provider_id = $1 WHERE id = $2`, [providerId, c.venue_id]);
    }
    await client.query(
      `UPDATE activities SET provider_id = $1
        WHERE provider_id IS NULL AND id IN (SELECT activity_id FROM activity_locations WHERE venue_id = $2)`,
      [providerId, c.venue_id]);
    await client.query(
      `INSERT INTO provider_members (provider_id, user_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT (provider_id, user_id) DO NOTHING`, [providerId, c.claimant_id]);
    await client.query(
      `UPDATE claims SET status = 'verified', reviewed_by = $2, reviewed_at = $3 WHERE id = $1`,
      [claimId, reviewer, now]);

    // CASL: a claimed listing is an existing business relationship for 24 months.
    const contact = await client.query<{ id: string }>(
      `INSERT INTO business_contacts (provider_id, venue_id, email, locale)
       VALUES ($1, $2, $3, 'fr-CA')
       ON CONFLICT (email) DO UPDATE SET provider_id = EXCLUDED.provider_id, venue_id = EXCLUDED.venue_id
       RETURNING id`, [providerId, c.venue_id, c.contact_email]);
    await client.query(
      `INSERT INTO consent_records (contact_id, basis, event_type, event_at, event_detail, expires_at)
       VALUES ($1, 'existing_business_relationship', 'claimed_listing', $2, $3, $4)`,
      [contact.rows[0]!.id, now, JSON.stringify({ claimId }), new Date(now.getTime() + 730 * 86_400_000)]);

    await client.query("COMMIT");
    return providerId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function rejectClaim(pool: pg.Pool, claimId: string, reviewer: string, note: string): Promise<void> {
  const r = await pool.query(
    `UPDATE claims SET status = 'rejected', reviewed_by = $2, review_note = $3, reviewed_at = now()
      WHERE id = $1 AND status = 'pending'`, [claimId, reviewer, note.slice(0, 500)]);
  if (r.rowCount !== 1) throw new Error("claim not found or not pending");
}

/** Venue ids the user can edit. */
export async function managedProviderIds(pool: pg.Pool, userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ provider_id: string }>(
    `SELECT provider_id FROM provider_members WHERE user_id = $1`, [userId]);
  return rows.map((r) => r.provider_id);
}
