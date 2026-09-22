/** Outreach agent types. See docs/alentour/14-outreach-agent.md. */

export type ConsentBasis =
  | "express_consent"
  | "existing_business_relationship"
  | "conspicuous_publication";

export interface ConsentRecord {
  id: string;
  contactId: string;
  basis: ConsentBasis;
  /** conspicuous_publication evidence — CASL s.10(9)(b) */
  sourceUrl?: string | null;
  capturedAt?: Date | null;
  antiSolicitationChecked?: boolean;
  antiSolicitationFound?: boolean | null;
  relevanceNote?: string | null;
  /** express / EBR evidence */
  eventType?: string | null;
  eventAt?: Date | null;
  expiresAt?: Date | null;
}

export interface BusinessContact {
  id: string;
  email: string;
  emailDomain: string;
  contactName?: string | null;
  locale: string;
  venueId?: string | null;
  providerId?: string | null;
}

export interface TimeSlot {
  /** 0 = Sunday, matching Date#getDay. */
  weekday: number;
  hour: number;
  weight: number;
}

/** The only facts a message is permitted to cite. Snapshotted, so the claim stays
 *  provable after the underlying saves change. */
export interface DemandSignal {
  id: string;
  venueId: string;
  venueName: string;
  activityId?: string | null;
  activityTitle?: string | null;
  windowDays: number;
  distinctUsers: number;
  savesCount: number;
  failedRallies: number;
  topSlots: TimeSlot[];
  segments: Record<string, number>;
  computedAt: Date;
}

export interface OutreachHistory {
  lifetimeSent: number;
  lastSentAt: Date | null;
  everReplied: boolean;
}

export type GateResult =
  | { allowed: true; basis: ConsentBasis; consentId: string }
  | { allowed: false; reason: GateRefusal; detail?: string };

export type GateRefusal =
  | "suppressed"
  | "no_consent_basis"
  | "consent_expired"
  | "publication_evidence_incomplete"
  | "anti_solicitation_notice"
  | "frequency_cap_30d"
  | "lifetime_cap_no_reply"
  | "quiet_hours"
  | "signal_too_weak"
  | "signal_stale";

export interface DraftedMessage {
  subject: string;
  body: string;
  locale: string;
  proposedSlots: TimeSlot[];
  /** Every factual assertion the model made, for mechanical verification. */
  claims: Claim[];
}

export interface Claim {
  kind: "distinct_users" | "saves_count" | "failed_rallies" | "segment" | "slot";
  /** For `segment`, the segment name. For `slot`, "weekday:hour". Otherwise omitted. */
  key?: string;
  value: number;
}

export interface GateInput {
  contact: BusinessContact;
  consents: ConsentRecord[];
  signal: DemandSignal;
  history: OutreachHistory;
  suppressed: boolean;
  now: Date;
  /** Venue-local time, for the quiet-hours check. */
  localNow?: Date;
}
