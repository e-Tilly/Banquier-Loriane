/**
 * Wall-clock time in a venue's timezone. The server runs in UTC; a Tuesday 19:00 trivia night
 * is 19:00 in Montréal, including across daylight-saving changes.
 */
export interface Local { y: number; m: number; d: number; h: number; min: number; dow: number }

const fmt = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    fmt.set(tz, f);
  }
  return f;
}
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(at: Date, tz: string): Local {
  const p = Object.fromEntries(formatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour! % 24, min: +p.minute!, dow: DOW[p.weekday!]! };
}

/** The instant at which the wall clock in `tz` reads y-m-d h:min. */
export function fromLocal(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const l = localParts(new Date(t), tz);
    const diff = Date.UTC(l.y, l.m - 1, l.d, l.h, l.min) - guess;
    if (diff === 0) break;
    t -= diff;
  }
  return new Date(t);
}

/** Local midnight `days` days after the local date of `at`, as {y, m, d, dow}. */
export function localDay(at: Date, tz: string, days: number) {
  const l = localParts(at, tz);
  const noon = fromLocal(l.y, l.m, l.d, 12, 0, tz);
  return localParts(new Date(noon.getTime() + days * 86_400_000), tz);
}
