/**
 * Just enough HTML handling to turn a small-business website into model input: visible text,
 * the page's own metadata, schema.org JSON-LD (often the best structured source of hours and
 * prices on the page), links to follow, and social profiles.
 *
 * Deliberately not a DOM parser. Small-business sites are template-built and messy; a tolerant
 * regex pass that loses some structure is fine, because the model reads prose.
 */

export interface PageInfo {
  title: string | null;
  description: string | null;
  lang: string | null;
  text: string;
  jsonLd: unknown[];
  links: { href: string; text: string }[];
  phones: string[];
  emails: string[];
  socials: Record<string, string>;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", eacute: "é", egrave: "è", ecirc: "ê",
  agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ucirc: "û", ugrave: "ù", icirc: "î", iuml: "ï",
  euml: "ë", Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…", middot: "·", copy: "©",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
};

const SOCIAL_HOSTS: Record<string, RegExp> = {
  instagram: /(^|\.)instagram\.com$/,
  facebook: /(^|\.)facebook\.com$|(^|\.)fb\.com$/,
  tiktok: /(^|\.)tiktok\.com$/,
};

export function parsePage(html: string, baseUrl: string): PageInfo {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  let description: string | null = null;
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = (attr(m[0], "name") ?? attr(m[0], "property") ?? "").toLowerCase();
    if (name === "description" || (name === "og:description" && !description)) description = attr(m[0], "content");
  }
  const lang = html.match(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i)?.[1] ?? null;

  const jsonLd: unknown[] = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1]!.trim());
      if (Array.isArray(v)) jsonLd.push(...v); else if (v && typeof v === "object" && "@graph" in v) jsonLd.push(...(v as any)["@graph"]); else jsonLd.push(v);
    } catch { /* malformed JSON-LD is common; skip it */ }
  }

  const links: PageInfo["links"] = [];
  const phones = new Set<string>(), emails = new Set<string>();
  const socials: Record<string, string> = {};
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(`<a ${m[1]}>`, "href");
    if (!href) continue;
    const text = clean(stripTags(m[2]!)).slice(0, 80);
    if (href.startsWith("tel:")) { phones.add(href.slice(4).replace(/[^\d+]/g, "")); continue; }
    if (href.startsWith("mailto:")) { emails.add(href.slice(7).split("?")[0]!.toLowerCase()); continue; }
    let abs: URL;
    try { abs = new URL(href, baseUrl); } catch { continue; }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    for (const [k, re] of Object.entries(SOCIAL_HOSTS)) {
      if (re.test(abs.hostname) && abs.pathname.length > 1 && !socials[k]) socials[k] = abs.toString();
    }
    abs.hash = "";
    links.push({ href: abs.toString(), text });
  }

  return {
    title: title ? clean(decodeEntities(title)) : null,
    description: description ? clean(description) : null,
    lang,
    text: htmlToText(html),
    jsonLd,
    links,
    phones: [...phones].filter((p) => p.replace(/\D/g, "").length >= 10),
    emails: [...emails].filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)),
    socials,
  };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

function clean(s: string): string {
  return decodeEntities(s).replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Visible text with block structure kept as line breaks. */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer)\b[^>]*>/gi, "\n")          // keep nav/footer text: hours often live there
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|dd|dt|address|main|aside)\b[^>]*>/gi, "\n")
    .replace(/<t[dh]\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  return clean(body).split("\n").map((l) => l.trim()).filter((l, i, arr) => l && l !== arr[i - 1]).join("\n");
}

/** Links worth a second fetch: same host, and plausibly about hours, prices, or what they do. */
const INTERESTING = /(a-?propos|about|horaire|hours|heures|tarif|prix|price|pricing|rates|contact|activit|services|cours|classes|ateliers|workshops|menu|faq|reserv|book|info|visit|planifier|plan-your)/i;

export function interestingLinks(page: PageInfo, base: string, max = 4): string[] {
  const host = new URL(base).host;
  const seen = new Set<string>([new URL(base).toString()]);
  const out: string[] = [];
  for (const l of page.links) {
    let u: URL;
    try { u = new URL(l.href); } catch { continue; }
    if (u.host !== host || seen.has(u.toString())) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?)$/i.test(u.pathname)) continue;
    if (!INTERESTING.test(u.pathname) && !INTERESTING.test(l.text)) continue;
    seen.add(u.toString());
    out.push(u.toString());
    if (out.length >= max) break;
  }
  return out;
}

/** The schema.org fields that matter for a listing, from any LocalBusiness-like JSON-LD node. */
export function businessFacts(jsonLd: unknown[]): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  for (const node of jsonLd) {
    if (!node || typeof node !== "object") continue;
    const n = node as Record<string, any>;
    for (const k of ["name", "telephone", "priceRange", "openingHours", "openingHoursSpecification", "address", "description", "url", "sameAs"]) {
      if (n[k] !== undefined && facts[k] === undefined) facts[k] = n[k];
    }
  }
  return facts;
}
