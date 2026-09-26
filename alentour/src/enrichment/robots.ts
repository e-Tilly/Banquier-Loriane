/**
 * robots.txt, per RFC 9309: the group for our user agent if one exists, otherwise `*`; the
 * longest matching rule wins, and Allow wins a tie. `*` and `$` wildcards are supported.
 *
 * An owner pasting their own site is arguably consent, but the seeding pipeline fetches sites
 * nobody asked us to read — so both respect robots.txt, and one policy is simpler than two.
 */
export interface RobotsRules { allow: string[]; disallow: string[] }

export function parseRobots(text: string, agent = "alentourbot"): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], allow: [], disallow: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
  };
}

function matchLength(rule: string, path: string): number {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path) ? body.length : -1;
}

export function isAllowed(rules: RobotsRules, pathWithQuery: string): boolean {
  let best = -1, allowed = true;
  for (const r of rules.disallow) {
    const n = matchLength(r, pathWithQuery);
    if (n > best) { best = n; allowed = false; }
  }
  for (const r of rules.allow) {
    const n = matchLength(r, pathWithQuery);
    if (n >= best && n >= 0) { best = n; allowed = true; }
  }
  return allowed;
}
