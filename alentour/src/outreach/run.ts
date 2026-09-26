/**
 * Outreach orchestrator.
 *
 * Defaults to DRY RUN: it drafts and queues, but never sends. Keep it that way until a
 * lawyer has reviewed the templates and the consent logic (docs/alentour/14-outreach-agent.md).
 *
 *   npm run outreach:run            # dry run, prints what it would queue
 *   OUTREACH_DRY_RUN=0 npm run …    # writes drafts to the approval queue
 *
 * Nothing in this file sends email. Sending happens only after human approval, through a
 * separate transport that reads status='approved'.
 */
import pg from "pg";
import { findDemandSignals } from "./demand.ts";
import { gate, venueLocalNow } from "./consent.ts";
import { draftMessage } from "./draft.ts";
import { verifyDraft } from "./verify.ts";
import { renderEmail, senderFromEnv } from "./render.ts";
import type { BusinessContact, ConsentRecord, OutreachHistory } from "./types.ts";

const DRY_RUN = process.env.OUTREACH_DRY_RUN !== "0";
const DAILY_CAP = Number(process.env.OUTREACH_DAILY_CAP ?? 20);

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const sender = senderFromEnv();          // fails fast if identity is incomplete
  const now = new Date();

  const signals = await findDemandSignals(pool, { limit: DAILY_CAP * 3 });
  console.log(`Found ${signals.length} venues with demand above threshold.\n`);

  let queued = 0;
  const refusals = new Map<string, number>();

  for (const signal of signals) {
    if (queued >= DAILY_CAP) {
      console.log(`\nDaily cap of ${DAILY_CAP} reached — stopping.`);
      break;
    }

    const contact = await loadContact(pool, signal.venueId);
    if (!contact) { bump(refusals, "no_contact"); continue; }

    const [consents, history, suppressed] = await Promise.all([
      loadConsents(pool, contact.id),
      loadHistory(pool, contact.id),
      isSuppressed(pool, contact),
    ]);

    const verdict = gate({
      contact,
      consents,
      signal: { ...signal, id: "pending" },
      history,
      suppressed,
      now,
      localNow: venueLocalNow(now, "America/Toronto")   // one city; every venue is in Montréal time,
    });

    if (!verdict.allowed) {
      bump(refusals, verdict.reason);
      continue;
    }

    const draft = await draftMessage({ contact, signal: { ...signal, id: "pending" }, locale: contact.locale });
    const check = verifyDraft(draft, { ...signal, id: "pending" });

    if (!check.ok) {
      // One regeneration, then give up — a model that keeps inventing will keep inventing.
      console.warn(`✗ ${signal.venueName}: ${check.problems.join("; ")} — regenerating once`);
      const retry = await draftMessage({ contact, signal: { ...signal, id: "pending" }, locale: contact.locale });
      const recheck = verifyDraft(retry, { ...signal, id: "pending" });
      if (!recheck.ok) {
        console.warn(`✗ ${signal.venueName}: still failing verification, skipped`);
        bump(refusals, "verification_failed");
        continue;
      }
      Object.assign(draft, retry);
    }

    const rendered = renderEmail(draft, sender, "PREVIEW-TOKEN", verdict.basis);
    queued++;

    console.log(`\n${"─".repeat(72)}`);
    console.log(`▸ ${signal.venueName}  <${contact.email}>`);
    console.log(`  basis: ${verdict.basis}   users: ${signal.distinctUsers}   saves: ${signal.savesCount}`);
    console.log(`  subject: ${rendered.subject}`);
    console.log(rendered.text.split("\n").map((l) => `  │ ${l}`).join("\n"));

    if (!DRY_RUN) {
      await queueForApproval(pool, { contact, signal, draft, consentId: verdict.consentId });
      console.log("  → queued for your approval");
    }
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(DRY_RUN ? `DRY RUN — nothing written. ${queued} would be queued.`
                      : `${queued} drafts queued for approval.`);
  if (refusals.size) {
    console.log("Skipped:");
    for (const [reason, n] of [...refusals].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${reason}`);
    }
  }
  await pool.end();
}

// ---------------------------------------------------------------- data access

async function loadContact(pool: pg.Pool, venueId: string): Promise<BusinessContact | null> {
  const { rows } = await pool.query(
    `SELECT c.id, c.email, c.email_domain, c.contact_name, c.locale, c.venue_id, c.provider_id
       FROM business_contacts c
      WHERE c.venue_id = $1
         OR c.provider_id = (SELECT provider_id FROM activities a
                              JOIN activity_locations al ON al.activity_id = a.id
                             WHERE al.venue_id = $1 AND a.provider_id IS NOT NULL LIMIT 1)
      LIMIT 1`,
    [venueId],
  );
  const r = rows[0];
  return r ? {
    id: r.id, email: r.email, emailDomain: r.email_domain,
    contactName: r.contact_name, locale: r.locale,
    venueId: r.venue_id, providerId: r.provider_id,
  } : null;
}

async function loadConsents(pool: pg.Pool, contactId: string): Promise<ConsentRecord[]> {
  const { rows } = await pool.query(
    `SELECT id, contact_id, basis, source_url, captured_at, anti_solicitation_checked,
            anti_solicitation_found, relevance_note, event_type, event_at, expires_at
       FROM consent_records WHERE contact_id = $1`,
    [contactId],
  );
  return rows.map((r) => ({
    id: r.id, contactId: r.contact_id, basis: r.basis,
    sourceUrl: r.source_url, capturedAt: r.captured_at,
    antiSolicitationChecked: r.anti_solicitation_checked,
    antiSolicitationFound: r.anti_solicitation_found,
    relevanceNote: r.relevance_note,
    eventType: r.event_type, eventAt: r.event_at, expiresAt: r.expires_at,
  }));
}

async function loadHistory(pool: pg.Pool, contactId: string): Promise<OutreachHistory> {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
            max(sent_at)                                     AS last_sent,
            bool_or(replied_at IS NOT NULL)                  AS replied
       FROM outreach_messages WHERE contact_id = $1`,
    [contactId],
  );
  const r = rows[0];
  return {
    lifetimeSent: r?.sent ?? 0,
    lastSentAt: r?.last_sent ?? null,
    everReplied: r?.replied ?? false,
  };
}

/** Suppression matches the address or the whole domain. Domain scope is deliberate: one
 *  person at a business unsubscribing speaks for the business. */
async function isSuppressed(pool: pg.Pool, contact: BusinessContact): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM suppressions
      WHERE (scope = 'email'  AND email_or_domain = lower($1))
         OR (scope = 'domain' AND email_or_domain = lower($2)) LIMIT 1`,
    [contact.email, contact.emailDomain],
  );
  return rows.length > 0;
}

async function queueForApproval(
  pool: pg.Pool,
  args: { contact: BusinessContact; signal: Omit<Parameters<typeof verifyDraft>[1], "id">;
          draft: Awaited<ReturnType<typeof draftMessage>>; consentId: string },
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO demand_signals
         (venue_id, activity_id, window_days, distinct_users, saves_count, failed_rallies,
          top_slots, segments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [args.signal.venueId, args.signal.activityId, args.signal.windowDays,
       args.signal.distinctUsers, args.signal.savesCount, args.signal.failedRallies,
       JSON.stringify(args.signal.topSlots), JSON.stringify(args.signal.segments)],
    );
    await client.query(
      `INSERT INTO outreach_messages
         (contact_id, signal_id, consent_id, locale, subject, body, claims, proposed_slots,
          model, verified, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'draft')`,
      [args.contact.id, rows[0].id, args.consentId, args.draft.locale,
       args.draft.subject, args.draft.body, JSON.stringify(args.draft.claims),
       JSON.stringify(args.draft.proposedSlots), "claude-opus-5"],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
