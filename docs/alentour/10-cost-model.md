# 10 — Cost Model *(v2: free start → 1M registered accounts)*

> List prices as of September 2026 — re-verify before committing. The *shape* of the analysis
> is more durable than the numbers.

**Scale target restated:** you clarified 1M means **registered accounts**, not monthly actives.
At a typical 20–25% monthly-active ratio for a local discovery app, 1M registered ≈ **200–250k
MAU**. Every figure below is computed on that basis, which is why the top-end number dropped
from v1's $7,900/month to **~$2,000/month**.

---

## What it costs to get to launch

| Item | Cost | Note |
|---|---|---|
| Apple Developer Program | **$99/year** | Unavoidable for TestFlight and the App Store |
| Google Play Developer | **$25 once** | Unavoidable |
| Domain | ~$12/year | Optional until you have a name |
| Cloudflare R2 | **$0** | 10 GB storage + 10M reads/month free |
| Supabase | **$0** | Free tier; not needed at all until Stage 2 |
| Expo / EAS | **$0** | Free tier builds, or build locally |
| PostHog, Sentry | **$0** | Free tiers are generous |
| Map tiles | **$0** | Build `montreal.pmtiles` once with planetiler, host on R2 |
| AI catalog seeding (500 activities) | **~$70–130 one-time** | Batch API at 50% off; see below |
| **Total to a working beta** | **≈ $10/month + ~$230 one-time** | |

**The whole pre-launch phase costs less than a phone plan.** The only irreducible costs are
Apple's and Google's, and they are the price of shipping a mobile app at all.

### Why AI seeding is the only real pre-launch spend

| Pass | Model | Per activity |
|---|---|---|
| Media triage | Haiku 4.5 ($1/$5 per MTok) | ~$0.04 |
| Structured extraction | Opus 5 ($5/$25 per MTok) | ~$0.14 |
| FR + EN copy | Opus 5 | ~$0.09 |
| **Interactive total** | | **~$0.27** |
| **Via Batch API (50% off), non-interactive** | | **~$0.14** |

500 activities × $0.14 ≈ **$70**. Cut it further by running extraction on Haiku for the
straightforward listings and reserving Opus for ambiguous ones, and by caching the taxonomy +
system prompt with `cache_control` — it's the same ~4k tokens on every call.

Compare: doing this by hand well is 20–40 min per listing. At 500 listings that is ~250 hours
you do not have. **This is the single highest-value dollar in the plan** — it converts money
you barely have into time you have even less of.

---

## Cost as it grows

| | Beta (~300 users) | Launch (~10k MAU) | 100k reg. (~25k MAU) | **1M reg. (~220k MAU)** |
|---|---|---|---|---|
| Database / platform | $0 (free tier) | $25 (Supabase Pro) | $90 | $750 |
| Compute / API | $0 | $0 | $40 | $250 |
| Storage + egress (R2) | $0 | $1 | $8 | $35 |
| Map tiles | $0 | $0 | $2 | $15 |
| AI — enrichment | ~$5 | $25 | $90 | $350 |
| AI — moderation + concierge | $0 | $8 | $45 | $200 |
| Analytics + errors | $0 | $0 | $40 | $150 |
| SMS / phone verification | $0 | $10 | $60 | $250 |
| **Total / month** | **~$10** | **~$70** | **~$375** | **~$2,000** |
| **Per registered account** | — | — | $0.0038 | **$0.002** |

Note the direction: **unit cost falls as you grow**, because most of the bill is fixed floors
and cacheable work. That only holds because nothing in the stack is priced per user.

### The honest caveat

**Infrastructure is not the binding constraint — your time is, and moderation is.** At 220k
MAU with user-generated content and in-person meetups, a funded company would staff 2–4
moderators. You cannot. That is why [06](06-groups-and-outings.md) and
[08](08-trust-safety-and-moderation.md) replace staffing with *constraint*: 18+, venue-anchored
outings, small caps, phone verification, and reports that auto-pause rather than queue. If
outings ever outgrow what you can personally review, turning them off is a legitimate and
correct decision — the dictionary carries no such exposure.

---

## The traps that would break the "cheap" promise

Each of these is a dependency whose price scales with *users* rather than *usage* — the exact
thing a free side project cannot absorb.

| # | Trap | What it would cost you | Instead |
|---|---|---|---|
| 1 | **Google Places as the catalog** | Terms forbid caching name, address, hours, rating, photos — every render re-bills at ~$35–40/1,000 Enterprise requests | Overture Maps Places (CDLA-Permissive, no share-alike) + OSM + municipal open data |
| 2 | **Mapbox / Google Maps mobile SDK** | Billed **per monthly active user**; free tier ends at 25k | MapLibre + self-hosted Protomaps: flat ~$0 |
| 3 | **Firebase / Firestore** | A 50-card feed is 50 document reads; also a genuine rewrite to escape | Postgres — one query, same 50 rows |
| 4 | **Image egress on S3/CloudFront** | ~$0.085/GB; media is the line that grows fastest | R2: $0 egress |
| 5 | **Algolia / hosted search** | Priced per search | On-device search, then Postgres FTS |
| 6 | **An LLM in the user-facing path** | Natural-language search on every query is four figures/month at modest scale | Cache by normalized query, gate to misses, queue everything else. **No LLM call ever blocks a user request.** |
| 7 | **Per-connection realtime SaaS** | Priced per concurrent socket | Postgres-backed chat + push. Outing chat doesn't need sockets. |
| 8 | **Supabase unified egress** | DB + storage + auth egress share one quota (250 GB on Pro, then ~$0.09/GB) | Media never touches Supabase — it's on R2 |

Traps 1, 2, and 3 are the ones that are **unwindable later**. Avoiding them now costs nothing;
escaping them at 50k users costs months you don't have.

---

## Levers if it ever gets tight

- **Batch API for everything non-interactive** — 50% off, and enrichment is always non-interactive.
- **Prompt caching** on the taxonomy + system prompt across enrichment calls.
- **Haiku 4.5 for volume, Opus 5 for judgment.** Don't run Opus on image triage or moderation.
- **Alert on daily AI spend.** A bad loop can burn a month's budget in an afternoon — this is
  the single most likely way a side project gets a surprise bill.
- **Hetzner** for any self-hosted piece: 3–5× cheaper than hyperscalers for the same cores.

## Sources

- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing) — $0.015/GB-month, **no egress fees**, 10 GB free
- [Supabase pricing](https://supabase.com/pricing) — Free / Pro $25; free tier pauses after 1 week idle; 250 GB egress on Pro then ~$0.09/GB
- [Mapbox pricing](https://www.mapbox.com/pricing) — mobile maps billed per MAU, 25k free
- [Google Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies) — caching prohibition
- [Overture Maps Places](https://docs.overturemaps.org/guides/places/) — CDLA-Permissive 2.0
- Anthropic API — Opus 5 $5/$25 per MTok, Haiku 4.5 $1/$5 per MTok; [Batches](https://platform.claude.com/docs/en/build-with-claude/batch-processing) at 50%
