/**
 * The filter + ranking engine. Pure, dependency-free, and shared by the export tool and the
 * app — there is exactly one implementation of "what matches" and "what ranks first".
 *
 * At Stage 1 this runs on-device over the whole catalog. Filtering ~2,000 rows in JS is
 * sub-millisecond, which is why Stage 1 needs no backend at all.
 * See docs/alentour/05-discovery-and-ranking.md.
 */
import type { CatalogActivity } from "./types.ts";
import { isOpenAt, type OpenState } from "./hours.ts";

export interface Filters {
  maxDistanceKm?: number;
  categories?: string[];
  /** All must be present (AND). */
  tags?: string[];
  maxPriceCents?: number;
  freeOnly?: boolean;
  maxDurationMinutes?: number;
  maxPhysical?: number;
  maxSkill?: number;
  maxRisk?: number;
  openNow?: boolean;
  indoorOnly?: boolean;
  /** Accessibility slugs that must be known-true. */
  requireA11y?: string[];
  /** Show `unknown` accessibility in a separate section instead of dropping it. */
  includeUnknownA11y?: boolean;
  minIcebreaker?: number;
  query?: string;
}

export interface RankContext {
  lat: number;
  lon: number;
  now: Date;
  /** 0-1. Drives the rainy-day behaviour that makes the feed feel alive. */
  precipitationProb?: number;
  tempC?: number;
  isDark?: boolean;
  /** Ids already shown without a tap, for impression fatigue. */
  fatigued?: Set<string>;
  savedIds?: Set<string>;
}

export interface Scored {
  activity: CatalogActivity;
  distanceKm: number;
  score: number;
  openState: OpenState;
  /** True when it matched every filter except accessibility, which is unknown. */
  a11yUnknown?: boolean;
}

export interface FilterOutcome {
  matches: Scored[];
  /**
   * Populated only when nothing matched: the same query with the fewest filters removed
   * that still yields results. `droppedFilters` is in the order they were given up, so the
   * UI can say exactly what it ignored and offer to put it back.
   */
  relaxed?: { droppedFilters: (keyof Filters)[]; matches: Scored[] };
  /** Matched everything but have unknown accessibility. Shown in their own section. */
  unknownA11y: Scored[];
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

/** Tri-state: null means unknown, which is NOT false. */
export function a11yValue(a: CatalogActivity, slug: string): boolean | null {
  const v = a.a11y?.[slug];
  return v === undefined ? null : v;
}

function matchesNonA11y(a: CatalogActivity, f: Filters, ctx: RankContext, distKm: number): boolean {
  if (f.maxDistanceKm !== undefined && distKm > f.maxDistanceKm) return false;
  if (f.categories?.length && !f.categories.includes(a.cat) &&
      !(a.cats ?? []).some((c) => f.categories!.includes(c))) return false;
  if (f.tags?.length && !f.tags.every((t) => a.tags.includes(t))) return false;
  if (f.freeOnly && !a.free) return false;
  if (f.maxPriceCents !== undefined && !a.free &&
      (a.priceMin ?? Infinity) > f.maxPriceCents) return false;
  if (f.maxDurationMinutes !== undefined &&
      (a.durTypical ?? a.durMin ?? 0) > f.maxDurationMinutes) return false;
  if (f.maxPhysical !== undefined && (a.physical ?? 0) > f.maxPhysical) return false;
  if (f.maxSkill !== undefined && (a.skill ?? 0) > f.maxSkill) return false;
  if (f.maxRisk !== undefined && a.risk > f.maxRisk) return false;
  if (f.minIcebreaker !== undefined && (a.icebreaker ?? 0) < f.minIcebreaker) return false;
  if (f.indoorOnly && a.weather !== "indoor" && a.weather !== "covered") return false;

  // Seasonality: a sugar shack in July is not a result.
  const monthBit = 1 << ctx.now.getMonth();
  if ((a.months & monthBit) === 0) return false;

  if (a.endsAt && new Date(a.endsAt).getTime() < ctx.now.getTime()) return false;

  if (f.openNow && isOpenAt(a.hours, ctx.now) !== "open") return false;

  if (f.query?.trim()) {
    const q = f.query.trim().toLowerCase();
    const hay = `${a.title} ${a.summary ?? ""} ${a.cat}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Returns "yes" | "unknown" | "no" for the accessibility requirement. */
function a11yVerdict(a: CatalogActivity, required: string[]): "yes" | "unknown" | "no" {
  let sawUnknown = false;
  for (const slug of required) {
    const v = a11yValue(a, slug);
    if (v === false) return "no";
    if (v === null) sawUnknown = true;
  }
  return sawUnknown ? "unknown" : "yes";
}

export function applyFilters(
  activities: CatalogActivity[],
  filters: Filters,
  ctx: RankContext,
): FilterOutcome {
  const matches: Scored[] = [];
  const unknownA11y: Scored[] = [];

  for (const a of activities) {
    const distanceKm = haversineKm(ctx.lat, ctx.lon, a.lat, a.lon);
    if (!matchesNonA11y(a, filters, ctx, distanceKm)) continue;

    const openState = isOpenAt(a.hours, ctx.now);
    const scored: Scored = { activity: a, distanceKm, openState, score: 0 };
    scored.score = scoreActivity(scored, ctx);

    if (filters.requireA11y?.length) {
      const verdict = a11yVerdict(a, filters.requireA11y);
      if (verdict === "no") continue;
      if (verdict === "unknown") {
        // Never silently dropped: absence of data is not absence of access, and dropping
        // these hides most of the catalog from the people who most need to see it.
        unknownA11y.push({ ...scored, a11yUnknown: true });
        continue;
      }
    }
    matches.push(scored);
  }

  matches.sort((x, y) => y.score - x.score);
  unknownA11y.sort((x, y) => y.score - x.score);

  const outcome: FilterOutcome = { matches, unknownA11y };
  if (matches.length === 0 && unknownA11y.length === 0) {
    const relaxed = relax(activities, filters, ctx);
    if (relaxed) outcome.relaxed = relaxed;
  }
  return outcome;
}

/**
 * Never show an empty screen. Give up the least important active filters, one at a time,
 * until something matches. Order is least-to-most important to the user's intent, so
 * distance and category — the things they most clearly meant — are surrendered last.
 */
const RELAX_ORDER: (keyof Filters)[] = [
  "minIcebreaker", "maxSkill", "maxPhysical", "openNow", "indoorOnly",
  "maxDurationMinutes", "tags", "maxPriceCents", "categories", "maxDistanceKm",
];

function relax(
  activities: CatalogActivity[],
  filters: Filters,
  ctx: RankContext,
): FilterOutcome["relaxed"] {
  const working: Filters = { ...filters };
  const dropped: (keyof Filters)[] = [];

  for (const key of RELAX_ORDER) {
    if (working[key] === undefined) continue;
    delete working[key];
    dropped.push(key);

    // Re-run the match pass directly rather than recursing through applyFilters, so a
    // still-empty result cannot trigger another nested relaxation.
    const matches: Scored[] = [];
    for (const a of activities) {
      const distanceKm = haversineKm(ctx.lat, ctx.lon, a.lat, a.lon);
      if (!matchesNonA11y(a, working, ctx, distanceKm)) continue;
      if (working.requireA11y?.length && a11yVerdict(a, working.requireA11y) === "no") continue;
      const openState = isOpenAt(a.hours, ctx.now);
      const scored: Scored = { activity: a, distanceKm, openState, score: 0 };
      scored.score = scoreActivity(scored, ctx);
      matches.push(scored);
    }

    if (matches.length > 0) {
      matches.sort((x, y) => y.score - x.score);
      return { droppedFilters: dropped, matches };
    }
  }
  return undefined;
}

// ------------------------------------------------------------------ ranking

export function scoreActivity(s: Scored, ctx: RankContext): number {
  const a = s.activity;
  const proximity = Math.exp(-s.distanceKm / 3);          // d0 = 3 km
  const quality = 0.3 + 0.7 * clamp01(a.quality);
  let score = proximity * quality * contextFit(s, ctx);

  if (ctx.fatigued?.has(a.id)) score *= 0.4;              // shown repeatedly, never tapped
  if (ctx.savedIds?.has(a.id)) score *= 0.6;              // they already know about it
  return score;
}

/**
 * The term that makes the feed feel alive: rainy Saturday leads with indoor, the first warm
 * day leads with terraces. One forecast call per city per hour feeds this — never per user.
 */
export function contextFit(s: Scored, ctx: RankContext): number {
  const a = s.activity;
  let f = 1;

  if ((ctx.precipitationProb ?? 0) > 0.5) {
    f *= a.weather === "indoor" ? 1.6
       : a.weather === "covered" ? 1.2
       : a.weather === "outdoor" ? 0.35
       : 1;
  }
  if (ctx.tempC !== undefined && ctx.tempC < -15) {
    f *= a.weather === "indoor" ? 1.5 : 0.4;
    if (a.tags.includes("weather.requires_snow")) f *= 1.4;
  }
  if (a.bestMonths !== undefined && (a.bestMonths & (1 << ctx.now.getMonth())) !== 0) f *= 1.3;
  if (ctx.isDark && a.tags.includes("weather.requires_daylight")) f *= 0.1;

  // Dim, don't drop: someone browsing at 23:00 is planning tomorrow.
  if (s.openState === "closed") f *= 0.15;

  return f;
}

/**
 * Cap runs of one category so a single good climbing gym doesn't turn the whole feed into
 * climbing. Greedy, order-preserving, and cheap.
 */
export function diversify(items: Scored[], maxPerWindow = 2, window = 6): Scored[] {
  const out: Scored[] = [];
  const held: Scored[] = [];

  for (const item of items) {
    const recent = out.slice(-window);
    const sameCat = recent.filter((r) => r.activity.cat === item.activity.cat).length;
    if (sameCat >= maxPerWindow) held.push(item);
    else out.push(item);
  }
  // Held items go to the end rather than being discarded.
  return out.concat(held);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
