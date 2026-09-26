/**
 * The sending half of the outreach agent. Only messages a human approved are sent, and every
 * check that could have changed since approval runs again at send time: suppression (someone
 * may have unsubscribed an hour ago), the consent basis (an EBR can lapse), quiet hours in
 * Montréal time, the 30-day spacing, and the daily cap.
 *
 * Each send is one transaction: the message is marked sent (the database's exclusion
 * constraint refuses a second message to the same contact within 30 days), the exact rendered
 * text goes into the immutable send log, then the email leaves. If the email fails, nothing
 * is recorded as sent.
 */
import type pg from "pg";
import type { Mailer } from "../api/mailer.ts";
import { validateConsent, venueLocalNow, withinSendWindow } from "./consent.ts";
import { renderEmail, unsubscribeUrl, type SenderIdentity } from "./render.ts";

export interface SendOptions { now: Date; dryRun: boolean; dailyCap: number; log?: (s: string) => void }

export async function sendApproved(pool: pg.Pool, mailer: Mailer, sender: SenderIdentity, o: SendOptions) {
  const log = o.log ?? (() => {});
  const result = { sent: 0, skipped: {} as Record<string, number> };
  const skip = (why: string) => { result.skipped[why] = (result.skipped[why] ?? 0) + 1; };
  if (o.dryRun) { log("OUTREACH_DRY_RUN is on — nothing will be sent."); skip("dry_run"); return result; }
  if (!withinSendWindow(venueLocalNow(o.now, "America/Toronto"))) { log("Outside weekday business hours in Montréal."); skip("quiet_hours"); return result; }

  const already = (await pool.query(`SELECT count(*)::int AS n FROM outreach_send_log WHERE sent_at > $1`,
    [new Date(o.now.getTime() - 86_400_000)])).rows[0].n;
  let room = Math.max(0, o.dailyCap - already);

  const { rows } = await pool.query(
    `SELECT m.*, c.email, c.email_domain, cr.basis, cr.source_url, cr.captured_at, cr.anti_solicitation_checked,
            cr.anti_solicitation_found, cr.relevance_note, cr.event_type, cr.event_at, cr.expires_at, cr.id AS consent_record_id
       FROM outreach_messages m
       JOIN business_contacts c ON c.id = m.contact_id
       JOIN consent_records cr ON cr.id = m.consent_id
      WHERE m.status = 'approved' ORDER BY m.reviewed_at`);

  for (const m of rows) {
    if (room <= 0) { skip("daily_cap"); continue; }
    const suppressed = await pool.query(
      `SELECT 1 FROM suppressions WHERE (scope = 'email' AND email_or_domain = lower($1)) OR (scope = 'domain' AND email_or_domain = lower($2))`,
      [m.email, m.email_domain]);
    if (suppressed.rowCount) {
      await pool.query(`UPDATE outreach_messages SET status = 'rejected' WHERE id = $1`, [m.id]);
      skip("suppressed"); continue;
    }
    const consentProblem = validateConsent({
      id: m.consent_record_id, contactId: m.contact_id, basis: m.basis, sourceUrl: m.source_url, capturedAt: m.captured_at,
      antiSolicitationChecked: m.anti_solicitation_checked, antiSolicitationFound: m.anti_solicitation_found,
      relevanceNote: m.relevance_note, eventType: m.event_type, eventAt: m.event_at, expiresAt: m.expires_at,
    }, o.now);
    if (consentProblem) { skip(consentProblem); continue; }

    const rendered = renderEmail({ subject: m.subject, body: m.body, locale: m.locale, proposedSlots: m.proposed_slots, claims: m.claims },
      sender, m.unsubscribe_token, m.basis);
    const url = unsubscribeUrl(sender, m.unsubscribe_token);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`UPDATE outreach_messages SET status = 'sent', sent_at = $2 WHERE id = $1 AND status = 'approved'`, [m.id, o.now]);
      await c.query(
        `INSERT INTO outreach_send_log (message_id, contact_email, consent_basis, consent_evidence, rendered_body, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [m.id, m.email, m.basis, JSON.stringify({ consentId: m.consent_record_id, sourceUrl: m.source_url, eventType: m.event_type, eventAt: m.event_at }),
         `Subject: ${rendered.subject}\n\n${rendered.text}`, o.now]);
      await mailer.send({
        to: m.email, subject: rendered.subject, text: rendered.text, replyTo: sender.replyTo,
        // RFC 8058 one-click unsubscribe, which the big mailbox providers now expect.
        headers: { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      await c.query("COMMIT");
      result.sent++; room--;
      log(`  ✓ sent to ${m.email}`);
    } catch (err) {
      await c.query("ROLLBACK");
      const msg = (err as Error).message;
      skip(/outreach_one_per_30d/.test(msg) ? "frequency_cap_30d" : "send_failed");
      log(`  ✗ ${m.email}: ${msg}`);
    } finally {
      c.release();
    }
  }
  return result;
}

/** Permanent, domain-wide: one person at a business unsubscribing speaks for the business. */
export async function unsubscribe(pool: pg.Pool, token: string): Promise<boolean> {
  const { rows } = await pool.query(
    `UPDATE outreach_messages m SET status = 'unsubscribed'
       FROM business_contacts c WHERE c.id = m.contact_id AND m.unsubscribe_token = $1
     RETURNING c.email_domain`, [token]);
  if (!rows[0]) return false;
  await pool.query(
    `INSERT INTO suppressions (email_or_domain, scope, reason) VALUES (lower($1), 'domain', 'unsubscribed') ON CONFLICT DO NOTHING`,
    [rows[0].email_domain]);
  await pool.query(
    `UPDATE outreach_messages SET status = 'rejected' WHERE status IN ('draft', 'approved')
        AND contact_id IN (SELECT id FROM business_contacts WHERE email_domain = lower($1))`, [rows[0].email_domain]);
  return true;
}
