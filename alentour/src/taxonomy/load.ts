import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "yaml";
import type { FacetDef, TagDef, Taxonomy } from "./types.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.join(here, "../../taxonomy/taxonomy.yaml");

/** namespace.name — lowercase, digits allowed (e.g. "a11y.step_free_entry"). */
export const SLUG_PATTERN = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;

let cached: Taxonomy | null = null;

export function loadTaxonomy(file: string = DEFAULT_PATH): Taxonomy {
  if (cached && file === DEFAULT_PATH) return cached;
  const parsed = parse(readFileSync(file, "utf8")) as Taxonomy;
  const taxonomy = validate(parsed);
  if (file === DEFAULT_PATH) cached = taxonomy;
  return taxonomy;
}

/** Every tag across every facet. */
export function allTags(t: Taxonomy): TagDef[] {
  return t.facets.flatMap((f) => f.tags ?? []);
}

/** Slugs only — this is what gets handed to the model as an enum. */
export function allSlugs(t: Taxonomy): string[] {
  return allTags(t).map((tag) => tag.slug);
}

export function facet(t: Taxonomy, key: string): FacetDef {
  const found = t.facets.find((f) => f.key === key);
  if (!found) throw new Error(`Unknown facet: ${key}`);
  return found;
}

/**
 * Slugs an AI is permitted to assert as true. Accessibility is excluded by design:
 * a hallucinated step-free entrance strands a wheelchair user at a door.
 */
export function aiAssertableSlugs(t: Taxonomy): string[] {
  return t.facets
    .filter((f) => f.ai_may_assert !== false)
    .flatMap((f) => (f.tags ?? []).map((tag) => tag.slug));
}

export function isAiAssertable(t: Taxonomy, slug: string): boolean {
  const owner = t.facets.find((f) => (f.tags ?? []).some((tag) => tag.slug === slug));
  if (!owner) throw new Error(`Unknown tag: ${slug}`);
  return owner.ai_may_assert !== false;
}

/** Price band for an amount in cents. Bands are derived, never stored. */
export function priceBand(t: Taxonomy, cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  const bands = facet(t, "price_band").tags ?? [];
  for (const band of bands) {
    if (band.max_cents === null || band.max_cents === undefined) return band.slug;
    if (cents <= band.max_cents) return band.slug;
  }
  return bands.at(-1)?.slug ?? null;
}

function validate(t: Taxonomy): Taxonomy {
  const problems: string[] = [];
  if (!Number.isInteger(t.version)) problems.push("version must be an integer");
  if (!t.locales?.length) problems.push("at least one locale is required");

  const seen = new Set<string>();
  for (const f of t.facets ?? []) {
    for (const tag of f.tags ?? []) {
      if (seen.has(tag.slug)) problems.push(`duplicate slug: ${tag.slug}`);
      seen.add(tag.slug);
      if (!SLUG_PATTERN.test(tag.slug)) {
        problems.push(`slug must match ${SLUG_PATTERN.source}: ${tag.slug}`);
      }
      for (const locale of ["fr", "en"] as const) {
        if (!tag[locale]?.trim()) problems.push(`${tag.slug} is missing its ${locale} label`);
      }
    }
    // A reserved slug must not also be live — that would make its meaning ambiguous.
    for (const slug of f.reserved ?? []) {
      if (seen.has(slug)) problems.push(`${slug} is both reserved and live`);
    }
  }

  for (const shelf of t.shelves ?? []) {
    const tags = (shelf.filters as { tags?: string[] }).tags ?? [];
    for (const slug of tags) {
      if (!seen.has(slug)) problems.push(`shelf "${shelf.key}" references unknown tag ${slug}`);
    }
  }

  if (problems.length) {
    throw new Error(`Invalid taxonomy:\n  - ${problems.join("\n  - ")}`);
  }
  return t;
}
