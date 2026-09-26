/** GeoJSON helpers for the map. Pure, shared by native and web map implementations. */
import type { Scored } from "./filter.ts";

export interface ActivityFeatureProps {
  id: string;
  title: string;
  cat: string;
  free: boolean;
  open: boolean;
}

export function toFeatureCollection(items: Scored[]): GeoJSON.FeatureCollection<GeoJSON.Point, ActivityFeatureProps> {
  return {
    type: "FeatureCollection",
    features: items.map((s) => ({
      type: "Feature",
      id: s.activity.id,
      geometry: { type: "Point", coordinates: [s.activity.lon, s.activity.lat] },
      properties: {
        id: s.activity.id,
        title: s.activity.title,
        cat: s.activity.cat,
        free: s.activity.free,
        open: s.openState === "open",
      },
    })),
  };
}

/** [[west, south], [east, north]] padded a little, or null when there is nothing to frame. */
export function boundsOf(
  items: Scored[],
  padDeg = 0.004,
): [[number, number], [number, number]] | null {
  if (!items.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const it of items) {
    w = Math.min(w, it.activity.lon); e = Math.max(e, it.activity.lon);
    s = Math.min(s, it.activity.lat); n = Math.max(n, it.activity.lat);
  }
  return [[w - padDeg, s - padDeg], [e + padDeg, n + padDeg]];
}
