/**
 * Runtime configuration. EXPO_PUBLIC_* values are inlined by the bundler at build time and
 * work on every platform, including static web exports — unlike app.json `extra`, which is
 * resolved at runtime and is not reliably populated on web.
 *
 * Each variable MUST be read with static member access (`process.env.EXPO_PUBLIC_X`). The
 * bundler only inlines that exact form; `process.env[name]` is silently undefined at runtime.
 */
function clean(v: string | undefined): string | undefined {
  return v && v.trim() ? v.trim().replace(/\/$/, "") : undefined;
}

export const config = {
  /** Directory holding catalog.<locale>.json and weather.<city>.json. */
  cdnUrl: clean(process.env.EXPO_PUBLIC_CDN_URL) ?? "https://catalog.alentour.app",
  /** Stage 2+ API. Absent in Stage 1: the app is fully usable without it. */
  apiUrl: clean(process.env.EXPO_PUBLIC_API_URL),
  /** A MapLibre style JSON (e.g. Protomaps on R2). Absent: markers on a plain canvas. */
  mapStyleUrl: clean(process.env.EXPO_PUBLIC_MAP_STYLE_URL),
  city: "montreal",
  /** Where "Report a problem" goes when there is no API yet. */
  supportEmail: clean(process.env.EXPO_PUBLIC_SUPPORT_EMAIL) ?? "allo@alentour.app",
  webUrl: clean(process.env.EXPO_PUBLIC_WEB_URL) ?? "https://alentour.app",
  /** Public base for listing photos (R2 in production, the API's /media in development). */
  mediaUrl: clean(process.env.EXPO_PUBLIC_MEDIA_URL) ?? "https://media.alentour.app",
};

export const mediaUrl = (key: string) => `${config.mediaUrl}/${key}`;

export const catalogUrl = (locale: string) => `${config.cdnUrl}/catalog.${locale}.json`;
export const weatherUrl = () => `${config.cdnUrl}/weather.${config.city}.json`;
