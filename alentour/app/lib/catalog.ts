/**
 * Catalog loading. The whole catalog is one file; it is fetched once, cached on device, and
 * then everything is local — filtering, search, ranking. No network in the interaction loop.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import type { CatalogFile } from "@core/catalog/types.ts";

const CACHE_KEY = "catalog.v1";
const CACHE_META = "catalog.v1.meta";

export interface CatalogState {
  catalog: CatalogFile | null;
  stale: boolean;
  error: string | null;
}

const DEFAULT_CATALOG_URL = "https://catalog.alentour.app/catalog.fr-CA.json";

/**
 * Resolution order matters. `EXPO_PUBLIC_*` is inlined by the bundler at build time and works
 * on every platform, including static web exports; `Constants.expoConfig.extra` resolves at
 * runtime and is NOT always populated on web, where it silently yields undefined. Env first,
 * app.json second, constant last.
 */
function catalogUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_CATALOG_URL;
  if (fromEnv) return fromEnv;
  const fromConfig = (Constants.expoConfig?.extra as { catalogUrl?: string } | undefined)?.catalogUrl;
  return fromConfig ?? DEFAULT_CATALOG_URL;
}

/** Cache first so the app opens instantly and works with no signal, then refresh behind it. */
export async function loadCatalog(): Promise<CatalogState> {
  const cached = await readCache();
  if (cached) {
    void refreshInBackground();
    return { catalog: cached, stale: false, error: null };
  }
  try {
    const fresh = await fetchCatalog();
    await writeCache(fresh);
    return { catalog: fresh, stale: false, error: null };
  } catch (err) {
    return { catalog: null, stale: false, error: String(err) };
  }
}

async function fetchCatalog(): Promise<CatalogFile> {
  const res = await fetch(catalogUrl());
  if (!res.ok) throw new Error(`Catalog fetch failed: HTTP ${res.status}`);
  const data = (await res.json()) as CatalogFile;
  if (!Array.isArray(data.activities)) throw new Error("Catalog is malformed");
  return data;
}

async function refreshInBackground(): Promise<void> {
  try {
    const meta = await AsyncStorage.getItem(CACHE_META);
    const lastAt = meta ? Number(JSON.parse(meta).at) : 0;
    if (Date.now() - lastAt < 6 * 60 * 60 * 1000) return;   // at most every 6h
    const fresh = await fetchCatalog();
    await writeCache(fresh);
  } catch {
    // Offline is normal and not an error worth surfacing: the cache is still good.
  }
}

async function readCache(): Promise<CatalogFile | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CatalogFile) : null;
  } catch {
    return null;
  }
}

async function writeCache(cat: CatalogFile): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cat));
    await AsyncStorage.setItem(CACHE_META, JSON.stringify({ at: Date.now() }));
  } catch {
    // A full disk must not break browsing.
  }
}
