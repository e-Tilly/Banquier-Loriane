/**
 * Copywriting: FR + EN summary and description, written from the facts that SURVIVED the gate —
 * so prose cannot reintroduce something the gate removed. Checked mechanically afterwards: every
 * number in the copy must come from the facts, and hype words are refused. One retry with the
 * problems listed; after that, the offending text is dropped and the factual label stays.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { numbersIn } from "./gate.ts";
import type { DraftActivity, LocaleCopy, Usage } from "./types.ts";

export const COPY_MODEL = "claude-opus-5";

const Loc = z.object({ title: z.string(), summary: z.string(), description: z.string() });
const CopySchema = z.object({
  activities: z.array(z.object({ key: z.string(), fr: Loc, en: Loc })),
});
type CopyOut = z.infer<typeof CopySchema>;

const SYSTEM = `You write listing copy for Alentour, a catalog of things to do in Montréal for
people aged 18 to 30. You are given FACTS that were checked against the business's own website.

HARD RULES:
1. Use only the FACTS. Never add a detail, a number, an award, a feeling you cannot back.
2. No superlatives or hype: not "best", "unique", "incroyable", "incontournable", "must-see",
   "amazing", "ultimate", "le meilleur". Say what it is and what you do there.
3. Write French natively, in natural Québec French — not a translation of the English. Then
   write the English natively too.
4. title: max 60 chars, names the activity plainly (e.g. "Escalade de bloc", "Bouldering").
   summary: one sentence, max 140 chars.
   description: 2 short paragraphs, max 600 chars, practical: what you do, what to expect,
   who it suits, what to know before going.
5. Numbers (prices, ages, durations, hours) only exactly as they appear in the FACTS.`;

const HYPE = /\b(best|unique|amazing|ultimate|must[- ]see|world[- ]class|unforgettable|incroyable|incontournable|le meilleur|la meilleure|les meilleurs|inoubliable|exceptionnel(le)?|unique en son genre)\b/i;

/** Numbers the copy may use: those in the facts, plus the hours of the day in opening hours. */
export function allowedNumbers(a: DraftActivity): Set<number> {
  const n = new Set<number>();
  const add = (v: number | null | undefined) => { if (v != null) n.add(v); };
  if (a.price) { add(a.price.value.minCents != null ? a.price.value.minCents / 100 : null); add(a.price.value.maxCents != null ? a.price.value.maxCents / 100 : null); }
  if (a.durationMinutes) { add(a.durationMinutes.value); if (a.durationMinutes.value % 60 === 0) add(a.durationMinutes.value / 60); if (a.durationMinutes.value % 30 === 0) add(a.durationMinutes.value / 60); }
  add(a.minAge?.value);
  for (const f of [a.price, a.durationMinutes, a.minAge, a.openingHours, a.whatToBring]) {
    if (f) numbersIn(f.evidence).forEach(add);
  }
  if (a.openingHours) numbersIn(a.openingHours.value).forEach(add);
  return n;
}

export function checkCopy(text: string, allowed: Set<number>): string[] {
  const problems: string[] = [];
  for (const num of numbersIn(text)) {
    if (num <= 2) continue;                                 // "1 heure", "2 personnes": harmless
    if (![...allowed].some((a) => Math.abs(a - num) < 0.005)) problems.push(`number ${num} is not in the facts`);
  }
  const hype = text.match(HYPE);
  if (hype) problems.push(`hype word "${hype[0]}"`);
  return problems;
}

function factsFor(a: DraftActivity) {
  return {
    key: a.key,
    name: a.name,
    kind: a.kind,
    category: a.primaryCategory?.value ?? null,
    tags: a.tags.map((t) => t.slug),
    price: a.price?.value ?? null,
    duration_minutes: a.durationMinutes?.value ?? null,
    opening_hours: a.openingHours?.value ?? null,
    min_age: a.minAge?.value ?? null,
    what_to_bring: a.whatToBring?.value ?? null,
    quotes: [a.price, a.durationMinutes, a.whatToBring, ...a.tags.map((t) => ({ evidence: t.evidence }))]
      .filter(Boolean).map((f) => f!.evidence).slice(0, 12),
  };
}

export async function writeCopy(
  client: Anthropic, business: { name: string; pitch?: string | null }, activities: DraftActivity[],
): Promise<{ activities: DraftActivity[]; problems: string[]; usage: Usage[] }> {
  const usage: Usage[] = [];
  const facts = { business: business.name, owner_says: business.pitch ?? null, activities: activities.map(factsFor) };
  let feedback = "";
  let out: CopyOut | null = null;
  let problems: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.parse({
      model: COPY_MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `FACTS:\n${JSON.stringify(facts, null, 2)}${feedback}` }],
      output_config: { format: zodOutputFormat(CopySchema) },
    });
    usage.push(response.usage as Usage);
    out = response.parsed_output ?? null;
    if (!out) { problems = ["no parseable copy"]; continue; }
    problems = review(out, activities);
    if (!problems.length) break;
    feedback = `\n\nYour previous attempt had these problems — fix them:\n- ${problems.join("\n- ")}`;
  }

  const byKey = new Map(out?.activities.map((c) => [c.key, c]) ?? []);
  const result = activities.map((a) => {
    const c = byKey.get(a.key);
    if (!c) return a;
    const allowed = allowedNumbers(a);
    const copy = { ...a.copy };
    for (const [loc, key] of [["fr-CA", "fr"], ["en-CA", "en"]] as const) {
      const written = c[key];
      const next: LocaleCopy = { ...(copy[loc] ?? { title: a.name }) };
      if (written.title.trim() && !checkCopy(written.title, allowed).length) next.title = written.title.trim().slice(0, 90);
      if (written.summary.trim() && !checkCopy(written.summary, allowed).length) next.summary = written.summary.trim().slice(0, 160);
      if (written.description.trim() && !checkCopy(written.description, allowed).length) next.description = written.description.trim().slice(0, 2000);
      copy[loc] = next;
    }
    return { ...a, copy };
  });
  return { activities: result, problems, usage };
}

function review(out: CopyOut, activities: DraftActivity[]): string[] {
  const problems: string[] = [];
  for (const a of activities) {
    const c = out.activities.find((x) => x.key === a.key);
    if (!c) { problems.push(`missing activity ${a.key}`); continue; }
    const allowed = allowedNumbers(a);
    for (const key of ["fr", "en"] as const) {
      for (const field of ["title", "summary", "description"] as const) {
        for (const p of checkCopy(c[key][field], allowed)) problems.push(`${a.key}.${key}.${field}: ${p}`);
      }
    }
  }
  return problems;
}
