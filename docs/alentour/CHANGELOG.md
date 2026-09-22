# Changelog

## v2 — 2026-09-22 — Rescoped for a solo, unfunded, part-time build

Ten questions answered. Seven changed the plan; two changed it fundamentally.

| # | Question | Answer | What changed |
|---|---|---|---|
| 1 | Groups: the point, or a feature? | **A feature** | Confirms dictionary-first. Outings move much later (Stage 5), which a solo build needs anyway. |
| 2 | Existing community? | **None. Audience: Montréal, 18–30** | No seed community, so supply-first is mandatory. Audience narrowing reshapes the taxonomy ([03](03-taxonomy.md)) and **sets minimum age 18**, which deletes the entire minor-safety burden. |
| 3 | Launch market | **Montréal, FR/EN** | Unchanged from v1. |
| 4 | Funding | **Side project. Free until launch, cheapest possible beta, no rework later** | **Rewrote the architecture and cost model.** New target: ~$10/mo pre-launch, ~$0 marginal at beta. See [09](09-architecture.md), [10](10-cost-model.md). |
| 5 | Who builds it | **Solo, free time** | **Rewrote the roadmap.** ~12 h/week capacity. MVP cut to its spine; v1 has no backend at all. See [02](02-scope-and-roadmap.md). |
| 6 | "1M users" | **Registered accounts** | ~1M registered ≈ 200–250k MAU. Cost at that scale drops from ~$7,900/mo to **~$2,000/mo**. |
| 7 | Accessibility | **One filter among many** | Demoted from headline feature: dropped the community-verification flow and the dedicated entry point. **Kept the tri-state schema and the AI prohibition** — they cost nothing and prevent real harm. See below. |
| 8 | Ambassadors | **AI, not paid humans** | Redesigned bootstrapping around an **AI concierge** plus **venue-anchored outings**. Hard constraint added: the AI never poses as an attendee. See [06](06-groups-and-outings.md). |
| 9 | Web presence | **Later** | Unchanged. |
| 10 | Brand | **Keep "Alentour"** | Unchanged. |

### The two structural changes

**v1 has no backend.** At 300–2,000 activities the whole catalog is 2–5 MB of JSON. Ship it
as a file on Cloudflare R2, filter on-device. No database, no API, no server, no auth — and
it scales to ~100k users inside free tiers. You add a backend at Stage 2, when accounts
arrive, not before. The JSON is *generated from* the Postgres schema in [04](04-data-model.md),
so this is a deferral, not a detour.

**The cheap stack and the scalable stack are the same stack.** Postgres + R2 + MapLibre are
free at zero users and ~$2k/month at a million registered accounts. Nothing in the v1 build
gets thrown away — the single migration in the whole plan is Supabase → self-managed
Postgres, which is a `pg_dump`. See [09](09-architecture.md) § No-rework guarantees.

### Two things I kept against the answers

Both cost roughly nothing and remove real downside. Overrule either if you disagree.

1. **Accessibility is demoted in the UI but not in the schema.** Tri-state (`true`/`false`/
   `unknown`) stays, and the rule that AI may never assert accessibility stays. Retrofitting
   tri-state later is a migration across every listing; and a wrongly-claimed step-free
   entrance strands somebody. The *work* I dropped is the community-verification flow, the
   14-tag facet (now 6), and the dedicated filter entry point.
2. **The three-entity schema (venue / activity / outing) ships in Stage 1** even though
   outings don't exist until Stage 5. Empty tables are free; re-modelling a live catalog is
   not.
