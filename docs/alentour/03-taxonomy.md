# 03 — Taxonomy & Tags

> **v2 changes:** audience narrowed to **18–30** — price bands, vibe tags and presets skew
> cheap/social/late; Family & Kids stays as a category but leaves the shelves. Accessibility
> (F6) is **demoted** to an ordinary facet of six tags. Everything else stands.

This is the most important document in the plan. The tag system *is* the product; the app
is a UI over it. Get it wrong and no amount of design saves you, because a filter that
returns the wrong things is worse than no filter.

## Ten design rules

1. **Closed vocabulary. No free-text tags. Ever.** Free tags produce `kid-friendly`,
   `kidfriendly`, `family friendly`, `KIDS` and a filter that silently misses 60% of matches.
   Owners and users get a *"suggest a tag"* queue instead; new tags enter the vocabulary
   only by a versioned migration.
2. **Every tag has a stable slug** (`accessibility.step_free_entry`) that never changes,
   plus FR/EN display labels that can change freely.
3. **The vocabulary is versioned.** `taxonomy_version` on every activity so you can
   re-run enrichment and diff.
4. **Every tag assignment carries provenance and confidence**: `owner`, `ai`, `community`,
   `derived` (computed from other data), plus `confidence 0–1` and `verified_at`. The UI
   treats an owner-confirmed accessibility tag very differently from an AI guess.
5. **Separate *facets* (filterable, structured) from *badges* (displayable, decorative).**
   Not everything shown needs to be queryable; queryable things need indexes and careful
   semantics.
6. **Numeric truth, banded display.** Store `duration_minutes = 90` and `price_cents = 2500`;
   *display and filter* by band. Never store the band as the truth — bands change, and
   currency and inflation move.
7. **Anchor every subjective scale with concrete, per-category text.** "Difficulty 3" is
   meaningless. "Difficulty 3 (hiking): 400–700m elevation gain, 3–5h, uneven terrain" is
   usable. Write the anchors before you write the code.
8. **Absence ≠ false.** A missing `wheelchair_accessible` tag means *unknown*, not *no*.
   Model it as a tri-state. This is a correctness issue with real-world consequences.
9. **Filters must never return zero results silently.** Always show "0 exact matches — here
   are 12 that match all but one filter", and name the filter that's blocking.
10. **Cap the taxonomy's total size.** If it exceeds ~350 tags across all facets, it is
    unusable by both owners and users. Ruthlessly merge.

---

## The facets

### F1. Category (hierarchical, 2 levels, single primary + up to 2 secondary)

Primary category drives the icon, the feed grouping, and the difficulty anchors.

| L1 | Example L2 |
|---|---|
| Outdoors & nature | hiking, trail running, birdwatching, beach, lookout, camping, foraging, stargazing, picnic spot |
| Water | kayak/canoe, paddleboard, swimming, surf, sailing, diving, fishing, rafting |
| Winter | ski (alpine/nordic), snowboard, skating, snowshoe, sledding, ice fishing, fat bike |
| Sports & fitness | climbing, bouldering, yoga, gym, martial arts, team sports, racket sports, running club, cycling, skate |
| Thrill & adventure | via ferrata, zipline, karting, paintball/airsoft, skydiving, offroad, caving |
| Arts & culture | museum, gallery, theatre, concert, film, architecture walk, public art, historic site |
| Learning & workshops | pottery, cooking class, woodworking, language exchange, coding, photography, dance class |
| Games & competition | escape room, bowling, arcade, board games, VR, mini-golf, axe throwing, trivia, billiards, chess |
| Food & drink | market, tasting, brewery/distillery/winery tour, food tour, cafés worth a trip, picnic supplies |
| Nightlife | live music, DJ/club, comedy, karaoke, bar with a thing (games, terrace, view) |
| Wellness & relaxation | spa, thermal baths, sauna, meditation, float, massage, hot spring |
| Family & kids | playground, farm, aquarium/zoo, science centre, indoor play, kid workshop |
| Animals | dog park, horseback, farm visit, wildlife watching, shelter volunteering |
| Community & volunteering | cleanup, food bank, community garden, repair café, mutual aid |
| Markets & shopping | flea/vintage, artisan market, bookshops, night market |
| Festivals & seasonal | festival, fair, parade, fireworks, cabane à sucre, apple picking, holiday market |

Keep L1 to ~16. Every additional L1 costs you a row in the filter UI and a decision for
every listing.

### F2. Price

Structured, not just a band:

```
price_min_cents, price_max_cents, currency
price_unit          ∈ { per_person, per_group, per_hour, per_day, per_entry }
free                 boolean          -- fully free
free_option          boolean          -- has a free tier/day/entry ("free Tuesdays")
price_notes_i18n     text             -- "free under 12", "student rate"
deposit_required     boolean
equipment_rental_extra boolean         -- the "$25 that becomes $70" trap
```

Display bands (recomputed, never stored as truth): **Free · $ (<$15) · $$ ($15–40) ·
$$$ ($40–100) · $$$$ ($100+)** per person.

> The `equipment_rental_extra` flag matters more than it looks. "Free" kayaking that
> requires a $60 rental is the #1 source of trust-destroying surprise. Surface total
> realistic cost, not sticker price.

### F3. Distance & reachability *(derived, not tagged)*

Never a tag — always computed at query time from the user's position.

- Radius presets: 1 / 5 / 10 / 25 / 50 / 100 km, plus "anywhere in the city".
- `travel_mode` ∈ walk, bike, transit, car → changes both the ranking decay and the display.
- **`transit_minutes`** — precomputed per activity per transit-accessible cell, from GTFS.
  Phase 4, but design the schema for it now.
- `parking` ∈ free, paid, street, none, difficult — a genuine deal-breaker facet.

### F4. Duration

`duration_min_minutes`, `duration_max_minutes`, plus `duration_flexible` boolean (a museum
is 45min–4h; a 3h guided tour is not).

Bands: **< 1h · 1–2h · 2–4h (half-day) · 4–8h (full day) · multi-day.**

Add `typical_duration_minutes` for ranking; the band for filtering.

### F5. Effort — three independent axes

The single most common taxonomy mistake is collapsing these into one "difficulty" number.
A chess tournament is skill-hard and physically trivial. Via ferrata is physically hard
and requires no skill. Free diving is both, plus dangerous.

```
physical_demand   0–4   -- how fit do you need to be
skill_required    0–4   -- can a first-timer do this today
risk_tier         0–3   -- consequence of things going wrong
```

**`risk_tier` drives product behaviour, not just display:**

| Tier | Meaning | Product consequence |
|---|---|---|
| 0 | No meaningful risk | — |
| 1 | Minor injury possible | Show a "what to know" block |
| 2 | Serious injury possible | Waiver acknowledgement required to join an outing; host must be verified |
| 3 | Requires certification/equipment/guide | Cannot be hosted as a community outing at all — business/certified guide only |

Each of `physical_demand` and `skill_required` gets **written anchors per L1 category**,
stored in the taxonomy table and shown on hover/tap. Example (hiking):

- 0 — flat, paved, stroller-friendly, < 3 km
- 1 — mostly flat, some uneven ground, < 6 km
- 2 — rolling, 200–400 m gain, 2–3 h
- 3 — sustained climb, 400–800 m gain, 3–5 h, uneven
- 4 — 800 m+ gain, scrambling, exposure, or > 6 h

### F6. Accessibility *(tri-state, provenance-critical — DEMOTED in v2)*

> **v2:** per your answer, accessibility is one filter among many rather than a headline
> feature. **Cut:** the community-verification flow, the dedicated filter entry point, and the
> 14-tag facet — now the six below. **Kept:** the tri-state model and the AI prohibition, which
> cost nothing and prevent real harm. Retrofitting tri-state later is a migration across every row.

Every value is `true` / `false` / `unknown`, with `source` and `verified_at`.
**An AI may never set these to `true`.** It may only propose them as `unknown → suggested`,
for owner confirmation. Wrongly claiming step-free access strands someone at a door.

| Slug | Notes |
|---|---|
| `step_free_entry` | The single most-requested one |
| `wheelchair_accessible_throughout` | Distinct from entry |
| `accessible_washroom` | |
| `seating_available` | Chronic pain, pregnancy, fatigue — not just wheelchair users |
| `low_sensory` | Autism, sensory processing |
| `service_animals_welcome` | Legally distinct from pet-friendly — keep separate |

*(The other eight from v1 — `accessible_parking`, `hearing_loop`, `asl_lsq_available`,
`audio_description`, `braille_signage`, `elevator_available`, `good_lighting`,
`staff_trained_accessibility` — are dropped from the shipped facet. The slugs are reserved in
the taxonomy file so they can be re-enabled without a migration.)*

Also `accessibility_notes_i18n` free text (displayed, not filterable) — real accessibility
is full of caveats that no boolean captures.

> **Cut in v2:** the community accessibility verification flow (photo-confirm, two-confirmation
> promotion). It needs a user base you won't have for a year. Revisit if the app grows — it is
> high trust value at near-zero cost, and the disability community engages with it
> enthusiastically when it's done respectfully.

### F7. Season, weather & timing

```
months_open           int  -- 12-bit bitmask, cheap to index and filter
weather_dependency    ∈ { indoor, covered, outdoor, either }
requires_snow         boolean
requires_ice          boolean
requires_daylight     boolean
bad_in_rain           boolean
best_months           int  -- bitmask, distinct from open months
best_time_of_day      ∈ { sunrise, morning, midday, afternoon, golden_hour, sunset, night }
peak_crowding         ∈ { weekday_am, weekend, holidays, evenings }
```

`months_open` vs `best_months` is a real distinction: a beach is *open* year-round and
*best* in July. Ranking uses `best_months`; filtering uses `months_open`.

### F8. Opening hours & availability

Use **[OSM `opening_hours` syntax](https://wiki.openstreetmap.org/wiki/Key:opening_hours)** —
it's a battle-tested standard with parsers in every language, it handles "Mo-Fr 09:00-17:00;
Sa 10:00-14:00; PH off", and it saves you from inventing a schedule DSL. Store the raw
string plus a materialized `open_intervals` table for fast `open_now` queries.

Plus: `seasonal_closure_start/end`, `last_admission_minutes_before_close`,
`hours_last_verified_at` (stale hours are the #1 catalog quality complaint).

### F9. Group & social fit

```
good_solo             boolean   -- a genuine filter; solo travellers/newcomers search this
good_for_pairs, good_for_small_group (3–6), good_for_large_group (7+)
min_participants, max_participants
booking_group_min                  -- some activities require 4+ to run
conversation_friendly boolean      -- can you actually talk (vs a loud concert)
icebreaker_score      0–2          -- derived: how well does this work for strangers
```

`icebreaker_score` is quietly important — it powers "outings that work for meeting people".
A pottery class scores 2 (parallel activity, natural talk, shared incompetence). A movie
scores 0. Bouldering scores 2. This should be AI-proposed and human-tuned.

### F10. Who it's for

`age_min`, `age_max` (nullable), plus tags: `kids_0_5`, `kids_6_12`, `teens`, `adults_only`,
`seniors_friendly`, `beginners_welcome`, `pets_welcome`, `stroller_friendly`,
`lgbtq_friendly`, `newcomer_friendly`, `languages_offered` (multi: fr, en, es, …).

> **Legal caution:** "women-only" and similar protected-characteristic restrictions are
> lawful in some jurisdictions and unlawful in others, and the analysis differs for a
> *venue* vs a *private gathering*. Model the capability (`audience_restriction` with a
> reason) but gate its availability per-jurisdiction and get counsel before enabling it.
> See [11](11-legal-and-compliance.md).

### F11. Booking & access

`booking_type` ∈ walk_in, reservation_recommended, reservation_required, ticketed,
membership_required, permit_required, invite_only.
Plus `lead_time_days`, `cancellation_policy`, `external_booking_url`, `sells_out` boolean,
`id_required`, `waiver_required`, `min_age_legal`.

### F12. Logistics & practicalities

`equipment_provided`, `bring_your_own` (list), `rental_onsite`, `changing_rooms`,
`showers`, `lockers`, `washrooms`, `food_onsite`, `alcohol_served`, `byob`, `cash_only`,
`wifi`, `phone_signal`, `shade`, `heated`, `covered`, `stroller_parking`,
`what_to_wear_i18n`, `what_to_bring_i18n`.

### F13. Vibe / mood *(the discovery differentiator)*

This is how people actually decide, and no competitor exposes it. Max 3 per activity,
AI-proposed, community-tunable:

`chill` · `adrenaline` · `romantic` · `social` · `learn_something` · `get_moving` ·
`creative` · `silly` · `awe` · `nostalgic` · `cozy` · `rainy_day` · `hungover` ·
`first_date` · `impress_a_visitor` · `team_building` · `solo_recharge` · `cheap_thrill` ·
`instagram_worthy` · `off_the_beaten_path`

Vibe tags power the best entry points in the whole app: the home screen shelves are
`"Rainy day"`, `"First date"`, `"Something new"`, `"Free tonight"` — not category grids.

### F14. Quality & status *(system-managed, not user-facing)*

`completeness_score 0–1`, `photo_quality_score`, `verification_status`,
`operating_status` ∈ open / temporarily_closed / permanently_closed / seasonal_closed,
`last_verified_at`, `data_sources[]`, `duplicate_of`, `flag_count`.

---

## Filter UX

Deep taxonomies die of their own UI. Rules:

- **Home is browse, not search.** Vibe/context shelves first ("Rainy day", "Free tonight",
  "Under 30 min away"), category grid second.
- **Max 4 chips visible**: `Near me ▾` `Free–$$ ▾` `Today ▾` `Filters (3)`. Everything else
  is behind a bottom sheet organized by facet, with counts on every option.
- **Live result counts** on every filter option, computed from the current candidate set.
  Never let someone tap into an empty state.
- **Presets are the real UI**, tuned to 18–30: "Free tonight", "Cheap date", "Rainy day",
  "Alone and restless", "New in town", "Hungover", "Impress a visitor", "Get moving".
  ("With kids" exists but is not a launch preset.) A preset is a saved filter bundle; ship ~8 curated and let users
  save their own. Most users will never open the full filter sheet — that's fine, and it's
  why the sheet can afford to be deep.
- **Accessibility lives in the filter sheet like any other facet** (v2 demotion). The one rule
  that survives: when an accessibility filter is on, `unknown` results appear in a clearly
  separated "not yet verified" section rather than being dropped — dropping them hides most of
  the catalog and is worse for the user than an honest label.
- **Never zero.** Relax the least-important filter and say so: *"No exact matches. Showing
  12 results ignoring 'wheelchair accessible' — [keep it strict]."*

## Governance

- Taxonomy lives in **version-controlled YAML** in the repo, applied by migration — not
  edited in a production admin panel. It is code.
- Adding a tag requires: slug, FR/EN labels, definition, at least 3 real example listings,
  a decision on whether it's filterable, and the migration to backfill it.
- Quarterly review: any tag applied to < 0.3% or > 60% of listings is a candidate for
  merge or deletion. A tag that matches everything filters nothing.
- Track **filter usage analytics per facet**. Facets nobody uses get demoted out of the
  main sheet. This is the only honest way to keep the taxonomy from bloating.
