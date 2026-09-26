/**
 * Native map: MapLibre with our own tiles (Protomaps on R2) — flat cost, no per-user billing.
 * See docs/alentour/10-cost-model.md, trap #2.
 *
 * MapLibre is a native module, so it is NOT available in Expo Go. In Expo Go this component
 * reports itself unavailable and the map screen shows a nearest-first list instead; in a dev
 * build or store build (`npx expo run:ios`, EAS) the real map renders. The module is required
 * lazily so Expo Go never evaluates it.
 */
import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { toFeatureCollection, boundsOf } from "@core/catalog/geo.ts";
import { config } from "../lib/config.ts";
import { fallbackStyle, MARKER, type ActivityMapProps } from "./mapTypes.ts";

export const mapAvailable = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

export function ActivityMap({ items, center, selectedId, onSelect, dark }: ActivityMapProps) {
  const data = useMemo(() => toFeatureCollection(items), [items]);
  const bounds = useMemo(() => boundsOf(items), [items]);
  if (!mapAvailable) return null;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ML = require("@maplibre/maplibre-react-native") as typeof import("@maplibre/maplibre-react-native");

  const initialViewState = bounds
    ? { bounds: [bounds[0][0], bounds[0][1], bounds[1][0], bounds[1][1]] as [number, number, number, number] }
    : { center: [center.lon, center.lat] as [number, number], zoom: 12 };

  return (
    <View style={StyleSheet.absoluteFill}>
      <ML.Map
        style={StyleSheet.absoluteFill}
        mapStyle={config.mapStyleUrl ?? fallbackStyle(dark)}
        attribution
        logo={false}
        onPress={() => onSelect(null)}
      >
        <ML.Camera initialViewState={initialViewState} />
        <ML.GeoJSONSource
          id="activities"
          data={data}
          onPress={(e) => {
            const id = e.nativeEvent.features?.[0]?.properties?.id;
            if (typeof id === "string") onSelect(id);
          }}
        >
          <ML.Layer
            id="activity-dots"
            type="circle"
            paint={{
              "circle-radius": ["case", ["==", ["get", "id"], selectedId ?? ""], 11, 8],
              "circle-color": ["case",
                ["==", ["get", "id"], selectedId ?? ""], MARKER.selected,
                ["get", "open"], MARKER.open, MARKER.closed],
              "circle-stroke-color": MARKER.stroke,
              "circle-stroke-width": 2,
            }}
          />
        </ML.GeoJSONSource>
        <ML.UserLocation />
      </ML.Map>
    </View>
  );
}
