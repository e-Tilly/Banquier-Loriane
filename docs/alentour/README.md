# Alentour — Product & Technical Plan

> **v2 — rescoped for a solo, unfunded, part-time build.** See [CHANGELOG](CHANGELOG.md) for
> what changed from v1 and why. "Alentour" (FR: *around, nearby*) remains a placeholder name.

A mobile app that answers one question well: **"What can I actually go do near me?"** — and
later, a second one: **"...and who will come with me?"**

## The one-paragraph pitch

A browsable, filterable dictionary of everything there is to do around you — from a kayak
launch to a Tuesday pottery class to a free lookout at sunset — where every entry is tagged
deeply enough that you can say "cheap, indoors, under two hours, tonight, reachable by metro"
and get a real answer. Later, from any entry, an AI concierge can gather a few people who
saved the same thing and turn it into an actual plan on an actual date.

## Documents

| # | Document | What it settles |
|---|---|---|
| — | [Changelog](CHANGELOG.md) | v1 → v2: your ten answers and their consequences |
| 01 | [Product & market](01-product-and-market.md) | Audience (Montréal, 18–30), differentiation, competitors |
| 02 | [Scope & roadmap](02-scope-and-roadmap.md) | **Six stages, ~12 h/week, 18 months. Start here.** |
| 03 | [Taxonomy & tags](03-taxonomy.md) | The filter system — the heart of the product |
| 04 | [Data model](04-data-model.md) | Entities, schema, the venue/activity/outing split |
| 05 | [Discovery & ranking](05-discovery-and-ranking.md) | Feed, filters, weather-aware ranking, cold start |
| 06 | [Groups & outings](06-groups-and-outings.md) | AI concierge, venue-anchored outings, the Rally |
| 07 | [Supply & AI enrichment](07-supply-onboarding-and-ai.md) | Seeding the catalog, business onboarding, UGC |
| 08 | [Trust & safety](08-trust-safety-and-moderation.md) | Constraint instead of staffing |
| 09 | [Architecture](09-architecture.md) | **The free stack, and the no-rework guarantees** |
| 10 | [Cost model](10-cost-model.md) | ~$10/mo to launch → ~$2,000/mo at 1M registered |
| 11 | [Legal & privacy](11-legal-and-compliance.md) | Law 25, liability, data licensing |
| 12 | [Monetization & metrics](12-monetization-and-metrics.md) | Side-project economics, five numbers to watch |
| 13 | [Risks & next steps](13-risks-and-open-questions.md) | **What to do in your first two weeks** |
| 14 | [Outreach agent](14-outreach-agent.md) | The AI ambassador that writes to businesses, within CASL |
| 15 | [Deploy & operate](15-deploy-and-operate.md) | **Putting it online, stage by stage, and the 15-minute daily routine** |

**Implementation status:** all six stages are built in [`alentour/`](../../alentour/) — see its
[README](../../alentour/README.md). What remains is not code: curation, the lawyer review, store
accounts, and the stage gates in [12](12-monetization-and-metrics.md).

---

## Executive summary

**You are one person with ~12 hours a week and no budget.** That constraint, not the product
vision, determines the plan. The v1 scope was ~20 person-months — five years at this pace. So
the product is cut to its spine and grown one organ at a time, with something shippable at
month 3 and a kill signal before you've spent a year.

**Six decisions that carry the plan:**

1. **Stage 1 has no backend.** 300–2,000 activities is 2–5 MB of JSON. Ship it on Cloudflare
   R2, filter on-device. No database, no API, no auth, no ops — and it serves ~100k users
   inside a free tier. It is a deferral rather than a detour because that JSON is generated
   from the same Postgres schema you'll eventually put online. ([09](09-architecture.md))

2. **The cheap stack and the scalable stack are the same stack.** Postgres + R2 + MapLibre
   cost $0 at zero users and ~$2,000/month at a million registered accounts. The only planned
   migration in the whole plan is Supabase → self-managed Postgres, which is a `pg_dump`.

3. **Three entities, never collapsed: venue → activity → outing.** A community centre is one
   venue and eight activities; an outdoor rink is one activity at forty venues. The tables
   ship empty in Stage 1 because re-modelling a live catalog later touches everything.
   ([04](04-data-model.md))

4. **A closed, versioned tag vocabulary — never free text.** Stable slugs, FR/EN labels,
   provenance and confidence on every assignment. The AI writes *into* the enum via
   constrained structured outputs, so it cannot invent a tag. ([03](03-taxonomy.md))

5. **Seed from Overture Maps, not Google Places.** Google's terms forbid caching name,
   address, hours, rating and photos — every render re-bills. Overture's places theme is
   CDLA-Permissive 2.0 with no share-alike. ([07](07-supply-onboarding-and-ai.md))

6. **AI concierge organizes; it never attends.** It spots that six people nearby saved the
   same climbing gym, writes the invites, chases the maybes, picks the slot, sends logistics
   and weather. It is never listed as an attendee and never counts toward quorum — fabricated
   social proof would end the product the first time three people waited for two who don't
   exist. Paired with **venue-anchored outings** (attach to things that already happen), this
   replaces the ambassador budget entirely, at under $50/month. ([06](06-groups-and-outings.md))

**Timeline:** ~3 months to a shippable catalog in two neighbourhoods · ~11 months to a dense
Montréal catalog with self-serve business onboarding · ~18 months to outings.

**Cost:** ~$10/month plus ~$230 one-time to reach a working beta. The only irreducible costs
are Apple's $99/year and Google's $25.

---

## Confirmed parameters

| # | Parameter | Value | Consequence |
|---|---|---|---|
| P1 | Market | **Montréal**, FR/EN | Bilingual from the first row; Law 25; Bill 96; heavy winter seasonality |
| P2 | Audience | **18–30** | Reshapes taxonomy emphasis; **minimum age 18 removes the entire minor-safety burden** |
| P3 | Builder | **Solo, ~12 h/week** | Six stages; ruthless cut list; resumability over velocity |
| P4 | Budget | **~$0 pre-launch, minimal at beta, no rework** | Free-tier stack that is also the scale stack |
| P5 | Scale target | **1M registered** (≈220k MAU) | ~$2,000/month at that point |
| P6 | Groups | **A feature, not the point** | Dictionary first; outings at Stage 5 |
| P7 | Ambassadors | **AI, never human-simulating** | Concierge + venue-anchored outings |
| P8 | Accessibility | **One filter among many** | UI demoted; tri-state schema and the AI prohibition kept |
| P9 | Web | **Later** | Mobile-only through Stage 6 |
| P10 | Brand | **Placeholder "Alentour"** | — |

---

## If you have 15 minutes

[02 Roadmap](02-scope-and-roadmap.md) → [09 Architecture](09-architecture.md) §Stage 1 →
[13 Next steps](13-risks-and-open-questions.md). The rest is reference for when you get there.
