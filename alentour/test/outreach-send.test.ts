/** The outreach agent's second half: human approval, sending, and the CASL unsubscribe. */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { createApp } from "../src/api/app.ts";
import { freshDatabase, hasDatabase, makeDeps } from "./helpers/db.ts";
import { MemoryMailer } from "../src/api/mailer.ts";
import { sendApproved } from "../src/outreach/send.ts";
import { venueLocalNow, withinSendWindow } from "../src/outreach/consent.ts";
import { run as admin } from "../scripts/admin.ts";
import type { SenderIdentity } from "../src/outreach/render.ts";

const SENDER: SenderIdentity = {
  appName: "Alentour", personName: "Loriane", replyTo: "loriane@alentour.test",
  mailingAddress: "123 Rue Exemple, Montréal, QC H2X 1Y4", unsubscribeBase: "https://api.alentour.test/u",
};
const TUESDAY_10AM = new Date("2026-09-01T14:00:00Z");   // 10:00 in Montréal
const SATURDAY = new Date("2026-09-05T14:00:00Z");
const VENUE = "a0000001-0000-4000-8000-000000000008";

test("quiet hours are Montréal's, whatever the server's clock zone", () => {
  assert.equal(withinSendWindow(venueLocalNow(new Date("2026-09-01T12:30:00Z"), "America/Toronto")), true, "08:30 Montréal");
  assert.equal(withinSendWindow(venueLocalNow(new Date("2026-09-01T11:30:00Z"), "America/Toronto")), false, "07:30 Montréal, 11:30 UTC");
  assert.equal(withinSendWindow(venueLocalNow(new Date("2026-09-01T22:30:00Z"), "America/Toronto")), false, "18:30 Montréal");
});

describe("sending outreach", { skip: !hasDatabase() && "DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  before(async () => {
    pool = await freshDatabase("outreachsend");
    app = createApp(makeDeps(pool), { trustProxy: true });
  });
  after(async () => { await pool?.end(); });

  async function draft(email: string, basis: "express_consent" | "existing_business_relationship" = "express_consent") {
    const contact = (await pool.query(
      `INSERT INTO business_contacts (venue_id, email) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [VENUE, email])).rows[0].id;
    const consent = (await pool.query(
      `INSERT INTO consent_records (contact_id, basis, event_type, event_at, expires_at) VALUES ($1, $2, 'opt_in_form', '2026-08-01', $3) RETURNING id`,
      [contact, basis, basis === "express_consent" ? null : "2028-08-01"])).rows[0].id;
    const signal = (await pool.query(
      `INSERT INTO demand_signals (venue_id, window_days, distinct_users, saves_count) VALUES ($1, 30, 7, 9) RETURNING id`, [VENUE])).rows[0].id;
    return (await pool.query(
      `INSERT INTO outreach_messages (contact_id, signal_id, consent_id, locale, subject, body, verified, status)
       VALUES ($1, $2, $3, 'fr-CA', '7 personnes ont enregistré votre atelier', 'Bonjour, 7 personnes…', true, 'draft') RETURNING id, unsubscribe_token`,
      [contact, signal, consent])).rows[0];
  }

  test("nothing is sent without approval, or while the dry-run switch is on", async () => {
    const m = await draft("atelier@ceramiccafe.ca");
    const mailer = new MemoryMailer();
    assert.equal((await sendApproved(pool, mailer, SENDER, { now: TUESDAY_10AM, dryRun: false, dailyCap: 20 })).sent, 0, "drafts are not sent");
    const lines: string[] = [];
    await admin(pool, ["outreach"], (x) => lines.push(x));
    assert.ok(lines.join("\n").includes("7 personnes ont enregistré"), "the operator reads the whole message before approving");
    await admin(pool, ["outreach-approve", m.id], () => {});
    assert.deepEqual((await sendApproved(pool, mailer, SENDER, { now: TUESDAY_10AM, dryRun: true, dailyCap: 20 })).skipped, { dry_run: 1 });
    assert.deepEqual((await sendApproved(pool, mailer, SENDER, { now: SATURDAY, dryRun: false, dailyCap: 20 })).skipped, { quiet_hours: 1 });
    assert.equal(mailer.sent.length, 0);
  });

  test("an approved message goes out with the legal footer, a one-click unsubscribe, and a permanent log", async () => {
    const mailer = new MemoryMailer();
    const r = await sendApproved(pool, mailer, SENDER, { now: TUESDAY_10AM, dryRun: false, dailyCap: 20 });
    assert.equal(r.sent, 1);
    const mail = mailer.sent[0]!;
    assert.match(mail.text, /123 Rue Exemple, Montréal/);
    assert.match(mail.text, /parce que vous avez accepté d'avoir des nouvelles/, "the footer states the real basis");
    const token = (await pool.query(`SELECT unsubscribe_token FROM outreach_messages WHERE status = 'sent'`)).rows[0].unsubscribe_token;
    assert.equal(mail.headers?.["List-Unsubscribe"], `<https://api.alentour.test/u/${token}>`);
    assert.equal(mail.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.equal(mail.replyTo, "loriane@alentour.test");
    const logged = (await pool.query(`SELECT rendered_body, consent_basis FROM outreach_send_log`)).rows[0];
    assert.equal(logged.consent_basis, "express_consent");
    assert.ok(logged.rendered_body.includes(mail.text), "the log holds exactly what was sent");
  });

  test("a second message to the same business within 30 days is refused by the database", async () => {
    const m = await draft("atelier@ceramiccafe.ca");
    await admin(pool, ["outreach-approve", m.id], () => {});
    const mailer = new MemoryMailer();
    const r = await sendApproved(pool, mailer, SENDER, { now: new Date("2026-09-08T14:00:00Z"), dryRun: false, dailyCap: 20 });
    assert.deepEqual(r, { sent: 0, skipped: { frequency_cap_30d: 1 } });
    assert.equal(mailer.sent.length, 0, "nothing leaves when the send can't be recorded");
  });

  test("unsubscribe: a confirmation page, then a permanent domain-wide suppression", async () => {
    const token = (await pool.query(`SELECT unsubscribe_token FROM outreach_messages WHERE status = 'sent'`)).rows[0].unsubscribe_token;
    const page = await app.request(`/u/${token}`);
    assert.equal(page.status, 200);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM suppressions`)).rows[0].n, 0, "looking at the page (or a link scanner) changes nothing");
    const done = await app.request(`/u/${token}`, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.equal(done.status, 200);
    const s = (await pool.query(`SELECT email_or_domain, scope FROM suppressions`)).rows;
    assert.deepEqual(s, [{ email_or_domain: "ceramiccafe.ca", scope: "domain" }]);
    const pending = (await pool.query(`SELECT count(*)::int AS n FROM outreach_messages WHERE status = 'approved'`)).rows[0].n;
    assert.equal(pending, 0, "anything queued for that business is withdrawn");

    const other = await draft("owner@ceramiccafe.ca");
    await admin(pool, ["outreach-approve", other.id], () => {});
    const r = await sendApproved(pool, new MemoryMailer(), SENDER, { now: new Date("2026-10-06T14:00:00Z"), dryRun: false, dailyCap: 20 });
    assert.deepEqual(r.skipped, { suppressed: 1 }, "another address at the same business is suppressed too");
    assert.equal((await app.request("/u/not-a-token", { method: "POST" })).status, 404);
  });
});
