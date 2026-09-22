# 02 — Scope & Roadmap *(v2: solo, part-time, unfunded)*

## The constraint that determines everything

**One person, ~12 hours a week, no budget.**

The v1 plan was roughly 20 person-months of work. At 12 h/week that is about five years.
AI-assisted coding is a real multiplier on *implementation* — maybe 2× — but zero on product
decisions, catalog curation, moderation, and App Store review. So the answer is not to code
faster. It is to **cut the product to its spine and add one organ at a time**, with each
stage shippable and useful on its own.

Rule for every stage below: *if it can be deferred without causing rework, defer it.*

---

## Stage 1 — The catalog, with no backend *(months 1–3, ~140 h)*

**Ship a beautiful, offline-capable activity dictionary for two neighbourhoods. Nothing else.**

The insight that makes this tractable: **300–2,000 activities is 2–5 MB of JSON.** You do not
need a database, an API, a server, or auth to ship a filterable catalog. You need a file.

```
  Local Postgres (your laptop)      ← the real schema from doc 04, authored once
        │  export script
        ▼
  catalog.fr.json / catalog.en.json  (~3 MB, gzipped ~700 KB)
  tiles: montreal.pmtiles            (~200 MB, built once from OSM)
        │  upload
        ▼
  Cloudflare R2 + CDN  ──────►  Expo app: on-device filter, on-device map
```

- **On-device filtering** is instant, works with no signal, and has no per-user cost.
- **The app scales to ~100k users inside R2's free tier**, because it is a static file behind
  a CDN. There is no request that can get slower.
- **Updating the catalog = uploading a file.** No deploy, no migration, no downtime.
- **Zero rework**, because the JSON is generated *from* the Postgres schema in
  [04](04-data-model.md). When Stage 2 needs a live database, that database already exists —
  you just put it online.

**In scope:** browse feed, vibe/context shelves, map, filters, activity detail, saves (device-
local), lists, share links, FR/EN.
**Out:** accounts, backend, UGC, business onboarding, outings, reviews, personalization, AI in
the app.

**Catalog:** 300–500 activities across **Plateau / Mile End / Villeray**, built by you with AI
assistance (see [07](07-supply-onboarding-and-ai.md)). Budget ~30 h of curation; it is the
most valuable work in the project and it is where you discover the taxonomy is wrong.

**Ship to:** TestFlight + Google Play internal testing, 30–80 people from local subreddits,
Facebook groups, university housing, Discord servers.

**Kill/continue gate:** ≥35% apply a filter · ≥25% return in week 2 · ≥15% save something ·
10 interviews where someone says "I went and did it."

**Cost: ~$10/month** (Apple Developer, amortized) plus ~$130 of one-time AI seeding.

---

## Stage 2 — Accounts & sync *(months 4–5, ~90 h)*

The first backend, and only because saved lists that die with a reinstall are infuriating.

- Supabase free tier: auth (Apple / Google), saves, lists, sync.
- The catalog **stays a static JSON file** — do not put it behind an API just because you now
  have a database. Serving 2,000 rows per request to do work the phone already does for free
  is a downgrade.
- Analytics (PostHog free tier) so Stage 3 decisions are evidence-based.

**Cost: still ~$10/month.**

---

## Stage 3 — Business claims, done by hand *(months 6–8, ~90 h)*

- A "claim this listing" form → an email to you → you verify and edit.
- **Do the first 50 manually.** It is unglamorous and it is the best product research
  available: you will learn exactly what the Stage 4 AI pipeline has to do, in a way no
  amount of design thinking gets you.
- A minimal owner-facing edit page (a web form, not an app). Owner dashboard can wait.

---

## Stage 4 — AI enrichment & catalog scale-up *(months 8–11, ~110 h)*

- The enrichment pipeline from [07](07-supply-onboarding-and-ai.md), run as a batch job on
  your laptop against the Batch API — not as a live service.
- Scale to **2,000–3,000 activities across central Montréal**.
- Self-serve business onboarding via website-URL + photo upload. **Social OAuth import comes
  later** — Meta app review is weeks of calendar time for a feature that serves a minority of
  owners at this stage.
- Catalog freshness loop: 90-day owner nudges, "report a problem", auto-demote stale listings.

**Cost: ~$60–100/month** once there are real users.

---

## Stage 5 — Outings, with the AI concierge *(months 12–18, ~160 h)*

The group feature. Deferred this far on purpose: it needs a dense catalog, a real user base,
and a safety stack, and it is the only part of the product that can hurt someone.

Ships with **hard constraints that substitute for the staffing you don't have**
([06](06-groups-and-outings.md), [08](08-trust-safety-and-moderation.md)):

- **18+ only** — your audience anyway, and it deletes the entire minor-protection burden.
- **Venue-anchored only** — an outing can only attach to a listed public venue. No
  user-chosen meeting points at all in v1. One constraint, a whole class of risk gone.
- **Phone verification required** to join. Max 8 people. Blocks enforced in the query.
- **Fail-safe reporting:** a report auto-pauses the outing pending your review, rather than
  waiting for a human to be awake.
- **AI concierge** does the organizing; it is never an attendee.

---

## Stage 6 — UGC & revenue *(months 18–24)*

User-created activities (after moderation exists, not before), Pro subscriptions, promoted
placement. See [12](12-monetization-and-metrics.md).

---

## Timeline summary

| Stage | Months | ~Hours | Ships | Monthly cost |
|---|---|---|---|---|
| 1 — Catalog, no backend | 1–3 | 140 | Filterable dictionary, 2 neighbourhoods | ~$10 |
| 2 — Accounts & sync | 4–5 | 90 | Saves that survive | ~$10 |
| 3 — Manual claims | 6–8 | 90 | Real businesses on board | ~$15 |
| 4 — AI enrichment | 8–11 | 110 | 3,000 activities, self-serve onboarding | ~$60–100 |
| 5 — Outings + concierge | 12–18 | 160 | The group feature | ~$150 |
| 6 — UGC & revenue | 18–24 | — | First money | ~$250 |

**~18 months to a product with groups.** That is the honest number for 12 h/week. Every stage
before it is independently useful, which means you can stop at any point and still have
shipped something real — and you get a kill signal at month 3, not month 30.

---

## What "side project" changes about the work itself

- **Optimize for resumability, not velocity.** You will lose three weeks to life. Small
  commits, a `NEXT.md` with the next three tasks, no half-finished refactors, tests on the
  taxonomy export so a stale catalog can't ship silently.
- **Never block on someone else.** Meta app review, Google Business Profile access, and
  partner integrations all have multi-week queues you don't control. Nothing on the critical
  path may depend on them — hence website-URL onboarding first.
- **Buy every hour you can.** Managed auth, managed Postgres, off-the-shelf components. Your
  scarce resource is hours, not dollars — and at this scale the dollars are ~$10/month anyway.
- **The catalog is the product, and it is not code.** Budget real, recurring, non-coding time
  for curation. A solo founder who only writes code will ship an empty app.

## What is cut versus v1, and why

| Cut | Reason |
|---|---|
| Paid ambassadors | Replaced by AI concierge + venue-anchored outings ([06](06-groups-and-outings.md)) |
| City ops role, multi-city expansion | No team. One city is the whole plan for two years. |
| Accessibility as headline feature | Per your answer. Schema kept, UI demoted ([03](03-taxonomy.md)) |
| Community accessibility verification | Needs a user base you won't have for a year |
| Typesense, Redis, read replicas, Centrifugo | Unnecessary below ~50k MAU. Postgres does all of it. |
| Social OAuth import at launch | Weeks of app review on someone else's calendar |
| Transit isochrones | Genuinely great, genuinely expensive. Stage 6+. |
| Web surface | Per your answer |
| 24/7 moderation triage | Impossible solo — replaced by constraint and fail-safe defaults |
