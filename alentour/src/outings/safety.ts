/**
 * Chat moderation and the fail-safe paths (docs/alentour/08).
 *
 *   [1] deterministic: length, rate limit, contact details and links    ($0, always on)
 *   [2] small-model classifier with structured scores                   (when a key is set)
 *   [3] route: low → visible · medium → visible + flagged · high → held
 *              critical → held, author restricted, outing paused, operator alerted
 *   [4] every decision logged on the message
 *
 * A report on an outing, a message or a person pauses the outing immediately and tells the
 * group, instead of waiting in a queue until a solo operator wakes up.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type pg from "pg";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Mailer } from "../api/mailer.ts";
import { blockedSql } from "./core.ts";
import { chatOpen } from "./outings.ts";
import { cardText, type Facts } from "./concierge.ts";
import { notify, type Pusher } from "./notify.ts";

export const MODERATION_MODEL = "claude-haiku-4-5";

export interface SafetyDeps {
  client?: Anthropic | null;
  pusher?: Pusher;
  mailer?: Mailer;
  operatorEmail?: string | null;
}

// ------------------------------------------------------------------ layer 1

const CONTACT = [
  /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/,                                   // email
  /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/,               // NANP phone
  /\bhttps?:\/\/|\bwww\.|\b[\w-]+\.(com|ca|net|org|io|me|ly|gg)\b\/?/i, // links
  /\b(insta(gram)?|snap(chat)?|whats ?app|telegram|tiktok)\s*[:@]/i,    // "insta: @…"
];

export function hasContactDetails(text: string): boolean {
  return CONTACT.some((re) => re.test(text));
}

// ------------------------------------------------------------------ layer 2

const Scores = z.object({
  harassment: z.number(), sexual: z.number(), violence: z.number(), hate: z.number(),
  self_harm: z.number(), threat: z.number(), spam: z.number(), pii: z.number(),
});
export type ModerationScores = z.infer<typeof Scores>;

const SYSTEM = `You score chat messages in a small group organizing an in-person outing in Montréal
(French or English). Score each category 0 to 1 for how clearly the message contains it.
Ordinary logistics, jokes and swearing without a target are low. Answer only with the scores.`;

export async function classify(client: Anthropic, text: string): Promise<ModerationScores> {
  const r = await client.messages.parse({
    model: MODERATION_MODEL,
    max_tokens: 200,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `MESSAGE:\n<<<\n${text}\n>>>` }],
    output_config: { format: zodOutputFormat(Scores) },
  });
  if (!r.parsed_output) throw new Error("no scores");
  return r.parsed_output;
}

export type Decision = "visible" | "flagged" | "held" | "critical";

export function route(s: ModerationScores | null): Decision {
  if (!s) return "visible";
  if (Math.max(s.threat, s.violence, s.sexual) >= 0.9) return "critical";
  if (Math.max(s.harassment, s.hate, s.threat, s.violence, s.sexual, s.self_harm) >= 0.7) return "held";
  if (Math.max(...Object.values(s)) >= 0.4) return "flagged";
  return "visible";
}

// ------------------------------------------------------------------ chat

export type PostResult =
  | { ok: true; id: number; status: "visible" | "held" }
  | { ok: false; error: "not_found" | "closed" | "too_long" | "empty" | "contact_details" | "rate_limited" };

export async function postMessage(pool: pg.Pool, deps: SafetyDeps, userId: string, outingId: string, raw: string, now: Date): Promise<PostResult> {
  const body = raw.replace(/\s+\n/g, "\n").trim();
  if (!body) return { ok: false, error: "empty" };
  if (body.length > 1000) return { ok: false, error: "too_long" };

  const { rows } = await pool.query(
    `SELECT o.*, ${blockedSql("o", "$2")} AS blocked,
            EXISTS (SELECT 1 FROM outing_participants p WHERE p.outing_id = o.id AND p.user_id = $2 AND p.status IN ('going', 'maybe'))
              OR o.host_user_id = $2 AS member
       FROM outings o WHERE o.id = $1`, [outingId, userId]);
  const o = rows[0];
  if (!o || o.blocked || !o.member) return { ok: false, error: "not_found" };
  if (!chatOpen(o, now)) return { ok: false, error: "closed" };
  const recent = await pool.query(
    `SELECT count(*)::int AS n FROM outing_messages WHERE author_id = $1 AND created_at > $2`, [userId, new Date(now.getTime() - 10 * 60_000)]);
  if (recent.rows[0].n >= 20) return { ok: false, error: "rate_limited" };
  // In-app contact only: exchanging numbers is how an outing moves off-platform, out of reach
  // of blocks and reports. People can swap details in person.
  if (hasContactDetails(body)) return { ok: false, error: "contact_details" };

  let scores: ModerationScores | null = null;
  let modelError: string | null = null;
  if (deps.client) {
    try { scores = await classify(deps.client, body); } catch (err) { modelError = (err as Error).message; }
  }
  const decision = route(scores);
  const status = decision === "held" || decision === "critical" ? "held" : "visible";
  const ins = await pool.query<{ id: string }>(
    `INSERT INTO outing_messages (outing_id, author_id, kind, body, status, moderation, created_at)
     VALUES ($1, $2, 'user', $3, $4, $5, $6) RETURNING id`,
    [outingId, userId, body, status,
     JSON.stringify({ layer: scores ? 2 : 1, model: scores ? MODERATION_MODEL : null, scores, decision, error: modelError }), now]);
  const id = Number(ins.rows[0]!.id);

  if (decision !== "visible") {
    const severity = decision === "critical" ? 4 : decision === "held" ? 3 : 2;
    await pool.query(
      `INSERT INTO reports (reporter_id, subject_type, subject_id, reason, details, severity)
       VALUES (NULL, 'message', $1, 'inappropriate', $2, $3)`, [String(id), `automatic: ${decision}`, severity]);
  }
  if (decision === "critical") {
    await pool.query(`UPDATE users SET restricted_until = $2 WHERE id = $1`, [userId, new Date(now.getTime() + 7 * 86_400_000)]);
    await pauseOuting(pool, deps, outingId, "automatic moderation", now);
    await alertOperator(deps, `Critical message held in outing ${outingId}`, `Message ${id} was held and its author restricted for 7 days. Review: npm run admin -- reports`);
  }
  return { ok: true, id, status };
}

export async function listMessages(pool: pg.Pool, userId: string, outingId: string, afterId = 0) {
  const { rows } = await pool.query(
    `SELECT m.id, m.kind, m.status, m.created_at,
            CASE WHEN m.status = 'visible' OR m.author_id = $2 THEN m.body ELSE NULL END AS body,
            m.author_id = $2 AS mine,
            CASE WHEN m.kind = 'user' THEN COALESCE(u.display_name, 'Membre') END AS author
       FROM outing_messages m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.outing_id = $1 AND m.id > $3 AND m.status <> 'removed'
        AND (m.status = 'visible' OR m.author_id = $2)
      ORDER BY m.id LIMIT 200`, [outingId, userId, afterId]);
  return rows;
}

export async function conciergeMessage(pool: pg.Pool | pg.PoolClient, outingId: string, body: string, now: Date) {
  await pool.query(
    `INSERT INTO outing_messages (outing_id, author_id, kind, body, created_at) VALUES ($1, NULL, 'concierge', $2, $3)`,
    [outingId, body.slice(0, 2000), now]);
}

// ------------------------------------------------------------------ fail-safe

export async function outingFacts(pool: pg.Pool | pg.PoolClient, outingId: string): Promise<Facts & { members: string[] }> {
  const { rows } = await pool.query(
    `SELECT o.id, v.name AS venue, v.address->>'line1' AS address,
            (SELECT jsonb_object_agg(c.locale, c.title) FROM activity_content c WHERE c.activity_id = o.activity_id) AS titles,
            (SELECT array_agg(DISTINCT m.user_id) FROM outing_members m WHERE m.outing_id = o.id) AS members,
            (SELECT count(*)::int FROM outing_participants p WHERE p.outing_id = o.id AND p.status = 'going') AS going
       FROM outings o JOIN venues v ON v.id = o.venue_id WHERE o.id = $1`, [outingId]);
  const r = rows[0];
  const fr = r?.titles?.["fr-CA"] ?? "";
  return { activity: { fr, en: r?.titles?.["en-CA"] ?? fr }, venue: r?.venue ?? "", address: r?.address, going: r?.going ?? 0, members: r?.members ?? [] };
}

export async function pauseOuting(pool: pg.Pool, deps: SafetyDeps, outingId: string, reason: string, now: Date): Promise<boolean> {
  const r = await pool.query(
    `UPDATE outings SET status = 'paused', paused_at = $2, paused_reason = $3, updated_at = $2
      WHERE id = $1 AND status IN ('voting', 'confirmed')`, [outingId, now, reason]);
  if (!r.rowCount) return false;
  const f = await outingFacts(pool, outingId);
  await notify(pool, deps.pusher, f.members, { kind: "paused", outingId, ...cardText("paused", f) });
  return true;
}

/** Called for every new report. Anything about an outing, a message or a person pauses first. */
export async function onReport(
  pool: pg.Pool, deps: SafetyDeps, report: { subjectType: string; subjectId: string; reporterId: string | null; severity: number }, now: Date,
): Promise<string[]> {
  const paused: string[] = [];
  const pause = async (id: string) => { if (await pauseOuting(pool, deps, id, "report", now)) paused.push(id); };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (report.subjectType === "outing" && UUID.test(report.subjectId)) {
    await pause(report.subjectId);
  } else if (report.subjectType === "message" && /^\d+$/.test(report.subjectId)) {
    // Hide the message pending review, then pause its outing.
    const m = (await pool.query(
      `UPDATE outing_messages SET status = 'held' WHERE id = $1 AND kind = 'user' RETURNING outing_id`, [report.subjectId])).rows[0];
    if (m) await pause(m.outing_id);
  } else if (report.subjectType === "user" && UUID.test(report.subjectId) && report.reporterId) {
    // Every upcoming outing the two share.
    const { rows } = await pool.query(
      `SELECT a.outing_id FROM outing_members a JOIN outing_members b ON b.outing_id = a.outing_id
         JOIN outings o ON o.id = a.outing_id
        WHERE a.user_id = $1 AND b.user_id = $2 AND o.status IN ('voting', 'confirmed')`, [report.subjectId, report.reporterId]);
    for (const r of rows) await pause(r.outing_id);
  }
  if (report.severity >= 3) {
    await alertOperator(deps, `Severity ${report.severity} report: ${report.subjectType} ${report.subjectId}`,
      `${paused.length ? `Paused outing(s): ${paused.join(", ")}. ` : ""}Review: npm run admin -- reports`);
  }
  return paused;
}

/** Severity 3+ reaches the operator immediately, not in a digest. */
export async function alertOperator(deps: SafetyDeps, subject: string, text: string) {
  if (deps.mailer && deps.operatorEmail) await deps.mailer.send({ to: deps.operatorEmail, subject: `[Alentour] ${subject}`, text }).catch(() => {});
}

export async function blockUser(pool: pg.Pool, blockerId: string, blockedId: string): Promise<boolean> {
  if (blockerId === blockedId) return false;
  await pool.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [blockerId, blockedId]);
  return true;
}
