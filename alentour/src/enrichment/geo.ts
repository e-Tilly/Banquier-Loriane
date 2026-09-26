/**
 * Address → coordinates for onboarding, and duplicate detection against the catalog.
 *
 * Geocoding uses OpenStreetMap's Nominatim: no key, and one lookup per business signing up is
 * well inside its usage policy (max 1 request/second, identifying User-Agent). Results are OSM
 * data — attribution is already on the settings screen, and storing the one coordinate for an
 * owner-entered address is the individual-lookup case of the OSMF geocoding guideline; it is
 * on the lawyer checklist in docs/alentour/11 with the rest of the ODbL questions.
 */
import type pg from "pg";
import { USER_AGENT } from "./net.ts";

export interface GeoCandidate { label: string; lat: number; lon: number; neighbourhood: string | null; line1: string }

export interface Geocoder { search(query: string): Promise<GeoCandidate[]> }

/** Greater Montréal. Results outside it are ignored: the catalog is one city. */
export const MONTREAL_BBOX = { west: -74.0, south: 45.35, east: -73.45, north: 45.72 };

export function inMontreal(lat: number, lon: number): boolean {
  const b = MONTREAL_BBOX;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

export class NominatimGeocoder implements Geocoder {
  base: string;
  fetchImpl: typeof fetch;
  constructor(base = "https://nominatim.openstreetmap.org", fetchImpl: typeof fetch = fetch) { this.base = base; this.fetchImpl = fetchImpl; }

  async search(query: string): Promise<GeoCandidate[]> {
    const b = MONTREAL_BBOX;
    const u = new URL("/search", this.base);
    u.search = new URLSearchParams({
      q: query, format: "jsonv2", addressdetails: "1", limit: "5", countrycodes: "ca",
      viewbox: `${b.west},${b.north},${b.east},${b.south}`, bounded: "1",
    }).toString();
    const res = await this.fetchImpl(u, { headers: { "user-agent": USER_AGENT, "accept-language": "fr-CA,fr" } });
    if (!res.ok) throw new Error(`Geocoder answered ${res.status}`);
    const rows = (await res.json()) as any[];
    return rows.map((r) => {
      const a = r.address ?? {};
      const line1 = [a.house_number, a.road].filter(Boolean).join(" ") || String(r.display_name).split(",")[0]!;
      return {
        label: String(r.display_name),
        lat: Number(r.lat), lon: Number(r.lon),
        neighbourhood: a.neighbourhood ?? a.suburb ?? a.city_district ?? null,
        line1,
      };
    }).filter((c) => inMontreal(c.lat, c.lon));
  }
}

export interface DuplicateVenue { id: string; name: string; address: string | null; distanceM: number; reason: string; claimed: boolean }

/**
 * Venues that are probably this business: a similar name within 150 m, or the same website
 * domain, or the same phone number. Doc 07 step 5 — a match routes the owner to CLAIM rather
 * than creating a second listing.
 */
export async function findDuplicateVenues(
  pool: pg.Pool,
  q: { name: string; lat: number; lon: number; website?: string | null; phone?: string | null },
): Promise<DuplicateVenue[]> {
  const domain = q.website ? hostOf(q.website) : null;
  const digits = q.phone ? q.phone.replace(/\D/g, "").slice(-10) : null;
  const { rows } = await pool.query(
    `WITH d AS (
       SELECT v.*, 6371000 * 2 * asin(sqrt(
                power(sin(radians(v.lat - $2) / 2), 2) +
                cos(radians($2)) * cos(radians(v.lat)) * power(sin(radians(v.lon - $3) / 2), 2))) AS dist,
              similarity(lower(v.name), lower($1)) AS sim
         FROM venues v)
     SELECT id, name, address->>'line1' AS address, round(dist)::int AS dist, sim, provider_id IS NOT NULL AS claimed,
            CASE WHEN $4::text IS NOT NULL AND lower(regexp_replace(coalesce(website, ''), '^https?://(www\\.)?([^/]+).*$', '\\2')) = $4 THEN 'website'
                 WHEN $5::text IS NOT NULL AND right(regexp_replace(coalesce(phone_e164, ''), '\\D', '', 'g'), 10) = $5 THEN 'phone'
                 ELSE 'name' END AS reason
       FROM d
      WHERE (sim > 0.45 AND dist < 150)
         OR ($4::text IS NOT NULL AND lower(regexp_replace(coalesce(website, ''), '^https?://(www\\.)?([^/]+).*$', '\\2')) = $4)
         OR ($5::text IS NOT NULL AND length($5) = 10 AND right(regexp_replace(coalesce(phone_e164, ''), '\\D', '', 'g'), 10) = $5)
      ORDER BY sim DESC, dist ASC
      LIMIT 5`,
    [q.name, q.lat, q.lon, domain, digits]);
  return rows.map((r: any) => ({ id: r.id, name: r.name, address: r.address, distanceM: r.dist, reason: r.reason, claimed: r.claimed }));
}

export function hostOf(website: string): string | null {
  try {
    return new URL(website.includes("://") ? website : `https://${website}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}
