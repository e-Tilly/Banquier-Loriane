/**
 * Every user-facing string, FR and EN, in one place. French first: Montréal, Bill 96.
 * Retrofitting i18n later is a rewrite (docs/alentour/09-architecture.md), so nothing in a
 * screen should be a bare literal.
 */
import * as Localization from "expo-localization";

export type Lang = "fr" | "en";

const dict = {
  // navigation
  "nav.explore": { fr: "Explorer", en: "Explore" },
  "nav.saved": { fr: "Enregistrés", en: "Saved" },
  "nav.map": { fr: "Carte", en: "Map" },
  "nav.settings": { fr: "Réglages", en: "Settings" },
  "nav.back": { fr: "Retour", en: "Back" },

  // home
  "home.morning": { fr: "Ce matin", en: "This morning" },
  "home.afternoon": { fr: "Cet après-midi", en: "This afternoon" },
  "home.evening": { fr: "Ce soir", en: "Tonight" },
  "home.title": { fr: "Quoi faire proche", en: "What to do nearby" },
  "home.locate": { fr: "Montrer ce qui est vraiment proche de moi", en: "Show what's actually near me" },
  "home.approx": { fr: "Position approximative : Plateau", en: "Approximate: Plateau" },
  "home.search": { fr: "Chercher et filtrer", en: "Search and filter" },
  "home.everything": { fr: "Tout ce qu'il y a autour", en: "Everything around you" },
  "home.rainNote": { fr: "Pluie prévue — l'intérieur passe en premier.", en: "Rain expected — indoor goes first." },
  "home.coldNote": { fr: "Grand froid — on a trié en conséquence.", en: "Deep cold — sorted accordingly." },
  "home.darkNote": { fr: "Il fait noir — les belvédères attendront demain.", en: "It's dark — lookouts can wait for tomorrow." },
  "home.unavailable": { fr: "Catalogue indisponible", en: "Catalog unavailable" },
  "home.unavailableBody": {
    fr: "Vérifie ta connexion. Le catalogue se garde en mémoire une fois téléchargé.",
    en: "Check your connection. The catalog is cached once downloaded.",
  },

  // cards and facts
  "card.free": { fr: "Gratuit", en: "Free" },
  "card.from": { fr: "dès", en: "from" },
  "card.open": { fr: "Ouvert", en: "Open" },
  "card.closed": { fr: "Fermé", en: "Closed" },
  "card.hoursUnknown": { fr: "Horaire inconnu", en: "Hours unknown" },
  "card.a11yUnknown": { fr: "Accessibilité non vérifiée", en: "Accessibility not verified" },
  "card.save": { fr: "Enregistrer", en: "Save" },
  "card.unsave": { fr: "Retirer des enregistrés", en: "Remove from saved" },
  "effort.0": { fr: "Facile", en: "Easy" },
  "effort.1": { fr: "Facile", en: "Easy" },
  "effort.2": { fr: "Modéré", en: "Moderate" },
  "effort.3": { fr: "Exigeant", en: "Demanding" },
  "effort.4": { fr: "Difficile", en: "Hard" },

  // browse
  "browse.search": { fr: "Chercher…", en: "Search…" },
  "browse.results": { fr: "{n} résultats", en: "{n} results" },
  "browse.results_one": { fr: "{n} résultat", en: "{n} result" },
  "browse.nothing": { fr: "Rien à afficher", en: "Nothing to show" },
  "browse.noExact": { fr: "Aucun résultat exact", en: "No exact matches" },
  "browse.relaxed": { fr: "Voici {n} suggestions en ignorant {what}.", en: "Showing {n} results ignoring {what}." },
  "browse.and": { fr: " et ", en: " and " },
  "browse.unknownTitle": { fr: "Accessibilité non vérifiée", en: "Accessibility not verified" },
  "browse.unknownBody": {
    fr: "On ne sait pas encore. Ces lieux ne sont pas cachés pour autant.",
    en: "We don't know yet. These aren't hidden for that reason.",
  },
  "filter.maxDistanceKm": { fr: "la distance", en: "distance" },
  "filter.maxPriceCents": { fr: "le prix", en: "price" },
  "filter.categories": { fr: "la catégorie", en: "category" },
  "filter.tags": { fr: "l'ambiance", en: "vibe" },
  "filter.openNow": { fr: "ouvert maintenant", en: "open now" },
  "filter.maxDurationMinutes": { fr: "la durée", en: "duration" },
  "filter.maxPhysical": { fr: "l'effort", en: "effort" },
  "filter.maxSkill": { fr: "le niveau", en: "skill" },
  "filter.indoorOnly": { fr: "intérieur", en: "indoor" },
  "filter.minIcebreaker": { fr: "le côté social", en: "sociability" },
  "chip.distance": { fr: "Distance", en: "Distance" },
  "chip.free": { fr: "Gratuit", en: "Free" },
  "chip.openNow": { fr: "Ouvert", en: "Open now" },
  "chip.filters": { fr: "Filtres", en: "Filters" },

  // filter sheet
  "sheet.title": { fr: "Filtres", en: "Filters" },
  "sheet.reset": { fr: "Réinitialiser", en: "Reset" },
  "sheet.mood": { fr: "Envie de quoi ?", en: "In the mood for" },
  "sheet.category": { fr: "Catégorie", en: "Category" },
  "sheet.duration": { fr: "Durée maximale", en: "Max duration" },
  "sheet.effort": { fr: "Effort physique", en: "Physical effort" },
  "sheet.a11y": { fr: "Accessibilité", en: "Accessibility" },
  "sheet.a11yNote": {
    fr: "Les lieux non vérifiés apparaissent séparément plutôt que d'être cachés.",
    en: "Unverified places are shown separately rather than hidden.",
  },
  "sheet.any": { fr: "Peu importe", en: "Any" },
  "sheet.none": { fr: "Aucun", en: "None" },
  "sheet.light": { fr: "Léger", en: "Light" },
  "sheet.moderate": { fr: "Modéré", en: "Moderate" },
  "sheet.halfDay": { fr: "Demi-journée", en: "Half day" },
  "sheet.show": { fr: "Voir {n} résultats", en: "Show {n} results" },
  "sheet.show_one": { fr: "Voir {n} résultat", en: "Show {n} result" },

  // detail
  "detail.price": { fr: "Prix", en: "Price" },
  "detail.duration": { fr: "Durée", en: "Duration" },
  "detail.distance": { fr: "Distance", en: "Distance" },
  "detail.effort": { fr: "Effort", en: "Effort" },
  "detail.about": { fr: "À propos", en: "About" },
  "detail.bring": { fr: "Quoi apporter", en: "What to bring" },
  "detail.hours": { fr: "Horaire", en: "Hours" },
  "detail.a11y": { fr: "Accessibilité", en: "Accessibility" },
  "detail.a11yNone": { fr: "Aucune information", en: "No information" },
  "detail.a11yUnverified": { fr: "Non vérifié :", en: "Not verified:" },
  "detail.a11yCallAhead": {
    fr: "Non vérifié ne veut pas dire inaccessible. Appelle avant de te déplacer.",
    en: "Not verified doesn't mean inaccessible. Call ahead.",
  },
  "detail.tags": { fr: "Étiquettes", en: "Tags" },
  "detail.where": { fr: "Où", en: "Where" },
  "detail.verified": { fr: "Vérifié le {date}", en: "Verified {date}" },
  "detail.unverified": { fr: "Non vérifié", en: "Unverified" },
  "detail.saved": { fr: "★ Enregistré", en: "★ Saved" },
  "detail.save": { fr: "☆ Enregistrer", en: "☆ Save" },
  "detail.go": { fr: "Y aller", en: "Directions" },
  "detail.share": { fr: "Partager", en: "Share" },
  "detail.addToList": { fr: "Ajouter à une liste", en: "Add to a list" },
  "detail.report": { fr: "Signaler une erreur", en: "Report a problem" },
  "detail.notFound": { fr: "Activité introuvable", en: "Activity not found" },
  "detail.shareMessage": { fr: "{title} — trouvé sur Alentour", en: "{title} — found on Alentour" },

  // saved + lists
  "saved.empty": { fr: "Rien d'enregistré pour l'instant", en: "Nothing saved yet" },
  "saved.emptyBody": {
    fr: "Touche l'étoile sur une activité pour la garder ici. Ça marche hors ligne.",
    en: "Tap the star on an activity to keep it here. Works offline.",
  },
  "saved.all": { fr: "Tout", en: "All" },
  "lists.title": { fr: "Mes listes", en: "My lists" },
  "lists.new": { fr: "Nouvelle liste", en: "New list" },
  "lists.namePlaceholder": { fr: "Ex. : Jours de pluie", en: "E.g. Rainy days" },
  "lists.create": { fr: "Créer", en: "Create" },
  "lists.count": { fr: "{n} activités", en: "{n} activities" },
  "lists.count_one": { fr: "{n} activité", en: "{n} activity" },
  "lists.delete": { fr: "Supprimer la liste", en: "Delete list" },
  "lists.done": { fr: "Terminé", en: "Done" },

  // report
  "report.title": { fr: "Qu'est-ce qui cloche ?", en: "What's wrong?" },
  "report.closed": { fr: "Fermé définitivement", en: "Permanently closed" },
  "report.hours": { fr: "Mauvais horaire", en: "Wrong hours" },
  "report.price": { fr: "Mauvais prix", en: "Wrong price" },
  "report.a11y": { fr: "Accessibilité inexacte", en: "Wrong accessibility info" },
  "report.missing": { fr: "N'existe pas", en: "Doesn't exist" },
  "report.dangerous": { fr: "Dangereux", en: "Dangerous" },
  "report.other": { fr: "Autre chose", en: "Something else" },
  "report.details": { fr: "Détails (facultatif)", en: "Details (optional)" },
  "report.send": { fr: "Envoyer", en: "Send" },
  "report.thanks": { fr: "Merci ! On vérifie.", en: "Thanks! We'll check." },
  "report.cancel": { fr: "Annuler", en: "Cancel" },

  // map
  "map.fallbackTitle": { fr: "Carte indisponible ici", en: "Map unavailable here" },
  "map.fallbackBody": {
    fr: "La carte a besoin de l'app installée (pas Expo Go). Voici la liste, du plus proche au plus loin.",
    en: "The map needs the installed app (not Expo Go). Here is the list, nearest first.",
  },

  // settings
  "settings.language": { fr: "Langue", en: "Language" },
  "settings.langAuto": { fr: "Selon l'appareil", en: "Device default" },
  "settings.location": { fr: "Position", en: "Location" },
  "settings.locationOn": { fr: "Position précise activée", en: "Precise location on" },
  "settings.locationOff": { fr: "Position approximative (Plateau)", en: "Approximate location (Plateau)" },
  "settings.locationEnable": { fr: "Utiliser ma position", en: "Use my location" },
  "settings.locationNote": {
    fr: "Ta position sert seulement à trier ce qui est proche. Elle n'est ni stockée ni partagée.",
    en: "Your location is only used to sort what's nearby. It is never stored or shared.",
  },
  "settings.data": { fr: "Données", en: "Data" },
  "settings.catalog": { fr: "Catalogue : {n} activités, mis à jour le {date}", en: "Catalog: {n} activities, updated {date}" },
  "settings.catalog_one": { fr: "Catalogue : {n} activité, mise à jour le {date}", en: "Catalog: {n} activity, updated {date}" },
  "settings.credits": { fr: "Sources et crédits", en: "Sources and credits" },
  "settings.creditsBody": {
    fr: "Lieux : Overture Maps Foundation (CDLA-Permissive 2.0) et contributeurs OpenStreetMap (ODbL). Données ouvertes de la Ville de Montréal. Météo : Open-Meteo (CC BY 4.0).",
    en: "Places: Overture Maps Foundation (CDLA-Permissive 2.0) and OpenStreetMap contributors (ODbL). City of Montréal open data. Weather: Open-Meteo (CC BY 4.0).",
  },
  "settings.privacy": { fr: "Confidentialité", en: "Privacy" },
  "settings.version": { fr: "Version {v}", en: "Version {v}" },
} as const;

export type Key = keyof typeof dict;

/**
 * Singular form, per language. French treats 0 and 1 as singular ("0 résultat"); English only 1.
 * A key with a `_one` sibling switches to it automatically when `vars.n` is singular.
 */
function isSingular(n: number, lang: Lang): boolean {
  return lang === "fr" ? Math.abs(n) < 2 : n === 1;
}

export function translate(key: Key, lang: Lang, vars?: Record<string, string | number>): string {
  const n = vars?.n;
  const oneKey = `${key}_one` as Key;
  const useOne = typeof n === "number" && isSingular(n, lang) && oneKey in dict;
  let s: string = dict[useOne ? oneKey : key][lang];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Device language, narrowed to what we ship. Anything that isn't English gets French. */
export function deviceLang(): Lang {
  try {
    const code = Localization.getLocales()[0]?.languageCode ?? "fr";
    return code === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

export const localeOf = (lang: Lang) => (lang === "fr" ? "fr-CA" : "en-CA");
