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
 */
import pg from "pg";
import { approveClaim, rejectClaim } from "../src/claims/claims.ts";

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
        (SELECT count(*) FROM reports WHERE status = 'open' AND severity >= 3)::int AS urgent_reports`);
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
    default:
      out("commands: stats | claims | approve <id> | reject <id> \"why\" | reports | resolve <id> actioned|dismissed \"note\"");
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
