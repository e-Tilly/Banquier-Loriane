/** The enrichment draft: what the owner reviews and what a seed job becomes. */

export interface Field<T> {
  value: T;
  confidence: number;
  /** A verbatim quote from the source. Nothing survives the gate without one. */
  evidence: string;
}

export interface PriceValue {
  isFree: boolean;
  minCents: number | null;
  maxCents: number | null;
  unit: "per_person" | "per_group" | "per_hour" | "per_day" | "per_entry" | null;
}

export interface LocaleCopy { title: string; summary?: string; description?: string; whatToBring?: string }

export type Kind = "place" | "scheduled_event" | "recurring_program" | "self_guided" | "seasonal";

export interface DraftActivity {
  key: string;
  name: string;
  kind: Kind;
  primaryCategory: Field<string> | null;
  secondaryCategories: string[];
  tags: { slug: string; confidence: number; evidence: string }[];
  price: Field<PriceValue> | null;
  durationMinutes: Field<number> | null;
  openingHours: Field<string> | null;
  minAge: Field<number> | null;
  monthsOpen: Field<number> | null;           // 12-bit mask, Jan = bit 0
  weather: Field<"indoor" | "covered" | "outdoor" | "either"> | null;
  physicalDemand: Field<number> | null;
  skillRequired: Field<number> | null;
  icebreakerScore: Field<number> | null;
  riskTier: Field<number> | null;
  whatToBring: Field<string> | null;
  /**
   * What the source SAYS about accessibility. Shown to the owner as a prompt to answer; never
   * stored as a value. Only a human sets an accessibility answer.
   */
  a11yMentions: { slug: string; says: "yes" | "no"; evidence: string }[];
  copy: Partial<Record<"fr-CA" | "en-CA", LocaleCopy>>;
}

export interface Draft {
  isActivityBusiness: boolean;
  phone: string | null;
  website: string | null;
  socials: Record<string, string>;
  activities: DraftActivity[];
  ai: boolean;                 // false when drafted without a model (no key, or the model failed)
  note?: string;               // shown to the owner, e.g. "We couldn't read your website"
}

export interface Dropped { field: string; reason: string }

export interface Usage { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }
