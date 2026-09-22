import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDraft, extractNumbers } from "../src/outreach/verify.ts";
import type { DemandSignal, DraftedMessage } from "../src/outreach/types.ts";

const signal: DemandSignal = {
  id: "s1", venueId: "v1", venueName: "Allez Up",
  windowDays: 30, distinctUsers: 8, savesCount: 12, failedRallies: 0,
  topSlots: [{ weekday: 2, hour: 18, weight: 5 }],
  segments: { new_to_app: 5 },
  computedAt: new Date("2026-09-21T14:00:00Z"),
};

const draft = (over: Partial<DraftedMessage> = {}): DraftedMessage => ({
  subject: "8 personnes ont enregistré Allez Up ce mois-ci",
  body: "Bonjour, 8 personnes près du Mile End ont enregistré Allez Up dans l'app ce mois-ci. " +
        "Le mardi vers 18:30 est le moment où elles regardent le plus. Voulez-vous une soirée débutants?",
  locale: "fr-CA",
  proposedSlots: [{ weekday: 2, hour: 18, weight: 5 }],
  claims: [{ kind: "distinct_users", value: 8 }],
  ...over,
});

test("accepts a draft whose claims match the signal", () => {
  const r = verifyDraft(draft(), signal);
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("rejects an inflated claim", () => {
  const r = verifyDraft(draft({
    body: "42 personnes ont enregistré Allez Up.",
    claims: [{ kind: "distinct_users", value: 42 }],
  }), signal);
  assert.equal(r.ok, false);
  assert.match(r.problems[0]!, /distinct_users = 42, actual 8/);
});

test("rejects a number in the prose with no backing claim", () => {
  const r = verifyDraft(draft({
    body: "Bonjour, 8 personnes ont enregistré Allez Up, et 97 autres dans le quartier.",
  }), signal);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("unbacked number in prose: 97")));
});

test("rejects an invented time slot", () => {
  const r = verifyDraft(draft({
    proposedSlots: [{ weekday: 5, hour: 20, weight: 1 }],
  }), signal);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.includes("not in topSlots")));
});

test("rejects an unknown segment key", () => {
  const r = verifyDraft(draft({
    claims: [{ kind: "segment", key: "millionaires", value: 3 }],
  }), signal);
  assert.equal(r.ok, false);
});

test("rejects pressure tactics and false relationship claims", () => {
  for (const body of ["Dernière chance pour réserver!", "Comme convenu, voici la proposition."]) {
    const r = verifyDraft(draft({ body, claims: [] }), signal);
    assert.equal(r.ok, false, `should reject: ${body}`);
    assert.ok(r.problems.some((p) => p.startsWith("banned phrasing")));
  }
});

test("extractNumbers ignores clock times and prices", () => {
  assert.deepEqual(extractNumbers("mardi 18:30, 25$ par personne, 8 personnes"), [8]);
});
