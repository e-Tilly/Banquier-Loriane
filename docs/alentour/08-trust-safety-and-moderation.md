# 08 — Trust, Safety & Moderation

You are building a product where strangers meet strangers in physical space. **One serious
incident, handled badly, ends the company.** This is not a phase-3 concern; it ships with
outings or outings don't ship.

Two separate problem spaces, often conflated:

- **Content safety** — is this listing real, accurate, legal, non-spam?
- **People safety** — is it safe to meet this person at this place at this time?

---

## People safety

### Trust levels

A single `trust_level` on the user drives capability gates throughout the app.

| Level | Earned by | Can |
|---|---|---|
| 0 — new | Signup | Browse, save, join *public* outings hosted by L2+ |
| 1 — verified | Email + phone verified, profile complete | Join any open outing, create rallies (max 3 open) |
| 2 — established | 2 attended outings, no upheld reports, account ≥ 14 days | Host outings up to 8 people, create activities that publish immediately |
| 3 — trusted | 8 attended, hosted ≥ 2, ID-verified | Host larger outings, host `risk_tier 2` activities, community moderation queue access |
| −1 — restricted | Upheld report, or no-show pattern | Read-only social; can appeal |

Progression must be **visible and achievable** — show "1 more outing to unlock hosting".
Invisible gates read as bugs.

### Verification ladder

- **Phone (SMS)** — cheap, blocks casual repeat abuse. Required for any social action.
- **Email + Apple/Google identity** — baseline.
- **ID verification** (Stripe Identity, Persona, or Veriff, ~$1–1.50/check) — *optional for
  attendees, required for hosts of paid outings, `risk_tier ≥ 2` outings, and outings > 12
  people.* Badged, not mandatory: forcing ID on everyone kills signup and excludes people
  without documents, which disproportionately hits exactly the newcomers you're trying to
  serve. Store the *result*, never the document images.
- **Selfie-match to profile photo** — optional badge, meaningfully reduces catfishing.

### Meeting-safety design (product features, not policy text)

- **Public meeting points only.** `outings.meeting_point` must resolve to a public venue or a
  known POI. Block residential addresses. This one constraint prevents a large class of harm.
- **Exact address disclosed at T−2h**, and only to confirmed participants. Approximate area
  before that.
- **"Share your plans"** — one tap sends a trusted contact the activity, venue, time, and a
  live-ish check-in link. No account needed for the recipient. This is table stakes now, and
  users notice its absence.
- **Check-in / check-out** with an optional "I'm home safe" prompt.
- **In-app contact only until the outing confirms.** No phone numbers, no Instagram handles
  exchanged in-app before that; strip contact info from pre-confirmation messages.
- **Blocks are total and silent.** A blocked user cannot see, join, or be shown your outings,
  and gets no signal that a block occurred. Block propagation must be enforced in the
  *candidate generation query*, not filtered in the client.
- **One-tap report from every surface** — profile, outing, message, photo, review. Under 3
  taps, always. Reporting flows that are hard to find don't get used.
- **Emergency resources** in the safety centre, localized per city.
- **A "leave" that isn't awkward.** A discreet in-app way to exit an outing early and mark
  discomfort, which routes to review without a confrontation.

### Incident response — write this before you need it

- **24/7 triage for `severity ≥ 3`** (physical harm, threats, minors, sexual misconduct).
  At small scale this is a phone that wakes someone up. That's acceptable; having no such
  phone is not.
- Published SLA: acknowledge < 4h, resolve or escalate < 24h for high severity.
- A written escalation playbook: what gets law enforcement contacted, who decides, who
  speaks. Rehearse it once.
- **Preserve evidence on report** — snapshot the reported content immediately; deletion by
  the reported user must not destroy it.
- Appeals for every enforcement action, reviewed by a different human.
- **Transparency reporting** from year one. It builds the trust you'll need on your worst day.

### Not a dating app — enforced, not just stated

See [06](06-groups-and-outings.md). Concretely: no swipe UI, no browsing attendees by photo,
no romantic-intent filters, zero tolerance for unsolicited advances (first offence = warning
+ visible record; second = restriction). Publish the norm in onboarding so enforcement isn't
a surprise.

### Minors

- Minimum age 16 (A6). Hosting requires 18+.
- Age-gate: activities tagged `adults_only`, `alcohol_served`, or `min_age_legal ≥ 18` are
  hidden from and unjoinable by under-18 accounts.
- Under-18s cannot join outings hosted by unverified individuals, and cannot appear in
  attendee lists to non-participants.
- Any report involving a minor is automatically `severity 4`, human-reviewed, with a mandated
  reporting path defined in the playbook.

---

## Content safety & moderation

### The pipeline

```
UGC (listing, photo, review, message, profile)
  → [1] Deterministic checks: rate limits, blocklists, link/contact-info rules, dup hash
  → [2] Automated classification — Claude Haiku 4.5, structured output
        {sexual, violence, harassment, hate, self_harm, illegal, spam, pii,
         off_topic, dangerous_activity, commercial_spam} each 0–1
        + image safety on every photo
  → [3] Risk score → route:
        low     → publish
        medium  → publish + queue for review (soft)
        high    → hold, publish only after human review
        critical→ block + auto-restrict + alert
  → [4] Human queue, SLA by severity
  → [5] Every decision logged to moderation_decisions (append-only) with model version
        and scores, so you can audit and re-run when a threshold changes
```

**Cost:** an outing message is ~200 input tokens. At 1M MAU and ~1M moderated items/month,
Haiku 4.5 at $1/MTok input is roughly **$300/month**. Cheap enough that you should moderate
*everything*, not sample.

**Do not moderate with an LLM alone.** Layer 1's deterministic rules catch the highest-volume
abuse (link spam, repeated text, contact-info harvesting) at zero marginal cost, and layer 2
should never be the only thing between a user and harm.

### Content-specific rules

- **Photos:** EXIF stripped on upload (GPS!), NSFW/violence classifier, no photos of
  identifiable people without consent in *user-submitted* listing photos, no photos of minors
  in UGC listings.
- **Reviews:** verified-attendance reviews ranked first and badged. One review per user per
  activity. Owner right of reply, no owner deletion. Detect and act on review brigading
  (velocity + account-age + graph clustering).
- **Listings:** no MLM, no unlicensed regulated services (medical, financial), no adult
  services, no prohibited dangerous activities, no political/religious recruitment disguised
  as an activity. Write this list *before* UGC opens, and put it in the ToS.
- **Duplicate/spam listings:** embedding + trigram similarity at creation ([07](07-supply-onboarding-and-ai.md)).

### Catalog accuracy — a safety issue, not just a quality one

Wrong hours waste an evening. **Wrong accessibility information strands someone.** Wrong
price/difficulty on a `risk_tier 2` activity gets someone hurt.

- Accessibility claims: owner-confirmed or community-verified only, never AI ([03](03-taxonomy.md),
  [07](07-supply-onboarding-and-ai.md)).
- `last_verified_at` shown in the UI when > 6 months.
- "Report a problem" on every listing, with fast-path reasons: *closed permanently · wrong
  hours · wrong price · wrong accessibility · doesn't exist · dangerous*.
- Owner nudge every 90 days: "still accurate?" — one tap to confirm.
- Auto-demote anything unverified for 12 months.

### Moderation tooling

Build a real internal tool in Phase 2 — not Retool forever, and definitely not psql. It needs:
queue with severity sort and SLA timers, full context on one screen (the content, the
reporter, the reported user's history, related reports), one-click actions with mandatory
reason codes, an append-only audit log, and appeal handling. Moderation quality is bounded by
tool quality, and a bad tool guarantees inconsistent decisions.

**Staffing:** roughly 1 FTE moderator per 50–100k MAU for a product with this much UGC and
in-person risk, plus on-call rotation for severity 3+. At 1M MAU budget 8–12 FTE or an
outsourced partner with a well-specified playbook and your own QA sampling on top. This is a
real line item in [10](10-cost-model.md) — moderation is usually a larger cost than the
infrastructure it moderates, and plans that omit it are wrong by an order of magnitude.
