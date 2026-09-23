/** Display formatting. All user-facing strings are FR/EN from the first row — retrofitting
 *  i18n is a rewrite (docs/alentour/09-architecture.md). */
import type { CatalogActivity } from "@core/catalog/types.ts";

export type Lang = "fr" | "en";

const S = {
  free:        { fr: "Gratuit",            en: "Free" },
  from:        { fr: "dès",                en: "from" },
  min:         { fr: "min",                en: "min" },
  h:           { fr: "h",                  en: "h" },
  openNow:     { fr: "Ouvert",             en: "Open" },
  closed:      { fr: "Fermé",              en: "Closed" },
  hoursUnknown:{ fr: "Horaire inconnu",    en: "Hours unknown" },
  away:        { fr: "de marche",          en: "away" },
  unverified:  { fr: "Non vérifié",        en: "Unverified" },
  a11yUnknown: { fr: "Accessibilité non vérifiée", en: "Accessibility not verified" },
  noResults:   { fr: "Aucun résultat exact", en: "No exact matches" },
  ignoring:    { fr: "en ignorant",        en: "ignoring" },
  savedEmpty:  { fr: "Rien d'enregistré pour l'instant", en: "Nothing saved yet" },
  results:     { fr: "résultats",          en: "results" },
} as const;

export function t(key: keyof typeof S, lang: Lang): string {
  return S[key][lang];
}

export function formatPrice(a: CatalogActivity, lang: Lang): string {
  if (a.free) return t("free", lang);
  if (a.priceMin === undefined) return "";
  const dollars = (c: number) => `${Math.round(c / 100)} $`;
  const base = lang === "fr" ? dollars(a.priceMin) : `$${Math.round(a.priceMin / 100)}`;
  return a.priceMax && a.priceMax !== a.priceMin ? `${t("from", lang)} ${base}` : base;
}

export function formatDuration(a: CatalogActivity, lang: Lang): string {
  const m = a.durTypical ?? a.durMin;
  if (!m) return "";
  if (m < 60) return `${m} ${t("min", lang)}`;
  const hours = m / 60;
  return Number.isInteger(hours) ? `${hours} ${t("h", lang)}` : `${hours.toFixed(1)} ${t("h", lang)}`;
}

export function formatDistance(km: number, lang: Lang): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return lang === "fr" ? `${km.toFixed(1)} km` : `${km.toFixed(1)} km`;
}

/** Difficulty as words, not a bare number — "3" means nothing without an anchor. */
export function effortLabel(a: CatalogActivity, lang: Lang): string | null {
  const p = a.physical ?? 0;
  const labels = {
    fr: ["Facile", "Facile", "Modéré", "Exigeant", "Difficile"],
    en: ["Easy", "Easy", "Moderate", "Demanding", "Hard"],
  };
  return p > 1 ? labels[lang][p]! : null;
}
