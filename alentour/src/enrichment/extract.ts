/**
 * Structured extraction: source text in, taxonomy-constrained facts out.
 *
 * Rule 1 of the AI layer (docs/alentour/07): the tag and category fields are enums built from
 * taxonomy.yaml, so the model physically cannot emit a tag that does not exist. Accessibility
 * slugs are a separate enum that can only be *mentioned*, never asserted.
 *
 * Numeric bounds are enforced by the gate rather than the schema: a schema violation fails the
 * whole parse, whereas the gate drops one bad field and keeps the rest.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { aiAssertableSlugs, facet, loadTaxonomy } from "../taxonomy/load.ts";
import type { Taxonomy } from "../taxonomy/types.ts";

export const EXTRACT_MODEL = "claude-opus-5";

const KINDS = ["place", "scheduled_event", "recurring_program", "self_guided", "seasonal"] as const;

function enumOf(values: string[]) {
  return z.enum(values as [string, ...string[]]);
}

export function extractionSchema(tax: Taxonomy = loadTaxonomy()) {
  const categories = (facet(tax, "category").tags ?? []).map((t) => t.slug);
  const tags = aiAssertableSlugs(tax).filter((s) => !s.startsWith("category.") && !s.startsWith("price."));
  const a11y = (facet(tax, "accessibility").tags ?? []).map((t) => t.slug);

  const conf = z.number().describe("0 to 1: how sure you are, given only the source");
  const evidence = z.string().describe("A VERBATIM quote copied from the SOURCE (max ~200 chars)");
  const fact = <T extends z.ZodType>(value: T) => z.object({ value, confidence: conf, evidence }).nullable();
  const bilingual = z.object({ fr: z.string(), en: z.string() });

  const activity = z.object({
    key: z.string().describe("short lowercase id, e.g. 'bouldering'"),
    name: z.string().describe("what the source calls this activity"),
    label: bilingual.describe("a plain factual title, max 60 chars, in natural Québec French and English"),
    one_liner: bilingual.describe("one factual sentence, max 140 chars, only facts present in the source"),
    kind: z.enum(KINDS),
    primary_category: z.object({ value: enumOf(categories), confidence: conf, evidence }).nullable(),
    secondary_categories: z.array(enumOf(categories)),
    tags: z.array(z.object({ slug: enumOf(tags), confidence: conf, evidence })),
    price: z.object({
      is_free: z.boolean(),
      min_dollars: z.number().nullable(),
      max_dollars: z.number().nullable(),
      unit: z.enum(["per_person", "per_group", "per_hour", "per_day", "per_entry"]).nullable(),
      confidence: conf,
      evidence,
    }).nullable(),
    duration_minutes: fact(z.number().int()),
    opening_hours: fact(z.string().describe("OSM opening_hours syntax, e.g. 'Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off'")),
    min_age: fact(z.number().int()),
    months_open: fact(z.array(z.number().int()).describe("months 1-12 when available")),
    weather_dependency: fact(z.enum(["indoor", "covered", "outdoor", "either"])),
    physical_demand: fact(z.number().int().describe("0 none … 4 very demanding")),
    skill_required: fact(z.number().int().describe("0 none … 4 expert")),
    icebreaker_score: fact(z.number().int().describe("0 no interaction (cinema) … 2 easy to talk to strangers (pottery, bouldering)")),
    risk_tier: fact(z.number().int().describe("0 none, 1 minor injury possible, 2 serious injury possible, 3 needs certification/guide")),
    what_to_bring: fact(z.string()),
    accessibility_mentions: z.array(z.object({ slug: enumOf(a11y), says: z.enum(["yes", "no"]), evidence })),
  });

  return z.object({
    is_activity_business: z.boolean().describe("false for businesses with nothing to do on site (bank, pharmacy, office)"),
    phone: fact(z.string()),
    activities: z.array(activity).describe("one entry per distinct thing a visitor can do; at most 6"),
  });
}

export type Extraction = z.infer<ReturnType<typeof extractionSchema>>;

function taxonomyGuide(tax: Taxonomy): string {
  const lines: string[] = [];
  for (const f of tax.facets) {
    if (!f.tags?.length || f.key === "price_band") continue;
    const note = f.ai_may_assert === false ? " (MENTION ONLY — you may never assert these)" : "";
    lines.push(`${f.key}${note}: ${f.tags.map((t) => `${t.slug} = ${t.en}`).join("; ")}`);
  }
  return lines.join("\n");
}

/** Stable across every call, so the ~4k-token taxonomy caches. Keep volatile content out. */
export function systemPrompt(tax: Taxonomy = loadTaxonomy()): string {
  return `You extract facts about a Montréal business for Alentour, a catalog of things to do.
You read a SOURCE (the owner's own words and their website) and fill a structured form.

HARD RULES — a violation makes the output unusable:
1. EXTRACT, NEVER GENERATE. Every fact needs "evidence": a verbatim quote copied character for
   character from the SOURCE that shows it. If you cannot quote it, return null for that field
   or leave the tag out. A blank field is better than a wrong one; the owner fills blanks.
2. Tags and categories come ONLY from the enums. Use a tag only when the source supports it.
3. Accessibility: you may only report what the source SAYS, in accessibility_mentions, with the
   quote. You never decide whether a place is accessible.
4. Prices: copy the numbers exactly as written (dollars). Do not compute, convert or estimate.
   "is_free" only when the source says it is free.
5. Confidence reflects the source, not your general knowledge of Montréal. Do not use anything
   you know about this business from outside the SOURCE.
6. One activity per distinct thing a visitor does (bouldering vs. a yoga class at the same gym),
   never one per price tier or per session time. Most businesses have one or two.
7. label and one_liner are plain and factual: no superlatives, no invented detail, no numbers that
   are not in the source.

Opening hours use OSM syntax: days Mo Tu We Th Fr Sa Su, ranges "Mo-Fr", times "09:00-17:00",
rules separated by "; ", "off" for closed days, "24/7" for always open.

Weekday numbering and dates: months are 1 = January … 12 = December.

TAXONOMY:
${taxonomyGuide(tax)}`;
}

export function userPrompt(source: string): string {
  return `SOURCE (everything between the markers; lines tagged [OWNER] were typed by the owner):
<<<SOURCE
${source}
SOURCE>>>

Fill the form from this source only.`;
}

/** The request body, shared by the direct call and the Batch API. */
export function extractionParams(source: string, tax: Taxonomy = loadTaxonomy()) {
  const format = zodOutputFormat(extractionSchema(tax));
  return {
    params: {
      model: EXTRACT_MODEL,
      max_tokens: 8000,
      system: [{ type: "text" as const, text: systemPrompt(tax), cache_control: { type: "ephemeral" as const } }],
      messages: [{ role: "user" as const, content: userPrompt(source) }],
      output_config: { effort: "high" as const, format: { type: format.type, schema: format.schema } },
    },
    parse: format.parse as (text: string) => Extraction,
  };
}

export async function extract(client: Anthropic, source: string, tax: Taxonomy = loadTaxonomy()) {
  const { params } = extractionParams(source, tax);
  const response = await client.messages.parse({
    ...params,
    output_config: { effort: "high", format: zodOutputFormat(extractionSchema(tax)) },
  });
  if (!response.parsed_output) throw new Error("The model returned no parseable extraction");
  return { extraction: response.parsed_output as Extraction, usage: response.usage };
}
