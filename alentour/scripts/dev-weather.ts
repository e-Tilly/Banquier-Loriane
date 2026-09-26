/**
 * Write a synthetic out/weather.montreal.json relative to NOW, for local development and
 * screenshots — no network needed.
 *
 *   npm run dev:weather              # dry, mild
 *   npm run dev:weather -- --rain    # rain over the next few hours (triggers the rainy-day shelf)
 *   npm run dev:weather -- --cold    # -20 °C
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { WeatherFile } from "../src/weather/types.ts";

const rain = process.argv.includes("--rain");
const cold = process.argv.includes("--cold");
const now = new Date();
const top = new Date(now); top.setMinutes(0, 0, 0);

const hours = Array.from({ length: 36 }, (_, i) => {
  const t = new Date(top.getTime() + (i - 1) * 3_600_000);
  return { t: t.toISOString(), precipProb: rain && i < 6 ? 85 : 5, tempC: cold ? -20 : 21 };
});
const day = (offset: number) => {
  const d = new Date(now); d.setDate(d.getDate() + offset);
  const at = (h: number, m: number) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.toISOString(); };
  return { date: at(12, 0).slice(0, 10), sunrise: at(6, 30), sunset: at(19, 45) };
};

const file: WeatherFile = {
  format: 1, city: "montreal", lat: 45.5089, lon: -73.5617,
  generatedAt: now.toISOString(), source: "dev-synthetic",
  hours, days: [day(0), day(1)],
};
mkdirSync("./out", { recursive: true });
writeFileSync("./out/weather.montreal.json", JSON.stringify(file));
console.log(`✓ out/weather.montreal.json (${rain ? "rain" : "dry"}, ${cold ? "-20" : "21"} °C)`);
