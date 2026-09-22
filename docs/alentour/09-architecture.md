# 09 — Architecture & Stack *(v2: free, solo, no-rework)*

## Two requirements in tension, and how they're reconciled

1. **Free until launch, near-free in beta.**
2. **Fully functional, with no excessive rework later.**

These are usually in conflict — the cheap thing (Firebase free tier, a no-code backend, a
static site generator) is the thing you throw away. **They are reconcilable here because the
cheap stack and the scalable stack are the same stack.** Postgres, R2, and MapLibre cost $0 at
zero users and ~$2,000/month at a million registered accounts. Nothing gets thrown away.

The one real deferral is that **Stage 1 has no backend at all** — and that's a deferral, not a
detour, because the catalog file is generated from the Postgres schema you'll later put online.

---

## Stage 1: the app is a file on a CDN

```
  Local Postgres (your laptop, never deployed)
     │   the real schema from doc 04 — authored once, used forever
     │   export script (a ~100-line Node/TS file)
     ▼
  catalog.v1.json  (~3 MB, ~700 KB gzipped)  ─┐
  montreal.pmtiles (~200 MB, built once)     ─┤──►  Cloudflare R2 + CDN  ──►  Expo app
  media/*.webp     (~300 MB)                 ─┘                               on-device filter
                                                                              on-device map
```

**Why this is right, not a shortcut:**

| | |
|---|---|
| **Cost** | R2 free tier: 10 GB storage, 10M reads/month. Serves ~100k users at $0. |
| **Speed** | Filtering 2,000 rows in JS is sub-millisecond. Faster than any network call. |
| **Offline** | Works in the metro, which is where people plan. A real feature, not a consolation. |
| **Ops** | Nothing to deploy, monitor, scale, patch, or wake at 3am. |
| **Updates** | Upload a file. New catalog live in seconds, no app release. |
| **Rework** | None. The schema is already the production schema. |

**When you outgrow it:** ~5,000 activities or ~8 MB. That's a year away. Then you either split
by neighbourhood (fetch only the cells the user is near) or move the catalog behind the API —
by which point you have a backend anyway.

---

## The stack, by stage

| Layer | Stage 1 | Stage 2–4 | Stage 5+ / 1M registered |
|---|---|---|---|
| **App** | Expo (React Native), EAS Update for OTA | same | same |
| **Catalog** | Static JSON on R2 | same | Postgres-backed API |
| **Database** | Local Postgres only | **Supabase free tier** | Supabase Pro → managed Postgres |
| **Auth** | none | Supabase Auth (Apple/Google) | same |
| **Maps** | MapLibre + self-hosted Protomaps `.pmtiles` on R2 | same | same |
| **Media** | R2 + Cloudflare CDN | same | same |
| **Search** | on-device (Fuse.js or a hand-rolled index) | Postgres FTS | + pgvector semantic |
| **Jobs** | your laptop, run by hand | pg-boss or GitHub Actions cron | same |
| **AI** | Batch API from your laptop | same + Haiku for live moderation | same |
| **Push** | — | Expo Push (free) | FCM/APNs direct |
| **Analytics** | PostHog free (1M events/mo) | same | self-hosted |
| **Errors** | Sentry free (5k/mo) | same | paid tier |

Deliberately **not** in this plan until ~50k MAU: Redis, read replicas, Typesense, Centrifugo,
Kubernetes, microservices, a staging environment. Postgres does all of it, and a solo dev
maintaining infrastructure is a solo dev not building the product.

### Why each choice survives to 1M

- **Expo/RN** — one codebase, and EAS Update ships fixes without a 2-day App Store review.
  For a part-time dev that is worth weeks a year.
- **Postgres + PostGIS + pgvector** — geo, relational, full-text, and vector in one engine.
  Replaces four services you'd otherwise pay for and operate.
- **Supabase** — fastest path to auth + database with no ops. It *is* Postgres, so the exit is
  a `pg_dump`. Its free tier pauses after **one week idle**, which is fine pre-beta and
  irrelevant once real users are hitting it daily.
- **Cloudflare R2** — $0 egress. This is what keeps media from ever becoming a bill.
- **MapLibre + Protomaps** — the single most important cost decision. Mapbox and Google bill
  mobile maps **per monthly active user**; a Montréal `.pmtiles` file on R2 is a flat ~$0.
  Build it once with `planetiler` from an OSM extract.

---

## No-rework guarantees

The things that are expensive to change later, decided now and never revisited:

| Decision | Made in Stage 1 | Why it can't wait |
|---|---|---|
| **Three-entity schema** (venue / activity / outing) | Yes, tables exist empty | Re-modelling a live catalog touches everything |
| **i18n as rows, not columns** (`activity_content` per locale) | Yes | `title_fr`/`title_en` columns become a rewrite at the third locale |
| **Closed, versioned taxonomy** with stable slugs | Yes | Free-text tags are unrecoverable after ~1,000 listings |
| **Tri-state accessibility** (`true`/`false`/`unknown`) | Yes | Retrofitting tri-state is a migration across every row |
| **Tag provenance + confidence** | Yes | You cannot reconstruct who claimed what, after the fact |
| **Money as integer cents + currency** | Yes | Floats and implied currency are a silent data-corruption bug |
| **Timestamps as `timestamptz` + explicit venue timezone** | Yes | Naive local times break the first time DST hits an outing |
| **UUID primary keys** | Yes | Sequential ints leak counts and break any future merge |
| **No Google Places data in the catalog** | Yes | Their terms forbid caching it; building on it is unwindable |
| **No per-MAU-priced dependency** | Yes | Growth would become the thing that bankrupts you |

**The only planned migration in the entire plan** is Supabase → self-managed Postgres,
somewhere past 100k MAU. That is a `pg_dump`, a connection string, and an afternoon.

---

## Non-functional targets (scaled to reality)

- **Offline-first.** The catalog, saves, and lists work with no network. Non-negotiable — it's
  a metro city and this is a planning app.
- **Cold start < 1.5 s**, feed paint immediate from the bundled/cached catalog.
- **Images:** WebP, 3 variants (400 / 800 / 1600 px), blurhash placeholders. Uncontrolled image
  sizes make the app slow *and* expensive at the same time.
- **i18n:** FR/EN from the first row, ICU message format, locale-aware dates and distances.
- **App accessibility:** VoiceOver/TalkBack, dynamic type, 4.5:1 contrast, 44pt targets. This
  is separate from the accessibility *filter* you demoted, and it stays.
- **Security:** no key with billing exposure ships in the app bundle — anything in the binary
  is public. Don't let the client talk to Postgres directly once auth exists; RLS policies for
  a social graph get subtle, and a mistake is a data breach.
- **Resumability:** small commits, a `NEXT.md` with the next three tasks, no long-lived
  branches. You will lose three weeks to life, repeatedly.
