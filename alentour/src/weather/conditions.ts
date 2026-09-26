/** Pure: turn a published forecast into current conditions. Shared by the app and tests. */
import type { Conditions, WeatherFile } from "./types.ts";

export const NEUTRAL: Conditions = { precipitationProb: 0, tempC: 15, isDark: false, fresh: false };

/** Forecast older than this is ignored: a stale "sunny" is worse than no opinion. */
const MAX_AGE_HOURS = 12;
/** Look this far ahead for rain. Someone planning a 3 p.m. outing at 1 p.m. cares about 3 p.m. */
const LOOKAHEAD_HOURS = 3;

export function currentConditions(w: WeatherFile | null | undefined, now: Date): Conditions {
  if (!w || !w.hours?.length) return NEUTRAL;

  const ageHours = (now.getTime() - new Date(w.generatedAt).getTime()) / 3_600_000;
  if (ageHours > MAX_AGE_HOURS || ageHours < -1) return { ...NEUTRAL, isDark: darkAt(w, now) };

  const t = now.getTime();
  const upcoming = w.hours.filter((h) => {
    const start = new Date(h.t).getTime();
    return start + 3_600_000 > t && start <= t + LOOKAHEAD_HOURS * 3_600_000;
  });
  if (!upcoming.length) return { ...NEUTRAL, isDark: darkAt(w, now) };

  return {
    precipitationProb: Math.max(...upcoming.map((h) => h.precipProb)) / 100,
    tempC: upcoming[0]!.tempC,
    isDark: darkAt(w, now),
    fresh: true,
  };
}

function darkAt(w: WeatherFile, now: Date): boolean {
  const t = now.getTime();
  for (const d of w.days) {
    const rise = new Date(d.sunrise).getTime();
    const set = new Date(d.sunset).getTime();
    // Same calendar window: dark before sunrise or after sunset on the day containing `now`.
    if (t >= rise - 12 * 3_600_000 && t < set + 12 * 3_600_000) {
      if (t >= rise && t < set) return false;
      if (t < rise || t >= set) return true;
    }
  }
  // No matching day: fall back to a crude clock rule rather than guessing "light".
  const h = now.getHours();
  return h < 7 || h >= 20;
}
