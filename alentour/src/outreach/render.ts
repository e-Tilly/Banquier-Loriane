/**
 * Transport-side rendering. The CASL-mandated elements live here, not in the prompt, so they
 * are structurally impossible for the model to omit or reword.
 *
 * CASL requires in every Commercial Electronic Message: sender identification, a physical
 * mailing address, and an unsubscribe mechanism that works for at least 60 days.
 */
import type { DraftedMessage } from "./types.ts";

export interface SenderIdentity {
  appName: string;
  personName: string;
  replyTo: string;
  mailingAddress: string;
  unsubscribeBase: string;
}

export function senderFromEnv(): SenderIdentity {
  const required = {
    appName: process.env.OUTREACH_SENDER_NAME,
    personName: process.env.OUTREACH_SENDER_PERSON,
    replyTo: process.env.OUTREACH_REPLY_TO,
    mailingAddress: process.env.OUTREACH_MAILING_ADDRESS,
    unsubscribeBase: process.env.OUTREACH_UNSUBSCRIBE_BASE,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v?.trim())
    .map(([k]) => k);
  if (missing.length) {
    // Failing closed here is deliberate: a message without these is unlawful to send.
    throw new Error(
      `Cannot render outreach — missing sender identity: ${missing.join(", ")}. ` +
      `CASL requires identification, a mailing address, and an unsubscribe link.`,
    );
  }
  return required as SenderIdentity;
}

export function renderEmail(
  draft: DraftedMessage,
  sender: SenderIdentity,
  unsubscribeToken: string,
): { subject: string; text: string } {
  const fr = draft.locale.startsWith("fr");
  const url = `${sender.unsubscribeBase.replace(/\/$/, "")}/${unsubscribeToken}`;

  const footer = fr
    ? [
        "",
        `— ${sender.personName}, ${sender.appName}`,
        `Répondez simplement à ce courriel : ${sender.replyTo}`,
        "",
        "—",
        `${sender.appName} · ${sender.mailingAddress}`,
        `Vous recevez ce message parce que votre adresse est publiée sur votre site web.`,
        `Se désabonner (définitif) : ${url}`,
      ]
    : [
        "",
        `— ${sender.personName}, ${sender.appName}`,
        `Just reply to this email: ${sender.replyTo}`,
        "",
        "—",
        `${sender.appName} · ${sender.mailingAddress}`,
        `You're receiving this because your address is published on your website.`,
        `Unsubscribe (permanent): ${url}`,
      ];

  return { subject: draft.subject, text: `${draft.body.trim()}\n${footer.join("\n")}` };
}
