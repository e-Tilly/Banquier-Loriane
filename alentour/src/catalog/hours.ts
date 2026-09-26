/**
 * A pragmatic subset of the OSM `opening_hours` syntax.
 *
 * Supports: `24/7`, day ranges and lists (`Mo-Fr`, `Mo,We,Fr`), multiple time spans,
 * overnight spans (`22:00-02:00`), `off`, and rules separated by `;`.
 *
 * Deliberately NOT supported: public holidays, week/month selectors, sunrise/sunset,
 * open-ended ranges. Anything it cannot parse returns "unknown" rather than guessing —
 * showing a venue as open when it is closed is worse than admitting we don't know.
 */
export type OpenState = "open" | "closed" | "unknown";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

interface Span { days: Set<number>; from: number; to: number; closed: boolean }

export function parseOpeningHours(spec: string): Span[] | null {
  const text = spec.trim();
  if (!text) return null;
  if (text === "24/7") {
    return [{ days: new Set([0, 1, 2, 3, 4, 5, 6]), from: 0, to: 1440, closed: false }];
  }

  const spans: Span[] = [];
  for (const rule of text.split(";")) {
    const r = rule.trim();
    if (!r) continue;

    const m = /^([A-Za-z,\-]+)\s+(.+)$/.exec(r);
    if (!m) return null;

    const days = parseDays(m[1]!);
    if (!days) return null;

    const rest = m[2]!.trim();
    if (/^off$/i.test(rest)) {
      spans.push({ days, from: 0, to: 1440, closed: true });
      continue;
    }

    for (const part of rest.split(",")) {
      const t = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(part.trim());
      if (!t) return null;
      const from = Number(t[1]) * 60 + Number(t[2]);
      const to = Number(t[3]) * 60 + Number(t[4]);
      spans.push({ days, from, to, closed: false });
    }
  }
  return spans.length ? spans : null;
}

function parseDays(spec: string): Set<number> | null {
  const out = new Set<number>();
  for (const chunk of spec.split(",")) {
    const range = chunk.split("-");
    if (range.length === 1) {
      const i = dayIndex(range[0]!);
      if (i < 0) return null;
      out.add(i);
    } else if (range.length === 2) {
      const a = dayIndex(range[0]!), b = dayIndex(range[1]!);
      if (a < 0 || b < 0) return null;
      for (let i = a; ; i = (i + 1) % 7) {          // wraps, so Sa-Su works
        out.add(i);
        if (i === b) break;
      }
    } else return null;
  }
  return out;
}

function dayIndex(s: string): number {
  return DAYS.findIndex((d) => d.toLowerCase() === s.trim().toLowerCase());
}

/** `at` must already be in the venue's local time. */
export function isOpenAt(spec: string | undefined, at: Date): OpenState {
  return openStateAt(spec, at.getDay(), at.getHours() * 60 + at.getMinutes());
}

/** The same test from a weekday (0 = Sunday) and minutes after local midnight — no Date needed. */
export function openStateAt(spec: string | null | undefined, day: number, minutes: number): OpenState {
  if (!spec) return "unknown";
  const spans = parseOpeningHours(spec);
  if (!spans) return "unknown";

  for (const s of spans) {
    if (s.closed && s.days.has(day)) return "closed";
  }
  for (const s of spans) {
    if (s.closed) continue;
    if (s.to > s.from) {
      if (s.days.has(day) && minutes >= s.from && minutes < s.to) return "open";
    } else {
      // overnight: 22:00-02:00 covers late today and early tomorrow
      if (s.days.has(day) && minutes >= s.from) return "open";
      if (s.days.has((day + 6) % 7) && minutes < s.to) return "open";
    }
  }
  return "closed";
}

/** Open periods that START on a weekday, as minutes after local midnight (`to` may pass 1440). */
export function openSpansOn(spec: string | null | undefined, day: number): { from: number; to: number }[] {
  const spans = spec ? parseOpeningHours(spec) : null;
  if (!spans) return [];
  if (spans.some((s) => s.closed && s.days.has(day))) return [];
  return spans
    .filter((s) => !s.closed && s.days.has(day))
    .map((s) => ({ from: s.from, to: s.to > s.from ? s.to : s.to + 1440 }))
    .sort((a, b) => a.from - b.from);
}
