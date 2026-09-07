# Alentour — Product & Technical Plan

> **Working codename.** "Alentour" (FR: *around, nearby*) is a placeholder. Replace it
> everywhere before you buy a domain or file a trademark.

A mobile app that answers one question well: **"What can I actually go do near me?"** —
and then a second one that no competitor answers well: **"...and who will come with me?"**

---

## The one-paragraph pitch

A browsable, filterable dictionary of everything there is to do around you — from a
kayak launch to a Tuesday pottery class to a free lookout at sunset — where every entry
is tagged deeply enough that you can say "cheap, indoors, under two hours, easy, tonight,
wheelchair accessible, reachable by metro" and get a real answer. Then, from any entry,
you can propose a date and let strangers and friends join, so discovery turns into a
plan that actually happens.

## Documents

| # | Document | What it settles |
|---|---|---|
| 01 | [Product & market](01-product-and-market.md) | Who it's for, what's differentiated, who we're up against, why now |
| 02 | [Scope & roadmap](02-scope-and-roadmap.md) | What ships in what order, team, timeline |
| 03 | [Taxonomy & tags](03-taxonomy.md) | The filter system — the heart of the product |
| 04 | [Data model](04-data-model.md) | Entities, schema, the activity/venue/outing split |
| 05 | [Discovery, search & ranking](05-discovery-and-ranking.md) | The feed, filters, personalization, cold start |
| 06 | [Groups & outings](06-groups-and-outings.md) | The meet-people feature, incl. the quorum mechanic |
| 07 | [Supply: onboarding & AI](07-supply-onboarding-and-ai.md) | Business signup from social profiles, AI enrichment, UGC |
| 08 | [Trust, safety & moderation](08-trust-safety-and-moderation.md) | Strangers meeting strangers; content quality |
| 09 | [Architecture & stack](09-architecture.md) | Concrete tech choices and why |
| 10 | [Cost model to 1M users](10-cost-model.md) | Itemized $ at 10k / 100k / 1M MAU, and the traps |
| 11 | [Legal & compliance](11-legal-and-compliance.md) | Privacy, Law 25/GDPR, liability, data licensing |
| 12 | [Monetization & metrics](12-monetization-and-metrics.md) | Revenue lines, unit economics, north star |
| 13 | [Risks & open questions](13-risks-and-open-questions.md) | What kills this, and what I need from you |

---

## Executive summary

**The hard part is not the app. It is supply density in one neighbourhood, and the
empty-room problem on group outings.** Everything in this plan is arranged around those
two risks. The engineering is well-understood; the marketplace is not.

**Five decisions that carry the whole plan:**

1. **Three entities, not one.** A *venue* (Parc Jean-Drapeau), an *activity* (kayaking
   at Parc Jean-Drapeau), and an *outing* (kayaking there, Saturday 2pm, 6 spots, 3
   taken). Most competitors collapse these and end up unable to answer either question.
   See [04](04-data-model.md).

2. **A closed, versioned tag vocabulary — never free text.** ~14 facets, every tag with
   a stable slug, FR/EN labels, a provenance (`owner` / `ai` / `community` / `derived`)
   and a confidence. The AI writes tags *into this enum* via structured outputs, so it
   cannot invent "kinda sporty". See [03](03-taxonomy.md).

3. **Seed the catalog from Overture Maps Places, not Google Places.** Google's terms
   forbid caching most Place fields, so a catalog built on it is re-billed on every
   render — economically fatal at 1M users. [Overture's places theme](https://docs.overturemaps.org/guides/places/)
   is CDLA-Permissive 2.0 with no share-alike, ~61M POIs. Use Google only for
   owner-facing address autocomplete during onboarding. See [07](07-supply-onboarding-and-ai.md)
   and [10](10-cost-model.md).

4. **The "Rally" solves the empty room.** Nobody joins an outing with 0 attendees. So
   the default group flow is not "pick a time and hope" — it is: propose 2–4 time
   windows, set a minimum headcount and a decision deadline, and the outing
   *auto-confirms or auto-cancels*. Voting on availability is a much lower-commitment
   act than joining an empty event, and it converts. See [06](06-groups-and-outings.md).

5. **Own the cost curve from day one: R2 + MapLibre/Protomaps + Postgres.** Image
   egress, map tiles, and per-document reads are what make apps like this cost
   $60k/month at 1M users. With the stack in [09](09-architecture.md) the same load
   lands around **$6–12k/month**. See [10](10-cost-model.md) for the arithmetic.

**Timeline:** ~8 weeks to a validation build in one neighbourhood, ~5 months to public
MVP in one city, ~8 months to groups shipped, ~12 months to self-serve business
onboarding and first revenue. See [02](02-scope-and-roadmap.md).

---

## Stated assumptions

I made these calls so the plan could be concrete. Each is cheap to change now and
expensive to change later — correct me where I'm wrong (see [13](13-risks-and-open-questions.md)).

| # | Assumption | Why it matters |
|---|---|---|
| A1 | **Launch market: Montréal / Québec**, expanding to the rest of Canada then EU | Drives bilingual-from-day-one, Law 25, Bill 96, and heavy winter seasonality |
| A2 | **Bilingual FR/EN is a launch requirement, not a phase 2 i18n pass** | Quebec's Charter of the French Language; also forces the taxonomy to be i18n-clean from the first row |
| A3 | **iOS + Android, no web app at launch** (a public read-only web surface comes later for SEO) | Justifies React Native/Expo over separate native codebases |
| A4 | **Small team: 3–5 engineers**, not 15 | Rules out microservices, custom infra, and anything requiring a dedicated SRE |
| A5 | **Consumer-free, business-paid.** Users never pay to browse or to join a free outing | Shapes monetization and the cost ceiling per user |
| A6 | **Minimum age 16; hosting an outing requires 18+** | Drives verification, moderation, and alcohol/venue tag rules |
| A7 | **"1M users" = 1M monthly actives**, ~30% DAU, seasonal peaks 2× in summer | The cost model is built on this; if it means 1M registered, every number drops ~3× |

---

## How to read this if you have 20 minutes

[README](README.md) → [03 Taxonomy](03-taxonomy.md) → [06 Groups](06-groups-and-outings.md)
→ [10 Cost model](10-cost-model.md) → [13 Open questions](13-risks-and-open-questions.md).

The rest is reference.
