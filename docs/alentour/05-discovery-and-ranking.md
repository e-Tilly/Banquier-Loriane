# 05 — Discovery, Search & Ranking

## The performance constraint that shapes everything

At 1M MAU the feed is the hot path: roughly **300M feed requests/month**. If each one runs
a fresh geo+facet+rank query you need a very large database. If you exploit the fact that
*users standing in the same place with the same filters want the same candidates*, you need
a small one.

**So: two-stage retrieval with a shared, cacheable first stage.**

```
      ┌─ Stage 1: CANDIDATE GENERATION ────────────────────────┐
      │  Key: (h3_r7 cell, filter_hash, day_part, weather_bucket)│
      │  Postgres → ~300 candidate activity ids                 │
      │  Cached in Redis, TTL 10 min. Shared across all users   │
      │  in that cell with those filters. Hit rate 90%+.        │
      └────────────────────────┬───────────────────────────────┘
                               ▼
      ┌─ Stage 2: PERSONALIZED RANKING ────────────────────────┐
      │  In the API process, per user, over ~300 rows:          │
      │  score = proximity × quality × fit × context × freshness│
      │  then MMR diversity + exploration slots. <5ms.          │
      └────────────────────────────────────────────────────────┘
```

A dense urban H3 resolution-7 cell is ~5 km² — big enough that thousands of users share it,
small enough that "near me" stays honest. Ranking re-applies exact distance per user, so
cell-level caching never shows something genuinely far away.

This one design decision is worth more than any other performance work in the project.

## Stage 1: candidate generation

```sql
SELECT a.id
FROM activity_locations al
JOIN activities a ON a.id = al.activity_id
WHERE al.h3_r7 = ANY($cells)                     -- centre cell + ring
  AND a.status = 'published'
  AND a.tag_slugs @> $required_tags               -- GIN
  AND a.months_open & (1 << $month) > 0
  AND ($max_price IS NULL OR a.price_min_cents <= $max_price)
  AND (a.ends_at IS NULL OR a.ends_at > now())
  AND a.operating_status = 'open'
ORDER BY a.quality_score DESC
LIMIT 400;
```

Notes:
- **H3 ring, not `ST_DWithin`, for the coarse pass.** Cell equality is an integer B-tree
  scan; distance is computed only on the ~400 survivors. For a strict radius, keep the GIST
  `ST_DWithin` as a second predicate — but the cell filter does the elimination work.
- Widen the ring adaptively in sparse (rural) areas: try r=1, and if < 60 results, r=2, r=3.
- `filter_hash` is a stable hash of the normalized filter set, so cache keys collide usefully.

## Stage 2: ranking

```
score = w_prox · proximity
      + w_qual · quality
      + w_fit  · personal_fit
      + w_ctx  · context_fit
      + w_fresh· freshness
      − penalties
```

| Term | Definition | Notes |
|---|---|---|
| `proximity` | `exp(-distance_km / d0)` where `d0` = user's stated radius / 3 | Smooth decay beats hard cutoffs; a great thing 6 km away should beat a mediocre one at 2 km |
| `quality` | Bayesian-smoothed rating `(v·R + m·C)/(v+m)` × `completeness` × `photo_quality` | Smoothing (m≈8 prior reviews) stops one 5★ review from topping the feed |
| `personal_fit` | `cosine(user.taste_embedding, activity.embedding)` + explicit interest boosts − disinterest | |
| `context_fit` | `open_now × weather_match × season_match × daypart_match × duration_fits_remaining_day` | The magic term. See below. |
| `freshness` | Boost new listings and activities with an upcoming open outing; decay repeats | |
| penalties | Impression fatigue (shown ≥3× without a tap → ×0.4), same-category run-length, already-visited | |

### Context fit is the differentiator — spell it out

```python
def context_fit(activity, ctx):
    s = 1.0
    if ctx.precipitation_prob > 0.5:
        s *= {"indoor": 1.6, "covered": 1.2, "outdoor": 0.35, "either": 1.0}[activity.weather_dependency]
    if ctx.temp_c < -15:
        s *= 1.5 if activity.weather_dependency == "indoor" else 0.4
        s *= 1.4 if activity.requires_snow else 1.0
    if ctx.month_bit & activity.best_months:  s *= 1.3
    if ctx.is_dark and activity.requires_daylight: s *= 0.1
    if activity.typical_duration_minutes > ctx.minutes_until_close: s *= 0.2
    if not is_open_at(activity.opening_hours, ctx.now): s *= 0.15   # dim, don't drop
    return s
```

Weather comes from a single forecast call **per city per hour** (not per user) — cached,
effectively free. Season from the month bitmask. Daylight from a sunrise/sunset calculation,
no API needed. Total cost: negligible. Total perceived intelligence: very high.

> Dim rather than drop for `open_now`. Someone browsing at 11pm for tomorrow still wants to
> see the museum. Add a "Open now only" toggle for the strict case.

### Diversity and exploration

- **MMR / category capping:** no more than 2 of the same L1 category in any 6 consecutive
  cards. Without this, a good climbing gym recommendation turns the whole feed into climbing.
- **Exploration slots:** reserve ~10% of positions (ε-greedy) for high-uncertainty items —
  new listings, low-impression items, things outside the user's usual categories. Without
  this, new supply never gets seen, owners churn, and the catalog ossifies. This is a
  marketplace-health mechanism, not an ML nicety.
- **Serendipity shelf:** an explicit "Something different" row, deliberately outside the
  taste vector. Users report this as the single most-loved feature in comparable apps, and
  it doubles as a cheap exploration channel.

## Cold start

**New user (no history).** Onboarding, ≤ 60 seconds:
1. Pick 3–6 interests from the L1 grid (images, not text).
2. **A 6-item image tap-quiz** — "which of these two would you rather do?" — seeds the taste
   embedding as a weighted centroid of the chosen activities' embeddings. Far better signal
   than a checkbox list, and it takes 15 seconds.
3. Set home area (coarse) and default radius.
Then rely on city-wide popularity priors until ~20 interactions exist.

**New activity (no engagement).** Prior from: category average × completeness × photo
quality × provider verification. Plus guaranteed exploration impressions (above) for its
first 14 days. Track "time to first 100 impressions" as a supply-health metric.

**New city.** Popularity priors transfer badly across cities (a lookout in Montréal ≠ a
lookout in Lisbon). Bootstrap with editorial curation: 200 hand-ranked anchor activities per
city. Yes, manual. It's a week of work and it makes launch day not look broken.

## Search

Three query types, three engines, one entry box:

| Query | Example | Handled by |
|---|---|---|
| Lexical | "escape room" | Postgres FTS (`tsvector`, `french` + `english` configs) + trigram for typos |
| Semantic | "something to do when it's raining and I'm broke" | pgvector HNSW over activity embeddings |
| Structured | "free · outdoor · under 2h · near me" | The filter pipeline above |

**Hybrid retrieval:** run lexical and semantic in parallel, fuse with Reciprocal Rank Fusion
(`score = Σ 1/(60 + rank_i)`), then apply the same stage-2 ranker. RRF is 15 lines of code
and beats hand-tuned score blending.

**Natural-language search** ("chill and cheap for a rainy Sunday with my mom"):
- Do **not** call an LLM per query — that's the cost bomb. Instead:
  1. Cache aggressively: normalized query → parsed filter set, in Redis. Head queries repeat
     enormously; expect an 80%+ hit rate after a few weeks.
  2. On a miss, call **Claude Haiku 4.5** with structured outputs constrained to the tag enum,
     converting the sentence into `{filters, semantic_query, sort_intent}`.
  3. Execute as a normal filter+semantic query. The LLM never sees or ranks the catalog.
- ~200 input / 100 output tokens per miss → at Haiku's $1/$5 per MTok, about **$0.0007 per
  uncached query**. With 80% caching and 5% of sessions using NL search, this is $200–400/month
  at 1M MAU. Acceptable. Calling an LLM on *every* search would be ~$15k/month. The cache and
  the "only on miss" rule are what make the feature viable.

**Embeddings.** Anthropic doesn't serve an embeddings endpoint; use
[Voyage AI](https://docs.voyageai.com/) (`voyage-3`-class, and their multilingual models
handle FR/EN well), or self-host **BGE-M3** for multilingual embeddings on a small GPU box if
you'd rather own it. ~500k activities × 1 embedding is a one-time job costing single-digit
dollars; re-embed only on content change.

## Feed surfaces

| Surface | Composition |
|---|---|
| **Home** | Context shelves first: "Rainy day" / "Free tonight" / "Under 30 min" / "New near you" / "Happening this weekend" / "Something different". Then a ranked infinite feed. |
| **Map** | Clustered pins, cluster count, filter chips persist, "search this area" button. Cluster server-side at low zoom (return cluster centroids, not 4,000 pins). |
| **Filtered list** | Stage 1 + 2 with the user's filters, sorted by relevance / distance / price / rating. |
| **Activity detail** | Plus "Upcoming outings here" (conversion moment), "Similar nearby" (pgvector), "People also did". |
| **Outings feed** | Separate tab: open outings sorted by `starts_at`, filtered by fit + spots left + trust match. |

## Instrumentation you must build with the ranker, not after

- Log every impression with `(user, activity, surface, position, ranker_version, score_components)`.
  Without score components you cannot debug a bad feed, and you *will* have a bad feed.
- Ship an internal **"why am I seeing this?"** debug view from day one. It pays for itself
  in the first week.
- Offline eval set: 200 hand-labelled (context, query) → good/bad result triples. Run it in
  CI on every ranker change. Ranking regressions are otherwise invisible until retention drops.
- A/B infrastructure before the second ranking change, not after the tenth.
