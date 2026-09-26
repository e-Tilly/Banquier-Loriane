/**
 * The CASL gate.
 *
 * Canada's Anti-Spam Legislation governs every Commercial Electronic Message sent to or from
 * Canada. Penalties reach $1M for an individual. This module is the single place that decides
 * whether a business may be contacted, and it fails closed: any doubt returns `allowed: false`.
 *
 * It does NOT construct a consent basis. A basis must already exist as evidence, captured when
 * the address was collected. Inferring consent at send time is exactly the thing that gets
 * people fined.
 */
import type { ConsentRecord, GateInput, GateRefusal, GateResult } from "./types.ts";

export const RULES = {
  /** One message per contact per 30 days. */
  minDaysBetweenMessages: 30,
  /** Lifetime cold messages before auto-suppression, if they never replied. */
  maxLifetimeWithoutReply: 3,
  /** An existing business relationship lapses 24 months after the qualifying event. */
  ebrMonths: 24,
  /** Weekday business hours, venue-local. */
  sendWindow: { startHour: 8, endHour: 18, weekdaysOnly: true },
  /** Demand thresholds below which there is nothing worth writing about. */
  minDistinctUsers: 5,
  minSaves: 6,
  /** A signal older than this no longer describes reality. */
  maxSignalAgeDays: 7,
} as const;

export function gate(input: GateInput): GateResult {
  const { contact, consents, signal, history, suppressed, now } = input;
  const localNow = input.localNow ?? now;

  // 1. Suppression is permanent and beats everything, including express consent.
  if (suppressed) return { allowed: false, reason: "suppressed" };

  // 2. Demand must actually exist — we have nothing to say otherwise.
  if (signal.distinctUsers < RULES.minDistinctUsers || signal.savesCount < RULES.minSaves) {
    return {
      allowed: false,
      reason: "signal_too_weak",
      detail: `${signal.distinctUsers} users / ${signal.savesCount} saves is below ` +
        `${RULES.minDistinctUsers}/${RULES.minSaves}`,
    };
  }
  if (daysBetween(signal.computedAt, now) > RULES.maxSignalAgeDays) {
    return { allowed: false, reason: "signal_stale" };
  }

  // 3. Frequency caps.
  if (history.lastSentAt && daysBetween(history.lastSentAt, now) < RULES.minDaysBetweenMessages) {
    return { allowed: false, reason: "frequency_cap_30d" };
  }
  if (!history.everReplied && history.lifetimeSent >= RULES.maxLifetimeWithoutReply) {
    return { allowed: false, reason: "lifetime_cap_no_reply" };
  }

  // 4. Quiet hours, in the venue's own timezone.
  if (!withinSendWindow(localNow)) return { allowed: false, reason: "quiet_hours" };

  // 5. A valid consent basis must already exist. Strongest first.
  const ranked = [...consents].sort(
    (a, b) => basisRank(b.basis) - basisRank(a.basis),
  );
  let lastFailure: GateResult | null = null;

  for (const consent of ranked) {
    const verdict = validateConsent(consent, now);
    if (verdict === null) {
      return { allowed: true, basis: consent.basis, consentId: consent.id };
    }
    lastFailure = { allowed: false, reason: verdict };
  }

  return lastFailure ?? { allowed: false, reason: "no_consent_basis" };
}

/** Returns null when the basis is valid, otherwise the refusal reason. */
export function validateConsent(c: ConsentRecord, now: Date): GateRefusal | null {
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime()) return "consent_expired";

  switch (c.basis) {
    case "express_consent":
      return null;

    case "existing_business_relationship": {
      if (!c.eventAt) return "no_consent_basis";
      const lapses = new Date(c.eventAt);
      lapses.setMonth(lapses.getMonth() + RULES.ebrMonths);
      return lapses.getTime() > now.getTime() ? null : "consent_expired";
    }

    case "conspicuous_publication": {
      // All three statutory conditions, or the basis does not exist.
      if (!c.sourceUrl || !c.capturedAt || !c.relevanceNote || !c.antiSolicitationChecked) {
        return "publication_evidence_incomplete";
      }
      if (c.antiSolicitationFound) return "anti_solicitation_notice";
      return null;
    }

    default:
      return "no_consent_basis";
  }
}

/**
 * A Date whose local getters read the wall clock in `tz`. The gate checks quiet hours with
 * getDay()/getHours(), which use the PROCESS's zone — UTC on a server, where 9:00 in Montréal
 * reads as 13:00. Always pass this as `localNow`.
 */
export function venueLocalNow(now: Date, tz: string): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return new Date(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!);
}

export function withinSendWindow(localNow: Date): boolean {
  const { startHour, endHour, weekdaysOnly } = RULES.sendWindow;
  const day = localNow.getDay();
  if (weekdaysOnly && (day === 0 || day === 6)) return false;
  const hour = localNow.getHours();
  return hour >= startHour && hour < endHour;
}

function basisRank(b: ConsentRecord["basis"]): number {
  return b === "express_consent" ? 3 : b === "existing_business_relationship" ? 2 : 1;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 86_400_000;
}
