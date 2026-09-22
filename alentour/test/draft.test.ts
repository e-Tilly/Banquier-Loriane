import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { draftMessage } from "../src/outreach/draft.ts";
import type { DemandSignal } from "../src/outreach/types.ts";

const signal: DemandSignal = {
  id: "s1", venueId: "v1", venueName: "Allez Up", activityTitle: "Bloc débutant",
  windowDays: 30, distinctUsers: 9, savesCount: 14, failedRallies: 2,
  topSlots: [{ weekday: 2, hour: 18, weight: 6 }],
  segments: { new_to_app: 6 },
  computedAt: new Date("2026-09-22T12:00:00Z"),
};

/** Captures the request instead of calling the API, so SDK misuse fails here, not in prod. */
function stubClient(captured: { params?: any }): Anthropic {
  return {
    messages: {
      parse: async (params: any) => {
        captured.params = params;
        return {
          parsed_output: {
            subject: "9 personnes ont enregistré Allez Up",
            body: "Bonjour, 9 personnes ont enregistré Allez Up ce mois-ci.",
            proposed_slots: [{ weekday: 2, hour: 18, weight: 6 }],
            claims: [{ kind: "distinct_users", value: 9 }],
          },
        };
      },
    },
  } as unknown as Anthropic;
}

test("builds a well-formed request and maps the response", async () => {
  const captured: { params?: any } = {};
  const draft = await draftMessage({
    contact: { id: "b1", email: "info@allezup.com", emailDomain: "allezup.com", locale: "fr-CA" },
    signal, locale: "fr-CA", client: stubClient(captured),
  });

  const p = captured.params!;
  assert.equal(p.model, "claude-opus-5");
  assert.ok(p.max_tokens > 0);
  // The system prompt must be cacheable — it is identical on every call.
  assert.equal(p.system[0].cache_control.type, "ephemeral");
  assert.ok(p.output_config?.format, "structured output format must be set");

  // The signal must reach the model verbatim: it is the only thing it may cite.
  const prompt: string = p.messages[0].content;
  assert.match(prompt, /"distinct_users": 9/);
  assert.match(prompt, /"saves_count": 14/);
  assert.match(prompt, /French \(Québec\)/);

  assert.equal(draft.locale, "fr-CA");
  assert.equal(draft.claims[0]!.value, 9);
  assert.equal(draft.proposedSlots[0]!.hour, 18);
});

test("the follow-up prompt is marked as final", async () => {
  const captured: { params?: any } = {};
  await draftMessage({
    contact: { id: "b1", email: "x@y.com", emailDomain: "y.com", locale: "en-CA" },
    signal, locale: "en-CA", sequenceNo: 2, client: stubClient(captured),
  });
  assert.match(captured.params.messages[0].content, /SECOND and FINAL/);
});

test("throws rather than inventing content when the model returns nothing parseable", async () => {
  const broken = { messages: { parse: async () => ({ parsed_output: null }) } } as unknown as Anthropic;
  await assert.rejects(
    () => draftMessage({
      contact: { id: "b1", email: "x@y.com", emailDomain: "y.com", locale: "fr-CA" },
      signal, locale: "fr-CA", client: broken,
    }),
    /no parseable draft/,
  );
});
