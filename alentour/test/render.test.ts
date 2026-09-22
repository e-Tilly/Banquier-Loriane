import { test } from "node:test";
import assert from "node:assert/strict";
import { renderEmail, senderFromEnv } from "../src/outreach/render.ts";
import type { DraftedMessage } from "../src/outreach/types.ts";

const sender = {
  appName: "Alentour", personName: "Frédérick", replyTo: "allo@alentour.app",
  mailingAddress: "1234 Rue Saint-Denis, Montréal, QC H2X 3J4",
  unsubscribeBase: "https://alentour.app/u/",
};

const draft = (locale: string): DraftedMessage => ({
  subject: "s", body: "Corps du message.", locale, proposedSlots: [], claims: [],
});

test("every rendered message carries the CASL-required elements", () => {
  for (const locale of ["fr-CA", "en-CA"]) {
    const { text } = renderEmail(draft(locale), sender, "tok123");
    assert.ok(text.includes(sender.mailingAddress), "mailing address is mandatory");
    assert.ok(text.includes("https://alentour.app/u/tok123"), "unsubscribe link is mandatory");
    assert.ok(text.includes(sender.appName), "sender identification is mandatory");
    assert.ok(text.includes(sender.replyTo));
  }
});

test("refuses to render when the sender identity is incomplete", () => {
  const saved = process.env.OUTREACH_MAILING_ADDRESS;
  process.env.OUTREACH_SENDER_NAME = "Alentour";
  process.env.OUTREACH_SENDER_PERSON = "F";
  process.env.OUTREACH_REPLY_TO = "a@b.c";
  process.env.OUTREACH_UNSUBSCRIBE_BASE = "https://x/u";
  delete process.env.OUTREACH_MAILING_ADDRESS;

  assert.throws(() => senderFromEnv(), /mailingAddress/);
  if (saved !== undefined) process.env.OUTREACH_MAILING_ADDRESS = saved;
});
