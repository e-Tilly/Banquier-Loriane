/**
 * Stage 5: outings, rallies, the AI concierge and the safety constraints. The first block needs
 * no database; the rest drive the API against a real one, with a controllable clock.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { createApp } from "../src/api/app.ts";
import { createSession } from "../src/api/auth.ts";
import { freshDatabase, hasDatabase, makeDeps } from "./helpers/db.ts";
import { stubClient } from "./helpers/enrichment.ts";
import { proposeSlots, setSettings } from "../src/outings/core.ts";
import { pickOption, generateVenueSessions } from "../src/outings/outings.ts";
import { checkConciergeText, inviteText, writeInvite } from "../src/outings/concierge.ts";
import { hasContactDetails, route } from "../src/outings/safety.ts";
import { normalizePhone, MemorySms } from "../src/outings/phone.ts";
import { MemoryPusher } from "../src/outings/notify.ts";
import { runOutingsTick, runConcierge } from "../src/outings/lifecycle.ts";
import { fromLocal, localParts } from "../src/outings/time.ts";
import { run as admin } from "../scripts/admin.ts";
import { MemoryStorage } from "../src/enrichment/storage.ts";
import { FakeFetcher, FakeGeocoder } from "./helpers/enrichment.ts";

const TZ = "America/Toronto";
const BELVEDERE = "b0000001-0000-4000-8000-000000000002";   // self-guided, 24/7, free
const IMPRO = "b0000001-0000-4000-8000-000000000003";       // recurring program, We-Su 17:00-01:00
const CERAMICS = "b0000001-0000-4000-8000-000000000008";

describe("pure rules", () => {
  test("wall-clock conversion survives daylight saving", () => {
    assert.equal(fromLocal(2026, 10, 30, 19, 0, TZ).toISOString(), "2026-10-30T23:00:00.000Z", "EDT, UTC−4");
    assert.equal(fromLocal(2026, 11, 2, 19, 0, TZ).toISOString(), "2026-11-03T00:00:00.000Z", "EST, UTC−5");
    assert.deepEqual(localParts(new Date("2026-11-03T00:00:00Z"), TZ), { y: 2026, m: 11, d: 2, h: 19, min: 0, dow: 1 });
  });

  test("slots come from real opening hours: distinct days, 3–10 days out, open for the whole visit", () => {
    const now = new Date("2026-09-01T16:00:00Z");            // Tuesday
    const slots = proposeSlots({ openingHours: "We-Su 17:00-01:00", kind: "recurring_program", durationMinutes: 120, tz: TZ }, now);
    assert.equal(slots.length, 3);
    const local = slots.map((s) => localParts(s, TZ));
    assert.deepEqual(local.map((l) => [l.d, l.h, l.min]), [[4, 19, 0], [5, 19, 0], [6, 19, 0]], "Fri 19:00, Sat 19:00 (closed at 14:00 and 11:00), Sun 19:00");
    assert.equal(new Set(local.map((l) => l.d)).size, 3);
    assert.deepEqual(proposeSlots({ openingHours: null, kind: "place", durationMinutes: 60, tz: TZ }, now), [], "unknown hours: no guesses");
    assert.equal(proposeSlots({ openingHours: null, kind: "self_guided", durationMinutes: 60, tz: TZ }, now).length, 3);
    assert.deepEqual(proposeSlots({ openingHours: "Mo-Su 09:00-10:00", kind: "place", durationMinutes: 120, tz: TZ }, now), [], "too short to fit a visit");
  });

  test("the winning time needs three yes; 2·yes + maybe decides; earliest breaks ties", () => {
    const t = (id: string, day: number, yes: number, maybe: number) => ({
      optionId: id, startsAt: new Date(Date.UTC(2026, 8, day)), yes: Array.from({ length: yes }, (_, i) => `${id}y${i}`), maybe: Array.from({ length: maybe }, (_, i) => `${id}m${i}`),
    });
    assert.equal(pickOption([t("a", 4, 2, 5), t("b", 5, 2, 0)]), null, "no option reached quorum");
    assert.equal(pickOption([t("a", 4, 3, 0), t("b", 5, 3, 2)])!.optionId, "b");
    assert.equal(pickOption([t("a", 5, 3, 1), t("b", 4, 3, 1)])!.optionId, "b");
  });

  test("the concierge never sounds like it's coming, and never invents a crowd or a number", () => {
    const f = { activity: { fr: "Impro", en: "Improv" }, venue: "Le Randolph", savers: 6 };
    assert.deepEqual(checkConciergeText("6 personnes ont enregistré Impro. Votez pour un moment.", f), []);
    for (const bad of ["On se voit là-bas !", "See you there!", "I'll be there early.", "Je serai là à 19 h."]) {
      assert.ok(checkConciergeText(bad, f).some((p) => /there/.test(p)), bad);
    }
    assert.ok(checkConciergeText("Plein de monde a hâte!", f).some((p) => /crowd/.test(p)));
    assert.ok(checkConciergeText("40 people saved this.", f).some((p) => /40/.test(p)));
    assert.deepEqual(checkConciergeText(inviteText(f).body.fr, f), [], "our own template passes our own check");
    assert.deepEqual(checkConciergeText(inviteText(f).body.en, f), []);
  });

  test("a model-written invite that breaks the rules is replaced by the template", async () => {
    const f = { activity: { fr: "Impro", en: "Improv" }, venue: "Le Randolph", savers: 6 };
    const client = { messages: { parse: async () => ({ parsed_output: { fr: "Venez, j'y serai !", en: "Come, I'll be there!" } }) } };
    const r = await writeInvite(client as any, f);
    assert.equal(r.drafted, false);
    assert.equal(r.body.fr, inviteText(f).body.fr);
    const good = { messages: { parse: async () => ({ parsed_output: { fr: "6 personnes ont enregistré l'impro. Oui, peut-être ou non ?", en: "6 people saved improv. Yes, maybe or no?" } }) } };
    assert.equal((await writeInvite(good as any, f)).drafted, true);
  });

  test("moderation routing and the contact-details rule", () => {
    const z = { harassment: 0, sexual: 0, violence: 0, hate: 0, self_harm: 0, threat: 0, spam: 0, pii: 0 };
    assert.equal(route(null), "visible");
    assert.equal(route(z), "visible");
    assert.equal(route({ ...z, spam: 0.5 }), "flagged");
    assert.equal(route({ ...z, harassment: 0.75 }), "held");
    assert.equal(route({ ...z, threat: 0.95 }), "critical");
    for (const s of ["texte-moi au 514-555-0100", "écris à jo@gmail.com", "insta: @jo.mtl", "www.monsite.com", "https://x.co"]) assert.equal(hasContactDetails(s), true, s);
    for (const s of ["On se rejoint à 19 h 30 devant l'entrée", "J'arrive dans 10 minutes", "Le prix est 25 $"]) assert.equal(hasContactDetails(s), false, s);
  });

  test("phone numbers: Canadian and US only", () => {
    assert.equal(normalizePhone("(514) 555-0142"), "+15145550142");
    assert.equal(normalizePhone("+1 438 555 0142"), "+14385550142");
    assert.equal(normalizePhone("555-0142"), null);
    assert.equal(normalizePhone("+33 6 12 34 56 78"), null);
  });
});

describe("outings", { skip: !hasDatabase() && "DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  let deps: ReturnType<typeof makeDeps> & { sms: MemorySms; pusher: MemoryPusher };
  let app: ReturnType<typeof createApp>;
  let classify = { harassment: 0, sexual: 0, violence: 0, hate: 0, self_harm: 0, threat: 0, spam: 0, pii: 0 };

  before(async () => {
    pool = await freshDatabase("outings");
    const client = {
      messages: {
        parse: async (req: any) => {
          const system: string = req.system[0].text;
          if (system.includes("You score chat messages")) return { parsed_output: classify, usage: {} };
          return { parsed_output: null, usage: {} };           // invites fall back to the template
        },
      },
    };
    const sms = new MemorySms(), pusher = new MemoryPusher();
    deps = makeDeps(pool, {
      sms, pusher, operatorEmail: "ops@alentour.test",
      enrich: { client: client as any, fetcher: new FakeFetcher({}), storage: new MemoryStorage(), geocoder: new FakeGeocoder([]) },
    }) as any;
    deps.clock.t = new Date("2026-09-01T16:00:00Z");          // a Tuesday, noon in Montréal
    app = createApp(deps, { trustProxy: true });
  });
  after(async () => { await pool?.end(); });

  let ip = 0;
  const call = (method: string, path: string, token?: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": `10.5.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const json = async (r: Response) => (await r.json()) as any;
  let n = 0;
  /** A person who may take part: adult, attested, phone verified, opted in. */
  async function person(o: { save?: string[]; name?: string } = {}) {
    const i = ++n;
    const u = (await pool.query(
      `INSERT INTO users (email, display_name, birth_year, adult_attested_at, phone_e164, phone_verified_at, verified_phone, outings_opt_in)
       VALUES ($1, $2, 1999, now(), $3, now(), true, true) RETURNING id`,
      [`p${i}@example.org`, o.name ?? `Person ${i}`, `+1514555${String(1000 + i).slice(-4)}`])).rows[0].id as string;
    for (const a of o.save ?? []) await pool.query(`INSERT INTO saves (user_id, activity_id, created_at) VALUES ($1, $2, $3)`, [u, a, deps.clock.now()]);
    return { id: u, token: await createSession(deps, u) };
  }

  test("taking part needs 18+ (year and attestation) and a verified phone", async () => {
    const u = (await pool.query(`INSERT INTO users (email) VALUES ('new@example.org') RETURNING id`)).rows[0].id;
    const token = await createSession(deps, u);
    assert.deepEqual((await json(await call("GET", "/v1/outings/eligibility", token))).missing, ["age", "phone"]);

    await call("PATCH", "/v1/me", token, { birthYear: 2009, adultAttested: true });
    assert.deepEqual((await json(await call("GET", "/v1/outings/eligibility", token))).missing, ["age", "phone"], "born 2009 is not 18 in 2026 by year");
    await call("PATCH", "/v1/me", token, { birthYear: 2000 });
    assert.deepEqual((await json(await call("GET", "/v1/outings/eligibility", token))).missing, ["phone"]);

    assert.equal((await call("POST", "/v1/me/phone", token, { phone: "12" })).status, 400);
    assert.equal((await call("POST", "/v1/me/phone", token, { phone: "(514) 555-0199" })).status, 200);
    const code = deps.sms.last("+15145550199")!.text.match(/(\d{6})/)![1]!;
    assert.equal((await call("POST", "/v1/me/phone/verify", token, { code: code === "000000" ? "111111" : "000000" })).status, 400);
    assert.equal((await call("POST", "/v1/me/phone/verify", token, { code })).status, 200);
    assert.equal((await call("POST", "/v1/me/phone/verify", token, { code })).status, 400, "single use");
    const e = await json(await call("GET", "/v1/outings/eligibility", token));
    assert.equal(e.ok, true);
    assert.equal(e.phone, "•••-•••-0199");

    const other = await person();
    assert.equal((await call("POST", "/v1/me/phone", other.token, { phone: "514 555 0199" })).status, 409, "one number, one account");
  });

  test("venue sessions: generated from real hours, joinable, and never oversold", async () => {
    const created = await generateVenueSessions(pool, deps.clock.now());
    assert.ok(created >= 4, `sessions for Wed–Sun this week (${created})`);
    assert.equal(await generateVenueSessions(pool, deps.clock.now()), 0, "idempotent");

    const a = await person();
    const list = await json(await call("GET", `/v1/outings?activityId=${IMPRO}`, a.token));
    const first = list.outings[0];
    assert.equal(first.mode, "venue_session");
    assert.equal(localParts(new Date(first.startsAt), TZ).h, 17, "starts when the program opens, Montréal time");

    // Ten people race for eight spots.
    const people = await Promise.all(Array.from({ length: 10 }, () => person()));
    const results = await Promise.all(people.map((p) => call("POST", `/v1/outings/${first.id}/join`, p.token)));
    assert.equal(results.filter((r) => r.status === 200).length, 8);
    assert.equal(results.filter((r) => r.status === 409).length, 2);
    const going = (await pool.query(`SELECT count(*)::int AS n FROM outing_participants WHERE outing_id = $1 AND status = 'going'`, [first.id])).rows[0].n;
    assert.equal(going, 8, "max 8, enforced under a row lock");

    const unverified = (await pool.query(`INSERT INTO users (email) VALUES ('nophone@example.org') RETURNING id`)).rows[0].id;
    const r = await call("POST", `/v1/outings/${list.outings[1].id}/join`, await createSession(deps, unverified));
    assert.equal(r.status, 403);
    assert.deepEqual((await json(r)).missing, ["age", "phone"]);
  });

  test("the concierge organizes a rally and never appears in it", async () => {
    const savers = await Promise.all(Array.from({ length: 5 }, () => person({ save: [BELVEDERE] })));
    const notOptedIn = await person({ save: [BELVEDERE] });
    await pool.query(`UPDATE users SET outings_opt_in = false WHERE id = $1`, [notOptedIn.id]);

    assert.equal(await runConcierge(pool, deps, deps.clock.now()), 1);
    const o = (await pool.query(`SELECT * FROM outings WHERE activity_id = $1 AND mode = 'rally'`, [BELVEDERE])).rows[0];
    assert.equal(o.organizer, "concierge");
    assert.equal(o.host_user_id, null, "the concierge hosts no one");
    const invited = (await pool.query(`SELECT user_id FROM outing_invites WHERE outing_id = $1`, [o.id])).rows.map((r) => r.user_id);
    assert.deepEqual(invited.sort(), savers.map((s) => s.id).sort(), "only people who opted in");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM outing_members WHERE outing_id = $1`, [o.id])).rows[0].n, 0,
      "nobody is attached until a human says yes — no seeded attendees, no synthetic quorum");
    const invites = deps.pusher.sent.length;
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM notifications WHERE kind = 'invite' AND outing_id = $1`, [o.id])).rows[0].n, 5);
    assert.equal(invites, 0, "no push tokens registered, inbox only");
    assert.equal(await runConcierge(pool, deps, deps.clock.now()), 0, "one rally at a time per activity");

    const detail = (await json(await call("GET", `/v1/outings/${o.id}`, savers[0]!.token))).outing;
    assert.equal(detail.options.length, 3);
    assert.equal(detail.going, 0);
    assert.equal((await call("GET", `/v1/outings/${o.id}`, notOptedIn.token)).status, 404, "not invited, not visible");

    const [opt0, opt1] = detail.options.map((x: any) => x.id);
    for (const s of savers.slice(0, 3)) assert.equal((await call("POST", `/v1/outings/${o.id}/votes`, s.token, { answers: { [opt1]: "yes", [opt0]: "no" } })).status, 200);
    await call("POST", `/v1/outings/${o.id}/votes`, savers[3]!.token, { answers: { [opt1]: "maybe" } });
    assert.equal((await call("POST", `/v1/outings/${o.id}/votes`, notOptedIn.token, { answers: { [opt1]: "yes" } })).status, 404);

    deps.clock.t = new Date(new Date(o.decision_deadline).getTime() + 60_000);
    const tick = await runOutingsTick(pool, deps, deps.clock.now());
    assert.equal(tick.resolved, 1);
    const after = (await json(await call("GET", `/v1/outings/${o.id}`, savers[0]!.token))).outing;
    assert.equal(after.status, "confirmed");
    assert.equal(new Date(after.startsAt).getTime(), new Date(detail.options[1].starts_at).getTime());
    assert.equal(after.going, 3, "three humans; the concierge is not counted because it cannot be");
    assert.equal(after.me.status, "going");

    const msgs = (await json(await call("GET", `/v1/outings/${o.id}/messages`, savers[0]!.token))).messages;
    assert.equal(msgs[0].kind, "concierge");
    assert.equal(msgs[0].author, null, "labelled as the app, never a person");
    assert.match(msgs[0].body, /3 personnes y vont/);
    deps.clock.t = new Date("2026-09-01T16:00:00Z");
  });

  test("the schema itself refuses a concierge attendee or author", async () => {
    const o = (await pool.query(`SELECT id FROM outings WHERE organizer = 'concierge' LIMIT 1`)).rows[0].id;
    await assert.rejects(pool.query(`INSERT INTO outing_messages (outing_id, author_id, kind, body) VALUES ($1, (SELECT id FROM users LIMIT 1), 'concierge', 'hi')`, [o]), /concierge_has_no_author/);
    await assert.rejects(pool.query(`INSERT INTO outing_messages (outing_id, kind, body) VALUES ($1, 'user', 'hi')`, [o]), /concierge_has_no_author/);
    await assert.rejects(pool.query(
      `INSERT INTO outings (activity_id, venue_id, host_user_id, mode, organizer, status, decision_deadline)
       SELECT $1, venue_id, (SELECT id FROM users LIMIT 1), 'rally', 'concierge', 'voting', now() FROM activity_locations WHERE activity_id = $1`, [BELVEDERE]),
      /outings_host_check/);
  });

  test("a rally without three yes cancels gently", async () => {
    const savers = await Promise.all(Array.from({ length: 4 }, () => person({ save: [CERAMICS] })));
    assert.equal(await runConcierge(pool, deps, deps.clock.now()), 1);
    const o = (await pool.query(`SELECT * FROM outings WHERE activity_id = $1 AND mode = 'rally'`, [CERAMICS])).rows[0];
    const opt = (await pool.query(`SELECT id FROM outing_time_options WHERE outing_id = $1 ORDER BY position LIMIT 1`, [o.id])).rows[0].id;
    for (const s of savers.slice(0, 2)) await call("POST", `/v1/outings/${o.id}/votes`, s.token, { answers: { [opt]: "yes" } });
    deps.clock.t = new Date(new Date(o.decision_deadline).getTime() + 60_000);
    await runOutingsTick(pool, deps, deps.clock.now());
    const r = (await pool.query(`SELECT status, cancel_reason FROM outings WHERE id = $1`, [o.id])).rows[0];
    assert.deepEqual(r, { status: "cancelled", cancel_reason: "no_quorum" });
    const note = (await pool.query(`SELECT body FROM notifications WHERE outing_id = $1 AND kind = 'cancelled' LIMIT 1`, [o.id])).rows[0];
    assert.match(note.body, /Personne n'a été refusé/);
    deps.clock.t = new Date("2026-09-01T16:00:00Z");
  });

  test("a person can suggest a rally only when others could say yes", async () => {
    const lonely = await person({ save: ["b0000001-0000-4000-8000-00000000000a"] });
    const r = await call("POST", "/v1/outings", lonely.token, { activityId: "b0000001-0000-4000-8000-00000000000a", mode: "rally" });
    assert.equal(r.status, 422);
    assert.equal((await json(r)).error, "not_enough_interest", "no guaranteed-to-fail rallies");
    const others = await Promise.all([person({ save: ["b0000001-0000-4000-8000-00000000000a"] }), person({ save: ["b0000001-0000-4000-8000-00000000000a"] })]);
    const ok = await json(await call("POST", "/v1/outings", lonely.token, { activityId: "b0000001-0000-4000-8000-00000000000a", mode: "rally" }));
    assert.equal(ok.invited, 2);
    const o = (await json(await call("GET", `/v1/outings/${ok.id}`, others[0]!.token))).outing;
    assert.deepEqual(o.options.map((x: any) => x.yes), [1, 1, 1], "the proposer said yes to every time they proposed");
    assert.equal(o.me.invited, true);
  });

  test("blocks are total and silent", async () => {
    const a = await person({ name: "Alex" }), b = await person({ name: "Bea" });
    const fixed = await call("POST", "/v1/outings", a.token, { activityId: BELVEDERE, mode: "fixed", startsAt: "2026-09-05T18:00:00Z" });
    assert.equal(fixed.status, 201);
    const { id } = await json(fixed);
    assert.equal((await call("POST", `/v1/outings/${id}/join`, b.token)).status, 200);
    await call("POST", `/v1/outings/${id}/messages`, b.token, { body: "Allo! Je serai en rouge." });
    const msgs = (await json(await call("GET", `/v1/outings/${id}/messages`, a.token))).messages;
    const fromB = msgs.find((m: any) => m.author === "Bea");
    assert.equal((await call("POST", `/v1/outings/${id}/messages/${fromB.id}/block`, a.token)).status, 200);

    // Bea gets no signal — the outing simply stops existing for her, and for Alex vice versa.
    assert.equal((await call("GET", `/v1/outings/${id}`, b.token)).status, 404);
    assert.ok(!(await json(await call("GET", `/v1/outings?activityId=${BELVEDERE}`, b.token))).outings.some((o: any) => o.id === id));
    assert.equal((await call("POST", `/v1/outings/${id}/join`, b.token)).status, 404);
    assert.equal((await call("POST", `/v1/outings/${id}/messages`, b.token, { body: "hello?" })).status, 404);
    // And nothing Alex joins later is visible to Bea either.
    const other = await json(await call("POST", "/v1/outings", a.token, { activityId: BELVEDERE, mode: "fixed", startsAt: "2026-09-06T18:00:00Z" }));
    assert.equal((await call("GET", `/v1/outings/${other.id}`, b.token)).status, 404);
    assert.deepEqual((await json(await call("GET", "/v1/me/blocks", a.token))).blocks.map((x: any) => x.name), ["Bea"]);
  });

  test("hosting a fixed outing: venue must be open, 2h–30d ahead, never for risky activities", async () => {
    const a = await person();
    const post = (activityId: string, startsAt: string) => call("POST", "/v1/outings", a.token, { activityId, mode: "fixed", startsAt });
    assert.equal((await post(IMPRO, "2026-09-02T14:00:00Z")).status, 400, "Wednesday 10:00 — closed");
    assert.equal((await post(BELVEDERE, "2026-09-01T17:00:00Z")).status, 400, "an hour from now is too soon");
    await pool.query(`UPDATE activities SET risk_tier = 2 WHERE id = $1`, [CERAMICS]);
    assert.equal((await post(CERAMICS, "2026-09-04T20:00:00Z")).status, 422);
    await pool.query(`UPDATE activities SET risk_tier = 0 WHERE id = $1`, [CERAMICS]);
    assert.equal((await post(IMPRO, "2026-09-03T23:30:00Z")).status, 201, "Thursday 19:30 Montréal time — open");
  });

  test("chat: members only, no contact details, and a threatening message pauses everything", async () => {
    const [a, b, c] = await Promise.all([person({ name: "Ana" }), person({ name: "Ben" }), person({ name: "Cy" })]);
    const { id } = await json(await call("POST", "/v1/outings", a.token, { activityId: BELVEDERE, mode: "fixed", startsAt: "2026-09-07T18:00:00Z" }));
    await call("POST", `/v1/outings/${id}/join`, b.token);
    assert.equal((await call("POST", `/v1/outings/${id}/messages`, c.token, { body: "hi" })).status, 404, "not a member");
    const contact = await call("POST", `/v1/outings/${id}/messages`, b.token, { body: "texte-moi au 514 555 0100" });
    assert.equal(contact.status, 400);
    assert.equal((await json(contact)).error, "contact_details");
    assert.equal((await call("POST", `/v1/outings/${id}/messages`, b.token, { body: "J'ai hâte!" })).status, 201);

    classify = { ...classify, threat: 0.97 };
    const bad = await json(await call("POST", `/v1/outings/${id}/messages`, b.token, { body: "(a threatening message)" }));
    classify = { ...classify, threat: 0 };
    assert.equal(bad.status, "held");

    const aView = (await json(await call("GET", `/v1/outings/${id}/messages`, a.token))).messages.map((m: any) => m.body);
    assert.deepEqual(aView, ["J'ai hâte!"], "held messages are invisible to others");
    const bView = (await json(await call("GET", `/v1/outings/${id}/messages`, b.token))).messages.map((m: any) => m.body);
    assert.ok(bView.includes("(a threatening message)"), "…but the author still sees what they wrote");

    assert.equal((await pool.query(`SELECT status FROM outings WHERE id = $1`, [id])).rows[0].status, "paused");
    assert.ok((await pool.query(`SELECT restricted_until FROM users WHERE id = $1`, [b.id])).rows[0].restricted_until, "author restricted");
    assert.ok(deps.mailer.sent.some((m) => m.to === "ops@alentour.test" && /Critical/.test(m.subject)), "operator alerted immediately");
    assert.ok((await pool.query(`SELECT 1 FROM notifications WHERE user_id = $1 AND outing_id = $2 AND kind = 'paused'`, [a.id, id])).rowCount);
    assert.equal((await call("POST", `/v1/outings/${id}/join`, c.token)).status, 423);
  });

  test("a report pauses the outing at once; the operator resumes it", async () => {
    const [a, b] = await Promise.all([person(), person()]);
    const { id } = await json(await call("POST", "/v1/outings", a.token, { activityId: BELVEDERE, mode: "fixed", startsAt: "2026-09-08T18:00:00Z" }));
    await call("POST", `/v1/outings/${id}/join`, b.token);
    const r = await json(await call("POST", "/v1/reports", b.token, { subjectType: "outing", subjectId: id, reason: "safety", details: "made me uncomfortable" }));
    assert.equal(r.paused, true);
    assert.equal((await pool.query(`SELECT status FROM outings WHERE id = $1`, [id])).rows[0].status, "paused");
    const lines: string[] = [];
    await admin(pool, ["outings"], (x) => lines.push(x));
    assert.ok(lines.some((l) => l.includes(id) && l.includes("⏸")));
    await admin(pool, ["unpause", id], () => {});
    assert.equal((await pool.query(`SELECT status FROM outings WHERE id = $1`, [id])).rows[0].status, "confirmed");
  });

  test("the operator's switches: pause new outings, or everything", async () => {
    const a = await person();
    await admin(pool, ["pause-creation", "on"], () => {});
    assert.equal((await call("POST", "/v1/outings", a.token, { activityId: BELVEDERE, mode: "fixed", startsAt: "2026-09-09T18:00:00Z" })).status, 423);
    await admin(pool, ["pause-creation", "off"], () => {});
    await admin(pool, ["pause-outings", "on"], () => {});
    assert.equal((await json(await call("GET", "/v1/outings", a.token))).paused, true);
    await setSettings(pool, { paused: false });
  });

  test("the outing clock: reminders, check-in, rating, completion and the 90-day purge", async () => {
    const [a, b] = await Promise.all([person(), person()]);
    const { id } = await json(await call("POST", "/v1/outings", a.token, { activityId: BELVEDERE, mode: "fixed", startsAt: "2026-09-10T22:00:00Z" }));
    await call("POST", `/v1/outings/${id}/join`, b.token);
    await call("POST", `/v1/outings/${id}/messages`, b.token, { body: "On se rejoint à l'entrée" });
    const kinds = async () => (await pool.query(`SELECT kind FROM notifications WHERE user_id = $1 AND outing_id = $2 ORDER BY id`, [b.id, id])).rows.map((r) => r.kind);

    deps.clock.t = new Date("2026-09-09T23:00:00Z");
    await runOutingsTick(pool, deps, deps.clock.now());
    deps.clock.t = new Date("2026-09-10T20:30:00Z");
    await runOutingsTick(pool, deps, deps.clock.now());
    deps.clock.t = new Date("2026-09-10T21:50:00Z");
    await runOutingsTick(pool, deps, deps.clock.now());
    assert.equal((await call("POST", `/v1/outings/${id}/checkin`, b.token)).status, 200);
    await runOutingsTick(pool, deps, deps.clock.now());
    assert.deepEqual(await kinds(), ["t24", "t2", "checkin"], "each card once");
    const t24 = (await pool.query(`SELECT body FROM notifications WHERE user_id = $1 AND outing_id = $2 AND kind = 't24'`, [b.id, id])).rows[0].body;
    assert.match(t24, /Belvédère|Parc du Mont-Royal/);
    assert.match(t24, /gratuit/);

    deps.clock.t = new Date("2026-09-11T02:00:00Z");
    await runOutingsTick(pool, deps, deps.clock.now());
    assert.equal((await pool.query(`SELECT status FROM outings WHERE id = $1`, [id])).rows[0].status, "completed");
    assert.equal((await call("POST", `/v1/outings/${id}/feedback`, b.token, { rating: 5, again: true })).status, 200);

    deps.clock.t = new Date("2026-12-15T00:00:00Z");
    await runOutingsTick(pool, deps, deps.clock.now());
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM outing_messages WHERE outing_id = $1`, [id])).rows[0].n, 0, "chat purged at 90 days");
    deps.clock.t = new Date("2026-09-01T16:00:00Z");
  });

  test("deleting an account withdraws from outings and erases what the person wrote", async () => {
    const [a, b] = await Promise.all([person(), person()]);
    const { id } = await json(await call("POST", "/v1/outings", a.token, { activityId: BELVEDERE, mode: "fixed", startsAt: "2026-09-12T18:00:00Z" }));
    await call("POST", `/v1/outings/${id}/join`, b.token);
    await call("POST", `/v1/outings/${id}/messages`, b.token, { body: "Mon nom complet est Jo Tremblay" });
    const exported = await json(await call("GET", "/v1/me/export", b.token));
    assert.equal(exported.outingMessages.length, 1);
    assert.equal((await call("DELETE", "/v1/me", b.token)).status, 200);
    assert.equal((await pool.query(`SELECT status FROM outing_participants WHERE user_id = $1`, [b.id])).rows[0].status, "left");
    const m = (await pool.query(`SELECT body, status FROM outing_messages WHERE author_id = $1`, [b.id])).rows[0];
    assert.equal(m.status, "removed");
    assert.ok(!m.body.includes("Tremblay"));
    assert.equal((await pool.query(`SELECT phone_e164 FROM users WHERE id = $1`, [b.id])).rows[0].phone_e164, null);
  });
});
