/**
 * Loading the two static files the app depends on: the catalog and the weather.
 *
 * Both are fetched from the CDN, cached on the device, and read cache-first so the app opens
 * instantly and keeps working with no signal. There is no network in the interaction loop —
 * filtering, search and ranking are all local.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CatalogFile } from "@core/catalog/types.ts";
import type { WeatherFile } from "@core/weather/types.ts";
import { catalogUrl, weatherUrl } from "./config.ts";

const CATALOG_REFRESH_MS = 6 * 60 * 60 * 1000;
const WEATHER_REFRESH_MS = 30 * 60 * 1000;

export interface Loaded<T> { data: T | null; error: string | null; fromCache: boolean }

export async function loadCatalog(locale: string): Promise<Loaded<CatalogFile>> {
  return cacheFirst<CatalogFile>(`catalog.v2.${locale}`, catalogUrl(locale), CATALOG_REFRESH_MS,
    (d) => Array.isArray((d as CatalogFile)?.activities));
}

export async function loadWeather(force = false): Promise<Loaded<WeatherFile>> {
  return cacheFirst<WeatherFile>("weather.v1", weatherUrl(), force ? 0 : WEATHER_REFRESH_MS,
    (d) => Array.isArray((d as WeatherFile)?.hours));
}

async function cacheFirst<T>(
  key: string,
  url: string,
  refreshMs: number,
  valid: (d: unknown) => boolean,
): Promise<Loaded<T>> {
  const cached = await read<T>(key);
  if (cached) {
    if (Date.now() - cached.at > refreshMs) void refresh(key, url, valid);
    return { data: cached.data, error: null, fromCache: true };
  }
  try {
    const data = await fetchJson<T>(url, valid);
    await write(key, data);
    return { data, error: null, fromCache: false };
  } catch (err) {
    return { data: null, error: String(err), fromCache: false };
  }
}

async function refresh(key: string, url: string, valid: (d: unknown) => boolean): Promise<void> {
  try {
    await write(key, await fetchJson(url, valid));
  } catch {
    // Offline is normal. The cached copy is still good; try again next launch.
  }
}

async function fetchJson<T>(url: string, valid: (d: unknown) => boolean): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const data = await res.json();
  if (!valid(data)) throw new Error(`Malformed file at ${url}`);
  return data as T;
}

async function read<T>(key: string): Promise<{ data: T; at: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { data: T; at: number }) : null;
  } catch {
    return null;
  }
}

async function write(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ data, at: Date.now() }));
  } catch {
    // A full disk must not break browsing.
  }
}
