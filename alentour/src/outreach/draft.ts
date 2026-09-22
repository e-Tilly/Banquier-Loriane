/**
 * Drafting. Claude writes the body only; every legally-required element (identification,
 * mailing address, unsubscribe) is templated by the transport so it cannot be dropped,
 * reworded, or hallucinated away.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { BusinessContact, DemandSignal, DraftedMessage } from "./types.ts";

const MODEL = "claude-opus-5";

const ClaimSchema = z.object({
  kind: z.enum(["distinct_users", "saves_count", "failed_rallies", "segment", "slot"]),
  key: z.string().optional(),
  value: z.number(),
});

const DraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  proposed_slots: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    weight: z.number(),
  })),
  claims: z.array(ClaimSchema),
});

/** Stable across every call, so it caches. Keep volatile content out of it. */
const SYSTEM = `You write short, plain emails to small business owners in Montréal on behalf of
Alentour, an app that helps people find things to do nearby.

Your job: tell a venue that people on the app have been saving them, and suggest they host a
session or a recurring night so those people can actually show up.

HARD RULES — a violation makes the draft unusable:
1. Cite ONLY numbers present in the DEMAND SIGNAL you are given. Never estimate, round,
   extrapolate, or invent a figure. If you want to say it, it must be in the signal.
2. For every factual assertion you make, add an entry to "claims" naming the figure you used.
3. Propose ONLY time slots that appear in the signal's top_slots.
4. Never imply an existing relationship, prior conversation, or agreement.
5. No urgency, scarcity, deadlines, guarantees, or superlatives.
6. Do NOT write a greeting footer, signature block, unsubscribe line, or mailing address —
   those are added automatically. End with your final sentence.
7. Never mention competitors or other venues.

STYLE: Montréal small-business owners delete a dozen AI growth emails a week. What makes this
one different is that it contains a fact they cannot get anywhere else. So:
- Under 120 words. Short sentences. No adjectives you don't need.
- Lead with the fact, not with who you are.
- One concrete suggestion, one easy next step.
- Write natively in the requested language. A machine-translation smell is disqualifying.
- Sound like a neighbour who noticed something, because that is what happened.`;

export interface DraftInput {
  contact: BusinessContact;
  signal: DemandSignal;
  locale: string;
  /** 1 = first touch, 2 = the single permitted follow-up. */
  sequenceNo?: number;
  client?: Anthropic;
}

export async function draftMessage(input: DraftInput): Promise<DraftedMessage> {
  const { contact, signal, locale, sequenceNo = 1 } = input;
  const client = input.client ?? new Anthropic();

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildPrompt(contact, signal, locale, sequenceNo) }],
    output_config: { format: zodOutputFormat(DraftSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Model returned no parseable draft");

  return {
    subject: parsed.subject,
    body: parsed.body,
    locale,
    proposedSlots: parsed.proposed_slots,
    claims: parsed.claims,
  };
}

function buildPrompt(
  contact: BusinessContact,
  signal: DemandSignal,
  locale: string,
  sequenceNo: number,
): string {
  const lang = locale.startsWith("fr") ? "French (Québec)" : "English";
  return [
    `Language: ${lang}`,
    `Venue: ${signal.venueName}`,
    contact.contactName ? `Contact name: ${contact.contactName}` : "Contact name: unknown",
    signal.activityTitle ? `Activity they're saving: ${signal.activityTitle}` : "",
    "",
    "DEMAND SIGNAL — the only facts you may cite:",
    JSON.stringify({
      window_days: signal.windowDays,
      distinct_users: signal.distinctUsers,
      saves_count: signal.savesCount,
      failed_rallies: signal.failedRallies,
      segments: signal.segments,
      top_slots: signal.topSlots,
    }, null, 2),
    "",
    "Weekday numbering: 0=Sunday, 1=Monday, … 6=Saturday.",
    sequenceNo === 2
      ? "This is a SECOND and FINAL message; they did not reply to the first. Be shorter still, " +
        "reference the updated numbers, and make it easy to say no."
      : "This is a first contact. They have never heard from us.",
  ].filter(Boolean).join("\n");
}
