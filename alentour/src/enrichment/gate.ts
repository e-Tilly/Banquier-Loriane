/**
 * The confidence gate: the mechanical check between the model and anything a person sees.
 *
 * Every field must carry a quote that is actually in the source; numbers must appear in their
 * quote; hours must parse; scales must be in range; low-confidence fields are blanked rather
 * than guessed ("a blank field beats a wrong one"). Whatever is removed is recorded with a
 * reason, so a reviewer can see what the model tried to say.
 */
import { parseOpeningHours } from "../catalog/hours.ts";
import type { Extraction } from "./extract.ts";
import type { Draft, DraftActivity, Dropped, Field, LocaleCopy, PriceValue } from "./types.ts";

export const MIN_CONFIDENCE = 0.6;
export const HIGH_CONFIDENCE = 0.85;
const MAX_ACTIVITIES = 6;
const MAX_VIBES = 3;

/** Lowercase, accents and punctuation removed, whitespace collapsed. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Evidence is found when every fragment of it (split on ellipses) is in the source. */
export function evidenceFound(evidence: string | null | undefined, normalizedSource: string): boolean {
  if (!evidence) return false;
  const parts = evidence.split(/…|\.\.\.|\[…\]/).map(normalize).filter(Boolean);
  if (!parts.length || parts.join(" ").length < 3) return false;
  return parts.every((p) => normalizedSource.includes(p));
}

/** Every number written in a piece of text, with decimal commas understood. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d{1,2})?/g)].map((m) => Number(m[0].replace(",", ".")));
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

interface GateInput { extraction: Extraction; source: string }

export function gate({ extraction, source }: GateInput): { activities: DraftActivity[]; phone: string | null; dropped: Dropped[] } {
  const src = normalize(source);
  const sourceNumbers = numbersIn(source);
  const dropped: Dropped[] = [];

  function keep<T>(path: string, f: { value: T; confidence: number; evidence: string } | null, check?: (v: T, evidence: string) => string | null): Field<T> | null {
    if (!f) return null;
    if (!evidenceFound(f.evidence, src)) { dropped.push({ field: path, reason: "evidence not found in source" }); return null; }
    if (!(f.confidence >= MIN_CONFIDENCE)) { dropped.push({ field: path, reason: `low confidence (${f.confidence})` }); return null; }
    const problem = check?.(f.value, f.evidence);
    if (problem) { dropped.push({ field: path, reason: problem }); return null; }
    return { value: f.value, confidence: round(f.confidence), evidence: f.evidence.trim().slice(0, 300) };
  }
  const inRange = (lo: number, hi: number) => (v: number) => (Number.isInteger(v) && v >= lo && v <= hi ? null : `out of range ${lo}-${hi}`);

  const activities: DraftActivity[] = [];
  const seenKeys = new Set<string>();
  for (const [i, a] of extraction.activities.slice(0, MAX_ACTIVITIES).entries()) {
    const p = `activities[${i}]`;
    let key = (a.key || `activity-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `activity-${i + 1}`;
    while (seenKeys.has(key)) key += "-2";
    seenKeys.add(key);

    const primaryCategory = keep(`${p}.primary_category`, a.primary_category);
    const secondary = [...new Set(a.secondary_categories)].filter((c) => c !== primaryCategory?.value).slice(0, 2);

    const tags: DraftActivity["tags"] = [];
    for (const t of a.tags) {
      const f = keep(`${p}.tags.${t.slug}`, { value: t.slug, confidence: t.confidence, evidence: t.evidence });
      if (f && !tags.some((x) => x.slug === t.slug)) tags.push({ slug: t.slug, confidence: f.confidence, evidence: f.evidence });
    }
    // At most three vibes, the most confident ones.
    const vibes = tags.filter((t) => t.slug.startsWith("vibe.")).sort((x, y) => y.confidence - x.confidence);
    for (const extra of vibes.slice(MAX_VIBES)) {
      tags.splice(tags.indexOf(extra), 1);
      dropped.push({ field: `${p}.tags.${extra.slug}`, reason: "more than three vibes" });
    }

    let price: Field<PriceValue> | null = null;
    if (a.price) {
      const pr = a.price;
      price = keep(`${p}.price`, {
        value: {
          isFree: pr.is_free,
          minCents: pr.min_dollars == null ? null : Math.round(pr.min_dollars * 100),
          maxCents: pr.max_dollars == null ? null : Math.round(pr.max_dollars * 100),
          unit: pr.unit,
        },
        confidence: pr.confidence,
        evidence: pr.evidence,
      }, (v, ev) => {
        const nums = numbersIn(ev);
        if (v.isFree && !/gratuit|free|gratis|sans frais|no charge|entr[ée]e libre/i.test(ev)) return "free without a quote saying so";
        for (const cents of [v.minCents, v.maxCents]) {
          if (cents == null) continue;
          if (cents < 0 || cents > 1_000_000) return "price out of range";
          if (!nums.some((n) => near(n, cents / 100))) return `price ${cents / 100} not in its quote`;
        }
        if (v.minCents != null && v.maxCents != null && v.maxCents < v.minCents) return "max below min";
        if (!v.isFree && v.minCents == null && v.maxCents == null) return "no price";
        return null;
      });
    }

    activities.push({
      key,
      name: a.name.trim().slice(0, 90),
      kind: a.kind,
      primaryCategory,
      secondaryCategories: secondary,
      tags,
      price,
      durationMinutes: keep(`${p}.duration_minutes`, a.duration_minutes, (v, ev) => {
        if (!(v >= 5 && v <= 1440)) return "duration out of range";
        const nums = numbersIn(ev);
        return nums.some((n) => near(n, v) || near(n * 60, v)) ? null : "duration not in its quote";
      }),
      openingHours: keep(`${p}.opening_hours`, a.opening_hours, (v) => (parseOpeningHours(v) ? null : `unparseable hours "${v}"`)),
      minAge: keep(`${p}.min_age`, a.min_age, (v, ev) => (v >= 0 && v <= 99 && numbersIn(ev).includes(v) ? null : "age not in its quote")),
      monthsOpen: toMask(keep(`${p}.months_open`, a.months_open, (v) => (v.length && v.every((m) => Number.isInteger(m) && m >= 1 && m <= 12) ? null : "bad months"))),
      weather: keep(`${p}.weather_dependency`, a.weather_dependency),
      physicalDemand: keep(`${p}.physical_demand`, a.physical_demand, inRange(0, 4)),
      skillRequired: keep(`${p}.skill_required`, a.skill_required, inRange(0, 4)),
      icebreakerScore: keep(`${p}.icebreaker_score`, a.icebreaker_score, inRange(0, 2)),
      riskTier: keep(`${p}.risk_tier`, a.risk_tier, inRange(0, 3)),
      whatToBring: keep(`${p}.what_to_bring`, a.what_to_bring, (v) => (v.trim() ? null : "empty")),
      // Mentions survive only with a real quote — and even then they are prompts, not answers.
      a11yMentions: a.accessibility_mentions.filter((m) => {
        const ok = evidenceFound(m.evidence, src);
        if (!ok) dropped.push({ field: `${p}.accessibility.${m.slug}`, reason: "evidence not found in source" });
        return ok;
      }),
      copy: factualCopy(a, sourceNumbers, dropped, p),
    });
  }

  const phone = keep("phone", extraction.phone, (v) => (v.replace(/\D/g, "").length >= 10 ? null : "not a phone number"));
  return { activities, phone: phone ? phone.value : null, dropped };
}

function toMask(f: Field<number[]> | null): Field<number> | null {
  if (!f) return null;
  return { ...f, value: f.value.reduce((mask, m) => mask | (1 << (m - 1)), 0) };
}

/** The label and one-liner become the default copy; numbers in them must be from the source. */
function factualCopy(a: Extraction["activities"][number], sourceNumbers: number[], dropped: Dropped[], p: string): DraftActivity["copy"] {
  const backed = (text: string) => numbersIn(text).every((n) => sourceNumbers.some((s) => near(s, n)));
  const copy: DraftActivity["copy"] = {};
  for (const [loc, key] of [["fr-CA", "fr"], ["en-CA", "en"]] as const) {
    let title = (a.label?.[key] ?? "").trim().slice(0, 90);
    if (!title || !backed(title)) {
      if (title) dropped.push({ field: `${p}.label.${key}`, reason: "number not in source" });
      title = a.name.trim().slice(0, 90);
    }
    const entry: LocaleCopy = { title };
    const line = (a.one_liner?.[key] ?? "").trim();
    if (line && backed(line)) entry.summary = line.slice(0, 160);
    else if (line) dropped.push({ field: `${p}.one_liner.${key}`, reason: "number not in source" });
    copy[loc] = entry;
  }
  return copy;
}

/** A draft with nothing from a model: the owner fills it in. Used without a key or on failure. */
export function emptyDraft(name: string, note?: string): Draft {
  return {
    isActivityBusiness: true,
    phone: null,
    website: null,
    socials: {},
    ai: false,
    ...(note ? { note } : {}),
    activities: [blankActivity(name)],
  };
}

export function blankActivity(name: string, key = "main"): DraftActivity {
  return {
    key, name, kind: "place", primaryCategory: null, secondaryCategories: [], tags: [], price: null,
    durationMinutes: null, openingHours: null, minAge: null, monthsOpen: null, weather: null,
    physicalDemand: null, skillRequired: null, icebreakerScore: null, riskTier: null, whatToBring: null,
    a11yMentions: [], copy: { "fr-CA": { title: name }, "en-CA": { title: name } },
  };
}

/** Is a gated activity good enough to skip field-by-field review (seed pipeline)? */
export function isHighConfidence(a: DraftActivity): boolean {
  return !!a.primaryCategory && a.primaryCategory.confidence >= HIGH_CONFIDENCE
    && a.tags.every((t) => t.confidence >= HIGH_CONFIDENCE)
    && (!a.price || a.price.confidence >= HIGH_CONFIDENCE);
}

function round(n: number) { return Math.round(n * 100) / 100; }
