import { test } from "node:test";
import assert from "node:assert/strict";
import { gate, validateConsent, withinSendWindow, RULES } from "../src/outreach/consent.ts";
import type { ConsentRecord, DemandSignal, GateInput, GateRefusal } from "../src/outreach/types.ts";

const NOW = new Date("2026-09-22T14:00:00Z");          // a Tuesday, 14:00
const MONDAY_10H = new Date("2026-09-21T10:00:00");    // local

const signal = (over: Partial<DemandSignal> = {}): DemandSignal => ({
  id: "s1", venueId: "v1", venueName: "Allez Up",
  windowDays: 30, distinctUsers: 8, savesCount: 12, failedRallies: 0,
  topSlots: [{ weekday: 2, hour: 18, weight: 5 }], segments: { new_to_app: 5 },
  computedAt: new Date("2026-09-21T14:00:00Z"), ...over,
});

const publication = (over: Partial<ConsentRecord> = {}): ConsentRecord => ({
  id: "c1", contactId: "b1", basis: "conspicuous_publication",
  sourceUrl: "https://allezup.com/contact", capturedAt: new Date("2026-09-01T00:00:00Z"),
  antiSolicitationChecked: true, antiSolicitationFound: false,
  relevanceNote: "Proposing they host climbing sessions — core to their business.", ...over,
});

const input = (over: Partial<GateInput> = {}): GateInput => ({
  contact: { id: "b1", email: "info@allezup.com", emailDomain: "allezup.com", locale: "fr-CA" },
  consents: [publication()],
  signal: signal(),
  history: { lifetimeSent: 0, lastSentAt: null, everReplied: false },
  suppressed: false,
  now: NOW,
  localNow: MONDAY_10H,
  ...over,
});

/** Narrow once, so assertions read cleanly and TypeScript is satisfied. */
function refusal(r: ReturnType<typeof gate>): GateRefusal {
  assert.equal(r.allowed, false, "expected the gate to refuse");
  if (r.allowed) throw new Error("unreachable");
  return r.reason;
}

test("allows a complete conspicuous-publication basis", () => {
  const r = gate(input());
  assert.equal(r.allowed, true);
  assert.equal(r.allowed && r.basis, "conspicuous_publication");
});

test("suppression beats every other basis, including express consent", () => {
  const r = gate(input({
    suppressed: true,
    consents: [{ id: "c9", contactId: "b1", basis: "express_consent" }],
  }));
  assert.equal(refusal(r), "suppressed");
});

test("rejects publication basis when an anti-solicitation notice was found", () => {
  const r = gate(input({ consents: [publication({ antiSolicitationFound: true })] }));
  assert.equal(refusal(r), "anti_solicitation_notice");
});

test("rejects publication basis with incomplete evidence", () => {
  for (const missing of [{ sourceUrl: null }, { capturedAt: null },
                         { relevanceNote: null }, { antiSolicitationChecked: false }]) {
    const r = gate(input({ consents: [publication(missing)] }));
    assert.equal(refusal(r), "publication_evidence_incomplete",
      `should refuse when missing ${Object.keys(missing)[0]}`);
  }
});

test("an existing business relationship lapses after 24 months", () => {
  const stale: ConsentRecord = {
    id: "c2", contactId: "b1", basis: "existing_business_relationship",
    eventType: "claimed_listing", eventAt: new Date("2024-01-01T00:00:00Z"),
  };
  assert.equal(validateConsent(stale, NOW), "consent_expired");

  const fresh = { ...stale, eventAt: new Date("2025-06-01T00:00:00Z") };
  assert.equal(validateConsent(fresh, NOW), null);
});

test("enforces the 30-day frequency cap", () => {
  const r = gate(input({
    history: { lifetimeSent: 1, lastSentAt: new Date("2026-09-10T00:00:00Z"), everReplied: false },
  }));
  assert.equal(r.allowed === false && r.reason, "frequency_cap_30d");
});

test("suppresses after the lifetime cap when they never replied", () => {
  const r = gate(input({
    history: {
      lifetimeSent: RULES.maxLifetimeWithoutReply,
      lastSentAt: new Date("2026-01-01T00:00:00Z"),
      everReplied: false,
    },
  }));
  assert.equal(refusal(r), "lifetime_cap_no_reply");
});

test("the lifetime cap does not apply once they have replied", () => {
  const r = gate(input({
    history: { lifetimeSent: 9, lastSentAt: new Date("2026-01-01T00:00:00Z"), everReplied: true },
  }));
  assert.equal(r.allowed, true);
});

test("refuses weak or stale demand signals", () => {
  assert.equal(refusal(gate(input({ signal: signal({ distinctUsers: 2 }) }))), "signal_too_weak");
  assert.equal(
    refusal(gate(input({ signal: signal({ computedAt: new Date("2026-08-01T00:00:00Z") }) }))),
    "signal_stale");
});

test("respects quiet hours and weekends", () => {
  assert.equal(withinSendWindow(new Date("2026-09-21T10:00:00")), true);   // Mon 10:00
  assert.equal(withinSendWindow(new Date("2026-09-21T06:00:00")), false);  // Mon 06:00
  assert.equal(withinSendWindow(new Date("2026-09-21T19:00:00")), false);  // Mon 19:00
  assert.equal(withinSendWindow(new Date("2026-09-19T10:00:00")), false);  // Saturday
});

test("refuses when no consent record exists at all", () => {
  const r = gate(input({ consents: [] }));
  assert.equal(refusal(r), "no_consent_basis");
});
