/**
 * Mechanical verification of everything the model asserted.
 *
 * The model returns a `claims[]` array alongside its prose. Every claim must match the
 * DemandSignal exactly, and every number appearing in the prose must be accounted for by a
 * claim. A model that can only cite numbers it was handed cannot invent social proof.
 *
 * This is the same principle as the consumer-side concierge: the AI organizes, it never
 * fabricates participation.
 */
import type { Claim, DemandSignal, DraftedMessage } from "./types.ts";

export interface VerificationResult {
  ok: boolean;
  problems: string[];
}

/** Numbers that may appear in prose without a backing claim: small ordinals, times, years. */
const BENIGN_NUMBERS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 30, 45, 60]);

export function verifyDraft(draft: DraftedMessage, signal: DemandSignal): VerificationResult {
  const problems: string[] = [];

  for (const claim of draft.claims) {
    const actual = resolveClaim(claim, signal);
    if (actual === null) {
      problems.push(`claim references unknown key: ${claim.kind}${claim.key ? `/${claim.key}` : ""}`);
    } else if (actual !== claim.value) {
      problems.push(
        `claim ${claim.kind}${claim.key ? `/${claim.key}` : ""} = ${claim.value}, actual ${actual}`,
      );
    }
  }

  // Any number in the prose must be backed by a claim, or be benign.
  const claimed = new Set(draft.claims.map((c) => c.value));
  for (const n of extractNumbers(draft.body).concat(extractNumbers(draft.subject))) {
    if (!claimed.has(n) && !BENIGN_NUMBERS.has(n)) {
      problems.push(`unbacked number in prose: ${n}`);
    }
  }

  // Proposed slots must come from the signal — not invented convenient times.
  for (const slot of draft.proposedSlots) {
    const known = signal.topSlots.some(
      (s) => s.weekday === slot.weekday && s.hour === slot.hour,
    );
    if (!known) problems.push(`proposed slot ${slot.weekday}:${slot.hour} is not in topSlots`);
  }

  for (const banned of BANNED_PHRASES) {
    if (banned.test(draft.body)) problems.push(`banned phrasing: ${banned.source}`);
  }

  return { ok: problems.length === 0, problems };
}

function resolveClaim(claim: Claim, signal: DemandSignal): number | null {
  switch (claim.kind) {
    case "distinct_users": return signal.distinctUsers;
    case "saves_count":    return signal.savesCount;
    case "failed_rallies": return signal.failedRallies;
    case "segment":        return claim.key ? signal.segments[claim.key] ?? null : null;
    case "slot": {
      if (!claim.key) return null;
      const [wd, hr] = claim.key.split(":").map(Number);
      const slot = signal.topSlots.find((s) => s.weekday === wd && s.hour === hr);
      return slot ? claim.value : null;   // presence is the assertion; weight is not cited
    }
    default: return null;
  }
}

export function extractNumbers(text: string): number[] {
  // Strip times (18:30) and prices ($25) first — those are not demand claims.
  const cleaned = text
    .replace(/\d{1,2}\s*[:h]\s*\d{2}/g, " ")   // clock times: 18:30, 18h30
    .replace(/\$\s?\d+(?:[.,]\d+)?/g, " ")     // prices, en: $25
    .replace(/\d+(?:[.,]\d+)?\s?\$/g, " ");    // prices, fr: 25$
  return [...cleaned.matchAll(/\b\d+\b/g)].map((m) => Number(m[0]));
}

/** Pressure tactics and relationship claims that would be false. */
const BANNED_PHRASES: RegExp[] = [
  /derni[èe]re chance|last chance/i,
  /offre limit[ée]e|limited time offer/i,
  /agir maintenant|act now/i,
  /comme convenu|as discussed|as we discussed/i,
  /votre partenaire|your partner/i,
  /garanti[e]?\b|guaranteed/i,
];
