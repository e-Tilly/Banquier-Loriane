import type { Scored } from "@core/catalog/filter.ts";

export interface ActivityMapProps {
  items: Scored[];
  center: { lat: number; lon: number };
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  dark: boolean;
}

/** A style with no basemap: markers on a plain canvas. Used until a Protomaps style URL is set. */
export function fallbackStyle(dark: boolean) {
  return {
    version: 8 as const,
    sources: {},
    layers: [{ id: "bg", type: "background" as const, paint: { "background-color": dark ? "#1A201D" : "#E9EEEA" } }],
  };
}

/** Marker colours: pine for open, muted for closed, a ring for the selected one. */
export const MARKER = {
  open: "#1F5F4B",
  closed: "#98A09B",
  stroke: "#FFFFFF",
  selected: "#8F5E16",
};
