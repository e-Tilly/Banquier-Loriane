/**
 * weather.json — published next to the catalog, refreshed hourly by a scheduled job.
 *
 * One forecast call per city per hour, never per user (docs/alentour/05-discovery-and-ranking.md).
 * The app reads this file from the CDN and works out "now" itself, so a file that is an hour
 * old is still correct: it carries the next ~36 hours, not a single reading.
 */
export interface WeatherHour {
  /** ISO timestamp with offset, start of the hour. */
  t: string;
  /** 0-100 */
  precipProb: number;
  tempC: number;
}

export interface WeatherDay {
  date: string;          // YYYY-MM-DD, venue-local
  sunrise: string;       // ISO
  sunset: string;        // ISO
}

export interface WeatherFile {
  format: 1;
  city: string;
  lat: number;
  lon: number;
  generatedAt: string;
  source: string;
  hours: WeatherHour[];
  days: WeatherDay[];
}

/** What the ranker consumes. */
export interface Conditions {
  /** 0-1: the WORST chance of rain over the next few hours — people plan ahead. */
  precipitationProb: number;
  tempC: number;
  isDark: boolean;
  /** False when the file is too old to trust; callers should then use neutral defaults. */
  fresh: boolean;
}
