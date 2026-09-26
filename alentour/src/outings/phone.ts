/**
 * Phone verification, required to join any outing (docs/alentour/08): about a cent per SMS, and
 * it stops casual repeat abuse better than anything else at this budget. Codes are stored as an
 * HMAC, single-use, five attempts, ten minutes. One phone number, one account.
 */
import { randomInt } from "node:crypto";
import type pg from "pg";
import { hmac, safeEqual } from "../api/crypto.ts";

export interface Sms { send(to: string, text: string): Promise<void> }

export class ConsoleSms implements Sms {
  async send(to: string, text: string) { console.log(`\n📱 to ${to}: ${text}\n`); }
}
export class MemorySms implements Sms {
  sent: { to: string; text: string }[] = [];
  async send(to: string, text: string) { this.sent.push({ to, text }); }
  last(to: string) { return [...this.sent].reverse().find((m) => m.to === to); }
}
/** Twilio's Messages API with a Messaging Service; any provider with the same `send` works. */
export class TwilioSms implements Sms {
  sid: string; token: string; service: string; fetchImpl: typeof fetch;
  constructor(sid: string, token: string, service: string, fetchImpl: typeof fetch = fetch) {
    this.sid = sid; this.token = token; this.service = service; this.fetchImpl = fetchImpl;
  }
  async send(to: string, text: string) {
    const res = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, MessagingServiceSid: this.service, Body: text }),
    });
    if (!res.ok) throw new Error(`SMS provider answered ${res.status}`);
  }
}
export function smsFromEnv(env: NodeJS.ProcessEnv = process.env): Sms {
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_MESSAGING_SERVICE_SID) {
    return new TwilioSms(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_MESSAGING_SERVICE_SID);
  }
  if (env.NODE_ENV === "production") throw new Error("TWILIO_* must be set in production");
  return new ConsoleSms();
}

/** Canadian/US numbers only: the product is one city. */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10 || /^[01]/.test(ten) || /^\d{3}[01]/.test(ten)) return null;
  return `+1${ten}`;
}

const TTL_MS = 10 * 60_000;

export async function startPhoneVerification(
  pool: pg.Pool, sms: Sms, secret: string, userId: string, raw: string, locale: string, now: Date,
): Promise<{ ok: true } | { ok: false; error: "invalid_phone" | "phone_in_use" | "rate_limited" }> {
  const phone = normalizePhone(raw);
  if (!phone) return { ok: false, error: "invalid_phone" };
  const taken = await pool.query(`SELECT 1 FROM users WHERE phone_e164 = $1 AND id <> $2 AND status = 'active'`, [phone, userId]);
  if (taken.rowCount) return { ok: false, error: "phone_in_use" };
  const recent = await pool.query(`SELECT count(*)::int AS n FROM phone_codes WHERE user_id = $1 AND created_at > $2`,
    [userId, new Date(now.getTime() - 3_600_000)]);
  if (recent.rows[0].n >= 3) return { ok: false, error: "rate_limited" };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(
    `INSERT INTO phone_codes (user_id, phone_e164, code_hash, expires_at, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [userId, phone, hmac(secret, `phone:${userId}:${phone}:${code}`), new Date(now.getTime() + TTL_MS), now]);
  await sms.send(phone, locale.startsWith("en") ? `Alentour code: ${code}` : `Code Alentour : ${code}`);
  return { ok: true };
}

export async function verifyPhone(pool: pg.Pool, secret: string, userId: string, code: string, now: Date): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE phone_codes SET attempts = attempts + 1
      WHERE id = (SELECT id FROM phone_codes WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > $2
                   ORDER BY created_at DESC LIMIT 1)
        AND attempts < 5
      RETURNING id, phone_e164, code_hash`, [userId, now]);
  const r = rows[0];
  if (!r || !safeEqual(hmac(secret, `phone:${userId}:${r.phone_e164}:${code.trim()}`), r.code_hash)) return false;
  const consumed = await pool.query(`UPDATE phone_codes SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL`, [r.id, now]);
  if (!consumed.rowCount) return false;
  try {
    await pool.query(`UPDATE users SET phone_e164 = $2, phone_verified_at = $3, verified_phone = true WHERE id = $1`, [userId, r.phone_e164, now]);
  } catch {
    return false;                            // someone verified the same number in the meantime
  }
  return true;
}
