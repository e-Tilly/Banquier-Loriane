/**
 * Fetch the forecast for each city and write out/weather.<city>.json.
 *
 *   npm run weather:publish                 # all cities
 *
 * Provider: Open-Meteo — free, no key, no account. Its free tier is for NON-COMMERCIAL use;
 * once the app earns money, switch to their commercial plan or to Environment Canada's open
 * data (api.weather.gc.ca, Open Government Licence, commercial use allowed). The provider is a
 * single function below, so the swap is local.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WeatherFile } from "./types.ts";

export interface City { key: string; name: string; lat: number; lon: number; tz: string }

export const CITIES: City[] = [
  { key: "montreal", name: "Montréal", lat: 45.5089, lon: -73.5617, tz: "America/Toronto" },
];

export function openMeteoUrl(c: City): string {
  const q = new URLSearchParams({
    latitude: String(c.lat), longitude: String(c.lon),
    hourly: "precipitation_probability,temperature_2m",
    daily: "sunrise,sunset",
    timezone: c.tz,
    timeformat: "unixtime",
    forecast_days: "2",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Pure mapping from the Open-Meteo response shape, testable with a fixture. */
export function fromOpenMeteo(c: City, body: any, now = new Date()): WeatherFile {
  const hourly = body?.hourly, daily = body?.daily;
  if (!Array.isArray(hourly?.time) || !Array.isArray(daily?.time)) {
    throw new Error("Unexpected Open-Meteo response shape");
  }
  const iso = (unix: number) => new Date(unix * 1000).toISOString();
  return {
    format: 1,
    city: c.key, lat: c.lat, lon: c.lon,
    generatedAt: now.toISOString(),
    source: "open-meteo",
    hours: hourly.time.map((t: number, i: number) => ({
      t: iso(t),
      precipProb: Number(hourly.precipitation_probability?.[i] ?? 0),
      tempC: Number(hourly.temperature_2m?.[i] ?? 0),
    })),
    days: daily.time.map((t: number, i: number) => ({
      date: new Date(t * 1000).toISOString().slice(0, 10),
      sunrise: iso(daily.sunrise[i]),
      sunset: iso(daily.sunset[i]),
    })),
  };
}

async function main(): Promise<void> {
  const outDir = process.argv[2] ?? "./out";
  mkdirSync(outDir, { recursive: true });
  let failed = 0;
  for (const c of CITIES) {
    try {
      const res = await fetch(openMeteoUrl(c));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const file = fromOpenMeteo(c, await res.json());
      const target = path.join(outDir, `weather.${c.key}.json`);
      writeFileSync(target, JSON.stringify(file));
      console.log(`✓ ${c.name}: ${file.hours.length} hours → ${target}`);
    } catch (err) {
      // Keep the previous file on the CDN: stale-but-labelled beats missing.
      console.error(`✗ ${c.name}: ${(err as Error).message}`);
      failed++;
    }
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
