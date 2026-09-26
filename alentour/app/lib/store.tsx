/**
 * App state: catalog, language, position, weather, filters, and the user's library.
 * One context with plain hooks — a solo codebase does not need a state-management library.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import type { CatalogFile } from "@core/catalog/types.ts";
import type { Filters, RankContext } from "@core/catalog/filter.ts";
import type { WeatherFile, Conditions } from "@core/weather/types.ts";
import { currentConditions } from "@core/weather/conditions.ts";
import {
  type Library, emptyLibrary, parseLibrary, fromLegacySaves, toggleSave as libToggleSave,
  isSaved, createList as libCreateList, toggleInList as libToggleInList,
  deleteList as libDeleteList, mergeLibraries,
} from "@core/user/library.ts";
import { loadCatalog, loadWeather } from "./catalog.ts";
import { deviceLang, localeOf, translate, type Key, type Lang } from "./i18n.ts";
import { config } from "./config.ts";

/** Montréal, Plateau. Used until (or unless) the user grants location. */
export const FALLBACK_POSITION = { lat: 45.523, lon: -73.58 };

const LIBRARY_KEY = "library.v1";
const LEGACY_SAVES_KEY = "saves.v1";
const LANG_KEY = "lang.v1";

export type ReportReason = "closed" | "hours" | "price" | "a11y" | "missing" | "dangerous" | "other";

export interface Store {
  catalog: CatalogFile | null;
  loading: boolean;
  error: string | null;
  lang: Lang;
  langOverride: Lang | null;
  setLangOverride: (l: Lang | null) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  position: { lat: number; lon: number };
  hasPreciseLocation: boolean;
  requestLocation: () => Promise<void>;
  conditions: Conditions;
  filters: Filters;
  setFilters: (f: Filters) => void;
  library: Library;
  /** Replace the library with a merge — used by sync in Stage 2. */
  mergeLibrary: (incoming: Library) => void;
  isSaved: (id: string) => boolean;
  toggleSave: (id: string) => void;
  createList: (name: string) => string;
  toggleInList: (listId: string, activityId: string) => void;
  deleteList: (listId: string) => void;
  report: (activityId: string, reason: ReportReason, details: string) => Promise<void>;
  rankContext: RankContext;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [langOverride, setLangOverrideState] = useState<Lang | null>(null);
  const lang: Lang = langOverride ?? deviceLang();
  const [catalog, setCatalog] = useState<CatalogFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(FALLBACK_POSITION);
  const [hasPreciseLocation, setHasPrecise] = useState(false);
  const [weather, setWeather] = useState<WeatherFile | null>(null);
  const [filters, setFilters] = useState<Filters>({ maxDistanceKm: 10 });
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const [tick, setTick] = useState(0);
  const libraryLoaded = useRef(false);

  // Language preference and library, once.
  useEffect(() => {
    void (async () => {
      try {
        const l = await AsyncStorage.getItem(LANG_KEY);
        if (l === "fr" || l === "en") setLangOverrideState(l);
      } catch { /* default to device language */ }
      try {
        const raw = await AsyncStorage.getItem(LIBRARY_KEY);
        if (raw) {
          setLibrary(parseLibrary(JSON.parse(raw)));
        } else {
          // Stage-1 installs stored a flat array of ids. Migrate it rather than lose it.
          const legacy = await AsyncStorage.getItem(LEGACY_SAVES_KEY);
          if (legacy) setLibrary(fromLegacySaves(JSON.parse(legacy) as string[], new Date()));
        }
      } catch { /* the library is a convenience, not critical state */ }
      libraryLoaded.current = true;
    })();
  }, []);

  // Persist the library whenever it changes (after the initial load).
  useEffect(() => {
    if (!libraryLoaded.current) return;
    void AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(library)).catch(() => {});
  }, [library]);

  // Catalog follows the language.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadCatalog(localeOf(lang)).then((r) => {
      if (cancelled) return;
      setCatalog(r.data);
      setError(r.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [lang]);

  // Weather: once now, then every 30 minutes. Open/closed state re-evaluates on the same tick.
  useEffect(() => {
    const load = () => void loadWeather().then((r) => setWeather(r.data));
    load();
    const id = setInterval(() => { load(); setTick((n) => n + 1); }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const setLangOverride = useCallback((l: Lang | null) => {
    setLangOverrideState(l);
    void (l ? AsyncStorage.setItem(LANG_KEY, l) : AsyncStorage.removeItem(LANG_KEY)).catch(() => {});
  }, []);

  const requestLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;           // the app stays fully usable without it
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPosition({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      setHasPrecise(true);
    } catch {
      // Denied or unavailable: the Plateau fallback is a perfectly good default.
    }
  }, []);

  const toggleSave = useCallback((id: string) => {
    setLibrary((lib) => libToggleSave(lib, id, new Date()));
  }, []);

  const createList = useCallback((name: string) => {
    const id = `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    setLibrary((lib) => libCreateList(lib, id, name, new Date()));
    return id;
  }, []);

  const toggleInList = useCallback((listId: string, activityId: string) => {
    setLibrary((lib) => libToggleInList(lib, listId, activityId, new Date()));
  }, []);

  const deleteList = useCallback((listId: string) => {
    setLibrary((lib) => libDeleteList(lib, listId, new Date()));
  }, []);

  const mergeLibrary = useCallback((incoming: Library) => {
    setLibrary((lib) => mergeLibraries(lib, incoming));
  }, []);

  const t = useCallback(
    (key: Key, vars?: Record<string, string | number>) => translate(key, lang, vars),
    [lang],
  );

  const report = useCallback(async (activityId: string, reason: ReportReason, details: string) => {
    if (config.apiUrl) {
      const res = await fetch(`${config.apiUrl}/v1/reports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subjectType: "activity", subjectId: activityId, reason, details }),
      });
      if (!res.ok) throw new Error(`Report failed: HTTP ${res.status}`);
      return;
    }
    // Stage 1 has no backend: fall back to email so reports are never silently dropped.
    const subject = encodeURIComponent(`[Alentour] ${reason} — ${activityId}`);
    const body = encodeURIComponent(`${details}\n\nActivity: ${activityId}\nPlatform: ${Platform.OS}`);
    await Linking.openURL(`mailto:${config.supportEmail}?subject=${subject}&body=${body}`);
  }, []);

  const conditions = useMemo(() => currentConditions(weather, new Date()), [weather, tick]);

  const savedSet = useMemo(
    () => new Set(Object.keys(library.saves).filter((id) => isSaved(library, id))),
    [library],
  );

  const rankContext: RankContext = useMemo(() => ({
    lat: position.lat,
    lon: position.lon,
    now: new Date(),
    precipitationProb: conditions.precipitationProb,
    tempC: conditions.tempC,
    isDark: conditions.isDark,
    savedIds: savedSet,
  }), [position, conditions, savedSet, tick]);

  const value: Store = {
    catalog, loading, error, lang, langOverride, setLangOverride, t,
    position, hasPreciseLocation, requestLocation, conditions,
    filters, setFilters, library, mergeLibrary,
    isSaved: (id) => savedSet.has(id), toggleSave, createList, toggleInList, deleteList,
    report, rankContext,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside StoreProvider");
  return v;
}
