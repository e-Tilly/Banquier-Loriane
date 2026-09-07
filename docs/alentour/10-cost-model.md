# 10 — Cost Model to 1M Users

> **All prices are list prices as of September 2026 and should be re-verified before you
> budget against them.** Sources are linked at the bottom. The *shape* of the analysis —
> which lines dominate and why — is more durable than the numbers.

## Traffic assumptions

| Assumption | Value | Note |
|---|---|---|
| MAU | 1,000,000 | Monthly *active*, not registered |
| DAU / MAU | 30% | 300k DAU |
| Sessions / MAU / month | 20 | |
| Total sessions / month | 20M | |
| API calls / session | 15 | 300M requests/month ≈ **115 rps average, ~600 rps peak** |
| Images viewed / session | 40 | Feed cards + detail galleries |
| Avg delivered image size | 60 KB | WebP, correctly sized variants |
| **Image egress / month** | **48 TB** | 20M × 40 × 60 KB — *the number that decides your bill* |
| Map tile loads / session | 25 | Only sessions that open the map |
| Catalog size | 500k activities, 4M photos | ~2 TB stored after variants |
| Outing messages / month | ~1M | |

---

## The itemized bill at 1M MAU

| Line | Choice made here | $/month | The naive alternative | $/month |
|---|---|---|---|---|
| **Image egress + storage** | Cloudflare R2 ($0 egress) + CDN; 2 TB stored @ $0.015/GB | **~$60** | S3 + CloudFront @ ~$0.085/GB × 48 TB | **~$4,100** |
| **Map tiles** | Self-hosted Protomaps `.pmtiles` on R2 + MapLibre | **~$50** | Mapbox mobile SDK, billed **per MAU** | **~$3,000+** |
| **Database** | Managed Postgres, 16 vCPU / 64 GB primary + 2 replicas | **~$2,200** | Firestore at ~50 doc reads per feed load | **~$15,000+** |
| **API compute** | 8–12 × 1 vCPU containers, autoscaled (Fly/Hetzner) | **~$500** | Overprovisioned managed platform | ~$1,500 |
| **Redis** | 16 GB managed | **~$200** | | |
| **Search** | Typesense self-hosted, 3 × 8 GB nodes | **~$250** | Algolia at ~50M searches/mo | **~$8,000+** |
| **Realtime (outing chat)** | Centrifugo self-hosted, 2 nodes | **~$120** | Pusher/Ably per-connection | **~$2,500** |
| **Push notifications** | FCM / APNs direct | **$0** | Paid push vendor | ~$1,000 |
| **Object ops (R2 class A/B)** | ~50M class B @ $0.36/M, 5M class A @ $4.50/M | **~$40** | | |
| **AI — moderation** | Haiku 4.5, ~1M items × 250 tok in @ $1/MTok | **~$300** | Opus on everything | ~$1,500 |
| **AI — enrichment** | ~5k new/updated listings/mo × $0.27 | **~$1,350** | Human curation @ $10 each | ~$50,000 |
| **AI — NL search** | Haiku, 80% cache hit, ~5% of sessions | **~$250** | LLM on every search | **~$15,000** |
| **Embeddings** | Voyage, incremental re-embedding only | **~$50** | | |
| **Analytics** | PostHog self-hosted | **~$300** | PostHog/Amplitude cloud at 500M events | ~$3,000 |
| **Error tracking, logs, monitoring** | Sentry + Grafana Cloud + Better Stack | **~$400** | | |
| **Email / SMS** | ~500k OTP+transactional | **~$500** | | |
| **ID verification** | ~5k checks/mo @ $1.25 | **~$625** | | |
| **App stores, EAS, misc SaaS** | | **~$400** | | |
| **INFRA SUBTOTAL** | | **≈ $7,600/mo** | | **≈ $60,000+/mo** |
| | | | | |
| **Trust & safety staffing** | 8–12 FTE or outsourced | **$40k–70k** | *not optional* | |
| **City ops / ambassadors** | ~10 active cities | **$20k–40k** | | |

### Read this twice

**Infrastructure is ~$0.008 per MAU per month. Humans are ~$0.06–0.10.** The interesting
cost question for this business is not servers — it is moderation and city operations.
Getting the infra choices right takes it from "a line item that could kill you" to "a
rounding error", and then the real work is making trust & safety and city launches efficient.

At **~$0.09/MAU/month all-in**, you need roughly **$1.10/MAU/year** in revenue to break even
on operations before salaries. That is very achievable with the B2B model in [12](12-monetization-and-metrics.md)
— but only if the infra choices above are made at the start, because retrofitting them
under load is a rewrite.

---

## Cost at each stage

| | 10k MAU | 100k MAU | 1M MAU |
|---|---|---|---|
| Platform / DB | $75 (Supabase Pro + compute) | $600 | $2,900 |
| Compute + Redis | $50 | $250 | $700 |
| Storage + egress (R2) | $10 | $30 | $100 |
| Map tiles | $10 | $25 | $50 |
| Search | $0 (Postgres FTS) | $80 | $250 |
| Realtime | $0 | $40 | $120 |
| AI (all) | $200 (seeding-heavy) | $600 | $1,950 |
| Analytics + observability | $50 | $250 | $700 |
| Comms + verification | $50 | $300 | $1,125 |
| **Infra total** | **≈ $450/mo** | **≈ $2,200/mo** | **≈ $7,900/mo** |
| Per MAU | $0.045 | $0.022 | $0.008 |

Note the direction: **unit cost falls ~5× from 10k to 1M**, because most of the bill is
fixed floors and cacheable work. That's the shape you want, and it's only that shape because
nothing here is billed per user.

---

## The nine cost traps

Ranked by how much money they've cost comparable products.

1. **Google Places as the catalog.** Their terms bar caching most Place fields, so every
   render re-bills at **$35–40 per 1,000** Enterprise requests. A 300M-render month is
   arithmetic you don't want to do. → Overture Places as the base; Google only for owner
   address autocomplete. ([07](07-supply-onboarding-and-ai.md))
2. **Mapbox/Google Maps mobile SDK billed per MAU.** The one pricing axis that scales
   precisely with your growth metric. Mapbox's free tier is 25k mobile MAU. → MapLibre +
   self-hosted Protomaps tiles: essentially flat.
3. **Image egress on S3/CloudFront.** 48 TB/month at ~$0.085/GB ≈ $4,100. → R2's $0 egress
   makes it ~$60. **Single highest-leverage decision in the stack.**
4. **Firestore/DynamoDB per-document reads for a feed.** A 50-card feed = 50 reads. 300M feed
   loads = 15 *billion* reads/month. One Postgres query returns the same 50 rows. → Relational.
5. **Search SaaS priced per query.** 50M searches/month on Algolia is five figures. →
   Postgres FTS, then self-hosted Typesense.
6. **Per-connection realtime SaaS.** 300k DAU with an open socket is a large bill for a chat
   feature almost nobody uses. → Self-host, and don't hold sockets open for users who aren't
   in an active outing.
7. **An LLM in the user-facing hot path.** NL search on every query ≈ $15k/month; enrichment
   done synchronously multiplies it. → Cache, gate, queue. ([05](05-discovery-and-ranking.md))
8. **Unified egress quotas.** Supabase pools DB + storage + auth + functions egress into one
   quota (250 GB on Pro, then ~$0.09/GB). Serving media through it is the expensive path. →
   Media never touches the platform; it goes to R2.
9. **Geocoding on every keystroke.** Autocomplete without debounce + cache multiplies calls
   by ~8. → 300ms debounce, cache by prefix, self-host if volume justifies it.

## Levers if you need to cut further

- **Hetzner instead of hyperscalers** for stateless compute and self-hosted services: often
  3–5× cheaper for the same cores. Keep Postgres managed (backups and failover are worth
  paying for).
- **Batch API for all non-interactive AI** — 50% off, and enrichment is *always* non-interactive.
- **Prompt caching** on the taxonomy + system prompt (identical ~4k tokens on every
  enrichment call) — a large fraction of enrichment input tokens becomes cache reads.
- **Effort tuning:** `effort: medium` for triage and classification, `high` only for
  extraction and copywriting. Measure before assuming you need `high` everywhere.
- **Reserved instances / committed spend** once traffic is predictable: 30–40% off.
- **Cache hit rate on candidate generation is the single biggest DB lever.** Going from 70%
  to 92% roughly halves database load. Instrument it and treat it as a first-class metric.

## What I'd watch weekly

`$/MAU` · candidate-cache hit rate · DB CPU at peak · image bytes per session · LLM spend per
day (with an alert) · moderation items per 1,000 MAU · egress GB per DAU.

---

## Sources

- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing) — $0.015/GB-month standard storage, $4.50/M class A, $0.36/M class B, **no egress fees**, 10 GB free
- [Supabase pricing](https://supabase.com/pricing) — Free / Pro $25 / Team $599; 250 GB egress on Pro then ~$0.09/GB from a unified quota; storage ~$0.13/GB
- [Mapbox pricing](https://www.mapbox.com/pricing) — mobile maps billed per MAU, 25k MAU free tier
- [Google Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies) — caching prohibition and its narrow exceptions
- [Google Places API pricing analysis](https://www.woosmap.com/blog/google-places-api-pricing) — per-SKU free tiers, Enterprise ~$35/1k
- [Overture Maps Places](https://docs.overturemaps.org/guides/places/) and [attribution/licensing](https://docs.overturemaps.org/attribution/) — CDLA-Permissive 2.0, no ODbL share-alike
- Anthropic API pricing — Opus 5 $5/$25 per MTok, Haiku 4.5 $1/$5 per MTok; [Batches](https://platform.claude.com/docs/en/build-with-claude/batch-processing) at 50%
