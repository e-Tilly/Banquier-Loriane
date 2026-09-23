/**
 * Home-screen shelf composition.
 *
 * Home is browse, not search: context shelves first ("Free tonight", "Rainy day"), ranked
 * feed second. Shelves are data, defined in taxonomy.yaml and carried in the catalog file,
 * so adding one is a content change rather than an app release.
 */
import type { CatalogFile, CatalogShelf } from "./types.ts";
import { applyFilters, diversify, type Filters, type RankContext, type Scored } from "./filter.ts";

export interface BuiltShelf {
  key: string;
  label: string;
  items: Scored[];
}

export interface ShelfOptions {
  /** A shelf with fewer than this many results is not worth a row. */
  minItems?: number;
  maxItems?: number;
}

/** Translate a shelf's declarative filter spec into engine Filters. */
export function shelfFilters(raw: Record<string, unknown>): Filters {
  const f: Filters = {};
  if (Array.isArray(raw.tags)) f.tags = raw.tags as string[];
  if (raw.open_now === true) f.openNow = true;
  if (typeof raw.max_price_cents === "number") f.maxPriceCents = raw.max_price_cents;
  if (typeof raw.min_icebreaker === "number") f.minIcebreaker = raw.min_icebreaker;
  if (typeof raw.max_distance_km === "number") f.maxDistanceKm = raw.max_distance_km;
  return f;
}

/**
 * A shelf with a `when` clause appears only when the world matches it. The rainy-day shelf
 * shows up when it is actually going to rain — that conditional presence is most of why the
 * feed feels alive.
 */
export function whenMatches(
  when: Record<string, unknown> | undefined,
  ctx: RankContext,
): boolean {
  if (!when) return true;
  const gt = when.precipitation_prob_gt;
  if (typeof gt === "number" && !((ctx.precipitationProb ?? 0) > gt)) return false;
  const below = when.temp_c_below;
  if (typeof below === "number" && !((ctx.tempC ?? 99) < below)) return false;
  const months = when.months;
  if (Array.isArray(months) && !months.includes(ctx.now.getMonth() + 1)) return false;
  return true;
}

export function buildShelves(
  catalog: CatalogFile,
  ctx: RankContext,
  opts: ShelfOptions = {},
): BuiltShelf[] {
  const minItems = opts.minItems ?? 2;
  const maxItems = opts.maxItems ?? 8;
  const shelves: BuiltShelf[] = [];
  const used = new Set<string>();

  for (const shelf of catalog.shelves as CatalogShelf[]) {
    if (!whenMatches(shelf.when, ctx)) continue;

    const outcome = applyFilters(catalog.activities, shelfFilters(shelf.filters), ctx);
    // Don't repeat the same activity across shelves: a home screen showing one venue four
    // times reads as an empty catalog even when it isn't.
    const fresh = outcome.matches.filter((m) => !used.has(m.activity.id)).slice(0, maxItems);
    if (fresh.length < minItems) continue;

    for (const m of fresh) used.add(m.activity.id);
    shelves.push({ key: shelf.key, label: shelf.label, items: fresh });
  }
  return shelves;
}

/**
 * The main ranked feed below the shelves.
 *
 * `exclude` should carry the ids the shelves already showed. Seeing the same venue in a shelf
 * and again two rows later makes a healthy catalog read as an empty one.
 */
export function buildFeed(
  catalog: CatalogFile,
  ctx: RankContext,
  filters: Filters = { maxDistanceKm: 15 },
  limit = 40,
  exclude?: ReadonlySet<string>,
): Scored[] {
  const matches = applyFilters(catalog.activities, filters, ctx).matches;
  if (!exclude?.size) return diversify(matches).slice(0, limit);

  const fresh = matches.filter((m) => !exclude.has(m.activity.id));
  const repeats = matches.filter((m) => exclude.has(m.activity.id));
  // Order, don't replace. On a thin catalog the shelves can consume almost everything; the
  // feed then still leads with whatever is new and only falls back to repeats to fill space.
  return diversify(fresh).concat(diversify(repeats)).slice(0, limit);
}

/** Ids already surfaced by the shelves, for passing to `buildFeed`. */
export function shelfItemIds(shelves: BuiltShelf[]): Set<string> {
  return new Set(shelves.flatMap((s) => s.items.map((i) => i.activity.id)));
}
