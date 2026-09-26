/**
 * The shape of the static catalog file the app downloads.
 *
 * Design constraints (docs/alentour/09-architecture.md):
 *  - Small: it ships to phones over cellular. Nulls are omitted, not serialized.
 *  - Self-contained: tag labels and shelves travel with it, so the app needs one fetch.
 *  - Tri-state accessibility: a key that is ABSENT means unknown. It never means false.
 */

export const CATALOG_FORMAT_VERSION = 1;

export type ActivityKind =
  | "place" | "scheduled_event" | "recurring_program" | "self_guided" | "seasonal";

export type WeatherDependency = "indoor" | "covered" | "outdoor" | "either";

export interface CatalogVenue {
  id: string;
  name: string;
  lat: number;
  lon: number;
  neighbourhood?: string;
  address?: string;
  tz: string;
}

export interface CatalogActivity {
  id: string;
  slug: string;
  kind: ActivityKind;
  title: string;
  summary?: string;
  description?: string;
  whatToBring?: string;

  /** Primary category slug, then any secondaries. */
  cat: string;
  cats?: string[];

  /** Primary venue id, plus the coordinates copied here so filtering needs no join. */
  venueId: string;
  lat: number;
  lon: number;
  otherVenueIds?: string[];

  priceMin?: number;          // cents
  priceMax?: number;          // cents
  priceUnit?: string;
  free: boolean;
  freeOption?: boolean;

  durMin?: number;            // minutes
  durMax?: number;
  durTypical?: number;

  physical?: number;          // 0-4
  skill?: number;             // 0-4
  risk: number;               // 0-3
  icebreaker?: number;        // 0-2

  months: number;             // 12-bit mask, January = bit 0
  bestMonths?: number;
  weather?: WeatherDependency;
  hours?: string;             // OSM opening_hours syntax
  minAge?: number;

  startsAt?: string;          // ISO, scheduled_event / seasonal
  endsAt?: string;

  tags: string[];
  /** Only KNOWN values appear. Absent => unknown. */
  a11y?: Record<string, boolean>;

  img?: { key: string; blurhash?: string; w?: number; h?: number };
  /** Business Pro: where to book. */
  bookingUrl?: string;
  quality: number;
  verifiedAt?: string;
}

export interface CatalogShelf {
  key: string;
  label: string;
  filters: Record<string, unknown>;
  when?: Record<string, unknown>;
}

export interface CatalogFile {
  format: number;
  taxonomyVersion: number;
  generatedAt: string;
  locale: string;
  bbox: [number, number, number, number];   // [minLon, minLat, maxLon, maxLat]
  counts: { activities: number; venues: number };
  /** slug -> label in this file's locale, so chips render without a second request. */
  tagLabels: Record<string, string>;
  tagFacets: Record<string, string>;
  shelves: CatalogShelf[];
  venues: CatalogVenue[];
  activities: CatalogActivity[];
}
