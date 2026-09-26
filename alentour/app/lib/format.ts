/** Display formatting, locale-aware. Strings come from the dictionary in i18n.ts. */
import type { CatalogActivity } from "@core/catalog/types.ts";
import { translate, type Key, type Lang } from "./i18n.ts";

export type { Lang };

export function formatPrice(a: CatalogActivity, lang: Lang): string {
  if (a.free) return translate("card.free", lang);
  if (a.priceMin === undefined) return "";
  const n = Math.round(a.priceMin / 100);
  const base = lang === "fr" ? `${n} $` : `$${n}`;
  return a.priceMax && a.priceMax !== a.priceMin ? `${translate("card.from", lang)} ${base}` : base;
}

export function formatDuration(a: CatalogActivity, lang: Lang): string {
  const m = a.durTypical ?? a.durMin;
  if (!m) return "";
  if (m < 60) return `${m} min`;
  const h = m / 60;
  const num = Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", lang === "fr" ? "," : ".");
  return `${num} h`;
}

export function formatDistance(km: number, lang: Lang): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", lang === "fr" ? "," : ".")} km`;
}

/** Difficulty as words — a bare "3" means nothing without an anchor. Null when trivial. */
export function effortLabel(a: CatalogActivity, lang: Lang): string | null {
  const p = a.physical ?? 0;
  return p > 1 ? translate(`effort.${p}` as Key, lang) : null;
}

export function formatDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", {
    year: "numeric", month: "long", day: "numeric",
  });
}
