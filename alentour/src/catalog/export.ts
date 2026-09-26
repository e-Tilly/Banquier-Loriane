/**
 * Postgres -> catalog.json.
 *
 * This is what makes Stage 1 shippable: the whole catalog becomes one static file on a CDN,
 * the app filters it on-device, and there is no backend to run, scale, or pay for.
 *
 *   npm run catalog:export -- --locale fr-CA --out ./out
 *
 * Upload the result to R2. Updating the catalog is then a file upload, not a deploy.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import pg from "pg";
import { loadTaxonomy, allTags } from "../taxonomy/load.ts";
import { CATALOG_FORMAT_VERSION } from "./types.ts";
import type { CatalogActivity, CatalogFile, CatalogVenue } from "./types.ts";

const ACTIVITY_QUERY = `
SELECT a.id, a.slug, a.kind, a.primary_category, a.secondary_categories,
       a.price_min_cents, a.price_max_cents, a.price_unit, a.is_free, a.has_free_option,
       a.duration_min_minutes, a.duration_max_minutes, a.typical_duration_minutes,
       a.physical_demand, a.skill_required, a.risk_tier, a.icebreaker_score,
       a.months_open, a.best_months, a.weather_dependency, a.opening_hours, a.min_age,
       a.starts_at, a.ends_at, a.tag_slugs, a.quality_score, a.last_verified_at,
       c.title, c.summary, c.description, c.what_to_bring,
       pl.venue_id AS primary_venue_id, pl.lat, pl.lon,
       (SELECT array_agg(l2.venue_id) FROM activity_locations l2
         WHERE l2.activity_id = a.id AND l2.venue_id <> pl.venue_id) AS other_venue_ids,
       (SELECT jsonb_object_agg(t.tag_slug, t.value)
          FROM activity_tags t
         WHERE t.activity_id = a.id AND t.tag_slug LIKE 'a11y.%' AND t.value IS NOT NULL
       ) AS a11y,
       (SELECT jsonb_build_object('key', m.storage_key, 'blurhash', m.blurhash,
                                  'w', m.width, 'h', m.height)
          FROM media m
         WHERE m.owner_type = 'activity' AND m.owner_id = a.id
           AND m.safety_status = 'approved'
         ORDER BY m.is_hero DESC, m.sort_order ASC LIMIT 1) AS img
  FROM activities a
  JOIN activity_content c ON c.activity_id = a.id AND c.locale = $1
  JOIN LATERAL (
      SELECT l.venue_id, l.lat, l.lon FROM activity_locations l
       WHERE l.activity_id = a.id
       ORDER BY l.is_primary DESC, l.venue_id LIMIT 1
  ) pl ON true
 WHERE a.status = 'published'
 ORDER BY a.quality_score DESC;
`;

const VENUE_QUERY = `
SELECT DISTINCT v.id, v.name, v.lat, v.lon, v.neighbourhood, v.timezone, v.address
  FROM venues v
  JOIN activity_locations l ON l.venue_id = v.id
  JOIN activities a ON a.id = l.activity_id AND a.status = 'published'
 WHERE v.operating_status = 'open';
`;

/** Pure row -> catalog mapping, so it can be tested without a database. */
export function toCatalogActivity(row: Record<string, any>): CatalogActivity {
  const a: CatalogActivity = {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    cat: row.primary_category,
    venueId: row.primary_venue_id,
    lat: row.lat,
    lon: row.lon,
    free: row.is_free === true,
    risk: row.risk_tier ?? 0,
    months: row.months_open ?? 4095,
    tags: row.tag_slugs ?? [],
    quality: round(row.quality_score ?? 0, 3),
  };

  // Everything below is omitted when absent — nulls would inflate the file for no benefit.
  put(a, "summary", row.summary);
  put(a, "description", row.description);
  put(a, "whatToBring", row.what_to_bring);
  if (row.secondary_categories?.length) a.cats = row.secondary_categories;
  if (row.other_venue_ids?.length) a.otherVenueIds = row.other_venue_ids;
  put(a, "priceMin", row.price_min_cents);
  put(a, "priceMax", row.price_max_cents);
  put(a, "priceUnit", row.price_unit);
  if (row.has_free_option) a.freeOption = true;
  put(a, "durMin", row.duration_min_minutes);
  put(a, "durMax", row.duration_max_minutes);
  put(a, "durTypical", row.typical_duration_minutes);
  put(a, "physical", row.physical_demand);
  put(a, "skill", row.skill_required);
  put(a, "icebreaker", row.icebreaker_score);
  put(a, "bestMonths", row.best_months);
  put(a, "weather", row.weather_dependency);
  put(a, "hours", row.opening_hours);
  put(a, "minAge", row.min_age);
  put(a, "startsAt", iso(row.starts_at));
  put(a, "endsAt", iso(row.ends_at));
  put(a, "verifiedAt", iso(row.last_verified_at));

  // Tri-state: only KNOWN values are emitted. An absent key means unknown, never false.
  if (row.a11y && Object.keys(row.a11y).length) a.a11y = row.a11y;
  if (row.img?.key) {
    a.img = { key: row.img.key };
    put(a.img, "blurhash", row.img.blurhash);
    put(a.img, "w", row.img.w);
    put(a.img, "h", row.img.h);
  }
  return a;
}

export function toCatalogVenue(row: Record<string, any>): CatalogVenue {
  const v: CatalogVenue = {
    id: row.id, name: row.name, lat: row.lat, lon: row.lon, tz: row.timezone,
  };
  put(v, "neighbourhood", row.neighbourhood);
  if (row.address?.line1) v.address = row.address.line1;
  return v;
}

export function computeBbox(venues: CatalogVenue[]): [number, number, number, number] {
  if (!venues.length) return [0, 0, 0, 0];
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const v of venues) {
    minLon = Math.min(minLon, v.lon); maxLon = Math.max(maxLon, v.lon);
    minLat = Math.min(minLat, v.lat); maxLat = Math.max(maxLat, v.lat);
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** Catches the class of bug that ships a broken catalog to every user at once. */
export function validateCatalog(cat: CatalogFile): string[] {
  const problems: string[] = [];
  const venueIds = new Set(cat.venues.map((v) => v.id));
  const seenSlugs = new Set<string>();

  for (const a of cat.activities) {
    if (!venueIds.has(a.venueId)) problems.push(`${a.slug}: venue ${a.venueId} not in file`);
    if (seenSlugs.has(a.slug)) problems.push(`${a.slug}: duplicate slug`);
    seenSlugs.add(a.slug);
    if (!a.title?.trim()) problems.push(`${a.slug}: empty title`);
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) problems.push(`${a.slug}: bad coords`);
    if (a.lat < 44 || a.lat > 47 || a.lon < -75 || a.lon > -71) {
      problems.push(`${a.slug}: coordinates outside Québec (${a.lat}, ${a.lon})`);
    }
    if (!a.free && a.priceMin === undefined) problems.push(`${a.slug}: not free and no price`);
    for (const slug of a.tags) {
      if (!cat.tagLabels[slug]) problems.push(`${a.slug}: unknown tag ${slug}`);
      // Accessibility is tri-state and lives in `a11y`. In this array it would read as
      // "absent = not accessible", collapsing unknown into false.
      if (slug.startsWith("a11y.")) problems.push(`${a.slug}: a11y tag ${slug} must not be in tags[]`);
    }
    for (const slug of Object.keys(a.a11y ?? {})) {
      if (!slug.startsWith("a11y.")) problems.push(`${a.slug}: ${slug} is not an a11y tag`);
    }
  }
  return problems;
}

export async function buildCatalog(pool: pg.Pool, locale: string): Promise<CatalogFile> {
  const taxonomy = loadTaxonomy();
  const [activityRows, venueRows] = await Promise.all([
    pool.query(ACTIVITY_QUERY, [locale]),
    pool.query(VENUE_QUERY),
  ]);

  const lang = locale.startsWith("fr") ? "fr" : "en";
  const tagLabels: Record<string, string> = {};
  const tagFacets: Record<string, string> = {};
  for (const f of taxonomy.facets) {
    for (const tag of f.tags ?? []) {
      tagLabels[tag.slug] = tag[lang];
      tagFacets[tag.slug] = f.key;
    }
  }

  const venues = venueRows.rows.map(toCatalogVenue);
  const activities = activityRows.rows.map(toCatalogActivity);

  return {
    format: CATALOG_FORMAT_VERSION,
    taxonomyVersion: taxonomy.version,
    generatedAt: new Date().toISOString(),
    locale,
    bbox: computeBbox(venues),
    counts: { activities: activities.length, venues: venues.length },
    tagLabels,
    tagFacets,
    shelves: taxonomy.shelves.map((s) => ({
      key: s.key, label: (s as any)[lang], filters: s.filters, when: s.when,
    })),
    venues,
    activities,
  };
}

// ------------------------------------------------------------------ helpers

function put<T extends object>(target: T, key: string, value: unknown): void {
  if (value !== null && value !== undefined && value !== "") {
    (target as Record<string, unknown>)[key] = value;
  }
}
function iso(d: Date | null | undefined): string | undefined {
  return d ? new Date(d).toISOString() : undefined;
}
function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// ------------------------------------------------------------------ CLI

/** Build, validate and write one locale. Returns false (and writes nothing) on failure. */
export async function exportLocale(pool: pg.Pool, locale: string, outDir: string): Promise<boolean> {
  const catalog = await buildCatalog(pool, locale);
  const problems = validateCatalog(catalog);
  if (problems.length) {
    console.error(`✗ ${locale}: catalog failed validation (${problems.length} problems):`);
    for (const p of problems.slice(0, 25)) console.error(`   ${p}`);
    if (problems.length > 25) console.error(`   … and ${problems.length - 25} more`);
    return false;                 // never write a broken catalog
  }

  mkdirSync(outDir, { recursive: true });
  const json = JSON.stringify(catalog);
  const file = path.join(outDir, `catalog.${locale}.json`);
  writeFileSync(file, json);
  const gz = gzipSync(json, { level: 9 });
  writeFileSync(`${file}.gz`, gz);

  console.log(`✓ ${catalog.counts.activities} activities, ${catalog.counts.venues} venues` +
              ` (${locale}, taxonomy v${catalog.taxonomyVersion})`);
  console.log(`  ${file}`);
  console.log(`  ${kb(json.length)} raw → ${kb(gz.length)} gzipped` +
              `  (${(gz.length / Math.max(catalog.counts.activities, 1)).toFixed(0)} B/activity)`);
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outDir = argValue(args, "--out") ?? "./out";
  const one = argValue(args, "--locale");
  const locales = one ? [one] : loadTaxonomy().locales;

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let ok = true;
  for (const locale of locales) ok = (await exportLocale(pool, locale, outDir)) && ok;
  await pool.end();
  if (!ok) process.exitCode = 1;
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
