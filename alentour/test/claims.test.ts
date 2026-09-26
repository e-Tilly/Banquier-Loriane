import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { createApp } from "../src/api/app.ts";
import { freshDatabase, hasDatabase, makeDeps } from "./helpers/db.ts";
import { siteDomain, emailMatchesDomain } from "../src/claims/claims.ts";
import { buildCatalog } from "../src/catalog/export.ts";
import { run as admin } from "../scripts/admin.ts";

const ALLEZ_UP = "a0000001-0000-4000-8000-000000000001";        // website: allezup.com
const MARKET = "a0000001-0000-4000-8000-000000000005";          // no website
const BLOC = "b0000001-0000-4000-8000-000000000001";            // activity at Allez Up
const CERAMICS = "b0000001-0000-4000-8000-000000000008";

test("domain matching accepts the venue's own domain and subdomains only", () => {
  assert.equal(siteDomain("https://www.allezup.com/fr"), "allezup.com");
  assert.equal(siteDomain("allezup.com"), "allezup.com");
  assert.equal(emailMatchesDomain("info@allezup.com", "allezup.com"), true);
  assert.equal(emailMatchesDomain("jo@mail.allezup.com", "allezup.com"), true);
  assert.equal(emailMatchesDomain("jo@notallezup.com", "allezup.com"), false, "suffix without a dot is a different domain");
  assert.equal(emailMatchesDomain("owner@gmail.com", "gmail.com"), false, "free mail can never prove a business domain");
  assert.equal(emailMatchesDomain("x@allezup.com", null), false);
});

describe("claims and owner edits", { skip: !hasDatabase() && "DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  let deps: ReturnType<typeof makeDeps>;
  let app: ReturnType<typeof createApp>;
  before(async () => {
    pool = await freshDatabase("claims");
    deps = makeDeps(pool);
    app = createApp(deps, { trustProxy: true });
  });
  after(async () => { await pool?.end(); });

  let n = 0;
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${(n++ % 250) + 1}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const codeFrom = (to: string) => deps.mailer.last(to)!.subject.match(/(\d{6})/)![1]!;
  async function signIn(email: string) {
    await call("POST", "/v1/auth/email/start", { email });
    const r = await call("POST", "/v1/auth/email/verify", { email, code: codeFrom(email) });
    const j = (await r.json()) as any;
    return { token: j.token as string, userId: j.user.id as string };
  }

  test("an address at the venue's domain verifies instantly and hands over the listing", async () => {
    const { token, userId } = await signIn("jo@personal.example");
    const r = await call("POST", "/v1/claims", {
      venueId: ALLEZ_UP, businessName: "Allez Up", role: "Gérante", contactEmail: "info@allezup.com",
    }, token);
    assert.equal(r.status, 201);
    const claim = (await r.json()) as any;
    assert.equal(claim.method, "email_domain");

    const v = await call("POST", `/v1/claims/${claim.claimId}/verify`, { code: codeFrom("info@allezup.com") }, token);
    assert.equal(v.status, 200);

    const owned = await pool.query(`SELECT provider_id FROM activities WHERE id = $1`, [BLOC]);
    assert.ok(owned.rows[0].provider_id, "the venue's activities now belong to the provider");
    const member = await pool.query(`SELECT role FROM provider_members WHERE user_id = $1`, [userId]);
    assert.equal(member.rows[0].role, "owner");

    // CASL tie-in: claiming is an existing business relationship for the outreach agent.
    const consent = await pool.query(
      `SELECT cr.basis, cr.event_type FROM consent_records cr JOIN business_contacts bc ON bc.id = cr.contact_id
        WHERE bc.email = 'info@allezup.com'`);
    assert.deepEqual(consent.rows[0], { basis: "existing_business_relationship", event_type: "claimed_listing" });
  });

  test("a free-mail address goes to manual review, and the admin CLI approves it", async () => {
    const { token, userId } = await signIn("marche@gmail.com");
    const r = await call("POST", "/v1/claims", {
      venueId: MARKET, businessName: "Marché Jean-Talon", role: "Gestionnaire", contactEmail: "marche@gmail.com",
    }, token);
    const claim = (await r.json()) as any;
    assert.equal(claim.method, "manual");

    const out: string[] = [];
    await admin(pool, ["claims"], (s) => out.push(s));
    assert.ok(out.join("\n").includes("Marché Jean-Talon"));
    assert.equal(await admin(pool, ["approve", claim.claimId], () => {}), 0);
    const member = await pool.query(`SELECT 1 FROM provider_members WHERE user_id = $1`, [userId]);
    assert.equal(member.rowCount, 1);
  });

  test("the same person cannot open two claims on one venue; contested claims are flagged", async () => {
    const a = await signIn("a@claim.example");
    const b = await signIn("b@claim.example");
    const body = { venueId: "a0000001-0000-4000-8000-000000000002", businessName: "Parc", role: "Gérant", contactEmail: "a@claim.example" };
    assert.equal((await call("POST", "/v1/claims", body, a.token)).status, 201);
    assert.equal((await call("POST", "/v1/claims", body, a.token)).status, 409);
    assert.equal((await call("POST", "/v1/claims", { ...body, contactEmail: "b@claim.example" }, b.token)).status, 201);
    const out: string[] = [];
    await admin(pool, ["claims"], (s) => out.push(s));
    assert.ok(out.join("\n").includes("contested"), "two claimants on one venue must be flagged for a phone check");
  });

  test("wrong claim codes lock after five attempts", async () => {
    const { token } = await signIn("lock@personal.example");
    const r = await call("POST", "/v1/claims", {
      venueId: "a0000001-0000-4000-8000-000000000003", businessName: "Randolph", role: "Gérant", contactEmail: "hi@lerandolph.com",
    }, token);
    const { claimId } = (await r.json()) as any;
    const right = codeFrom("hi@lerandolph.com");
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await call("POST", `/v1/claims/${claimId}/verify`, { code: wrong }, token);
    assert.equal((await call("POST", `/v1/claims/${claimId}/verify`, { code: right }, token)).status, 429);
  });

  describe("owner edits", () => {
    let owner: { token: string; userId: string };
    before(async () => {
      owner = await signIn("owner@ceramiccafe.ca");
      const r = await call("POST", "/v1/claims", {
        venueId: "a0000001-0000-4000-8000-000000000008", businessName: "Céramic Café", role: "Propriétaire",
        contactEmail: "owner@ceramiccafe.ca",
      }, owner.token);
      const { claimId } = (await r.json()) as any;
      await call("POST", `/v1/claims/${claimId}/verify`, { code: codeFrom("owner@ceramiccafe.ca") }, owner.token);
    });

    test("strangers cannot edit", async () => {
      const stranger = await signIn("stranger@example.com");
      const r = await call("PATCH", `/v1/owner/activities/${CERAMICS}`, { isFree: true }, stranger.token);
      assert.equal(r.status, 403);
    });

    test("an owner edit applies, is recorded with previous values, and re-verifies the listing", async () => {
      const r = await call("PATCH", `/v1/owner/activities/${CERAMICS}`, {
        content: { "fr-CA": { title: "Peinture sur céramique — Plateau" } },
        priceMinCents: 2500,
        openingHours: "Mo-Su 11:00-22:00",
        a11y: { "a11y.step_free_entry": true },
        tagsAdd: ["vibe.cozy"],
      }, owner.token);
      assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
      const rev = await pool.query(`SELECT patch, previous FROM activity_revisions WHERE activity_id = $1 ORDER BY id DESC LIMIT 1`, [CERAMICS]);
      assert.equal(rev.rows[0].patch.priceMinCents, 2500);
      assert.equal(rev.rows[0].previous.priceMinCents, 2200, "the previous value is kept, so revert is exact");

      // An owner may assert accessibility (the AI may not): the trigger allows source 'owner'.
      const a11y = await pool.query(`SELECT value, source FROM activity_tags WHERE activity_id = $1 AND tag_slug = 'a11y.step_free_entry'`, [CERAMICS]);
      assert.deepEqual(a11y.rows[0], { value: true, source: "owner" });

      const cat = await buildCatalog(pool, "fr-CA");
      const a = cat.activities.find((x) => x.id === CERAMICS)!;
      assert.equal(a.title, "Peinture sur céramique — Plateau");
      assert.equal(a.a11y?.["a11y.step_free_entry"], true);
      assert.ok(a.tags.includes("vibe.cozy"));
      assert.ok(!a.tags.some((t) => t.startsWith("a11y.")));
    });

    test("invalid edits are refused with a reason the owner can act on", async () => {
      const bad = await call("PATCH", `/v1/owner/activities/${CERAMICS}`, { openingHours: "9 to 5 weekdays" }, owner.token);
      assert.equal(bad.status, 400);
      assert.match(JSON.stringify(await bad.json()), /Mo-Fr 09:00-17:00/);
      const tag = await call("PATCH", `/v1/owner/activities/${CERAMICS}`, { tagsAdd: ["a11y.step_free_entry"] }, owner.token);
      assert.equal(tag.status, 400, "accessibility must go through the tri-state field, never plain tags");
      const unknown = await call("PATCH", `/v1/owner/activities/${CERAMICS}`, { tagsAdd: ["vibe.made_up"] }, owner.token);
      assert.equal(unknown.status, 400);
      const extra = await call("PATCH", `/v1/owner/activities/${CERAMICS}`, { status: "published" }, owner.token);
      assert.equal(extra.status, 400, "unknown fields are rejected, not silently ignored");
    });

    test("'still accurate' re-verifies without changing anything", async () => {
      // 20 days: long enough to see the date move, short of the 30-day test session expiring.
      deps.clock.advance(20 * 86_400_000);
      const r = await call("POST", `/v1/owner/activities/${CERAMICS}/confirm`, undefined, owner.token);
      assert.equal(r.status, 200);
      const { rows } = await pool.query(`SELECT last_verified_at FROM activities WHERE id = $1`, [CERAMICS]);
      assert.equal(new Date(rows[0].last_verified_at).toISOString(), deps.clock.t.toISOString());
    });

    test("an expired session cannot edit", async () => {
      const saved = deps.clock.t;
      deps.clock.advance(31 * 86_400_000);
      const r = await call("POST", `/v1/owner/activities/${CERAMICS}/confirm`, undefined, owner.token);
      assert.equal(r.status, 401, "sessions end; an old token must not keep write access");
      deps.clock.t = saved;
    });

    describe("owner web pages", () => {
      const ORIGIN = "http://localhost";
      const form = (fields: Record<string, string | string[]>) => {
        const f = new URLSearchParams();
        for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
        return f;
      };
      async function cookieSession(): Promise<string> {
        await app.request("/owner/login", { method: "POST", headers: { origin: ORIGIN, "x-forwarded-for": "10.9.9.9" },
          body: form({ email: "owner@ceramiccafe.ca" }) });
        const r = await app.request("/owner/login/verify", { method: "POST", headers: { origin: ORIGIN, "x-forwarded-for": "10.9.9.9" },
          body: form({ email: "owner@ceramiccafe.ca", code: codeFrom("owner@ceramiccafe.ca") }) });
        assert.equal(r.status, 302);
        const cookie = r.headers.get("set-cookie")!;
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /SameSite=Lax/i);
        return cookie.split(";")[0]!;
      }

      test("the dashboard lists the owner's listings", async () => {
        const cookie = await cookieSession();
        const r = await app.request("/owner", { headers: { cookie } });
        const body = await r.text();
        assert.ok(body.includes("Peinture sur céramique"));
      });

      test("cross-site POSTs are refused before anything runs", async () => {
        const r = await app.request("/owner/login", { method: "POST", headers: { origin: "https://evil.example" }, body: form({ email: "x@y.co" }) });
        assert.equal(r.status, 403);
      });

      test("a signed-in POST without the form token is refused", async () => {
        const cookie = await cookieSession();
        const r = await app.request(`/owner/activities/${CERAMICS}/confirm`, { method: "POST", headers: { cookie, origin: ORIGIN }, body: form({}) });
        assert.equal(r.status, 403);
      });

      test("editing through the form works, and owner text is escaped on render", async () => {
        const cookie = await cookieSession();
        const pageHtml = await (await app.request(`/owner/activities/${CERAMICS}`, { headers: { cookie } })).text();
        const csrf = pageHtml.match(/name="_csrf" value="([^"]+)"/)![1]!;
        const r = await app.request(`/owner/activities/${CERAMICS}`, {
          method: "POST", headers: { cookie, origin: ORIGIN },
          body: form({ _csrf: csrf, "title_fr-CA": "Céramique <script>alert(1)</script>", openingHours: "Mo-Su 11:00-22:00",
            priceMin: "25", "a11y_a11y.step_free_entry": "yes", tag: ["vibe.cozy", "vibe.creative"] }),
        });
        assert.equal(r.status, 302);
        const after = await (await app.request(`/owner/activities/${CERAMICS}`, { headers: { cookie } })).text();
        assert.ok(!after.includes("<script>alert(1)</script>"), "owner input must never reach the page as markup");
        assert.ok(after.includes("&lt;script&gt;"));
      });
    });
  });
});
