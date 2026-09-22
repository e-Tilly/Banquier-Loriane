# 14 — The Outreach Agent (AI ambassador → businesses)

**What it does:** watches for latent demand in the catalog, and when a venue has enough of it,
writes to that business proposing they run a session — with the evidence attached.

> *"8 people near Mile End saved your gym this month. 5 of them are beginners who've never
> booked. Tuesday 18:30 is the slot most of them are free. Want us to list a beginner night?"*

**Why it's the best idea in the plan for a solo founder.** One agent closes three loops at once:

1. **Supply acquisition** — it's a warm sales pitch with data, not a cold email.
2. **Outing supply** — venue-anchored outings can't have an empty room ([06](06-groups-and-outings.md)).
3. **Profile claims** — the natural call-to-action is "claim your listing to publish it".

It replaces the business-development work you have no time for, and unlike consumer-side
ambassadors it has **no impersonation problem**: it is openly the app writing to a business.

---

## The legal constraint that shapes the whole design

**Canada's Anti-Spam Legislation (CASL) is among the strictest in the world, and this is a
Commercial Electronic Message.** Penalties reach **$1M for an individual** and $10M for an
organization. A solo founder cannot absorb that, so compliance is a build-time gate, not a
policy page.

CASL requires, for every CEM: a **consent basis**, **sender identification**, a **physical
mailing address**, and a **working unsubscribe** honoured for at least 60 days.

### The three consent bases this system may use

| Basis | When it applies | Evidence stored |
|---|---|---|
| `express_consent` | They ticked a box, claimed their listing, or replied asking for this | Timestamp, IP, exact wording shown |
| `existing_business_relationship` | Claimed profile, subscription, or an enquiry — **within the last 24 months** | The event and its date |
| `conspicuous_publication` | The business **published this address itself** (their own website//contact page), there was **no "no unsolicited email" notice**, and the message is **relevant to their business role** | `source_url`, `captured_at`, a stored snapshot, and the anti-solicitation check result |

**`conspicuous_publication` is the workhorse for cold outreach, and it is only valid if all
three conditions hold.** A message proposing that a climbing gym host a climbing session is
squarely relevant to their business role — that part is comfortable. The parts that need
discipline are capturing the publication evidence and checking for an opt-out notice, which is
why both are enforced in code (`src/outreach/consent.ts`).

Never used as a basis: scraped directories, email-finder tools, guessed addresses
(`info@`, `contact@` patterns you didn't see published), personal addresses, or
`@gmail`/`@hotmail` addresses not published on the business's own site.

### Hard rules enforced in code

- **Permanent suppression list.** An unsubscribe is forever and applies across every address at
  that domain. Never expires, never "re-permissioned".
- **Frequency caps:** at most 1 message per business per 30 days; at most **3 lifetime** without
  a human reply, then the business is auto-suppressed for cold outreach.
- **The legally-required footer is templated, never model-written** — identification, mailing
  address, and unsubscribe link are appended by the transport, so they cannot be dropped,
  reworded, or hallucinated away.
- **Human approval before send**, at least for the first 200 messages. See below.
- **Quiet hours + timezone**: nothing sends outside 08:00–18:00 local, weekdays.
- **Every send is logged immutably** with its consent basis and the evidence id. If a complaint
  arrives, you must be able to prove the basis — the CRTC's due-diligence defence depends on it.

> **Get a lawyer to review the templates and the consent logic before the first real send.**
> One hour of a Quebec commercial lawyer's time is the cheapest insurance in this plan. The
> code is built so the basis is auditable; a lawyer confirms the basis is sound.

---

## Pipeline

```
[1] DETECT      SQL over saves, views, and failed rallies per venue
                → DemandSignal { venue, distinct_users, saves_30d, top_slots, segments }
                → threshold: ≥5 distinct users in 30d within 5 km, ≥1 unclaimed/claimed venue

[2] GATE        consent.ts — the CASL gate. Returns a basis or a refusal reason.
                No basis → the business is never contacted. Full stop.

[3] DRAFT       Claude Opus 5, structured output (subject, body_fr, body_en,
                proposed_slots, claims[]). Model writes the body only.

[4] VERIFY      Every numeric claim the model made must match the DemandSignal exactly.
                Mismatch → discard the draft and regenerate once, then give up.
                This is what stops a hallucinated "42 people are waiting".

[5] APPROVE     Queue for your review. One keystroke: approve / edit / reject / suppress.

[6] SEND        Transport appends the CASL footer, records the send, schedules follow-up.

[7] LEARN       Reply / claim / no-response feed back into targeting thresholds.
```

**Cost per drafted message:** ~2.5k input / ~800 output tokens on Opus 5 ≈ **$0.033**. Drafting
1,000 businesses is ~$33. Use Haiku 4.5 for the segment-summary pass and it's under $15.

## What the model is and isn't allowed to write

| May | May never |
|---|---|
| The pitch body, in FR and EN | Any number not present in the `DemandSignal` |
| A subject line | The unsubscribe text or mailing address (templated) |
| Proposed time slots **drawn from `top_slots`** | Claims about revenue, competitors, or other venues |
| A short "why this venue" line grounded in the listing | Urgency pressure, fake scarcity, fake deadlines |
| Plain, specific, non-salesy prose | Implying an existing relationship that doesn't exist |

**Verification is mechanical, not vibes-based.** The model returns a `claims[]` array of the
factual assertions it made; `verify.ts` checks each against the signal and rejects the draft on
any mismatch. A model that can only cite numbers it was given cannot invent social proof — the
same principle as the consumer-side concierge in [06](06-groups-and-outings.md).

## Tone

Small operators get a dozen "GROW YOUR BUSINESS WITH AI" emails a week and delete all of them.
The entire advantage here is that **this one contains a fact they care about and couldn't get
elsewhere**. So: short, plain, specific, no adjectives, no logo, no marketing template, signed
by a person. It should read like a neighbour noticed something, because it is true.

French first for Montréal, English available — and never a machine-translation smell, which is
instantly disqualifying to a Montréal business. The model drafts both natively.

## Escalation ladder

| Step | Trigger | Action |
|---|---|---|
| 1 | Demand threshold met | Draft + approve + send |
| 2 | No reply after 14 days | **One** follow-up, shorter, with updated numbers. Then stop. |
| 3 | Reply "not interested" | Permanent suppression, no exceptions |
| 4 | Reply interested | Hand off to you — a human closes. Do not automate the conversation. |
| 5 | They claim the listing | Basis upgrades to `existing_business_relationship`; switch to product emails |

## Metrics

| Metric | Target | Meaning |
|---|---|---|
| Reply rate | ≥ 15% | Well above cold-email norms, because the message contains real data |
| Claim rate within 14 days | ≥ 8% | The actual goal |
| Complaint / unsubscribe rate | **< 0.5%** | Above 1%, stop the programme and rewrite it |
| Sessions published per 100 messages | ≥ 5 | The outing-supply payoff |
| Drafts rejected by `verify.ts` | < 2% | Higher means the prompt is leaking invention |

The unsubscribe rate is the one to watch. This mechanism trades on goodwill in a small city
where operators talk to each other; burning it is unrecoverable.
