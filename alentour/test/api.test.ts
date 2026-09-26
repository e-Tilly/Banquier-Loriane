import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { createApp } from "../src/api/app.ts";
import { freshDatabase, hasDatabase, makeDeps } from "./helpers/db.ts";
import { MAX_CODES_PER_HOUR } from "../src/api/auth.ts";

const ACT = {
  ceramics: "b0000001-0000-4000-8000-000000000008",
  escape: "b0000001-0000-4000-8000-00000000000a",
  market: "b0000001-0000-4000-8000-000000000005",
};

describe("api", { skip: !hasDatabase() && "DATABASE_URL not set" }, () => {
  let pool: pg.Pool;
  let deps: ReturnType<typeof makeDeps>;
  let app: ReturnType<typeof createApp>;

  before(async () => {
    pool = await freshDatabase("api");
    deps = makeDeps(pool);
    app = createApp(deps, { trustProxy: true });
  });
  after(async () => { await pool?.end(); });

  let ipCounter = 0;
  const call = (method: string, path: string, body?: unknown, token?: string, ip?: string) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip ?? `10.0.0.${(ipCounter++ % 250) + 1}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Full sign-in through the real email flow, reading the code back from the mailer. */
  async function signIn(email: string): Promise<{ token: string; userId: string }> {
    const s = await call("POST", "/v1/auth/email/start", { email, lang: "fr" });
    assert.equal(s.status, 200);
    const code = deps.mailer.last(email.toLowerCase())!.subject.match(/(\d{6})/)![1];
    const v = await call("POST", "/v1/auth/email/verify", { email, code });
    assert.equal(v.status, 200);
    const j = await v.json() as { token: string; user: { id: string } };
    return { token: j.token, userId: j.user.id };
  }

  test("health", async () => {
    const r = await call("GET", "/health");
    assert.equal(r.status, 200);
  });

  describe("email sign-in", () => {
    test("start → code by email → verify → session works", async () => {
      const { token } = await signIn("Alice@Example.com");
      const me = await call("GET", "/v1/me", undefined, token);
      assert.equal(me.status, 200);
      assert.equal(((await me.json()) as any).user.email, "alice@example.com", "emails are normalized");
    });

    test("the code is never stored in clear", async () => {
      await call("POST", "/v1/auth/email/start", { email: "leak@example.com" });
      const code = deps.mailer.last("leak@example.com")!.subject.match(/(\d{6})/)![1]!;
      const { rows } = await pool.query(`SELECT code_hash FROM auth_codes WHERE email = 'leak@example.com'`);
      assert.ok(!rows[0].code_hash.includes(code));
    });

    test("start does not reveal whether an account exists", async () => {
      await signIn("known@example.com");
      const a = await call("POST", "/v1/auth/email/start", { email: "known@example.com" });
      const b = await call("POST", "/v1/auth/email/start", { email: "stranger@example.com" });
      assert.equal(a.status, b.status);
      assert.deepEqual(await a.json(), await b.json());
    });

    test("a code works exactly once", async () => {
      await call("POST", "/v1/auth/email/start", { email: "once@example.com" });
      const code = deps.mailer.last("once@example.com")!.subject.match(/(\d{6})/)![1];
      assert.equal((await call("POST", "/v1/auth/email/verify", { email: "once@example.com", code })).status, 200);
      assert.equal((await call("POST", "/v1/auth/email/verify", { email: "once@example.com", code })).status, 400);
    });

    test("five wrong guesses lock the code, even if the sixth is right", async () => {
      await call("POST", "/v1/auth/email/start", { email: "brute@example.com" });
      const code = deps.mailer.last("brute@example.com")!.subject.match(/(\d{6})/)![1]!;
      const wrong = code === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) await call("POST", "/v1/auth/email/verify", { email: "brute@example.com", code: wrong });
      const r = await call("POST", "/v1/auth/email/verify", { email: "brute@example.com", code });
      assert.equal(r.status, 429);
      assert.equal(((await r.json()) as any).error, "too_many_attempts");
    });

    test("codes expire", async () => {
      await call("POST", "/v1/auth/email/start", { email: "slow@example.com" });
      const code = deps.mailer.last("slow@example.com")!.subject.match(/(\d{6})/)![1];
      deps.clock.advance(11 * 60_000);
      const r = await call("POST", "/v1/auth/email/verify", { email: "slow@example.com", code });
      assert.equal(((await r.json()) as any).error, "expired");
    });

    test("per-email limit on codes per hour", async () => {
      for (let i = 0; i < MAX_CODES_PER_HOUR; i++) {
        assert.equal((await call("POST", "/v1/auth/email/start", { email: "spam@example.com" })).status, 200);
      }
      assert.equal((await call("POST", "/v1/auth/email/start", { email: "spam@example.com" })).status, 429);
    });

    test("rejects malformed input", async () => {
      assert.equal((await call("POST", "/v1/auth/email/start", { email: "not-an-email" })).status, 400);
      assert.equal((await call("POST", "/v1/auth/email/verify", { email: "a@b.co", code: "12" })).status, 400);
      const bad = await app.request("/v1/auth/email/start", { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
      assert.equal(bad.status, 400);
    });
  });

  describe("library sync", () => {
    test("requires a session", async () => {
      assert.equal((await call("GET", "/v1/library")).status, 401);
    });

    test("merges, keeps deletions, and derives the saves table with the real save time", async () => {
      const { token, userId } = await signIn("sync@example.com");
      const phone = {
        saves: {
          [ACT.ceramics]: { at: "2026-08-20T10:00:00.000Z" },
          [ACT.escape]: { at: "2026-08-21T10:00:00.000Z", deleted: true },
          "not-a-uuid": { at: "2026-08-21T10:00:00.000Z" },
          "b0000001-0000-4000-8000-0000000000ff": { at: "2026-08-21T10:00:00.000Z" },   // no such activity
        },
        lists: { L1: { name: "Pluie", items: [ACT.ceramics], at: "2026-08-20T10:00:00.000Z" } },
      };
      const tablet = {
        saves: { [ACT.escape]: { at: "2026-08-19T10:00:00.000Z" }, [ACT.market]: { at: "2026-08-22T09:00:00.000Z" } },
        lists: {},
      };
      assert.equal((await call("PUT", "/v1/library", { library: phone }, token)).status, 200);
      const r = await call("PUT", "/v1/library", { library: tablet }, token);
      const merged = ((await r.json()) as any).library;

      assert.equal(merged.saves[ACT.escape].deleted, true, "the phone's later deletion wins over the tablet's older save");
      assert.ok(merged.saves[ACT.market], "the tablet's new save arrives");
      assert.equal(merged.lists.L1.name, "Pluie");

      const { rows } = await pool.query(
        `SELECT activity_id::text AS id, created_at FROM saves WHERE user_id = $1 ORDER BY activity_id`, [userId]);
      assert.deepEqual(rows.map((r) => r.id).sort(), [ACT.market, ACT.ceramics].sort(),
        "deleted, malformed and unknown ids are excluded");
      const ceramics = rows.find((r) => r.id === ACT.ceramics)!;
      assert.equal(new Date(ceramics.created_at).toISOString(), "2026-08-20T10:00:00.000Z",
        "saves keep the time the user saved, not the sync time");
    });

    test("two devices syncing at once do not lose each other's changes", async () => {
      const { token } = await signIn("race@example.com");
      const a = { saves: { [ACT.ceramics]: { at: "2026-08-20T10:00:00.000Z" } }, lists: {} };
      const b = { saves: { [ACT.market]: { at: "2026-08-20T11:00:00.000Z" } }, lists: {} };
      await Promise.all([
        call("PUT", "/v1/library", { library: a }, token),
        call("PUT", "/v1/library", { library: b }, token),
      ]);
      const lib = ((await (await call("GET", "/v1/library", undefined, token)).json()) as any).library;
      assert.ok(lib.saves[ACT.ceramics] && lib.saves[ACT.market], "both saves survive");
    });
  });

  describe("profile, export, deletion", () => {
    test("birth year is stored as a year and cannot be in the future", async () => {
      const { token } = await signIn("profile@example.com");
      const ok = await call("PATCH", "/v1/me", { birthYear: 1999, displayName: "Sam" }, token);
      assert.equal(((await ok.json()) as any).user.birthYear, 1999);
      assert.equal((await call("PATCH", "/v1/me", { birthYear: 2999 }, token)).status, 400);
    });

    test("export returns the library", async () => {
      const { token } = await signIn("export@example.com");
      await call("PUT", "/v1/library", { library: { saves: { [ACT.market]: { at: "2026-08-01T00:00:00.000Z" } }, lists: {} } }, token);
      const r = await call("GET", "/v1/me/export", undefined, token);
      const j = (await r.json()) as any;
      assert.ok(j.library.data.saves[ACT.market]);
      assert.equal(j.user.email, "export@example.com");
    });

    test("deleting the account revokes sessions and erases personal data", async () => {
      const { token, userId } = await signIn("gone@example.com");
      await call("PUT", "/v1/library", { library: { saves: { [ACT.market]: { at: "2026-08-01T00:00:00.000Z" } }, lists: {} } }, token);
      assert.equal((await call("DELETE", "/v1/me", undefined, token)).status, 200);

      assert.equal((await call("GET", "/v1/me", undefined, token)).status, 401, "the session is dead immediately");
      const { rows } = await pool.query(`SELECT email, status FROM users WHERE id = $1`, [userId]);
      assert.equal(rows[0].email, null);
      assert.equal(rows[0].status, "deleted");
      assert.equal((await pool.query(`SELECT 1 FROM saves WHERE user_id = $1`, [userId])).rowCount, 0);
      assert.equal((await pool.query(`SELECT 1 FROM libraries WHERE user_id = $1`, [userId])).rowCount, 0);

      const again = await signIn("gone@example.com");
      assert.notEqual(again.userId, userId, "signing up again starts a fresh account");
    });

    test("logout revokes only this session", async () => {
      const { token } = await signIn("logout@example.com");
      const other = await signIn("logout@example.com");
      await call("POST", "/v1/auth/logout", undefined, token);
      assert.equal((await call("GET", "/v1/me", undefined, token)).status, 401);
      assert.equal((await call("GET", "/v1/me", undefined, other.token)).status, 200);
    });
  });

  describe("reports", () => {
    test("anyone can report; safety reports go to the top of the queue", async () => {
      const r = await call("POST", "/v1/reports", { subjectType: "activity", subjectId: ACT.market, reason: "hours", details: "Fermé le lundi" });
      assert.equal(r.status, 201);
      await call("POST", "/v1/reports", { subjectType: "activity", subjectId: ACT.escape, reason: "dangerous" });
      const { rows } = await pool.query(`SELECT reason, severity FROM reports ORDER BY severity DESC LIMIT 1`);
      assert.equal(rows[0].reason, "dangerous");
      assert.equal(rows[0].severity, 3);
    });

    test("unknown reasons are rejected", async () => {
      assert.equal((await call("POST", "/v1/reports", { subjectType: "activity", subjectId: "x", reason: "nope" })).status, 400);
    });

    test("reports are rate limited per IP", async () => {
      const ip = "203.0.113.9";
      let last = 0;
      for (let i = 0; i < 11; i++) {
        last = (await call("POST", "/v1/reports", { subjectType: "activity", subjectId: "x", reason: "other" }, undefined, ip)).status;
      }
      assert.equal(last, 429);
    });
  });

  describe("Apple / Google ID tokens", () => {
    test("a valid token signs in, and a verified email links to the existing account", async () => {
      const { publicKey, privateKey } = await generateKeyPair("RS256");
      const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
      const jwks = createLocalJWKSet({ keys: [jwk] });
      const d = { ...deps, jwks: { apple: jwks } };
      const a = createApp(d);
      const sign = (claims: Record<string, unknown>, aud = "app.alentour.mobile", iss = "https://appleid.apple.com") =>
        new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(iss).setAudience(aud).setSubject("apple-sub-123")
          .setIssuedAt(Math.floor(deps.clock.t.getTime() / 1000))
          .setExpirationTime(Math.floor(deps.clock.t.getTime() / 1000) + 600)
          .sign(privateKey);

      const existing = await signIn("linked@example.com");
      const ok = await a.request("/v1/auth/id-token", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "apple", idToken: await sign({ email: "linked@example.com", email_verified: true }) }),
      });
      assert.equal(ok.status, 200);
      const j = (await ok.json()) as any;
      assert.equal(j.user.id, existing.userId, "same verified email → same person, not a second account");

      const wrongAud = await a.request("/v1/auth/id-token", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "apple", idToken: await sign({}, "someone.else.app") }),
      });
      assert.equal(wrongAud.status, 401, "tokens minted for another app are refused");

      const wrongIss = await a.request("/v1/auth/id-token", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "apple", idToken: await sign({}, "app.alentour.mobile", "https://evil.example") }),
      });
      assert.equal(wrongIss.status, 401);
    });

    test("an unverified provider email does not take over an account", async () => {
      const { publicKey, privateKey } = await generateKeyPair("RS256");
      const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k2", alg: "RS256" }] });
      const a = createApp({ ...deps, jwks: { google: jwks } });
      const victim = await signIn("victim@example.com");
      const token = await new SignJWT({ email: "victim@example.com", email_verified: false })
        .setProtectedHeader({ alg: "RS256", kid: "k2" }).setIssuer("https://accounts.google.com")
        .setAudience("google-client-id").setSubject("attacker-sub")
        .setIssuedAt(Math.floor(deps.clock.t.getTime() / 1000))
        .setExpirationTime(Math.floor(deps.clock.t.getTime() / 1000) + 600).sign(privateKey);
      const r = await a.request("/v1/auth/id-token", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", idToken: token }),
      });
      const j = (await r.json()) as any;
      assert.notEqual(j.user.id, victim.userId, "must NOT be linked to the victim's account");
    });
  });
});
