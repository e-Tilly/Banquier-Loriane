# 09 — Architecture & Stack

## Principles

1. **Boring, well-understood technology.** A 4-person team cannot operate a distributed
   system. One Postgres, one API service, one queue.
2. **Prefer things whose cost scales with *usage*, not with *users*.** This single rule is
   why the stack below costs ~$8k/month at 1M MAU instead of ~$60k ([10](10-cost-model.md)).
3. **No lock-in on the data layer.** Managed platforms are fine for speed as long as the
   escape hatch is "it's just Postgres".
4. **Every hot path must be cacheable by something other than the user's identity.**

## The stack

| Layer | Choice | Why, and what it beats |
|---|---|---|
| **Mobile** | **React Native + Expo** (EAS Build, EAS Update) | One codebase, OTA updates without app-review round-trips (worth weeks per year), a small team can ship both platforms. Flutter is equally fine; native ×2 is not, at this size. |
| **Maps rendering** | **MapLibre Native** + **Protomaps** basemap (`.pmtiles` on R2 behind Cloudflare) | Flat, tiny cost. Mapbox bills mobile maps **per monthly active user** — the one pricing axis that scales exactly with the thing you're trying to grow. See [10](10-cost-model.md). |
| **Geocoding / autocomplete** | Self-hosted **Photon**/Nominatim, or Geoapify/Radar; Google Places only in the business-onboarding address field | Avoids the Places caching prohibition ([07](07-supply-onboarding-and-ai.md)) |
| **Backend API** | **TypeScript**, Fastify or NestJS, REST + a thin BFF for the feed | Type sharing with the RN app is a genuine velocity win. Move a hot path to Go later only if profiling says so. |
| **Database** | **PostgreSQL 16 + PostGIS + pgvector + pg_trgm** | Geo, relational, full-text, vector, and JSON in one engine. Replaces what would otherwise be Postgres + Elasticsearch + Pinecone + a geo service. |
| **Platform (phases 0–2)** | **Supabase Pro** — Postgres, auth, storage, realtime, RLS | Fastest path to a working product. It *is* Postgres, so the exit is a `pg_dump`. Plan the exit; don't take it early. |
| **Platform (phase 3+)** | Managed Postgres (Crunchy / RDS / Neon) + own API on Fly.io or Hetzner | Migrate when the platform's usage pricing exceeds the ops cost of running it — realistically around 200–400k MAU. |
| **Cache / queue** | **Redis** (Upstash or self-hosted) + **pg-boss** or BullMQ | Candidate-set cache, rate limits, job queue. pg-boss keeps jobs in Postgres — one fewer thing to operate. |
| **Object storage + CDN** | **Cloudflare R2** + Cloudflare CDN; **imgproxy** or Cloudflare Images for variants | **$0 egress.** At 1M MAU image bandwidth is the single largest infra line on S3/CloudFront and it is ~free here. This is the highest-leverage choice in the document. |
| **Search (later)** | **Typesense** self-hosted (3 small nodes) when Postgres FTS stops being enough | Typo tolerance + fast facet counts. Algolia is excellent and prices per search — untenable at this volume. |
| **Realtime** | Supabase Realtime early → **Centrifugo** self-hosted later | Outing chat only. Per-connection SaaS (Pusher/Ably) is a cost trap at 1M users. |
| **Push** | Expo Push → FCM/APNs directly | Free. Push cost should be ~$0; if it isn't, something is wrong. |
| **AI** | **Claude Opus 5** (extraction, copy) + **Claude Haiku 4.5** (triage, moderation, NL parse); **Voyage AI** or self-hosted BGE-M3 for embeddings | Anthropic has no embeddings endpoint — use Voyage or self-host. See [07](07-supply-onboarding-and-ai.md). |
| **Auth** | Supabase Auth / Clerk early; consider own later | Sign in with Apple is mandatory if you offer any other social sign-in on iOS. |
| **Analytics** | **PostHog** (cloud, then self-hosted) + **Sentry** | Product analytics, session replay, feature flags, A/B in one. Self-host when event volume makes cloud pricing bite. |
| **Weather** | OpenWeather / Environment Canada, one call per city per hour, cached | Powers context ranking. Negligible cost — never call it per user. |
| **CI/CD** | GitHub Actions + EAS | |
| **IaC** | Terraform for the non-Supabase pieces | |

## Shape

```
   iOS / Android (Expo RN)
        │  HTTPS (JSON), deep links, push
        ▼
   Cloudflare  ── CDN for media (R2) and map tiles (PMTiles)
        │
        ▼
   API service (Fastify, 4–12 stateless containers, autoscaled)
        ├── Redis: candidate-set cache, rate limits, sessions, NL-query cache
        ├── Postgres primary (writes) ──► 2 read replicas (feed, search)
        ├── pg-boss workers: enrichment, rally deadlines, reminders,
        │                    moderation, imports, digests, expiry
        └── Anthropic API (async only — never in a user-blocking request)
```

**Rule: no LLM call is ever in a user-blocking request path.** Enrichment is queued;
moderation is queued-with-optimistic-publish; NL search is cached and falls back to plain
filters on timeout. This bounds both latency and cost, and it means an API outage degrades
the product instead of breaking it.

## Scaling path

| Stage | MAU | What changes |
|---|---|---|
| 1 | < 50k | Single Supabase project. Nothing clever. Measure. |
| 2 | 50–200k | Add read replicas; add Redis candidate cache; move media to R2; move tiles to Protomaps. |
| 3 | 200k–500k | Split API from platform, own Postgres, partition `impressions`, add Typesense, self-host analytics. |
| 4 | 500k–1M+ | Shard read traffic geographically (cities are naturally partitionable), regional CDN, consider a separate read model for the feed. |

**Cities are the natural shard key.** Activity data is geographically local; a user in
Montréal never queries Lisbon. If you ever need to split the database, split by city/region
— not by user. Design the queries now so that's possible later (always carry a region
predicate).

## Non-functional requirements

- **Latency budget:** feed p95 < 400 ms end-to-end. Candidate gen < 40 ms (cached < 5 ms),
  ranking < 10 ms, media via CDN.
- **Offline:** saved activities, lists, and today's outing details must work with no network.
  Cache the last feed. People lose signal exactly when they're going to the thing.
- **Cold start:** app open to first meaningful paint < 1.5 s. Skeleton + cached feed while
  the network resolves.
- **Image discipline:** WebP/AVIF, 3 variants (thumb 400px, card 800px, full 1600px),
  blurhash placeholders, aggressive lazy loading. Uncontrolled image sizes are how a feed
  gets slow *and* expensive simultaneously.
- **Accessibility (the app's own):** full VoiceOver/TalkBack, dynamic type, 4.5:1 contrast,
  44pt targets. Non-negotiable for a product that advertises accessibility filtering — the
  hypocrisy would be noticed, loudly and correctly.
- **i18n:** ICU message format, FR/EN at launch, locale-aware dates/distances/currency,
  RTL-ready layout even if no RTL locale ships yet.
- **Observability:** OpenTelemetry traces; dashboards for feed latency, cache hit rate, queue
  depth, LLM spend/day, moderation queue age. **Alert on LLM spend/day** — a bad loop can burn
  a month's budget in an afternoon.

## Security

- Row-level security in Postgres if using Supabase's direct-from-client access. **Better: do
  not let the client talk to the database at all** — go through the API. RLS policies for a
  social graph with blocks and visibility rules get subtle fast, and a mistake is a data breach.
- Secrets in a real manager, never in the app bundle. **Anything in the mobile binary is
  public** — no third-party API key with billing exposure ships in the app.
- Rate limits per user, per IP, per device on every write and on search.
- Signed, short-TTL URLs for private media; public media through the CDN.
- Certificate pinning for the API. Jailbreak/root detection is not worth it.
- Annual pen test once there's a social graph and payments.
