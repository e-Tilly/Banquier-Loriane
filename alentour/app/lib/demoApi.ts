/**
 * DEMO BACKEND — an in-browser stand-in for the Alentour API, used only by the hosted preview
 * build (EXPO_PUBLIC_DEMO=1). The real API (src/api, tested against Postgres) cannot run inside
 * a static page, so this reproduces its route shapes and the rules a person can see and feel:
 * the 18+ / phone setup, the 8-person cap, chat refusing contact details, a report pausing an
 * outing, duplicate warnings on additions, the concierge being a labelled voice and never an
 * attendee. Everything lives in this browser (localStorage) and every person in it is fictional.
 *
 * Nothing here ships in a production build: config.demo is false unless the flag is set.
 */
import { mergeLibraries, parseLibrary, emptyLibrary, type Library } from "@core/user/library.ts";
import { ApiError } from "./api.ts";

const STORE = "alentour.demo.v1";
const H = 3_600_000, DAY = 86_400_000;

// Venue ids and activity ids from db/seed/montreal.sql, which the demo catalog is exported from.
const A = {
  impro: "b0000001-0000-4000-8000-000000000003",
  escape: "b0000001-0000-4000-8000-00000000000a",
  ceramics: "b0000001-0000-4000-8000-000000000008",
  bloc: "b0000001-0000-4000-8000-000000000001",
};
const V = {
  impro: { id: "a0000001-0000-4000-8000-000000000003", name: "Le Randolph", address: "2041 Rue Saint-Denis", lat: 45.5237, lon: -73.5817 },
  escape: { id: "a0000001-0000-4000-8000-00000000000a", name: "Lab Escape", address: "1751 Rue Richardson", lat: 45.5195, lon: -73.572 },
  ceramics: { id: "a0000001-0000-4000-8000-000000000008", name: "Céramic Café", address: "4338 Rue Saint-Denis", lat: 45.5232, lon: -73.5952 },
};
const TITLES: Record<string, string> = { [A.impro]: "Impro au Randolph", [A.escape]: "Jeu d'évasion", [A.ceramics]: "Peinture sur céramique", [A.bloc]: "Bloc à Allez Up" };

interface Msg { id: number; kind: "user" | "concierge"; body: string; author: string | null; mine: boolean; status: "visible" | "held"; at: number }
interface Option { id: string; at: number; yes: number; maybe: number; mine: "yes" | "maybe" | "no" | null }
interface Outing {
  id: string; mode: "venue_session" | "rally" | "fixed"; organizer: "venue" | "concierge" | "user"; status: "voting" | "confirmed" | "paused";
  activityId: string; venue: typeof V.impro; startsAt: number | null; deadline: number | null; capacity: number; going: number;
  me: "going" | "maybe" | null; invited: boolean; hosting: boolean; checkedIn: boolean; options: Option[]; messages: Msg[];
}
interface State {
  user: { id: string; email: string; displayName: string | null; birthYear: number | null; locale: string; trustLevel: number } | null;
  adult: boolean; phone: string | null; optIn: boolean; library: Library; outings: Outing[]; seq: number;
  confirmed: Record<string, boolean>; submissions: { id: string; title: string; status: string }[];
}

/** `hour` o'clock Montréal time, `daysAhead` days from today — the app shows times in that zone. */
function at(daysAhead: number, hour: number): number {
  const tz = "America/Toronto";
  const parts = (t: number) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const day = parts(Date.now() + daysAhead * DAY);
  const guess = Date.UTC(+day.year!, +day.month! - 1, +day.day!, hour, 0);
  const seen = parts(guess);
  const shown = Date.UTC(+seen.year!, +seen.month! - 1, +seen.day!, +seen.hour! % 24, +seen.minute!);
  return guess - (shown - guess);
}

function seed(): State {
  const mk = (id: string, o: Partial<Outing>): Outing => ({
    id, mode: "venue_session", organizer: "venue", status: "confirmed", activityId: A.impro, venue: V.impro, startsAt: null, deadline: null,
    capacity: 8, going: 0, me: null, invited: false, hosting: false, checkedIn: false, options: [], messages: [], ...o,
  });
  const outings: Outing[] = [
    mk("demo-impro-1", { startsAt: at(2, 19), going: 3 }),
    mk("demo-impro-2", { startsAt: at(3, 19), going: 6 }),
    mk("demo-impro-3", { startsAt: at(5, 19), going: 7 }),
    mk("demo-rally", {
      mode: "rally", organizer: "concierge", status: "voting", activityId: A.escape, venue: V.escape, deadline: Date.now() + 40 * H, invited: true,
      options: [
        { id: "o1", at: at(5, 19), yes: 2, maybe: 1, mine: null },
        { id: "o2", at: at(6, 14), yes: 1, maybe: 2, mine: null },
        { id: "o3", at: at(7, 19), yes: 2, maybe: 0, mine: null },
      ],
    }),
    mk("demo-fixed", {
      mode: "fixed", organizer: "user", activityId: A.ceramics, venue: V.ceramics, startsAt: at(4, 18), capacity: 6, going: 3,
      messages: [
        { id: 1, kind: "concierge", author: null, mine: false, status: "visible", at: Date.now() - 2 * H,
          body: "Sortie confirmée : 3 personnes y vont. La discussion du groupe est ouverte.\n\nIt's on: 3 people are going. The group chat is open." },
        { id: 2, kind: "user", author: "Camille", mine: false, status: "visible", at: Date.now() - H, body: "Hâte! J'apporte un tablier." },
        { id: 3, kind: "user", author: "Samuel", mine: false, status: "visible", at: Date.now() - 40 * 60_000, body: "Moi aussi. On se rejoint à l'entrée vers 17 h 55 ?" },
      ],
    }),
  ];
  return {
    user: null, adult: false, phone: null, optIn: false, library: emptyLibrary(), outings, seq: 10, confirmed: {}, submissions: [],
  };
}

let state: State = (() => {
  try { const raw = localStorage.getItem(STORE); if (raw) return JSON.parse(raw) as State; } catch { /* first visit */ }
  return seed();
})();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ } };

const err = (status: number, code: string, body: Record<string, unknown> = {}): never => { throw new ApiError(status, code, { error: code, ...body }); };
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.]{2,}|(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b|https?:\/\/|www\.|\b[\w-]+\.(com|ca|net|org)\b/i;

function me() { if (!state.user) err(401, "unauthorized"); return state.user!; }
function missing(): string[] {
  const m: string[] = [];
  const u = me();
  if (!u.birthYear || new Date().getFullYear() - u.birthYear < 18 || !state.adult) m.push("age");
  if (!state.phone) m.push("phone");
  return m;
}
const publicUser = () => ({ ...me() });

function summary(o: Outing) {
  return {
    id: o.id, mode: o.mode, organizer: o.organizer, status: o.status, activityId: o.activityId,
    startsAt: o.startsAt ? new Date(o.startsAt).toISOString() : null,
    decisionDeadline: o.deadline ? new Date(o.deadline).toISOString() : null,
    capacity: o.capacity, going: o.going, venue: { id: o.venue.id, name: o.venue.name },
    me: { status: o.me, invited: o.invited, hosting: o.hosting },
  };
}
function detail(o: Outing) {
  const member = o.me === "going" || o.me === "maybe" || o.hosting;
  return {
    ...summary(o), venue: o.venue, endsAt: null, quorum: 3,
    me: { status: o.me, invited: o.invited, hosting: o.hosting, checkedIn: o.checkedIn },
    options: o.options.map((x) => ({ id: x.id, starts_at: new Date(x.at).toISOString(), yes: x.yes, maybe: x.maybe, mine: x.mine })),
    chatOpen: member && o.status === "confirmed",
  };
}
function find(id: string): Outing { const o = state.outings.find((x) => x.id === id); return o ?? err(404, "not_found"); }

function messages(o: Outing, after: number) {
  return o.messages.filter((m) => m.id > after).map((m) => ({
    id: m.id, kind: m.kind, status: m.status, body: m.body, mine: m.mine, author: m.author, created_at: new Date(m.at).toISOString(),
  }));
}

const delay = () => new Promise((r) => setTimeout(r, 120));

export async function demoApi(method: string, path: string, body: any): Promise<unknown> {
  await delay();
  const [route, query = ""] = path.split("?");
  const q = new URLSearchParams(query);
  const out = handle(method, route!, body ?? {}, q);
  save();
  return out;
}

function handle(method: string, route: string, body: any, q: URLSearchParams): unknown {
  const key = `${method} ${route}`;
  let m: RegExpMatchArray | null;

  // ---- accounts
  if (key === "POST /v1/auth/email/start") return { ok: true };
  if (key === "POST /v1/auth/email/verify") {
    if (!/^\d{6}$/.test(String(body.code ?? ""))) err(400, "invalid_code");
    const keep = state.user?.email === body.email ? state : null;
    if (!keep) state = { ...seed(), library: state.library, confirmed: {} };
    state.user = { id: "demo-user", email: String(body.email), displayName: null, birthYear: null, locale: "fr-CA", trustLevel: 0 };
    return { token: "demo-token", user: publicUser(), created: true };
  }
  if (key === "POST /v1/auth/logout") { state.user = null; return { ok: true }; }
  if (key === "GET /v1/me") return { user: publicUser() };
  if (key === "PATCH /v1/me") {
    const u = me();
    if (body.birthYear !== undefined) u.birthYear = body.birthYear;
    if (body.displayName !== undefined) u.displayName = body.displayName;
    if (body.adultAttested) state.adult = true;
    if (body.outingsOptIn !== undefined) state.optIn = body.outingsOptIn;
    return { user: publicUser() };
  }
  if (key === "DELETE /v1/me") { state = seed(); return { ok: true, deleted: true }; }
  if (key === "GET /v1/me/export") return { exportedAt: new Date().toISOString(), note: "Demo data — stored only in this browser.", user: me(), library: state.library };
  if (key === "PUT /v1/library") { me(); state.library = mergeLibraries(state.library, parseLibrary(body.library)); return { library: state.library }; }
  if (key === "GET /v1/library") { me(); return { library: state.library }; }
  if (key === "POST /v1/reports") {
    if (body.subjectType === "outing") { const o = state.outings.find((x) => x.id === body.subjectId); if (o) o.status = "paused"; return { ok: true, id: "r", paused: !!o }; }
    return { ok: true, id: "r", paused: false };
  }
  if (key === "POST /v1/me/push-tokens") return { ok: true };

  // ---- phone
  if (key === "POST /v1/me/phone") {
    me();
    if (String(body.phone).replace(/\D/g, "").length < 10) err(400, "invalid_phone");
    return { ok: true };
  }
  if (key === "POST /v1/me/phone/verify") {
    me();
    if (!/^\d{6}$/.test(String(body.code))) err(400, "invalid_code");
    state.phone = "+15145550123";
    return { ok: true };
  }

  // ---- outings
  if (key === "GET /v1/outings/eligibility") {
    const u = me(), mi = missing();
    return {
      ok: mi.length === 0, missing: mi, minAge: 18, paused: false, creationPaused: false, optIn: state.optIn,
      birthYear: u.birthYear, adultAttested: state.adult, phone: state.phone ? "•••-•••-0123" : null,
    };
  }
  if (key === "GET /v1/outings") {
    me();
    const only = q.get("activityId");
    const list = state.outings.filter((o) => !only || o.activityId === only).sort((a, b) => (a.startsAt ?? a.deadline ?? 0) - (b.startsAt ?? b.deadline ?? 0));
    return { paused: false, outings: list.map(summary) };
  }
  if (key === "POST /v1/outings") {
    me();
    const ma = missing(); if (ma.length) err(403, "ineligible", { missing: ma });
    const activityId = String(body.activityId);
    const venue = activityId === A.impro ? V.impro : activityId === A.ceramics ? V.ceramics : V.escape;
    const savers = Object.keys(state.library.saves).length >= 1 ? 3 : 0;
    if (savers < 2) err(422, "not_enough_interest");
    const id = `demo-rally-${state.seq++}`;
    state.outings.unshift({
      id, mode: "rally", organizer: "user", status: "voting", activityId, venue, startsAt: null, deadline: Date.now() + 48 * H, capacity: 8, going: 0,
      me: null, invited: true, hosting: true, checkedIn: false, messages: [],
      options: [at(4, 19), at(5, 19), at(6, 14)].map((t, i) => ({ id: `${id}-o${i}`, at: t, yes: 1, maybe: 0, mine: "yes" as const })),
    });
    return { id, options: [], invited: 2 };
  }
  if ((m = route.match(/^\/v1\/outings\/([^/]+)(?:\/(\w+))?(?:\/(\d+)\/block)?$/)) && m[1] !== "eligibility") {
    me();
    const o = find(m[1]!);
    const verb = m[2];
    if (method === "GET" && !verb) return { outing: detail(o) };
    if (method === "GET" && verb === "messages") return { messages: messages(o, Number(q.get("after") ?? 0)), open: o.status === "confirmed" };
    if (method === "POST" && verb === "votes") {
      if (o.status === "paused") err(423, "paused");
      for (const [optionId, answer] of Object.entries(body.answers as Record<string, "yes" | "maybe" | "no">)) {
        const opt = o.options.find((x) => x.id === optionId);
        if (!opt) err(400, "invalid");
        if (opt!.mine === "yes") opt!.yes--; if (opt!.mine === "maybe") opt!.maybe--;
        opt!.mine = answer;
        if (answer === "yes") opt!.yes++; if (answer === "maybe") opt!.maybe++;
      }
      return { ok: true };
    }
    if (method === "POST" && verb === "join") {
      const mi = missing(); if (mi.length) err(403, "ineligible", { missing: mi });
      if (o.status === "paused") err(423, "paused");
      if (o.me === "going") return { ok: true, status: "going" };
      if (o.going >= o.capacity) err(409, "full");
      o.going++; o.me = "going";
      if (!o.messages.length && o.mode !== "venue_session") o.messages = [];
      return { ok: true, status: "going" };
    }
    if (method === "POST" && verb === "leave") { if (o.me === "going") o.going--; o.me = null; return { ok: true }; }
    if (method === "POST" && verb === "checkin") { o.checkedIn = true; return { ok: true }; }
    if (method === "POST" && verb === "feedback") return { ok: true };
    if (method === "POST" && verb === "messages" && !m[3]) {
      if (o.me !== "going" && !o.hosting) err(404, "not_found");
      const text = String(body.body ?? "").trim();
      if (!text) err(400, "empty");
      if (CONTACT.test(text)) err(400, "contact_details");
      const id = Math.max(0, ...o.messages.map((x) => x.id)) + 1;
      o.messages.push({ id, kind: "user", author: null, mine: true, status: "visible", at: Date.now(), body: text });
      return { ok: true, id, status: "visible" };
    }
    if (method === "POST" && m[3]) return { ok: true };
  }

  // ---- community
  if (key === "POST /v1/submissions/suggest") {
    const t = String(body.title).toLowerCase();
    const outdoors = /parc|butte|glis|sentier|vélo|belvédère|coucher|patin|neige/.test(t);
    return { category: outdoors ? "category.outdoors" : "category.arts", tags: outdoors ? ["vibe.chill", "weather.outdoor"] : ["vibe.creative"] };
  }
  if (key === "POST /v1/submissions") {
    me();
    const title = String(body.title ?? "");
    if (CONTACT.test(`${title} ${body.description ?? ""}`)) err(400, "contact_details");
    if (/urbex|toit|abandonn|cliff/i.test(title)) err(400, "prohibited");
    const known = Object.entries(TITLES).find(([, t]) => t.toLowerCase().includes(title.toLowerCase().slice(0, 8)) || title.toLowerCase().includes(t.toLowerCase().slice(0, 8)));
    if (known && !body.confirmNotDuplicate) err(409, "duplicate", { similar: [{ id: known[0], title: known[1], venue: "", distanceM: 0 }] });
    const id = `demo-sub-${state.seq++}`;
    state.submissions.push({ id, title, status: "pending_review" });
    return { ok: true, activityId: id, status: "pending_review" };
  }
  if ((m = route.match(/^\/v1\/activities\/([^/]+)\/confirm$/)) && method === "POST") { state.confirmed[m[1]!] = !!body.accurate; return { ok: true, effect: null }; }

  return err(404, "not_found");
}
