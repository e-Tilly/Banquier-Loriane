/**
 * Web map: maplibre-gl, with the pmtiles protocol registered so a Protomaps style on R2 works
 * directly — no tile server, no per-user billing.
 */
import React, { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { toFeatureCollection, boundsOf } from "@core/catalog/geo.ts";
import { config } from "../lib/config.ts";
import { fallbackStyle, MARKER, type ActivityMapProps } from "./mapTypes.ts";

export const mapAvailable = true;

let protocolRegistered = false;
function ensurePmtiles() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

export function ActivityMap({ items, center, selectedId, onSelect, dark }: ActivityMapProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const data = useMemo(() => toFeatureCollection(items), [items]);

  // Create once.
  useEffect(() => {
    if (!container.current) return;
    ensurePmtiles();
    const m = new maplibregl.Map({
      container: container.current,
      style: (config.mapStyleUrl ?? fallbackStyle(dark)) as maplibregl.StyleSpecification | string,
      center: [center.lon, center.lat],
      zoom: 12,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("activities", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "activity-dots",
        type: "circle",
        source: "activities",
        paint: {
          "circle-radius": 8,
          "circle-color": ["case", ["get", "open"], MARKER.open, MARKER.closed],
          "circle-stroke-color": MARKER.stroke,
          "circle-stroke-width": 2,
        },
      });
      m.on("click", "activity-dots", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current(id);
      });
      m.on("click", (e) => {
        const hits = m.queryRenderedFeatures(e.point, { layers: ["activity-dots"] });
        if (!hits.length) onSelectRef.current(null);
      });
      m.on("mouseenter", "activity-dots", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "activity-dots", () => { m.getCanvas().style.cursor = ""; });
      (m as unknown as { _alentourLoaded: boolean })._alentourLoaded = true;
      m.fire("alentour:ready");
    });
    map.current = m;
    return () => { m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push data and frame it whenever the result set changes.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      (m.getSource("activities") as maplibregl.GeoJSONSource | undefined)?.setData(data);
      const b = boundsOf(items);
      if (b) m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 });
    };
    if ((m as unknown as { _alentourLoaded?: boolean })._alentourLoaded) apply();
    else m.once("alentour:ready", apply);
  }, [data, items]);

  // Highlight the selection.
  useEffect(() => {
    const m = map.current;
    if (!m || !(m as unknown as { _alentourLoaded?: boolean })._alentourLoaded) return;
    m.setPaintProperty("activity-dots", "circle-color",
      ["case", ["==", ["get", "id"], selectedId ?? ""], MARKER.selected,
        ["get", "open"], MARKER.open, MARKER.closed]);
    m.setPaintProperty("activity-dots", "circle-radius",
      ["case", ["==", ["get", "id"], selectedId ?? ""], 11, 8]);
  }, [selectedId]);

  return <div ref={container} data-testid="activity-map" style={{ position: "absolute", inset: 0 }} />;
}
