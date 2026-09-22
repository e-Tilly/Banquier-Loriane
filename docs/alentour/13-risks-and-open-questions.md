# 13 — Risks & What To Do Next *(v2)*

All ten questions are answered ([CHANGELOG](CHANGELOG.md)). What remains is the risk picture
for a solo unfunded build — which is materially different from v1's.

## Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **R1** | **You lose interest or run out of evenings** | **High** | **Terminal** | The single most likely failure. Every stage ships something useful alone; kill-gate at month 3; `NEXT.md` so a 3-week gap doesn't cost a restart; no long-lived branches. |
| **R2** | **Supply too thin — "nothing near me"** | High | Severe | Two neighbourhoods only. 300–500 activities before anyone sees it. Density gate of 30/km² before widening. Never launch a borough you haven't filled. |
| R3 | **Catalog rots** — wrong hours, closed venues | High | High | "Report a problem" from day one, `last_verified_at` shown, 90-day owner nudges, auto-demote at 12 months |
| R4 | **A safety incident at an outing** | Low (constrained) | **Existential** | 18+, venue-anchored only, phone verification, max 8, fail-safe auto-pause on report, pause switch. Turning outings off is always available ([08](08-trust-safety-and-moderation.md)). |
| R5 | **Empty room — outings never reach quorum** | Medium | Moderate | Venue-anchored outings can't be empty by construction; AI concierge does the chasing ([06](06-groups-and-outings.md)). Lower stakes now that groups are a feature, not the point. |
| R6 | **Scope creep kills the timeline** | **High** | Severe | The cut list in [02](02-scope-and-roadmap.md) is a contract with yourself. Anything not on the current stage goes in a backlog file, not the app. |
| R7 | **A surprise AI bill** | Medium | Moderate | Hard spend alert on daily LLM cost. Batch API for all non-interactive work. Never an LLM call in a blocking request path. |
| R8 | **Taxonomy proves wrong after 500 listings** | Medium | Moderate | Versioned taxonomy, re-runnable enrichment, and Stage 1 exists specifically to find this out cheaply |
| R9 | **It drifts into a dating app** | Medium | Severe | 18–30 makes this *more* likely. Enforced in product, not policy ([06](06-groups-and-outings.md)). |
| R10 | **Burnout from moderation once UGC opens** | Medium | Moderate | Tune automated thresholds so the daily queue is 15 minutes. Accept false positives over an unbounded queue. |
| R11 | **Seasonality — a Montréal winter** | **Certain** | Moderate | Make it the feature: winter taxonomy, indoor-first ranking in January, winter shelves. Expect 2× summer / 0.6× winter and don't panic in February. |
| R12 | **ODbL contamination from OSM data** | Medium | Moderate | Overture (contains no OSM) as the base layer; OSM kept in a separate attributed layer ([07](07-supply-onboarding-and-ai.md), [11](11-legal-and-compliance.md)) |

**R1 is now the top risk, and it wasn't even on the v1 list.** For a funded team the danger is
building the wrong thing; for a solo part-time build the danger is simply stopping. The
staging in [02](02-scope-and-roadmap.md) is designed around that: something shippable at month
3, and no stage that requires finishing a later one to be worth anything.

---

## Your first two weeks

In order. Nothing here requires a line of app code.

1. **Draw the boundary.** Literally, on a map. Plateau + Mile End, or add Villeray. That polygon
   is your entire world for six months.
2. **Build the taxonomy in a spreadsheet** ([03](03-taxonomy.md)), then hand-tag **50 activities**
   inside the polygon. You will find five things wrong with the taxonomy. Finding them now is
   free; finding them at 2,000 listings is not.
3. **Pull the Overture Places extract** for Montréal and see what coverage actually looks like.
   Expect it to be good for businesses and poor for the free outdoor things people love —
   which tells you exactly where your manual effort goes.
4. **Set up the local Postgres with the real schema** ([04](04-data-model.md)) and the JSON
   export script. This is ~1 evening and it is the thing that makes Stage 1 backend-free
   without creating rework.
5. **Walk the neighbourhood for two hours with the spreadsheet open.** You will find things no
   database knows about. That gap *is* the product.
6. Register the Apple Developer account — it takes a few days to activate and it is on the
   critical path for TestFlight.

Do **not** yet: build the app shell, pick a state-management library, design a logo, set up
CI, write the onboarding flow, or apply for Meta API access.

---

## Decisions I'd revisit at specific moments

Not open questions — triggers to re-examine, so they don't get forgotten:

| When | Revisit |
|---|---|
| Catalog > 5,000 activities or JSON > 8 MB | Move the catalog behind an API, or split by neighbourhood cell ([09](09-architecture.md)) |
| > 50k MAU | Supabase Pro → managed Postgres; add Redis + candidate caching ([05](05-discovery-and-ranking.md)) |
| Outings live for 8 weeks with zero incidents | Consider relaxing venue-anchoring to user-chosen *public* venues |
| 500 businesses claimed | Launch Pro billing ([12](12-monetization-and-metrics.md)) |
| Moderation queue > 15 min/day | Tighten automated thresholds — do not absorb it |
| Someone offers to join you | Re-read v1 of this plan; most of what was cut becomes possible again |
| You stop enjoying it | Ship what exists, write the handover, stop. A good dictionary that exists beats a great app that doesn't. |
