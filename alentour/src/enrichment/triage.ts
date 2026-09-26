/**
 * Photo triage with the small model: what is in the picture, is it usable, does it show
 * identifiable people, is it unsafe. Picks the hero (activity in progress > venue > food) and
 * decides each photo's safety status.
 *
 * Faces are *detected*, never identified. A photo with people in it waits for a human before it
 * is shown, because the people in it did not sign up for a catalog.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ImageType } from "./images.ts";

export const TRIAGE_MODEL = "claude-haiku-4-5";

const KINDS = ["activity_in_progress", "venue", "food", "people", "logo", "screenshot", "poster", "irrelevant"] as const;

const TriageSchema = z.object({
  kind: z.enum(KINDS),
  quality: z.number().describe("0 to 1: sharpness, light, framing"),
  has_faces: z.boolean().describe("true if any human face is recognisable"),
  has_text_overlay: z.boolean(),
  unsafe: z.boolean().describe("nudity, violence, hate symbols, weapons, drugs"),
});
export type Triage = z.infer<typeof TriageSchema>;

const SYSTEM = `You sort photos a business uploaded for its listing in a catalog of things to do.
Classify the photo; do not describe or identify anyone in it. Answer only with the form.`;

export async function triagePhoto(client: Anthropic, bytes: Buffer, type: ImageType): Promise<Triage> {
  const response = await client.messages.parse({
    model: TRIAGE_MODEL,
    max_tokens: 300,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: type, data: bytes.toString("base64") } },
        { type: "text", text: "Classify this photo." },
      ],
    }],
    output_config: { format: zodOutputFormat(TriageSchema) },
  });
  if (!response.parsed_output) throw new Error("no triage");
  return response.parsed_output;
}

export type Safety = "approved" | "pending" | "rejected";

/** What happens to a photo, given its triage (or none, when no model is available). */
export function safetyFor(t: Triage | null): Safety {
  if (!t) return "pending";                                 // no model: a human looks first
  if (t.unsafe) return "rejected";
  if (t.kind === "irrelevant" || t.kind === "screenshot") return "rejected";
  if (t.has_faces || t.kind === "people") return "pending";
  return "approved";
}

const HERO_RANK: Record<string, number> = { activity_in_progress: 3, venue: 2, food: 1 };

/** Index of the best hero among approved photos, or -1. */
export function pickHero(items: { triage: Triage | null; safety: Safety }[]): number {
  let best = -1, score = -1;
  items.forEach((it, i) => {
    if (it.safety === "rejected") return;
    const s = (HERO_RANK[it.triage?.kind ?? ""] ?? 0) * 10 + (it.triage?.quality ?? 0.5) * 5 + (it.safety === "approved" ? 1 : 0);
    if (s > score) { score = s; best = i; }
  });
  return best;
}
