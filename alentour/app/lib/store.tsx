/**
 * App state: the catalog, the user's position, their filters, and their saves.
 * Deliberately a single context with plain hooks — a solo codebase does not need Redux.
 */
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import type { CatalogFile } from "@core/catalog/types.ts";
import type { Filters, RankContext } from "@core/catalog/filter.ts";
import { loadCatalog } from "./catalog.ts";
import type { Lang } from "./format.ts";

/** Montréal, Plateau. Used until (or unless) the user grants location. */
export const FALLBACK_POSITION = { lat: 45.5230, lon: -73.5800 };

const SAVES_KEY = "saves.v1";

interface Store {
  catalog: CatalogFile | null;
  loading: boolean;
  error: string | null;
  lang: Lang;
  position: { lat: number; lon: number };
  hasPreciseLocation: boolean;
  requestLocation: () => Promise<void>;
  filters: Filters;
  setFilters: (f: Filters) => void;
  saved: Set<string>;
  toggleSave: (id: string) => void;
  /** Weather comes from one call per city per hour, never per user. Stubbed until Stage 2. */
  weather: { precipitationProb: number; tempC: number };
  rankContext: RankContext;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [catalog, setCatalog] = useState<CatalogFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(FALLBACK_POSITION);
  const [hasPreciseLocation, setHasPrecise] = useState(false);
  const [filters, setFilters] = useState<Filters>({ maxDistanceKm: 10 });
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [weather] = useState({ precipitationProb: 0, tempC: 18 });

  useEffect(() => {
    void (async () => {
      const state = await loadCatalog();
      setCatalog(state.catalog);
      setError(state.error);
      setLoading(false);
    })();
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(SAVES_KEY);
        if (raw) setSaved(new Set(JSON.parse(raw) as string[]));
      } catch { /* saves are a convenience, not critical state */ }
    })();
  }, []);

  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;           // the app stays fully usable without it
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      setHasPrecise(true);
    } catch {
      // Denied or unavailable: the Plateau fallback is a perfectly good default.
    }
  }, []);

  const toggleSave = useCallback((id: string) => {
    setSaved((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      void AsyncStorage.setItem(SAVES_KEY, JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, []);

  const lang: Lang = (catalog?.locale ?? "fr-CA").startsWith("fr") ? "fr" : "en";

  const rankContext: RankContext = useMemo(() => {
    const now = new Date();
    return {
      lat: position.lat,
      lon: position.lon,
      now,
      precipitationProb: weather.precipitationProb,
      tempC: weather.tempC,
      isDark: now.getHours() < 7 || now.getHours() >= 20,
      savedIds: saved,
    };
  }, [position, weather, saved]);

  const value: Store = {
    catalog, loading, error, lang, position, hasPreciseLocation, requestLocation,
    filters, setFilters, saved, toggleSave, weather, rankContext,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside StoreProvider");
  return v;
}
