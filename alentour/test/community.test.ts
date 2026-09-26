/** Stage 6: user-created activities, the confirmation loop, and Business Pro billing. */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { createApp } from "../src/api/app.ts";
import { createSession } from "../src/api/auth.ts";
import { freshDatabase, hasDatabase, makeDeps } from "./helpers/db.ts";
import { FakeFetcher, FakeGeocoder, fakeJpeg } from "./helpers/enrichment.ts";
import { MemoryStorage } from "../src/enrichment/storage.ts";
import { signPayload, verifySignature, entitlementsFor, type StripeConfig } from "../src/billing/stripe.ts";
import { buildCatalog } from "../src/catalog/export.ts";
import { run as admin } from "../scripts/admin.ts";

const ALLEZ_UP = "a0000001-0000-4000-8000-000000000001";
const BLOC = "b0000001-0000-4000-8000-000000000001";
const CERAMIC_VENUE = "a0000001-0000-4000-8000-000000000008";
const CERAMICS = "b0000001-0000-4000-8000-000000000008";
const SECRET = "whsec_test_secret";

describe("webhook signatures", () => {
  const body = JSON.stringify({ id: "evt_1", type: "ping" });
  const now = new Date("2026-09-01T12:00:00Z");
  test("a valid signature passes; anything else does not", () => {
    const header = signPayload(body, SECRET, now);
    assert.equal(verifySignature(body, header, SECRET, now), true);
    assert.equal(verifySignature(body, header, "whsec_other", now), false, "wrong secret");
    assert.equal(verifySignature(body + " ", header, SECRET, now), false, "tampered body");
    assert.equal(verifySignature(body, header, SECRET, new Date(now.getTime() + 10 * 60_000)), false, "replayed after 5 minutes");
    assert.equal(verifySignature(body, undefined, SECRET, now), false);
    assert.equal(verifySignature(body, `t=${Math.floor(now.getTime() / 1000)},v1=deadbeef,${header.split(",")[1]}`, SECRET, now), true,
      "Stripe may send several v1 signatures during secret rotation");
  });
  test("tiers", () => {
    assert.equal(entitlementsFor("free").maxPhotos, 6);
    assert.equal(entitlementsFor("pro").hostSessions, true);
    assert.equal(entitlementsFor(undefined).bookingLink, false);
  });
});

describe("community and Pro", { skip: !hasDatabase() && "DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  let deps: ReturnType<typeof makeDeps>;
  let app: ReturnType<typeof createApp>;
  let scores = { harassment: 0, sexual: 0, violence: 0, hate: 0, self_harm: 0, threat: 0, spam: 0, pii: 0 };
  const stripeCalls: { url: string; body: URLSearchParams }[] = [];
  const stripe: StripeConfig = { secretKey: "sk_test_x", webhookSecret: SECRET, priceMonthly: "price_month", priceYearly: "price_year", publicUrl: "http://localhost" };

  before(async () => {
    pool = await freshDatabase("community");
    const client = {
      messages: {
        parse: async (req: any) => {
          const sys: string = req.system[0].text;
          if (sys.includes("You score chat messages")) return { parsed_output: scores, usage: {} };
          if (sys.includes("Suggest a category")) return { parsed_output: { category: "category.outdoors", tags: ["vibe.chill", "vibe.awe", "vibe.chill", "group.pairs"] }, usage: {} };
          return { parsed_output: null, usage: {} };
        },
      },
    };
    const fetchStub = (async (url: string, init: any) => {
      stripeCalls.push({ url: String(url), body: new URLSearchParams(String(init.body)) });
      return new Response(JSON.stringify({ url: String(url).includes("portal") ? "https://billing.stripe.test/p" : "https://checkout.stripe.test/c" }), { status: 200 });
    }) as unknown as typeof fetch;
    deps = makeDeps(pool, {
      stripe, fetch: fetchStub,
      enrich: { client: client as any, fetcher: new FakeFetcher({}), storage: new MemoryStorage(), geocoder: new FakeGeocoder([]) },
    });
    app = createApp(deps, { trustProxy: true });
  });
  after(async () => { await pool?.end(); });

  let ip = 0, n = 0;
  const call = (method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": `10.8.0.${(++ip % 250) + 1}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  const json = async (r: Response) => (await r.json()) as any;
  async function user(trust = 0) {
    const id = (await pool.query(`INSERT INTO users (email, trust_level) VALUES ($1, $2) RETURNING id`, [`c${++n}@example.org`, trust])).rows[0].id as string;
    return { id, token: await createSession(deps, id) };
  }
  const place = (over: Record<string, unknown> = {}) => ({
    title: "Glissade au parc Jarry", description: "La butte derrière le terrain de baseball, parfaite après une bordée.",
    category: "category.winter", tags: ["vibe.silly"], kind: "seasonal",
    place: { name: "Parc Jarry, la butte", lat: 45.5335, lon: -73.6277 }, ...over,
  });

  // ---------------------------------------------------------------- submissions

  test("tags are suggested from the taxonomy, at most three", async () => {
    const a = await user();
    const r = await json(await call("POST", "/v1/submissions/suggest", a.token, { title: "Coucher de soleil au belvédère", description: "" }));
    assert.deepEqual(r, { category: "category.outdoors", tags: ["vibe.chill", "vibe.awe", "group.pairs"] });
  });

  test("a new person's addition waits for review, and a new place can't host outings until then", async () => {
    const a = await user();
    const r = await call("POST", "/v1/submissions", a.token, place());
    assert.equal(r.status, 201);
    const { activityId, status } = await json(r);
    assert.equal(status, "pending_review");
    const v = (await pool.query(`SELECT v.origin, v.created_by FROM venues v JOIN activity_locations l ON l.venue_id = v.id WHERE l.activity_id = $1`, [activityId])).rows[0];
    assert.deepEqual(v, { origin: "community", created_by: a.id });
    const cat = await buildCatalog(pool, "fr-CA");
    assert.ok(!cat.activities.some((x) => x.id === activityId), "unreviewed additions never reach the app");
  });

  test("did you mean…? comes before creating a duplicate", async () => {
    const a = await user();
    const dup = await call("POST", "/v1/submissions", a.token, {
      title: "Bloc à Allez Up", category: "category.sports", venueId: ALLEZ_UP, tags: [],
    });
    assert.equal(dup.status, 409);
    const body = await json(dup);
    assert.equal(body.similar[0].id, BLOC);
    const again = await call("POST", "/v1/submissions", a.token, {
      title: "Bloc à Allez Up", category: "category.sports", venueId: ALLEZ_UP, tags: [], confirmNotDuplicate: true,
    });
    assert.equal(again.status, 201, "the person can insist it's different");
  });

  test("contact details, prohibited activities, unknown tags and flagged text are refused", async () => {
    const a = await user();
    const err = async (over: Record<string, unknown>) => (await json(await call("POST", "/v1/submissions", a.token, place(over)))).error;
    assert.equal(await err({ description: "Écris-moi au 514-555-0100 pour l'adresse" }), "contact_details");
    assert.equal(await err({ title: "Urbex dans une usine", description: "Un bâtiment abandonné près du canal" }), "prohibited");
    assert.equal(await err({ tags: ["a11y.step_free_entry"] }), "invalid", "community can't assert accessibility as a tag");
    assert.equal(await err({ place: { name: "Chalet", lat: 46.8, lon: -71.2 } }), "outside_city");
    scores = { ...scores, harassment: 0.8 };
    assert.equal(await err({ title: "Terrain pour niaiser les passants" }), "prohibited");
    scores = { ...scores, harassment: 0 };
  });

  test("trusted people publish at existing venues instantly — but never a new place", async () => {
    const t = await user(2);
    const at = await json(await call("POST", "/v1/submissions", t.token, {
      title: "Soirée tournage libre", description: "Le jeudi, tour de potier libre.", category: "category.learning", venueId: CERAMIC_VENUE, tags: [], confirmNotDuplicate: true,
    }));
    assert.equal(at.status, "published");
    const fresh = await json(await call("POST", "/v1/submissions", t.token, place({ title: "Pique-nique au bassin", place: { name: "Bassin Peel", lat: 45.494, lon: -73.556 } })));
    assert.equal(fresh.status, "pending_review", "a pin could be somebody's home");
  });

  test("the operator's decisions build or remove trust, and the person hears about it", async () => {
    const a = await user();
    const ids: string[] = [];
    for (const [i, title] of ["Butte à glisser Villeray", "Patin au parc Jarry"].entries()) {
      const r = await json(await call("POST", "/v1/submissions", a.token, place({ title, place: { name: `Place ${i}`, lat: 45.54 + i / 100, lon: -73.62 } })));
      ids.push(r.activityId);
    }
    for (const id of ids) {
      const venue = (await pool.query(`SELECT venue_id FROM activity_locations WHERE activity_id = $1`, [id])).rows[0].venue_id;
      await admin(pool, ["publish", venue], () => {});
    }
    assert.equal((await pool.query(`SELECT trust_level FROM users WHERE id = $1`, [a.id])).rows[0].trust_level, 2, "two approved → trusted");
    assert.equal((await json(await call("GET", "/v1/me/notifications", a.token))).notifications.length, 2);

    const bad = await json(await call("POST", "/v1/submissions", a.token, place({ title: "Spot secret", place: { name: "Quelque part", lat: 45.52, lon: -73.60 } })));
    await admin(pool, ["reject-submission", bad.activityId, "Lieu privé"], () => {});
    assert.equal((await pool.query(`SELECT trust_level FROM users WHERE id = $1`, [a.id])).rows[0].trust_level, 0, "one removal resets trust");
    const mine = await json(await call("GET", "/v1/submissions/mine", a.token));
    assert.equal(mine.submissions.find((s: any) => s.id === bad.activityId).reviewNote, "Lieu privé");
  });

  test("five additions a day, no more", async () => {
    const a = await user();
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = (await call("POST", "/v1/submissions", a.token, { ...place({ title: `Endroit numéro ${i} à découvrir`, place: { name: `P${i}`, lat: 45.5 + i / 50, lon: -73.6 } }), confirmNotDuplicate: true })).status;
    }
    assert.equal(last, 429);
  });

  test("two 'still accurate' re-verify a listing; two 'not anymore' flag it", async () => {
    const [a, b, c] = await Promise.all([user(), user(), user()]);
    assert.equal((await call("POST", `/v1/activities/${BLOC}/confirm`, a.token, { accurate: true })).status, 403, "only people who saved it or went");
    for (const u of [a, b, c]) await pool.query(`INSERT INTO saves (user_id, activity_id) VALUES ($1, $2), ($1, $3)`, [u.id, BLOC, CERAMICS]);
    await pool.query(`UPDATE activities SET last_verified_at = '2025-01-01' WHERE id = $1`, [BLOC]);
    await call("POST", `/v1/activities/${BLOC}/confirm`, a.token, { accurate: true });
    const r = await json(await call("POST", `/v1/activities/${BLOC}/confirm`, b.token, { accurate: true }));
    assert.equal(r.effect, "verified");
    assert.ok(new Date((await pool.query(`SELECT last_verified_at FROM activities WHERE id = $1`, [BLOC])).rows[0].last_verified_at) > new Date("2026-01-01"));

    await call("POST", `/v1/activities/${CERAMICS}/confirm`, a.token, { accurate: false });
    await call("POST", `/v1/activities/${CERAMICS}/confirm`, b.token, { accurate: false });
    await call("POST", `/v1/activities/${CERAMICS}/confirm`, c.token, { accurate: false });
    const reports = (await pool.query(`SELECT count(*)::int AS n FROM reports WHERE subject_id = $1 AND status = 'open'`, [CERAMICS])).rows[0].n;
    assert.equal(reports, 1, "flagged once, not once per dispute");
  });

  // ---------------------------------------------------------------- Business Pro

  const ORIGIN = "http://localhost";
  const form = (f: Record<string, string>) => new URLSearchParams(f);
  const codeFrom = (to: string) => deps.mailer.last(to)!.subject.match(/(\d{6})/)![1]!;
  let providerId = "";
  async function ownerSession() {
    const email = "patron@ceramiccafe.ca";
    const h = { origin: ORIGIN, "x-forwarded-for": "10.9.1.1" };
    await app.request("/owner/login", { method: "POST", headers: h, body: form({ email }) });
    const r = await app.request("/owner/login/verify", { method: "POST", headers: h, body: form({ email, code: codeFrom(email) }) });
    const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    const page = await (await app.request(`/owner/activities/${CERAMICS}`, { headers: { cookie } })).text();
    return { cookie, csrf: page.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? "", page };
  }
  const post = (s: { cookie: string }, url: string, body: URLSearchParams | FormData) =>
    app.request(url, { method: "POST", headers: { cookie: s.cookie, origin: ORIGIN }, body });

  test("setup: a claimed business on the free tier", async () => {
    const u = (await pool.query(`INSERT INTO users (email) VALUES ('patron@ceramiccafe.ca') RETURNING id`)).rows[0].id;
    providerId = (await pool.query(`INSERT INTO providers (display_name, claim_status) VALUES ('Céramic Café', 'verified') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO provider_members (provider_id, user_id) VALUES ($1, $2)`, [providerId, u]);
    await pool.query(`UPDATE activities SET provider_id = $1 WHERE id = $2`, [providerId, CERAMICS]);
    await pool.query(`UPDATE venues SET provider_id = $1 WHERE id = $2`, [providerId, CERAMIC_VENUE]);
  });

  test("free tier: six photos, no booking link, no sessions — each with a way to upgrade", async () => {
    const s = await ownerSession();
    assert.ok(s.page.includes("Réservé à Pro"));
    const f = new FormData();
    f.append("_csrf", s.csrf); f.append("licence", "on");
    for (let i = 0; i < 7; i++) f.append("photos", new Blob([new Uint8Array(fakeJpeg())]), `p${i}.jpg`);
    const r = await post(s, `/owner/activities/${CERAMICS}/photos`, f);
    assert.equal(r.status, 400);
    assert.ok((await r.text()).includes("p6.jpg"), "the seventh photo is the one refused");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM media WHERE owner_id = $1`, [CERAMICS])).rows[0].n, 6);

    const booking = await post(s, `/owner/activities/${CERAMICS}`, form({ _csrf: s.csrf, "title_fr-CA": "Peinture sur céramique", bookingUrl: "https://ceramiccafe.ca/reserver" }));
    assert.equal(booking.status, 400);
    assert.ok((await booking.text()).includes("Business Pro"));
    const session = await post(s, `/owner/activities/${CERAMICS}/sessions`, form({ _csrf: s.csrf, startsAt: "2026-09-10T19:00", capacity: "6" }));
    assert.equal(session.status, 402);
  });

  test("checkout is created for this business, and only a signed webhook makes it Pro", async () => {
    const s = await ownerSession();
    const r = await post(s, "/owner/billing/checkout", form({ _csrf: s.csrf, provider: providerId, plan: "yearly" }));
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "https://checkout.stripe.test/c");
    const sent = stripeCalls.at(-1)!;
    assert.equal(sent.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(sent.body.get("client_reference_id"), providerId);
    assert.equal(sent.body.get("line_items[0][price]"), "price_year");
    assert.equal(sent.body.get("customer_email"), "patron@ceramiccafe.ca");
    assert.equal(sent.body.get("mode"), "subscription");

    const hook = (event: unknown, sig?: string) => {
      const raw = JSON.stringify(event);
      return call("POST", "/v1/stripe/webhook", undefined, raw, { "stripe-signature": sig ?? signPayload(raw, SECRET, deps.clock.now()) });
    };
    const completed = { id: "evt_a", type: "checkout.session.completed", data: { object: { client_reference_id: providerId, customer: "cus_1", subscription: "sub_1" } } };
    assert.equal((await hook(completed, "t=1,v1=forged")).status, 400, "forged events are refused");
    assert.equal((await pool.query(`SELECT stripe_customer_id FROM providers WHERE id = $1`, [providerId])).rows[0].stripe_customer_id, null);
    assert.equal((await hook(completed)).status, 200);

    const active = { id: "evt_b", type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "active", current_period_end: 1_800_000_000, metadata: { provider_id: providerId } } } };
    await hook(active);
    const p = (await pool.query(`SELECT subscription_tier, stripe_customer_id, pro_until FROM providers WHERE id = $1`, [providerId])).rows[0];
    assert.equal(p.subscription_tier, "pro");
    assert.equal(p.stripe_customer_id, "cus_1");
    assert.equal(new Date(p.pro_until).getTime(), 1_800_000_000_000);
    assert.equal((await json(await hook(active))).duplicate, true, "replays change nothing");
  });

  test("Pro: booking link reaches the app, sessions reach users, stats show the weekly detail", async () => {
    const s = await ownerSession();
    assert.ok(s.page.includes('name="bookingUrl"'));
    const r = await post(s, `/owner/activities/${CERAMICS}`, form({ _csrf: s.csrf, "title_fr-CA": "Peinture sur céramique", bookingUrl: "https://ceramiccafe.ca/reserver" }));
    assert.equal(r.status, 302);
    const cat = await buildCatalog(pool, "fr-CA");
    assert.equal(cat.activities.find((a) => a.id === CERAMICS)!.bookingUrl, "https://ceramiccafe.ca/reserver");

    const created = await post(s, `/owner/activities/${CERAMICS}/sessions`, form({ _csrf: s.csrf, startsAt: "2026-09-10T19:00", capacity: "6" }));
    assert.equal(created.status, 302);
    const o = (await pool.query(`SELECT starts_at, capacity_max, organizer, host_provider_id FROM outings WHERE activity_id = $1 AND mode = 'venue_session'`, [CERAMICS])).rows[0];
    assert.equal(new Date(o.starts_at).toISOString(), "2026-09-10T23:00:00.000Z", "19:00 Montréal time");
    assert.deepEqual([o.capacity_max, o.organizer, o.host_provider_id], [6, "venue", providerId]);
    const someone = await user();
    const list = await json(await call("GET", `/v1/outings?activityId=${CERAMICS}`, someone.token));
    assert.equal(list.outings.length, 1, "users see the venue's session");

    const stats = await (await app.request("/owner/stats", { headers: { cookie: s.cookie } })).text();
    assert.ok(stats.includes('class="bars"'), "Pro sees the weekly breakdown");
    assert.match(stats, /<strong>3<\/strong> enregistrements/, "three people saved it in the last 30 days");

    const portal = await post(s, "/owner/billing/portal", form({ _csrf: s.csrf, provider: providerId }));
    assert.equal(portal.headers.get("location"), "https://billing.stripe.test/p");
  });

  test("cancelling returns the business to free", async () => {
    const raw = JSON.stringify({ id: "evt_c", type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer: "cus_1", status: "canceled", metadata: { provider_id: providerId } } } });
    await call("POST", "/v1/stripe/webhook", undefined, raw, { "stripe-signature": signPayload(raw, SECRET, deps.clock.now()) });
    assert.equal((await pool.query(`SELECT subscription_tier FROM providers WHERE id = $1`, [providerId])).rows[0].subscription_tier, "free");
  });
});
