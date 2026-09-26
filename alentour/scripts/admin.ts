/**
 * The solo operator's toolbox. A CLI, not a dashboard: one person does not need a UI to
 * review ten claims a week, and a CLI cannot be left logged in on a shared laptop.
 *
 *   npm run admin -- stats
 *   npm run admin -- claims                     pending claims, oldest first
 *   npm run admin -- approve <claim-id>
 *   npm run admin -- reject  <claim-id> "why"
 *   npm run admin -- reports                    open reports, most severe first
 *   npm run admin -- resolve <report-id> actioned|dismissed "note"
 *   npm run admin -- pending                    listings waiting for review (seeded or self-serve)
 *   npm run admin -- publish <venue-id>         publish a venue's pending listings (+ verify its business)
 *   npm run admin -- hide <activity-id>         take one listing out of the catalog
 *   npm run admin -- media                      photos waiting for a human (faces, no triage)
 *   npm run admin -- media-ok <media-id> | media-no <media-id>
 *   npm run admin -- jobs                       recent enrichment jobs, with token use
 *   npm run admin -- stale                      published listings nobody confirmed in a year
 *   npm run admin -- outings                    paused and upcoming outings
 *   npm run admin -- unpause <outing-id> | cancel <outing-id> "why"
 *   npm run admin -- pause-outings on|off       the whole feature (joins, votes, new outings)
 *   npm run admin -- pause-creation on|off      only new outings — flip this before going away
 *   npm run admin -- restrict <user-id> <days>  keep someone out of outings for a while
 *   npm run admin -- reject-submission <activity-id> "why"   a community submission that won't be published
 */
import pg from "pg";
import { approveClaim, rejectClaim } from "../src/claims/claims.ts";
import { staleListings } from "../src/freshness/nudge.ts";
import { setSettings } from "../src/outings/core.ts";
import { recomputeTrust, rejectSubmission } from "../src/community/submissions.ts";

const REVIEWER = `admin:${process.env.USER ?? "cli"}`;

export async function run(pool: pg.Pool, argv: string[], out: (s: string) => void = console.log): Promise<number> {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "stats": {
      const { rows } = await pool.query(`SELECT
        (SELECT count(*) FROM activities WHERE status = 'published')::int AS activities,
        (SELECT count(*) FROM users WHERE status = 'active')::int AS users,
        (SELECT count(*) FROM saves)::int AS saves,
        (SELECT count(*) FROM providers WHERE claim_status = 'verified')::int AS claimed,
        (SELECT count(*) FROM claims WHERE status = 'pending')::int AS pending_claims,
        (SELECT count(*) FROM reports WHERE status = 'open')::int AS open_reports,
        (SELECT count(*) FROM reports WHERE status = 'open' AND severity >= 3)::int AS urgent_reports,
        (SELECT count(*) FROM activities WHERE status = 'pending_review')::int AS pending_listings,
        (SELECT count(*) FROM media WHERE safety_status = 'pending')::int AS pending_media,
        (SELECT count(*) FROM outings WHERE status = 'paused')::int AS paused_outings,
        (SELECT count(*) FROM outings WHERE status = 'confirmed' AND starts_at > now())::int AS upcoming_outings`);
      for (const [k, v] of Object.entries(rows[0])) out(`${k.padEnd(16)} ${v}`);
      return 0;
    }
    case "claims": {
      const { rows } = await pool.query(
        `SELECT c.id, c.created_at, c.method, c.business_name, c.role, c.contact_email, c.contact_phone,
                c.message, v.name AS venue, v.website,
                (SELECT count(*) FROM claims c2 WHERE c2.venue_id = c.venue_id AND c2.status = 'pending')::int AS competing
           FROM claims c JOIN venues v ON v.id = c.venue_id
          WHERE c.status = 'pending' ORDER BY c.created_at`);
      if (!rows.length) { out("No pending claims."); return 0; }
      for (const r of rows) {
        out(`\n${r.id}  ${r.created_at.toISOString().slice(0, 10)}  [${r.method}]`);
        out(`  venue:   ${r.venue}  ${r.website ?? "(no website)"}`);
        out(`  claimant ${r.business_name} — ${r.role} — ${r.contact_email}${r.contact_phone ? ` — ${r.contact_phone}` : ""}`);
        if (r.message) out(`  message: ${r.message}`);
        if (r.competing > 1) out(`  ⚠ ${r.competing} pending claims on this venue — contested; verify by phone before approving.`);
      }
      return 0;
    }
    case "approve": {
      if (!args[0]) { out("usage: approve <claim-id>"); return 2; }
      const providerId = await approveClaim(pool, args[0], REVIEWER);
      out(`✓ approved — provider ${providerId}`);
      return 0;
    }
    case "reject": {
      if (!args[0] || !args[1]) { out('usage: reject <claim-id> "reason"'); return 2; }
      await rejectClaim(pool, args[0], REVIEWER, args[1]);
      out("✓ rejected");
      return 0;
    }
    case "reports": {
      const { rows } = await pool.query(
        `SELECT r.id, r.created_at, r.severity, r.reason, r.subject_type, r.subject_id, r.details,
                COALESCE(c.title, r.subject_id) AS subject
           FROM reports r
           LEFT JOIN activity_content c ON r.subject_type = 'activity' AND c.activity_id::text = r.subject_id AND c.locale = 'fr-CA'
          WHERE r.status = 'open' ORDER BY r.severity DESC, r.created_at LIMIT 50`);
      if (!rows.length) { out("No open reports."); return 0; }
      for (const r of rows) {
        out(`${"!".repeat(r.severity).padEnd(4)} ${r.id}  ${r.created_at.toISOString().slice(0, 16)}  ${r.reason.padEnd(10)} ${r.subject_type}: ${r.subject}`);
        if (r.details) out(`       “${r.details}”`);
      }
      return 0;
    }
    case "resolve": {
      const [id, outcome, note] = args;
      if (!id || (outcome !== "actioned" && outcome !== "dismissed")) {
        out('usage: resolve <report-id> actioned|dismissed "note"'); return 2;
      }
      const r = await pool.query(
        `UPDATE reports SET status = $2, resolution = $3, resolved_at = now() WHERE id = $1 AND status = 'open'`,
        [id, outcome, note ?? null]);
      out(r.rowCount ? "✓ resolved" : "not found or already resolved");
      return r.rowCount ? 0 : 1;
    }
    case "pending": {
      const { rows } = await pool.query(
        `SELECT v.id AS venue_id, v.name, v.website, a.id, a.origin, a.primary_category, c.title,
                p.display_name, p.claim_status, a.tag_slugs,
                (SELECT string_agg(u.email, ', ') FROM provider_members m JOIN users u ON u.id = m.user_id
                  WHERE m.provider_id = a.provider_id) AS owners
           FROM activities a
           JOIN activity_locations l ON l.activity_id = a.id AND l.is_primary
           JOIN venues v ON v.id = l.venue_id
           LEFT JOIN activity_content c ON c.activity_id = a.id AND c.locale = 'fr-CA'
           LEFT JOIN providers p ON p.id = a.provider_id
          WHERE a.status = 'pending_review' ORDER BY v.name, a.slug LIMIT 200`);
      if (!rows.length) { out("Nothing pending."); return 0; }
      let venue = "";
      for (const r of rows) {
        if (r.venue_id !== venue) {
          venue = r.venue_id;
          out(`\n${r.venue_id}  ${r.name}  ${r.website ?? ""}`);
          if (r.owners) out(`  owner: ${r.owners} (business ${r.claim_status}; email not at the website's domain — check by phone)`);
        }
        out(`  [${r.origin}] ${r.title ?? r.id} — ${r.primary_category} — ${(r.tag_slugs ?? []).join(" ")}`);
      }
      return 0;
    }
    case "publish": {
      if (!args[0]) { out("usage: publish <venue-id>"); return 2; }
      const r = await pool.query(
        `UPDATE activities SET status = 'published', updated_at = now(), last_verified_at = COALESCE(last_verified_at, now())
          WHERE status = 'pending_review' AND id IN (SELECT activity_id FROM activity_locations WHERE venue_id = $1)
          RETURNING created_by`, [args[0]]);
      for (const by of new Set(r.rows.map((x) => x.created_by).filter(Boolean))) {
        await recomputeTrust(pool, by);
        await pool.query(
          `INSERT INTO notifications (user_id, kind, title, body) VALUES ($1, 'submission', 'Publié / Published', 'Merci ! Ton ajout est maintenant dans Alentour. / Thanks! Your addition is now on Alentour.')`, [by]);
      }
      await pool.query(
        `UPDATE providers SET claim_status = 'verified', claimed_at = COALESCE(claimed_at, now())
          WHERE claim_status = 'pending' AND id = (SELECT provider_id FROM venues WHERE id = $1)`, [args[0]]);
      out(`✓ ${r.rowCount} listing(s) published — they reach the app with the next catalog export`);
      return 0;
    }
    case "hide": {
      if (!args[0]) { out("usage: hide <activity-id>"); return 2; }
      const r = await pool.query(`UPDATE activities SET status = 'hidden', updated_at = now() WHERE id = $1`, [args[0]]);
      out(r.rowCount ? "✓ hidden" : "not found");
      return r.rowCount ? 0 : 1;
    }
    case "media": {
      const { rows } = await pool.query(
        `SELECT m.id, m.owner_type, m.owner_id, m.storage_key, m.has_faces, m.triage->>'kind' AS kind, m.created_at
           FROM media m WHERE m.safety_status = 'pending' ORDER BY m.created_at LIMIT 100`);
      if (!rows.length) { out("No photos waiting."); return 0; }
      const base = process.env.MEDIA_PUBLIC_URL ?? "http://localhost:8787/media";
      for (const r of rows) {
        out(`${r.id}  ${r.kind ?? "untriaged"}${r.has_faces ? " · faces" : ""}  ${base}/${r.storage_key}`);
      }
      return 0;
    }
    case "media-ok":
    case "media-no": {
      if (!args[0]) { out(`usage: ${cmd} <media-id>`); return 2; }
      const r = await pool.query(`UPDATE media SET safety_status = $2 WHERE id = $1`, [args[0], cmd === "media-ok" ? "approved" : "rejected"]);
      out(r.rowCount ? "✓ done" : "not found");
      return r.rowCount ? 0 : 1;
    }
    case "jobs": {
      const { rows } = await pool.query(
        `SELECT id, origin, status, input->>'name' AS name, created_at, error,
                (usage->>'input_tokens')::int AS tin, (usage->>'output_tokens')::int AS tout
           FROM enrichment_jobs ORDER BY created_at DESC LIMIT 30`);
      if (!rows.length) { out("No enrichment jobs."); return 0; }
      for (const r of rows) {
        out(`${r.id}  ${r.created_at.toISOString().slice(0, 16)}  ${r.origin.padEnd(10)} ${r.status.padEnd(10)} ${r.name}` +
          `${r.tin ? `  (${r.tin} in / ${r.tout} out tokens)` : ""}${r.error ? `  ! ${r.error.slice(0, 80)}` : ""}`);
      }
      return 0;
    }
    case "stale": {
      const rows = await staleListings(pool);
      if (!rows.length) { out("Nothing stale."); return 0; }
      for (const r of rows) out(`${r.id}  ${r.last_verified_at ? r.last_verified_at.toISOString().slice(0, 10) : "never"}  [${r.origin}] ${r.title}${r.provider ? ` — ${r.provider}` : ""}`);
      return 0;
    }
    case "outings": {
      const { rows } = await pool.query(
        `SELECT o.id, o.mode, o.organizer, o.status, o.starts_at, o.paused_reason, v.name AS venue,
                (SELECT count(*)::int FROM outing_participants p WHERE p.outing_id = o.id AND p.status = 'going') AS going,
                (SELECT count(*)::int FROM reports r WHERE r.subject_type = 'outing' AND r.subject_id = o.id::text AND r.status = 'open') AS reports
           FROM outings o JOIN venues v ON v.id = o.venue_id
          WHERE o.status = 'paused' OR (o.status IN ('voting', 'confirmed') AND COALESCE(o.starts_at, o.decision_deadline) < now() + interval '7 days')
          ORDER BY o.status = 'paused' DESC, COALESCE(o.starts_at, o.decision_deadline) LIMIT 100`);
      const { rows: s } = await pool.query(`SELECT value FROM app_settings WHERE key = 'outings'`);
      out(`feature: ${JSON.stringify(s[0]?.value ?? {})}`);
      if (!rows.length) { out("No paused or upcoming outings."); return 0; }
      for (const r of rows) {
        out(`${r.status === "paused" ? "⏸ " : "  "}${r.id}  ${r.mode.padEnd(13)} ${r.status.padEnd(9)} ${r.starts_at ? r.starts_at.toISOString().slice(0, 16) : "voting"}  ${r.venue}  ${r.going} going${r.reports ? `  ⚠ ${r.reports} open report(s)` : ""}${r.paused_reason ? `  (${r.paused_reason})` : ""}`);
      }
      return 0;
    }
    case "unpause": {
      if (!args[0]) { out("usage: unpause <outing-id>"); return 2; }
      const r = await pool.query(
        `UPDATE outings SET status = CASE WHEN mode = 'rally' AND starts_at IS NULL THEN 'voting' ELSE 'confirmed' END,
                paused_at = NULL, paused_reason = NULL, updated_at = now() WHERE id = $1 AND status = 'paused'`, [args[0]]);
      out(r.rowCount ? "✓ resumed" : "not found or not paused");
      return r.rowCount ? 0 : 1;
    }
    case "cancel": {
      if (!args[0]) { out('usage: cancel <outing-id> "why"'); return 2; }
      const r = await pool.query(
        `UPDATE outings SET status = 'cancelled', cancel_reason = $2, updated_at = now() WHERE id = $1 AND status IN ('voting', 'confirmed', 'paused')`,
        [args[0], args[1] ?? "operator"]);
      out(r.rowCount ? "✓ cancelled" : "not found");
      return r.rowCount ? 0 : 1;
    }
    case "pause-outings":
    case "pause-creation": {
      if (args[0] !== "on" && args[0] !== "off") { out(`usage: ${cmd} on|off`); return 2; }
      const s = await setSettings(pool, cmd === "pause-outings" ? { paused: args[0] === "on" } : { creationPaused: args[0] === "on" });
      out(`✓ ${JSON.stringify(s)}`);
      return 0;
    }
    case "reject-submission": {
      if (!args[0] || !args[1]) { out('usage: reject-submission <activity-id> "why"'); return 2; }
      const by = await rejectSubmission(pool, args[0], args[1]);
      if (!by) { out("not found or not a pending community submission"); return 1; }
      await pool.query(
        `INSERT INTO notifications (user_id, kind, title, body) VALUES ($1, 'submission', 'Non publié / Not published', $2)`, [by, args[1]]);
      out("✓ rejected — the person is told why");
      return 0;
    }
    case "restrict": {
      const days = Number(args[1]);
      if (!args[0] || !Number.isFinite(days)) { out("usage: restrict <user-id> <days>"); return 2; }
      const r = await pool.query(`UPDATE users SET restricted_until = now() + make_interval(days => $2) WHERE id = $1`, [args[0], days]);
      out(r.rowCount ? `✓ restricted for ${days} day(s)` : "not found");
      return r.rowCount ? 0 : 1;
    }
    default:
      out("commands: stats | claims | approve <id> | reject <id> \"why\" | reports | resolve <id> actioned|dismissed \"note\"" +
        " | pending | publish <venue-id> | hide <activity-id> | media | media-ok <id> | media-no <id> | jobs | stale" +
        " | outings | unpause <id> | cancel <id> | pause-outings on|off | pause-creation on|off | restrict <user-id> <days>" +
        " | reject-submission <activity-id> \"why\"");
      return cmd ? 2 : 0;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  run(pool, process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
