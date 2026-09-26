/**
 * Stage 4 end to end: self-serve onboarding through the owner pages, the seed pipeline, the
 * batch mode and the freshness loop — against a real database, with a fake web and a stub model.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type pg from "pg";
import { createApp } from "../src/api/app.ts";
import { freshDatabase, hasDatabase, makeDeps } from "./helpers/db.ts";
import { FakeFetcher, FakeGeocoder, activity, extraction, fakeJpeg, stubClient } from "./helpers/enrichment.ts";
import { MemoryStorage } from "../src/enrichment/storage.ts";
import { NodeFetcher } from "../src/enrichment/net.ts";
import { readSite } from "../src/enrichment/site.ts";
import { createJob, runJob, runQueuedJobs, type EnrichDeps } from "../src/enrichment/pipeline.ts";
import { materializeSeedJob } from "../src/enrichment/listing.ts";
import { collectBatch, prepareSeedJobs, submitBatch } from "../src/enrichment/batch.ts";
import { loadSeedFile } from "../scripts/enrich.ts";
import { buildCatalog } from "../src/catalog/export.ts";
import { sendNudges } from "../src/freshness/nudge.ts";
import { run as admin } from "../scripts/admin.ts";
import { MemoryMailer } from "../src/api/mailer.ts";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SITE = "https://blocshop.ca/";
const HOME = `<!doctype html><html lang="fr"><head><title>Bloc Shop</title>
  <meta name="description" content="Salle d'escalade de bloc dans Villeray"></head><body>
  <nav><a href="/tarifs">Tarifs</a><a href="/prive/tarifs-internes">Interne</a><a href="/blog/2019">Blog</a></nav>
  <h1>Escalade de bloc pour tous les niveaux</h1>
  <p>Ambiance conviviale, on jase entre les essais. Nos murs sont au rez-de-chaussée, entrée de plain-pied.</p>
  <p>Ouvert du lundi au vendredi de 6 h à 23 h.</p><a href="tel:514-555-0142">514 555-0142</a></body></html>`;
const TARIFS = `<html><body><h1>Tarifs</h1><p>Entrée : 22,50 $ par personne, location de souliers 5 $.</p>
  <p>Cours d'initiation de 90 minutes, le mardi soir.</p></body></html>`;

function web() {
  return new FakeFetcher({
    [`${SITE}robots.txt`]: { body: "User-agent: *\nDisallow: /prive/", type: "text/plain" },
    [SITE]: { body: HOME },
    [`${SITE}tarifs`]: { body: TARIFS },
    [`${SITE}prive/tarifs-internes`]: { body: "<p>SECRET 9 $</p>" },
  });
}

/** What a well-behaved model returns for the Bloc Shop site. */
function blocShop(source: string) {
  assert.ok(source.includes("22,50 $"), "the pricing page was read");
  return extraction([
    activity({
      price: { is_free: false, min_dollars: 22.5, max_dollars: null, unit: "per_person", confidence: 0.95, evidence: "Entrée : 22,50 $ par personne" },
      opening_hours: { value: "Mo-Fr 06:00-23:00", confidence: 0.9, evidence: "Ouvert du lundi au vendredi de 6 h à 23 h" },
      tags: [
        { slug: "audience.beginners_welcome", confidence: 0.9, evidence: "pour tous les niveaux" },
        { slug: "group.conversation_friendly", confidence: 0.8, evidence: "on jase entre les essais" },
        { slug: "logistics.equipment_extra_cost", confidence: 0.85, evidence: "location de souliers 5 $" },
      ],
      physical_demand: { value: 3, confidence: 0.8, evidence: "Escalade de bloc" },
      icebreaker_score: { value: 2, confidence: 0.8, evidence: "on jase entre les essais" },
      accessibility_mentions: [{ slug: "a11y.step_free_entry", says: "yes", evidence: "entrée de plain-pied" }],
    }),
    activity({
      key: "intro-class", name: "Cours d'initiation", kind: "recurring_program",
      label: { fr: "Cours d'initiation au bloc", en: "Intro to bouldering class" },
      one_liner: { fr: "Un cours de 90 minutes le mardi soir.", en: "A 90-minute class on Tuesday evenings." },
      primary_category: { value: "category.learning", confidence: 0.9, evidence: "Cours d'initiation" },
      duration_minutes: { value: 90, confidence: 0.9, evidence: "Cours d'initiation de 90 minutes" },
      tags: [{ slug: "vibe.learn_something", confidence: 0.85, evidence: "Cours d'initiation" }],
    }),
  ], { phone: { value: "514 555-0142", confidence: 0.9, evidence: "514 555-0142" } });
}

function copy(facts: any) {
  return {
    activities: facts.activities.map((a: any) => ({
      key: a.key,
      fr: { title: a.key === "bouldering" ? "Escalade de bloc" : "Initiation au bloc", summary: "Grimper sans corde, à son rythme.", description: "Comptez 22,50 $ l'entrée. Les débutants sont bienvenus." },
      en: { title: a.key === "bouldering" ? "Bouldering" : "Intro to bouldering", summary: "Rope-free climbing at your own pace.", description: "The best gym in town, with 400 problems." },
    })),
  };
}

const PLACE = { label: "7250 Rue Saint-Hubert, Villeray", lat: 45.5405, lon: -73.6205, neighbourhood: "Villeray", line1: "7250 Rue Saint-Hubert" };

describe("self-serve onboarding", { skip: !hasDatabase() && "DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  let deps: ReturnType<typeof makeDeps>;
  let enrich: EnrichDeps & { storage: MemoryStorage };
  let client: ReturnType<typeof stubClient>;
  let app: ReturnType<typeof createApp>;
  const ORIGIN = "http://localhost";

  before(async () => {
    pool = await freshDatabase("onboarding");
    client = stubClient({ extract: blocShop, copy });
    enrich = { client: client as any, fetcher: web(), storage: new MemoryStorage(), geocoder: new FakeGeocoder([PLACE]), perUserDaily: 3 };
    deps = makeDeps(pool, { enrich });
    app = createApp(deps, { trustProxy: true });
  });
  after(async () => { await pool?.end(); });

  const form = (fields: Record<string, string | string[]>) => {
    const f = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
    return f;
  };
  const codeFrom = (to: string) => deps.mailer.last(to)!.subject.match(/(\d{6})/)![1]!;
  let ip = 0;
  async function session(email: string) {
    const h = { origin: ORIGIN, "x-forwarded-for": `10.7.0.${++ip}` };
    await app.request("/owner/login", { method: "POST", headers: h, body: form({ email }) });
    const r = await app.request("/owner/login/verify", { method: "POST", headers: h, body: form({ email, code: codeFrom(email) }) });
    const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    const page = await (await app.request("/owner/new", { headers: { cookie } })).text();
    return { cookie, csrf: page.match(/name="_csrf" value="([^"]+)"/)![1]! };
  }
  const post = (s: { cookie: string }, url: string, body: URLSearchParams | FormData) =>
    app.request(url, { method: "POST", headers: { cookie: s.cookie, origin: ORIGIN }, body });

  async function startDraft(s: { cookie: string; csrf: string }, name = "Bloc Shop") {
    const r = await post(s, "/owner/new", form({ _csrf: s.csrf, name, website: "blocshop.ca", address: "7250 Rue Saint-Hubert", pitch: "Salle de bloc dans Villeray",
      notDuplicate: "1" }));   // duplicate routing has its own test
    assert.equal(r.status, 302, await r.clone().text());
    const draftUrl = r.headers.get("location")!;
    assert.match(draftUrl, /^\/owner\/drafts\/[0-9a-f-]{36}$/);
    return draftUrl;
  }

  function reviewForm(csrf: string, extra: Record<string, string | string[]> = {}) {
    const f = new FormData();
    const fields: Record<string, string | string[]> = {
      _csrf: csrf,
      a0_include: "on", a0_kind: "place", a0_category: "category.sports",
      "a0_title_fr-CA": "Escalade de bloc", "a0_title_en-CA": "Bouldering", a0_priceMin: "22.5", a0_openingHours: "Mo-Fr 06:00-23:00",
      "a0_a11y_a11y.step_free_entry": "yes", "a0_a11y_a11y.accessible_washroom": "unknown",
      a0_tag: ["audience.beginners_welcome", "group.conversation_friendly"],
      a1_include: "on", a1_kind: "recurring_program", a1_category: "category.learning",
      "a1_title_fr-CA": "Initiation au bloc", a1_duration: "90",
      confirmPrice: "on", confirmA11y: "on", consent: "on", phone: "514 555-0142",
      ...extra,
    };
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
    return f;
  }

  test("the website is read politely: robots.txt is honoured and only useful pages are fetched", async () => {
    const fetcher = web();
    const site = await readSite(fetcher, "blocshop.ca");
    assert.deepEqual(site.pages.map((p) => p.url), [SITE, `${SITE}tarifs`]);
    assert.deepEqual(site.skipped, [{ url: `${SITE}prive/tarifs-internes`, reason: "robots.txt" }]);
    assert.ok(!fetcher.requested.includes(`${SITE}prive/tarifs-internes`));
    assert.deepEqual(site.phones, ["5145550142"]);
  });

  test("owner at the website's domain: draft → review → published, with photos stripped", async () => {
    const s = await session("allo@blocshop.ca");
    const draftUrl = await startDraft(s);

    // Before the worker runs, the owner sees honest progress.
    const waiting = await (await app.request(draftUrl, { headers: { cookie: s.cookie } })).text();
    assert.ok(waiting.includes("http-equiv=\"refresh\""));

    assert.equal(await runQueuedJobs(pool, enrich, { now: deps.now }), 1);
    const job = (await pool.query(`SELECT * FROM enrichment_jobs WHERE id = $1`, [draftUrl.split("/").pop()])).rows[0];
    assert.equal(job.status, "ready");
    assert.deepEqual(job.sources.map((x: any) => x.url), [SITE, `${SITE}tarifs`], "provenance: what was read");
    // extraction, copy, and one copy retry: the first copy invented "400 problems" and "the best".
    assert.equal(job.usage.input_tokens, 1200 * 3);

    const review = await (await app.request(draftUrl, { headers: { cookie: s.cookie } })).text();
    assert.ok(review.includes('value="Escalade de bloc"'), "copy pre-filled");
    assert.ok(review.includes("Entrée : 22,50 $ par personne"), "evidence is shown next to the price");
    assert.ok(review.includes("entrée de plain-pied") && review.includes("confirmez vous-même"), "the site's accessibility claim is shown as a prompt");
    assert.match(review, /name="a0_a11y_a11y\.step_free_entry" value="unknown" checked/, "…but the answer is not pre-filled");
    assert.ok(!review.includes("400 problems"), "copy with an invented number was dropped");
    assert.ok(!review.includes("The best gym"), "hype was dropped");

    const f = reviewForm(s.csrf, { licence: "on" });
    f.append("photos", new Blob([new Uint8Array(fakeJpeg({ orientation: 6, width: 2000, height: 1500 }))], { type: "image/jpeg" }), "IMG_0001.jpg");
    const r = await post(s, draftUrl, f);
    assert.equal(r.status, 302, await r.clone().text());
    assert.equal(r.headers.get("location"), "/owner?published=published");

    const acts = (await pool.query(
      `SELECT a.*, c.title FROM activities a JOIN activity_content c ON c.activity_id = a.id AND c.locale = 'fr-CA'
        WHERE a.origin = 'onboarding' ORDER BY c.title`)).rows;
    assert.deepEqual(acts.map((a) => [a.title, a.status, a.kind]), [
      ["Escalade de bloc", "published", "place"], ["Initiation au bloc", "published", "recurring_program"]]);
    const bloc = acts[0];
    assert.equal(bloc.price_min_cents, 2250);
    assert.equal(bloc.physical_demand, 3, "descriptive scales come from the draft");
    assert.ok(bloc.last_verified_at, "the owner reviewed it, so it counts as verified");

    const tags = (await pool.query(`SELECT tag_slug, value, source FROM activity_tags WHERE activity_id = $1 ORDER BY tag_slug`, [bloc.id])).rows;
    assert.deepEqual(tags, [
      { tag_slug: "a11y.step_free_entry", value: true, source: "owner" },
      { tag_slug: "audience.beginners_welcome", value: true, source: "owner" },
      { tag_slug: "category.sports", value: true, source: "owner" },
      { tag_slug: "group.conversation_friendly", value: true, source: "owner" },
    ], "both checked tags saved (regression: repeated fields), a11y only as the owner answered");

    const revs = (await pool.query(`SELECT author_type FROM activity_revisions WHERE activity_id = $1 ORDER BY id`, [bloc.id])).rows;
    assert.deepEqual(revs.map((x) => x.author_type), ["ai", "owner"], "the AI draft is kept for provenance");

    const media = (await pool.query(`SELECT * FROM media WHERE owner_type = 'activity' AND owner_id = $1`, [bloc.id])).rows;
    assert.equal(media.length, 1);
    assert.equal(media[0].safety_status, "approved");
    assert.equal(media[0].is_hero, true);
    assert.equal(media[0].width, 2000);
    assert.ok(media[0].licence_granted_at);
    const stored = enrich.storage.files.get(media[0].storage_key)!.body;
    assert.ok(!stored.includes(Buffer.from("GPSLatitude")), "location stripped before storage");

    const venue = (await pool.query(`SELECT v.*, p.claim_status FROM venues v JOIN providers p ON p.id = v.provider_id WHERE v.name = 'Bloc Shop'`)).rows[0];
    assert.equal(venue.claim_status, "verified");
    assert.equal(venue.phone_e164, "+15145550142");
    assert.equal(venue.lat, PLACE.lat);

    const consent = (await pool.query(
      `SELECT basis FROM consent_records cr JOIN business_contacts bc ON bc.id = cr.contact_id WHERE bc.email = 'allo@blocshop.ca'`)).rows;
    assert.deepEqual(consent, [{ basis: "express_consent" }]);

    const cat = await buildCatalog(pool, "fr-CA");
    const inCatalog = cat.activities.find((a) => a.id === bloc.id)!;
    assert.ok(inCatalog, "published listings reach the next catalog export");
    assert.equal(inCatalog.img?.key, media[0].storage_key);
    assert.deepEqual(inCatalog.a11y, { "a11y.step_free_entry": true });
  });

  test("anyone else's business waits for the operator, who publishes it from the CLI", async () => {
    const s = await session("someone@gmail.com");
    const draftUrl = await startDraft(s, "Studio Poterie Villeray");
    await runQueuedJobs(pool, enrich, { now: deps.now });
    const r = await post(s, draftUrl, reviewForm(s.csrf, { "a0_title_fr-CA": "Poterie libre", a1_include: "" }));
    assert.equal(r.headers.get("location"), "/owner?published=pending_review");
    const a = (await pool.query(
      `SELECT a.id, a.status, l.venue_id FROM activities a JOIN activity_content c ON c.activity_id = a.id
         JOIN activity_locations l ON l.activity_id = a.id WHERE c.title = 'Poterie libre'`)).rows[0];
    assert.equal(a.status, "pending_review");

    const out: string[] = [];
    await admin(pool, ["pending"], (x) => out.push(x));
    assert.ok(out.join("\n").includes("someone@gmail.com"), "the queue shows who to call");
    await admin(pool, ["publish", a.venue_id], () => {});
    assert.equal((await pool.query(`SELECT status FROM activities WHERE id = $1`, [a.id])).rows[0].status, "published");
  });

  test("publishing needs the two confirmations, and a failed publish keeps what the owner typed", async () => {
    const s = await session("allo2@blocshop.ca");
    const draftUrl = await startDraft(s, "Bloc Shop Rosemont");
    await runQueuedJobs(pool, enrich, { now: deps.now });
    const r = await post(s, draftUrl, reviewForm(s.csrf, { confirmPrice: "", confirmA11y: "", "a0_title_fr-CA": "Mon titre à moi", a0_openingHours: "n'importe quand" }));
    assert.equal(r.status, 400);
    const body = await r.text();
    assert.ok(body.includes("confirmPrice") && body.includes("confirmA11y"));
    assert.ok(body.includes("openingHours"), "unparseable hours are refused");
    assert.ok(body.includes('value="Mon titre à moi"'), "the owner's edits survive the error");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM venues WHERE name = 'Bloc Shop Rosemont'`)).rows[0].n, 0);
  });

  test("a business already in the catalog is routed to claim it instead", async () => {
    const s = await session("gerant@allezup.com");
    const near = { ...PLACE, lat: 45.4796, lon: -73.5664, line1: "1555 Rue Saint-Patrick" };
    enrich.geocoder = new FakeGeocoder([near]);
    const r = await post(s, "/owner/new", form({ _csrf: s.csrf, name: "Allez-Up", address: "1555 Rue Saint-Patrick", website: "" }));
    const body = await r.text();
    assert.ok(body.includes("Allez Up") && body.includes("/owner/claim?q=Allez%20Up"), "claim, don't duplicate");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM enrichment_jobs WHERE input->>'name' = 'Allez-Up'`)).rows[0].n, 0);
    const again = await post(s, "/owner/new", form({ _csrf: s.csrf, name: "Allez-Up", address: "1555 Rue Saint-Patrick", website: "", notDuplicate: "1" }));
    assert.equal(again.status, 302, "the owner can say it's a different business");
    enrich.geocoder = new FakeGeocoder([PLACE]);
  });

  test("an address outside Montréal, or no website at all, is handled", async () => {
    const s = await session("x@example.org");
    enrich.geocoder = new FakeGeocoder([]);
    const r = await post(s, "/owner/new", form({ _csrf: s.csrf, name: "Nowhere", address: "1 Main St, Toronto" }));
    assert.equal(r.status, 400);
    assert.ok((await r.text()).includes("On ne trouve pas cette adresse"));
    enrich.geocoder = new FakeGeocoder([PLACE]);
  });

  test("the model failing never strands an owner: they get an empty draft with a note", async () => {
    const s = await session("y@example.org");
    const draftUrl = await startDraft(s, "Café Panne");
    const failing = { ...enrich, client: stubClient({ fail: true }) as any };
    await runQueuedJobs(pool, failing, { now: deps.now });
    const job = (await pool.query(`SELECT status, draft FROM enrichment_jobs WHERE id = $1`, [draftUrl.split("/").pop()])).rows[0];
    assert.equal(job.status, "ready");
    assert.equal(job.draft.ai, false);
    assert.equal(job.draft.note, "ai_failed");
    const page = await (await app.request(draftUrl, { headers: { cookie: s.cookie } })).text();
    assert.ok(page.includes("La rédaction automatique a échoué"));
  });

  test("each owner can start only a few drafts a day (the model costs money)", async () => {
    const s = await session("z@example.org");
    for (let i = 0; i < 3; i++) await startDraft(s, `Business ${i}`);
    const r = await post(s, "/owner/new", form({ _csrf: s.csrf, name: "Business 4", address: "7250 Rue Saint-Hubert" }));
    assert.equal(r.status, 429);
  });

  test("another owner's draft is invisible, and multipart posts still need the form token", async () => {
    const a = await session("a1@example.org");
    const draftUrl = await startDraft(a, "Mine");
    const b = await session("b1@example.org");
    assert.equal((await app.request(draftUrl, { headers: { cookie: b.cookie } })).status, 404);
    const f = reviewForm("not-the-token");
    assert.equal((await post(a, draftUrl, f)).status, 403);
  });

  test("owners can add and remove photos on an existing listing", async () => {
    const s = await session("allo@blocshop.ca");
    const id = (await pool.query(`SELECT a.id FROM activities a JOIN activity_content c ON c.activity_id = a.id WHERE c.title = 'Initiation au bloc'`)).rows[0].id;
    const noLicence = new FormData();
    noLicence.append("_csrf", s.csrf);
    noLicence.append("photos", new Blob([new Uint8Array(fakeJpeg())]), "a.jpg");
    assert.equal((await post(s, `/owner/activities/${id}/photos`, noLicence)).status, 400, "no licence, no copy");

    const f = new FormData();
    f.append("_csrf", s.csrf);
    f.append("licence", "on");
    f.append("photos", new Blob([new Uint8Array(fakeJpeg())]), "a.jpg");
    f.append("photos", new Blob([new TextEncoder().encode("<svg onload=alert(1)>")]), "evil.jpg");
    const r = await post(s, `/owner/activities/${id}/photos`, f);
    assert.equal(r.status, 400);
    assert.ok((await r.text()).includes("format non pris en charge"), "a file is judged by its bytes, not its name");
    const media = (await pool.query(`SELECT id FROM media WHERE owner_type = 'activity' AND owner_id = $1`, [id])).rows;
    assert.equal(media.length, 1, "the valid photo was kept");

    const del = await post(s, `/owner/activities/${id}/photos/${media[0].id}/delete`, form({ _csrf: s.csrf }));
    assert.equal(del.status, 302);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM media WHERE owner_id = $1`, [id])).rows[0].n, 0);
  });

  test("photos showing people wait for a human", async () => {
    const s = await session("allo@blocshop.ca");
    const id = (await pool.query(`SELECT a.id FROM activities a JOIN activity_content c ON c.activity_id = a.id WHERE c.title = 'Initiation au bloc'`)).rows[0].id;
    const faces = { ...enrich, client: stubClient({ triage: () => ({ kind: "activity_in_progress", quality: 0.9, has_faces: true, has_text_overlay: false, unsafe: false }) }) as any };
    const local = createApp(makeDeps(pool, { enrich: faces, mailer: deps.mailer }), { trustProxy: true });
    const f = new FormData();
    f.append("_csrf", s.csrf); f.append("licence", "on");
    f.append("photos", new Blob([new Uint8Array(fakeJpeg())]), "group.jpg");
    await local.request(`/owner/activities/${id}/photos`, { method: "POST", headers: { cookie: s.cookie, origin: ORIGIN }, body: f });
    const m = (await pool.query(`SELECT safety_status, has_faces FROM media WHERE owner_id = $1`, [id])).rows[0];
    assert.deepEqual(m, { safety_status: "pending", has_faces: true });
    const out: string[] = [];
    await admin(pool, ["media"], (x) => out.push(x));
    assert.ok(out[0]!.includes("faces"));
  });
});

describe("seeding the catalog", { skip: !hasDatabase() && "DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  before(async () => { pool = await freshDatabase("seeding"); });
  after(async () => { await pool?.end(); });

  const input = { name: "Bloc Shop", website: "blocshop.ca", lat: 45.5405, lon: -73.6205, address: "7250 Rue Saint-Hubert", neighbourhood: "Villeray" };

  test("direct mode: facts only, AI-sourced, unverified, pending review, no accessibility", async () => {
    const client = stubClient({ extract: blocShop });
    const enrich: EnrichDeps = { client: client as any, fetcher: web(), storage: new MemoryStorage(), geocoder: new FakeGeocoder([]) };
    const jobId = await createJob(pool, "seed", input, null);
    assert.equal(await runJob(pool, enrich, jobId), true);
    assert.equal(client.calls.length, 1, "seeding writes no marketing copy — one extraction call");
    const made = (await materializeSeedJob(pool, jobId))!;
    assert.equal(made.activityIds.length, 2);

    const rows = (await pool.query(
      `SELECT a.status, a.origin, a.last_verified_at, a.price_min_cents, c.title, c.summary, c.source
         FROM activities a JOIN activity_content c ON c.activity_id = a.id AND c.locale = 'fr-CA'
        WHERE a.id = ANY($1::uuid[]) ORDER BY c.title`, [made.activityIds])).rows;
    assert.deepEqual(rows.map((r) => [r.status, r.origin, r.last_verified_at, r.source]),
      [["pending_review", "seed_ai", null, "ai"], ["pending_review", "seed_ai", null, "ai"]]);
    assert.equal(rows[0].title, "Cours d'initiation au bloc");

    const tags = (await pool.query(`SELECT tag_slug, source, confidence FROM activity_tags WHERE activity_id = ANY($1::uuid[])`, [made.activityIds])).rows;
    assert.ok(tags.every((t) => t.source === "ai" && t.confidence > 0));
    assert.ok(!tags.some((t) => t.tag_slug.startsWith("a11y.")), "the website's step-free claim is not asserted");

    const cat = await buildCatalog(pool, "fr-CA");
    assert.ok(!cat.activities.some((a) => made.activityIds.includes(a.id)), "nothing unreviewed reaches the app");
  });

  test("the database refuses an AI accessibility assertion even if code tried", async () => {
    const id = (await pool.query(`SELECT id FROM activities WHERE origin = 'seed_ai' LIMIT 1`)).rows[0].id;
    await assert.rejects(pool.query(
      `INSERT INTO activity_tags (activity_id, tag_slug, value, source, confidence) VALUES ($1, 'a11y.wheelchair_throughout', true, 'ai', 0.99)`, [id]),
      /AI may not assert/);
  });

  test("the seed file loader skips venues already in the catalog", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "alentour-"));
    const file = path.join(dir, "in.jsonl");
    writeFileSync(file, [
      JSON.stringify({ name: "Allez Up", lat: 45.4795, lon: -73.5665 }),                     // in the seed
      JSON.stringify({ name: "Bloc Shop", website: "https://www.blocshop.ca", lat: 45.54, lon: -73.62 }), // same website
      JSON.stringify({ name: "Toronto Place", lat: 43.65, lon: -79.38 }),                    // wrong city
      JSON.stringify({ name: "Atelier Neuf", website: "atelierneuf.ca", lat: 45.53, lon: -73.60 }),
      "not json",
    ].join("\n"));
    const r = await loadSeedFile(pool, file, () => {});
    assert.deepEqual(r, { queued: 1, skipped: 4 });
  });

  test("batch mode: prepare, submit, collect", async () => {
    const client = stubClient({
      extract: () => extraction([activity({
        key: "ceramics", name: "Atelier Neuf", label: { fr: "Atelier de céramique", en: "Ceramics workshop" }, one_liner: { fr: "", en: "" },
        primary_category: { value: "category.learning", confidence: 0.9, evidence: "Atelier Neuf" }, tags: [],
      })]),
    });
    const fetcher = new FakeFetcher({ "https://atelierneuf.ca/": { body: "<h1>Atelier Neuf</h1><p>Cours de tournage.</p>" } });
    assert.equal(await prepareSeedJobs(pool, fetcher, { delayMs: 0 }), 1);
    const batchId = await submitBatch(pool, client as any);
    assert.ok(batchId);
    const r = await collectBatch(pool, client as any, batchId!);
    assert.deepEqual(r, { ended: true, ready: 1, failed: 0, listings: 1 });
    const job = (await pool.query(`SELECT status, venue_id FROM enrichment_jobs WHERE input->>'name' = 'Atelier Neuf'`)).rows[0];
    assert.equal(job.status, "published");
    assert.ok(job.venue_id);
  });
});

describe("the freshness loop", { skip: !hasDatabase() && "DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  before(async () => { pool = await freshDatabase("freshness"); });
  after(async () => { await pool?.end(); });

  test("owners of listings unconfirmed for 90 days get one email a month", async () => {
    const user = (await pool.query(`INSERT INTO users (email, locale) VALUES ('owner@ceramiccafe.ca', 'fr-CA') RETURNING id`)).rows[0].id;
    const provider = (await pool.query(`INSERT INTO providers (display_name, claim_status) VALUES ('Céramic Café', 'verified') RETURNING id`)).rows[0].id;
    await pool.query(`INSERT INTO provider_members (provider_id, user_id) VALUES ($1, $2)`, [provider, user]);
    await pool.query(`UPDATE activities SET provider_id = $1, last_verified_at = '2026-01-01' WHERE slug = 'ceramique-ceramic-cafe' OR id = 'b0000001-0000-4000-8000-000000000008'`, [provider]);

    const mailer = new MemoryMailer();
    const now = new Date("2026-09-01T12:00:00Z");
    assert.deepEqual(await sendNudges(pool, mailer, { now, baseUrl: "https://api.alentour.app" }), { providers: 1, sent: 1 });
    assert.equal(mailer.sent.length, 1);
    assert.match(mailer.sent[0]!.text, /https:\/\/api\.alentour\.app\/owner\/activities\/b0000001-0000-4000-8000-000000000008/);
    assert.equal((await sendNudges(pool, mailer, { now: new Date("2026-09-15T12:00:00Z"), baseUrl: "x" })).sent, 0, "not again within 30 days");
    assert.equal((await sendNudges(pool, mailer, { now: new Date("2026-10-05T12:00:00Z"), baseUrl: "x" })).sent, 1, "but again next month");
  });
});

describe("the real fetcher", () => {
  test("refuses loopback targets, including through a redirect", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/go") { res.writeHead(302, { location: "http://127.0.0.1:1/" }); return res.end(); }
      res.writeHead(200, { "content-type": "text/html" }); res.end("<p>ok</p>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as any).port;
    try {
      await assert.rejects(new NodeFetcher().get(`http://127.0.0.1:${port}/`), /Non-standard ports|not public/);
      const lax = new NodeFetcher({ allowPrivate: true });
      assert.equal((await lax.get(`http://127.0.0.1:${port}/`)).body, "<p>ok</p>");
      await assert.rejects(new NodeFetcher().get("http://localhost/"), /not public/);
    } finally {
      server.close();
    }
  });
});
