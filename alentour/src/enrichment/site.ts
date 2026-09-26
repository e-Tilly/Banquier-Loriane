/**
 * Read a business website: robots.txt, the home page, and up to four same-site pages that look
 * like they hold hours, prices or what the place does. Returns the text the model will read,
 * labelled by page so every piece of evidence can be traced back to a URL.
 */
import { FetchError, type Fetcher } from "./net.ts";
import { isAllowed, parseRobots, type RobotsRules } from "./robots.ts";
import { businessFacts, interestingLinks, parsePage } from "./html.ts";

export interface SitePage { url: string; title: string | null; text: string }

export interface SiteSnapshot {
  url: string;
  pages: SitePage[];
  description: string | null;
  lang: string | null;
  structured: Record<string, unknown>;
  phones: string[];
  emails: string[];
  socials: Record<string, string>;
  skipped: { url: string; reason: string }[];
}

const PAGE_CHARS = 12_000;
const TOTAL_CHARS = 40_000;

export async function readSite(fetcher: Fetcher, website: string, maxExtraPages = 4): Promise<SiteSnapshot> {
  const start = new URL(website.includes("://") ? website : `https://${website}`);
  const skipped: SiteSnapshot["skipped"] = [];

  let robots: RobotsRules = { allow: [], disallow: [] };
  try {
    const r = await fetcher.get(new URL("/robots.txt", start).toString(), { accept: "text/plain", maxBytes: 200_000 });
    if (r.status === 200) robots = parseRobots(r.body);
  } catch (err) {
    if (err instanceof FetchError && (err.code === "private_address" || err.code === "bad_url")) throw err;
    // No robots.txt, or it failed: RFC 9309 treats an unreachable file as "allow".
  }
  const allowed = (u: URL) => isAllowed(robots, u.pathname + u.search);
  if (!allowed(start)) throw new FetchError("robots", "This website asks robots not to read its home page");

  const home = await fetcher.get(start.toString());
  if (home.status !== 200 || !home.body) throw new FetchError("http", `The website answered ${home.status}`);
  const homeInfo = parsePage(home.body, home.url);

  const pages: SitePage[] = [{ url: home.url, title: homeInfo.title, text: homeInfo.text.slice(0, PAGE_CHARS) }];
  const jsonLd = [...homeInfo.jsonLd];
  const phones = new Set(homeInfo.phones), emails = new Set(homeInfo.emails);
  const socials = { ...homeInfo.socials };
  let total = pages[0]!.text.length;

  for (const link of interestingLinks(homeInfo, home.url, maxExtraPages)) {
    if (total >= TOTAL_CHARS) break;
    const u = new URL(link);
    if (!allowed(u)) { skipped.push({ url: link, reason: "robots.txt" }); continue; }
    try {
      const r = await fetcher.get(link);
      if (r.status !== 200 || !r.body) { skipped.push({ url: link, reason: `HTTP ${r.status}` }); continue; }
      const info = parsePage(r.body, r.url);
      const text = info.text.slice(0, Math.min(PAGE_CHARS, TOTAL_CHARS - total));
      pages.push({ url: r.url, title: info.title, text });
      total += text.length;
      jsonLd.push(...info.jsonLd);
      info.phones.forEach((p) => phones.add(p));
      info.emails.forEach((e) => emails.add(e));
      for (const [k, v] of Object.entries(info.socials)) socials[k] ??= v;
    } catch (err) {
      skipped.push({ url: link, reason: (err as Error).message });
    }
  }

  return {
    url: home.url,
    pages,
    description: homeInfo.description,
    lang: homeInfo.lang,
    structured: businessFacts(jsonLd),
    phones: [...phones],
    emails: [...emails],
    socials,
    skipped,
  };
}

/** The exact text the model sees, and the text evidence is checked against. */
export function sourceText(site: SiteSnapshot | null, owner: { name: string; pitch?: string | null }): string {
  const parts = [`[OWNER] Business name: ${owner.name}`];
  if (owner.pitch) parts.push(`[OWNER] What we do: ${owner.pitch}`);
  if (site) {
    if (site.description) parts.push(`[META ${site.url}] ${site.description}`);
    if (Object.keys(site.structured).length) parts.push(`[SCHEMA.ORG ${site.url}] ${JSON.stringify(site.structured)}`);
    for (const p of site.pages) parts.push(`[PAGE ${p.url}]${p.title ? ` ${p.title}` : ""}\n${p.text}`);
  }
  return parts.join("\n\n");
}
