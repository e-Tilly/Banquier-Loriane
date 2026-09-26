/**
 * The AI concierge: it notices demand, writes invitations and logistics, and never takes part.
 *
 * The bright line (docs/alentour/06): the concierge may organize; it may never appear in an
 * attendee list, count toward quorum, have a human name, be described as going, or imply a
 * person will be there who won't. The schema makes the first two impossible (it has no user
 * row). This file makes the rest mechanical: every text it sends is either a template or a
 * model draft that passed checks for invented numbers and for any hint of presence.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type pg from "pg";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { numbersIn } from "../enrichment/gate.ts";
import { MAX_GROUP, MIN_AGE, QUORUM } from "./core.ts";
import type { Text } from "./notify.ts";

export const CONCIERGE_MODEL = "claude-haiku-4-5";

/** Phrases that would make the concierge sound like a participant, in either language. */
const PRESENCE = /(?<!\p{L})(j'y serai|je serai l[àa]|je viens|j'y vais|on se voit|nous serons|je vous rejoins|à tantôt|see you there|see you|i'll be there|i will be there|i'm going|i am going|we'll be there|join you|meet you there|i'll join)(?!\p{L})/iu;
/** And phrases that would invent a crowd. */
const CROWD = /(?<!\p{L})(plein de monde|beaucoup de gens|tout le monde|lots of people|everyone|crowd|tons of)(?!\p{L})/iu;

export interface Facts {
  activity: Text;              // title per language
  venue: string;
  address?: string | null;
  savers?: number;             // how many people saved it (invites only)
  going?: number;              // humans confirmed (count only, never names)
  when?: Text;                 // formatted time per language
  price?: Text | null;
  bring?: Text | null;
}

export function checkConciergeText(text: string, facts: Facts): string[] {
  const problems: string[] = [];
  if (PRESENCE.test(text)) problems.push("implies the concierge will be there");
  if (CROWD.test(text)) problems.push("invents a crowd");
  const allowed = new Set<number>([
    ...(facts.savers != null ? [facts.savers] : []), ...(facts.going != null ? [facts.going] : []), MIN_AGE, QUORUM, MAX_GROUP,
    ...[facts.when?.fr, facts.when?.en, facts.price?.fr, facts.price?.en, facts.address].flatMap((s) => (s ? numbersIn(s) : [])),
  ]);
  for (const n of numbersIn(text)) if (n > 2 && !allowed.has(n)) problems.push(`number ${n} is not in the facts`);
  return problems;
}

// ------------------------------------------------------------------ templates

export function inviteText(f: Facts): { title: Text; body: Text } {
  return {
    title: { fr: `On y va ensemble ? ${f.activity.fr}`, en: `Go together? ${f.activity.en}` },
    body: {
      fr: `${f.savers} personnes sur Alentour ont enregistré « ${f.activity.fr} » (${f.venue}). Alentour propose trois moments : dites oui, peut-être ou non. Si au moins 3 personnes disent oui au même moment, c'est confirmé.`,
      en: `${f.savers} people on Alentour saved "${f.activity.en}" (${f.venue}). Alentour suggests three times: say yes, maybe or no. If at least 3 people say yes to the same time, it's on.`,
    },
  };
}

export function cardText(kind: "confirmed" | "cancelled" | "nudge" | "t24" | "t2" | "checkin" | "after" | "paused" | "full", f: Facts): { title: Text; body: Text } {
  const a = f.activity;
  switch (kind) {
    case "confirmed": return {
      title: { fr: `C'est confirmé : ${a.fr}`, en: `It's on: ${a.en}` },
      body: { fr: `${f.when?.fr} · ${f.venue}. ${f.going} personnes y vont. La discussion du groupe est ouverte.`, en: `${f.when?.en} · ${f.venue}. ${f.going} people are going. The group chat is open.` },
    };
    case "cancelled": return {
      title: { fr: `Pas de moment trouvé pour ${a.fr}`, en: `No time worked for ${a.en}` },
      body: { fr: "Le système n'a pas trouvé de moment qui convenait à assez de monde. Personne n'a été refusé. Vous pourrez relancer la semaine prochaine.", en: "The system didn't find a time that worked for enough people. Nobody was turned down. You can try again next week." },
    };
    case "nudge": return {
      title: { fr: `Dernier jour pour voter : ${a.fr}`, en: `Last day to vote: ${a.en}` },
      body: { fr: "Le choix du moment se fait demain. Oui, peut-être ou non — un seul tap.", en: "The time gets picked tomorrow. Yes, maybe or no — one tap." },
    };
    case "t24": return {
      title: { fr: `Demain : ${a.fr}`, en: `Tomorrow: ${a.en}` },
      body: {
        fr: [`${f.when?.fr} · ${f.venue}${f.address ? `, ${f.address}` : ""}.`, f.price?.fr ? `Coût : ${f.price.fr}.` : "", f.bring?.fr ? `À apporter : ${f.bring.fr}.` : ""].filter(Boolean).join(" "),
        en: [`${f.when?.en} · ${f.venue}${f.address ? `, ${f.address}` : ""}.`, f.price?.en ? `Cost: ${f.price.en}.` : "", f.bring?.en ? `Bring: ${f.bring.en}.` : ""].filter(Boolean).join(" "),
      },
    };
    case "t2": return {
      title: { fr: `Dans 2 heures : ${a.fr}`, en: `In 2 hours: ${a.en}` },
      body: { fr: `Rendez-vous à l'entrée de ${f.venue}${f.address ? `, ${f.address}` : ""}. ${f.going} personnes confirmées.`, en: `Meet at the entrance of ${f.venue}${f.address ? `, ${f.address}` : ""}. ${f.going} people confirmed.` },
    };
    case "checkin": return {
      title: { fr: "Vous êtes arrivé·e ?", en: "Made it?" },
      body: { fr: "Faites votre arrivée dans l'app. Pour briser la glace : chacun dit d'où il vient et la dernière chose qu'il a essayée pour la première fois.", en: "Check in in the app. Icebreaker: everyone says where they're from and the last thing they tried for the first time." },
    };
    case "after": return {
      title: { fr: `Comment c'était, ${a.fr} ?`, en: `How was ${a.en}?` },
      body: { fr: "Une note, et dites-nous si vous le referiez. La discussion reste lisible 48 heures.", en: "Leave a rating and tell us if you'd do it again. The chat stays readable for 48 hours." },
    };
    case "paused": return {
      title: { fr: `Sortie en pause : ${a.fr}`, en: `Outing paused: ${a.en}` },
      body: { fr: "Un signalement a été fait. La sortie est en pause le temps qu'on vérifie. On vous écrit dès que c'est fait.", en: "Something was reported. The outing is paused while we check. We'll write as soon as that's done." },
    };
    case "full": return {
      title: { fr: `Complet : ${a.fr}`, en: `Full: ${a.en}` },
      body: { fr: "Le groupe a atteint 8 personnes avant votre réponse. On vous proposera la prochaine.", en: "The group reached 8 people before your answer. We'll offer you the next one." },
    };
  }
}

// ------------------------------------------------------------------ optional model drafting

const InviteSchema = z.object({ fr: z.string(), en: z.string() });

const SYSTEM = `You write short invitations for Alentour, an app that helps people aged 18-30 in
Montréal do things together. You are the app, not a person.

HARD RULES:
1. You never take part. Never say or imply you will be there, are going, or will meet anyone.
2. Use only the FACTS. The only numbers you may write are the ones in the FACTS.
3. Never describe the other people (no names, looks, ages, genders) and never invent a crowd.
4. Two sentences max per language. Natural Québec French, natural English. Warm, plain, no hype.
5. Say plainly that people vote yes, maybe or no on three proposed times.`;

/** The invite, written by the small model when available — checked, and replaced by the template if it fails. */
export async function writeInvite(client: Anthropic | null, f: Facts): Promise<{ title: Text; body: Text; drafted: boolean }> {
  const fallback = inviteText(f);
  if (!client) return { ...fallback, drafted: false };
  try {
    const r = await client.messages.parse({
      model: CONCIERGE_MODEL,
      max_tokens: 400,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `FACTS:\n${JSON.stringify({ activity: f.activity, venue: f.venue, people_who_saved_it: f.savers })}` }],
      output_config: { format: zodOutputFormat(InviteSchema) },
    });
    const out = r.parsed_output;
    if (!out) return { ...fallback, drafted: false };
    if (checkConciergeText(out.fr, f).length || checkConciergeText(out.en, f).length) return { ...fallback, drafted: false };
    return { title: fallback.title, body: { fr: out.fr.trim().slice(0, 400), en: out.en.trim().slice(0, 400) }, drafted: true };
  } catch {
    return { ...fallback, drafted: false };
  }
}

// ------------------------------------------------------------------ noticing demand

export const DEMAND = { minSavers: 4, windowDays: 14, cooldownDays: 7, maxInvitees: 12 };

/**
 * Activities where at least four eligible, opted-in people saved the same thing in 14 days, with
 * no open outing for it and no rally in the last week. Only people who asked to be invited are
 * counted or contacted: using saves to introduce strangers is a purpose they must opt into.
 */
export async function findLatentDemand(pool: pg.Pool, now: Date) {
  const { rows } = await pool.query(
    `SELECT s.activity_id, array_agg(s.user_id ORDER BY s.created_at) AS users
       FROM saves s
       JOIN users u ON u.id = s.user_id
       JOIN activities a ON a.id = s.activity_id AND a.status = 'published' AND a.risk_tier < 2
      WHERE s.created_at > $1
        AND u.status = 'active' AND u.outings_opt_in AND u.phone_verified_at IS NOT NULL
        AND u.adult_attested_at IS NOT NULL AND u.birth_year <= $4
        AND (u.restricted_until IS NULL OR u.restricted_until < $2)
        AND NOT EXISTS (SELECT 1 FROM outings o WHERE o.activity_id = s.activity_id
                          AND (o.status IN ('voting', 'paused') OR (o.status = 'confirmed' AND o.starts_at > $2)
                               OR (o.mode = 'rally' AND o.created_at > $3)))
      GROUP BY s.activity_id
     HAVING count(*) >= $5`,
    [new Date(now.getTime() - DEMAND.windowDays * 86_400_000), now,
     new Date(now.getTime() - DEMAND.cooldownDays * 86_400_000), now.getUTCFullYear() - MIN_AGE, DEMAND.minSavers]);
  return rows as { activity_id: string; users: string[] }[];
}

/** Keep the earliest savers, skipping anyone who has blocked, or been blocked by, someone kept. */
export async function pickInvitees(pool: pg.Pool | pg.PoolClient, userIds: string[]): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT blocker_id, blocked_id FROM blocks WHERE blocker_id = ANY($1::uuid[]) AND blocked_id = ANY($1::uuid[])`, [userIds]);
  const conflicts = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const [a, b] of [[r.blocker_id, r.blocked_id], [r.blocked_id, r.blocker_id]]) {
      if (!conflicts.has(a)) conflicts.set(a, new Set());
      conflicts.get(a)!.add(b);
    }
  }
  const kept: string[] = [];
  for (const u of userIds) {
    if (kept.some((k) => conflicts.get(u)?.has(k))) continue;
    kept.push(u);
    if (kept.length >= DEMAND.maxInvitees) break;
  }
  return kept;
}
