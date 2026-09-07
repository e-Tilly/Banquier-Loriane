# 11 — Legal, Privacy & Compliance

**Not legal advice.** This is an engineering-side checklist of what to build and what to
take to counsel. Given assumption A1 (Québec launch), several of these are unusually strict
and unusually cheap to handle now versus later.

---

## Privacy — the defining constraint

You are collecting **location + social graph + real-world attendance**. That combination is
sensitive by any regulator's standard, and it's the kind of dataset that produces headlines
when mishandled.

### Regimes that apply

| Regime | Applies | Notable obligations |
|---|---|---|
| **Québec Law 25** | Launch market | Designated **Privacy Officer** (named publicly), **privacy impact assessment before any new tech that processes personal info**, privacy-by-default (settings must default to most private), explicit granular consent, right to portability, right to erasure/de-indexing, **72h breach reporting**, and disclosure of any automated decision-making |
| **PIPEDA** | Rest of Canada | Consent, purpose limitation, access rights |
| **GDPR** | Any EU expansion | DPO if scale requires, DPIA, lawful basis, DSARs in 30 days, cross-border transfer mechanism |
| **Apple / Google policies** | Both stores | Privacy nutrition labels, `NSLocationWhenInUseUsageDescription` with an honest string, App Tracking Transparency, account **deletion in-app** (Apple requires it), data safety form |
| **Bill 96 / Charter of the French Language** | Québec commercial activity | French must be available and **at least as prominent** as English in commercial communications |

### Location data — build these rules in

- **`WhenInUse` permission only.** No background location at launch. Background location
  invites the worst App Review scrutiny and the worst press, and it buys nothing.
- **Never store raw continuous location.** Query with the coordinate in the request, use it,
  drop it. Persist only a coarse **H3 res-7 cell** for "home area", with explicit consent.
- **Coarse-location fallback** for users who deny precise location (iOS lets them choose) —
  the app must be fully usable at city-level precision.
- **Location is never shown to other users.** Outing meeting points are venue-based, exact
  address released at T−2h to confirmed participants only ([08](08-trust-safety-and-moderation.md)).
- **Strip EXIF from every uploaded image.** Photo GPS is the most common accidental
  location leak in consumer apps.
- **Retention:** location-bearing logs 30 days, then aggregate. Impressions 90 days.

### Rights machinery (build it in Phase 1, not when the first request arrives)

- **In-app account deletion** — Apple requires it, and it must actually delete, not just
  deactivate. Cascade defined in [04](04-data-model.md).
- **Data export** — JSON of profile, saves, outings, reviews, messages. A background job.
- **Granular consent records** — timestamp, version, and text of what was consented to, per
  purpose (analytics, personalization, marketing). One global "I agree" won't satisfy Law 25.
- **A privacy dashboard**: what we know, what's shared, toggles, delete.
- **Automated decision disclosure** — Law 25 requires telling users when a decision affecting
  them is automated. Your moderation pipeline and trust-level system qualify. Build the
  "why was this decided" explanation and the human-review path into moderation from the start.

---

## Liability — the part people forget until it matters

Users will get hurt doing activities they found in your app. Plan for it.

1. **Be a facilitator, not an organizer — and make the product consistent with that claim.**
   Terms must be explicit that you neither operate, supervise, vet, nor endorse activities or
   outings. This position is undermined if you promote specific outings editorially, pay
   ambassadors as if they were employees, or advertise safety guarantees. Align the product
   with the legal posture, or the posture won't hold.
2. **Risk-tiered waivers.** `risk_tier ≥ 2` requires an in-app acknowledgement with a
   versioned waiver text; store `waiver_version` and `accepted_at` per participant
   ([04](04-data-model.md)). Waiver enforceability varies by province/state — get local counsel.
3. **`risk_tier 3` cannot be community-hosted at all** — verified operator only.
4. **Ambassador classification.** Paid ambassadors ([06](06-groups-and-outings.md)) can create
   employment/contractor exposure and blur the facilitator position. Structure with counsel:
   fixed stipends, no direction of manner and means, clear independent-contractor terms.
5. **Insurance:** general liability, tech E&O, cyber. Get quotes before Phase 2 launches;
   underwriters will ask precisely the questions above and their answers will tell you where
   your policies are weak.
6. **Accessibility claims.** Publishing a wrong accessibility claim could expose you under
   accessibility legislation and, more importantly, harms someone. Owner/community-verified
   only, with a visible "last verified" date and a fast correction path
   ([03](03-taxonomy.md), [08](08-trust-safety-and-moderation.md)).
7. **Minors** — see [08](08-trust-safety-and-moderation.md). Age gates, no adult-tagged
   activities, mandated-reporting playbook.

## Content & IP

- **UGC licence** in the ToS: non-exclusive, worldwide, royalty-free licence to display and
  adapt submitted content; user warrants they own it. Survives account deletion for content
  already published, unless erasure is requested.
- **Imported media** — separate, explicit consent at social-connect time; per-asset provenance
  and licence recorded; propagate deletion on disconnect ([07](07-supply-onboarding-and-ai.md)).
- **Open-data attribution** — Overture (CDLA-Permissive 2.0) and OSM (ODbL) both require
  attribution. Build an in-app credits screen and per-listing source attribution *now*; it's
  trivial at the start and a migration later.
- **ODbL share-alike** — keep OSM-derived data in a separate, attributed layer; treat it as a
  Collective rather than Derivative Database; confirm with counsel ([07](07-supply-onboarding-and-ai.md)).
- **Notice-and-takedown** process for copyright and defamation claims (DMCA-style in the US,
  equivalents elsewhere), with a published contact and a logged workflow.
- **AI-generated content** — descriptions drafted by AI and published under a business's name
  are the business's representations once they approve them. The review-and-approve step in
  [07](07-supply-onboarding-and-ai.md) isn't only a quality mechanism; it's the mechanism that
  transfers responsibility for the claim to the party making it. Keep the approval record.

## Platform & marketing compliance

- **Meta / TikTok / Google API terms** — app review, permitted use, data retention and
  deletion obligations, and no storing data beyond what the permission covers. Read the
  platform terms before designing the import; they constrain what you may keep.
- **Sponsored/promoted placement must be labeled** (Competition Act in Canada, FTC in the US,
  and store policies). "Sponsored" on the card, always, not a footnote.
- **Anti-discrimination.** Audience restrictions (women-only, age-limited) are lawful in some
  jurisdictions and for some contexts and not others, and the analysis differs between a
  public accommodation and a private gathering. Model the capability, gate it per
  jurisdiction, ship it only with counsel's sign-off ([03](03-taxonomy.md)).
- **Accessibility of the app itself** — WCAG 2.1 AA as the internal bar. Also increasingly a
  legal requirement, and unarguably the right thing for a product with accessibility filters.
- **Reviews** — no paid or incentivized reviews without disclosure; owners may reply, never
  delete.
- **Payments (if/when)** — PCI scope avoided by using Stripe's hosted elements; marketplace
  flows may trigger money-transmitter analysis; sales tax/GST/QST on service fees.

## Pre-launch legal checklist

- [ ] ToS, Privacy Policy, Community Guidelines, Waiver text — all in **FR and EN**
- [ ] Privacy Officer designated and named publicly (Law 25)
- [ ] PIA completed for: location processing, the AI enrichment pipeline, the moderation
      classifier, and any personalization based on attendance
- [ ] Records of processing activities; data map; sub-processor list
- [ ] DPA/sub-processor agreements with every vendor touching personal data
- [ ] Breach response plan with a 72h clock and a named decision-maker
- [ ] Deletion + export flows implemented and tested end-to-end
- [ ] Store privacy labels accurate and matching what the app actually does
- [ ] Open-data attribution screen shipped
- [ ] Insurance bound before Phase 2 (outings) opens
- [ ] Moderation playbook, escalation ladder, and law-enforcement request policy written
