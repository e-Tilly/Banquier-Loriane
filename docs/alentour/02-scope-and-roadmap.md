# 02 — Scope & Roadmap

## Sequencing principle

**Supply, then demand, then liquidity, then revenue — in one neighbourhood at a time.**

The failure mode for this category is launching a beautiful nationwide app with 40
activities per city and no outings. A user who opens the app twice and sees nothing near
them is gone forever, and re-acquiring them costs more than acquiring them did.

So: pick one neighbourhood. Get it to ~95% coverage of what actually exists there. Then
widen. Density beats breadth by a wide margin in every local marketplace ever built.

---

## Phase 0 — Validation (weeks 1–8)

**Goal: find out if people will browse and filter at all, before building any of the hard parts.**

- One city, 2–3 adjacent neighbourhoods. **300–500 activities, hand-curated.** Seed from
  Overture + municipal open data, then a human walks the taxonomy over every one. Yes, by
  hand. This is the most valuable 40 hours in the project — it is how you discover that
  your taxonomy is wrong.
- Ship: browse feed, map view, filters, activity detail, save. **No accounts beyond an
  anonymous device ID. No groups. No business onboarding. No AI.**
- Distribution: 200–500 people from local subreddits, Facebook groups, university housing,
  newcomer associations.
- **Kill/continue criteria:**
  - ≥ 35% of installs apply at least one filter (proves the filter thesis)
  - ≥ 25% return in week 2
  - ≥ 15% save at least one activity
  - Qualitative: 10 interviews where someone says "I did the thing I found."
- If filters aren't used, the entire product thesis is wrong and you should know in week 8,
  not month 14.

**Team:** 1–2 engineers + you. Design can be a good template.

---

## Phase 1 — Public MVP, one city (months 2–5)

**Goal: a genuinely useful single-city activity dictionary.**

Ships:
- Accounts (Apple / Google / email OTP). Profiles, minimal.
- **~2,000–3,000 activities in one city**, ≥ 60% with 3+ photos.
- Full taxonomy and filter UI ([03](03-taxonomy.md)), including saved filter presets.
- Feed + map + list, distance/duration/price/category/accessibility filters, `open now`.
- **Weather- and season-aware ranking** (cheap, high impact — do it here, not later).
- Activity detail: photos, tags, hours, price, how to get there, what to bring, accessibility.
- Save, lists ("Rainy day", "With kids"), share-out (deep links + a decent OG preview).
- Reviews and photo contributions from users.
- **Assisted business claim:** owner emails/DMs you, you onboard them by hand. Do this
  manually for the first 100 businesses. It is the best product research available and it
  is how you learn exactly what the AI pipeline in Phase 3 must do.
- FR/EN throughout.
- Trust basics: report, block, moderation queue.

Does **not** ship: groups, self-serve business onboarding, user-created activities,
payments, personalization beyond stated interests.

**Success:** 10k installs in the launch city, 30% W4 retention, 5 saves/active user/month,
250 claimed businesses.

**Team:** 2 mobile, 1–2 backend, 1 designer (0.5), 1 city ops/curator (this role is not optional).

---

## Phase 2 — Outings & Rallies (months 5–9)

**Goal: turn discovery into attendance. This is the retention engine and the acquisition
engine at once.**

Ships:
- Outings: host, join, capacity, waitlist, guests, cancel, chat, reminders.
- **Rallies** (propose time windows → vote → auto-confirm at quorum). See [06](06-groups-and-outings.md).
- Friend invites, private outings, share-to-anywhere links.
- Attendance check-in, no-show handling, post-outing prompts.
- Full trust & safety stack: verification tiers, blocks that propagate, safety centre,
  emergency contact share, in-app reporting with SLA. **Non-negotiable before this ships.**
  See [08](08-trust-safety-and-moderation.md).
- Seeded outings: paid community ambassadors host 5–10 outings/week in the launch city for
  the first three months. Budget for this explicitly (~$2–4k/month). It is the only known
  cure for the empty room.

**Success:** 25% of MAU join ≥1 outing/month, ≥ 60% of Rallies reach quorum, no-show < 20%,
zero serious safety incidents.

**Team:** +1 backend, +0.5 community/trust ops.

---

## Phase 3 — Self-serve supply & AI enrichment (months 8–14, overlaps Phase 2)

Ships:
- **Business self-serve onboarding** via Meta / TikTok / Google Business OAuth + website URL
  + camera roll, with the AI enrichment pipeline and the owner review screen. Target:
  **under 5 minutes from "start" to "published", ≥ 90% of fields pre-filled.**
  See [07](07-supply-onboarding-and-ai.md).
- **User-created activities**, with dedup, moderation, and community editing.
- Business dashboard: views, saves, outings at your venue, click-to-directions, respond to reviews.
- Personalization (taste vectors, embeddings-based similarity, "more like this").
- Natural-language search ("something chill and cheap for a rainy Sunday with my mom").
- Monetization v1: Pro subscription, promoted placement (labeled). See [12](12-monetization-and-metrics.md).

**Success:** 60% of new listings arrive self-serve; AI-drafted fields accepted unedited
≥ 70% of the time; first $10k MRR.

---

## Phase 4 — Expansion (months 14–24)

- **A repeatable city playbook**: seed from open data → AI enrich → 200 hand-verified
  anchor activities → recruit 10 ambassadors → 50 claimed businesses → launch. Target
  4–6 weeks and < $15k per city. If a city takes more than that, the playbook isn't done
  and you should not expand.
- Transit isochrones ("reachable in 30 min by metro"), offline maps, Apple/Google Wallet
  passes for outings, widgets, Live Activities.
- Public web surface for SEO — this is a large organic acquisition channel and by then the
  catalog is worth indexing.
- Bookings/payments where operators want it; affiliate integrations.
- Migration off the phase-1 managed platform if cost curves demand it ([09](09-architecture.md)).

---

## What is deliberately out of scope, and why

| Deferred | Reason |
|---|---|
| Web app at launch | Splits a small team's effort; the value is mobile-and-local. Read-only SEO surface in Phase 4. |
| In-app payments / ticketing | Regulatory and support burden (refunds, chargebacks, tax). Link out until operators demand otherwise. |
| Full messaging / DMs between users | Enormous safety surface. Outing-scoped chat only, until moderation is mature. See [08](08-trust-safety-and-moderation.md). |
| Multi-day trips, itineraries | A different product. Lists cover 80% of it. |
| Recurring "clubs" / persistent groups | Meetup's model. Revisit once outings work — it's a natural Phase 4 extension of repeat co-attendance. |
| Tourist / international coverage | Dilutes density. See [01](01-product-and-market.md). |
| Ratings *of people* | Toxic and gameable. Attendance reliability + badges only. |

## Team shape

| Phase | Eng | Design | Ops/community | Total headcount |
|---|---|---|---|---|
| 0 | 2 | 0.25 | 0.5 (you) | ~2.5 |
| 1 | 3–4 | 0.5 | 1 | ~5.5 |
| 2 | 4–5 | 1 | 1.5 (incl. trust & safety) | ~7.5 |
| 3 | 5–6 | 1 | 2 | ~9 |

**Build vs buy:** buy auth, push, crash reporting, analytics, ID verification, email/SMS,
error tracking, and payments. Build the taxonomy, the ranking, the outing mechanics, the
enrichment pipeline, and the moderation tooling — those are the product. Self-host only
map tiles and (later) search, because those are precisely the two whose SaaS pricing
scales with users rather than with usefulness (see [10](10-cost-model.md)).
