# 04 — Data Model

> **v2:** this schema is unchanged and ships **in Stage 1**, authored in a local Postgres on
> your laptop and exported to a static JSON catalog ([09](09-architecture.md)). The `outings`,
> `reports` and `provider` tables sit empty until Stages 3–5 — empty tables are free, whereas
> re-modelling a live catalog is not.

Target: **PostgreSQL 16+ with PostGIS, pgvector, pg_trgm**. One database is the source of
truth for everything until it demonstrably cannot be ([09](09-architecture.md)).

## The central modelling decision: venue ≠ activity ≠ outing

Almost every app in this space collapses two of these and then can't answer basic questions.

| Entity | Is | Example | Answers |
|---|---|---|---|
| **Venue** | A physical place | Parc Jean-Drapeau | "Where is it, what's the address, is there parking" |
| **Activity** | A *thing you can do*, possibly at several venues | Kayaking at Parc Jean-Drapeau | "What can I do, what does it cost, how hard is it" |
| **Outing** | A specific scheduled instance with people | Kayaking there, Sat 14:00, 6 spots, 3 taken | "When, with whom, is it happening" |

Why it matters concretely:
- One venue hosts 8 activities (a community centre: pool, gym, pottery, daycare, hall…).
  Collapsing venue+activity means you either lose 7 of them or you duplicate the venue 8×.
- One activity happens at many venues ("outdoor skating rink" — 40 locations). Collapsing
  means 40 near-identical listings polluting the feed.
- An outing needs a *place and a time*; an activity is timeless. Collapsing activity+outing
  means a hiking trail expires, which is nonsense.

## Activity kinds

`activity.kind` fundamentally changes lifecycle and feed behaviour:

| kind | Example | Expires? | Has outings? |
|---|---|---|---|
| `place` | Climbing gym, museum, lookout | No (until closed) | Yes |
| `scheduled_event` | Festival, concert, one-off workshop | Yes, at `ends_at` | Usually is one |
| `recurring_program` | Tuesday pottery class, weekly run club | Per-occurrence | Yes, generated |
| `self_guided` | A trail, a bike route, a walking tour | No | Yes |
| `seasonal` | Sugar shack, apple picking, ice rink | Per-season window | Yes |

---

## Core schema (abridged, illustrative)

```sql
-- ---------- Places & activities ----------

CREATE TABLE venues (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  geom            geography(Point, 4326) NOT NULL,
  address         jsonb,                    -- structured, i18n-aware
  h3_r7           bigint NOT NULL,          -- coarse cell, for candidate caching
  h3_r9           bigint NOT NULL,          -- fine cell
  timezone        text NOT NULL,
  external_ids    jsonb,                    -- {overture:..., osm:..., google_place_id:...}
  operating_status text NOT NULL DEFAULT 'open',
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX venues_geom_gix ON venues USING GIST (geom);
CREATE INDEX venues_h3_r7_ix ON venues (h3_r7);

CREATE TABLE activities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL,          -- place|scheduled_event|recurring_program|self_guided|seasonal
  slug              text UNIQUE NOT NULL,
  provider_id       uuid REFERENCES providers(id),   -- null => community/seeded
  created_by        uuid REFERENCES users(id),
  status            text NOT NULL DEFAULT 'draft',   -- draft|pending_review|published|hidden|removed
  -- i18n content: one row per locale in activity_content, not columns here
  primary_category  text NOT NULL,
  price_min_cents   int, price_max_cents int, currency char(3) DEFAULT 'CAD',
  price_unit        text, is_free boolean, has_free_option boolean,
  duration_min_minutes int, duration_max_minutes int, typical_duration_minutes int,
  physical_demand   smallint CHECK (physical_demand BETWEEN 0 AND 4),
  skill_required    smallint CHECK (skill_required  BETWEEN 0 AND 4),
  risk_tier         smallint CHECK (risk_tier       BETWEEN 0 AND 3) DEFAULT 0,
  months_open       smallint NOT NULL DEFAULT 4095,  -- 12-bit mask
  best_months       smallint,
  weather_dependency text,                  -- indoor|covered|outdoor|either
  opening_hours     text,                   -- OSM opening_hours syntax
  booking_type      text,
  min_age           smallint, max_age smallint,
  starts_at         timestamptz, ends_at timestamptz,   -- for scheduled_event/seasonal
  quality_score     real DEFAULT 0,
  completeness      real DEFAULT 0,
  embedding         vector(1024),           -- multilingual, for semantic search + similarity
  taxonomy_version  int NOT NULL,
  last_verified_at  timestamptz,
  search_tsv        tsvector,               -- generated from content, fr+en configs
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX activities_embedding_ix ON activities
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX activities_search_ix ON activities USING GIN (search_tsv);
CREATE INDEX activities_live_ix ON activities (primary_category, quality_score DESC)
  WHERE status = 'published';

-- An activity happens at one or more venues.
CREATE TABLE activity_locations (
  activity_id  uuid REFERENCES activities(id) ON DELETE CASCADE,
  venue_id     uuid REFERENCES venues(id),
  is_primary   boolean DEFAULT false,
  geom         geography(Point,4326) NOT NULL,   -- denormalized from venue for query speed
  h3_r7        bigint NOT NULL,
  PRIMARY KEY (activity_id, venue_id)
);
CREATE INDEX activity_locations_geom_gix ON activity_locations USING GIST (geom);
CREATE INDEX activity_locations_h3_ix    ON activity_locations (h3_r7);
```

> **Note the denormalized `geom` and `h3_r7` on `activity_locations`.** The hot query is
> "activities near me", not "venues near me". Denormalizing removes a join from the single
> most-executed query in the product. Keep it in sync with a trigger.

```sql
-- ---------- i18n content ----------

CREATE TABLE activity_content (
  activity_id  uuid REFERENCES activities(id) ON DELETE CASCADE,
  locale       text NOT NULL,               -- 'fr-CA', 'en-CA'
  title        text NOT NULL,
  summary      text,                        -- 1 line, for cards
  description  text,                        -- 2-4 paragraphs
  what_to_bring text,
  accessibility_notes text,
  source       text NOT NULL,               -- owner|ai|community|translated
  PRIMARY KEY (activity_id, locale)
);
```

Never put `title_fr`/`title_en` columns on the main table — you will add a third language
and rewrite everything. One row per locale, always.

```sql
-- ---------- Tags ----------

CREATE TABLE tags (
  slug            text PRIMARY KEY,          -- 'accessibility.step_free_entry'
  facet           text NOT NULL,
  label_i18n      jsonb NOT NULL,            -- {"fr-CA":"Entrée sans marche","en-CA":"Step-free entry"}
  definition_i18n jsonb,
  is_filterable   boolean DEFAULT true,
  is_tristate     boolean DEFAULT false,     -- accessibility tags
  sort_order      int,
  deprecated_at   timestamptz
);

CREATE TABLE activity_tags (
  activity_id  uuid REFERENCES activities(id) ON DELETE CASCADE,
  tag_slug     text REFERENCES tags(slug),
  value        boolean,                      -- NULL = unknown (tri-state)
  source       text NOT NULL,                -- owner|ai|community|derived
  confidence   real,
  verified_at  timestamptz,
  verified_by  uuid REFERENCES users(id),
  PRIMARY KEY (activity_id, tag_slug)
);
CREATE INDEX activity_tags_tag_ix ON activity_tags (tag_slug) WHERE value IS TRUE;
```

**Filtering performance note.** A normalized `activity_tags` table is correct but slow for
multi-tag AND queries. Maintain a denormalized `activity_tag_slugs text[]` column on
`activities` with a **GIN index**, refreshed by trigger. Then `WHERE tag_slugs @> ARRAY[...]`
is a single index scan. Normalized table = truth and provenance; array = query path.

```sql
-- ---------- People & providers ----------

CREATE TABLE users (
  id                uuid PRIMARY KEY,
  auth_provider_id  text UNIQUE,
  email             citext UNIQUE,
  phone_e164        text UNIQUE,
  locale            text DEFAULT 'fr-CA',
  birth_year        smallint,               -- year only; never store a full DOB you don't need
  home_h3_r7        bigint,                 -- coarse home area, consented; NEVER raw coordinates
  trust_level       smallint DEFAULT 0,     -- see doc 08
  verified_email    boolean, verified_phone boolean, verified_id boolean,
  taste_embedding   vector(1024),
  status            text DEFAULT 'active',  -- active|suspended|deleted
  created_at        timestamptz DEFAULT now(),
  deleted_at        timestamptz
);

CREATE TABLE providers (              -- businesses / organizations
  id             uuid PRIMARY KEY,
  legal_name     text, display_name text NOT NULL,
  claim_status   text DEFAULT 'unclaimed',  -- unclaimed|pending|verified|rejected
  claim_method   text,                      -- meta_oauth|google_business|phone|postcard|manual
  subscription_tier text DEFAULT 'free',
  connected_accounts jsonb,                 -- {instagram:{id,handle,connected_at}, ...}
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE provider_members (
  provider_id uuid REFERENCES providers(id), user_id uuid REFERENCES users(id),
  role text NOT NULL,                        -- owner|manager|editor
  PRIMARY KEY (provider_id, user_id)
);
```

```sql
-- ---------- Outings (the group feature) ----------

CREATE TABLE outings (
  id               uuid PRIMARY KEY,
  activity_id      uuid REFERENCES activities(id),
  venue_id         uuid REFERENCES venues(id),
  host_user_id     uuid REFERENCES users(id),
  host_provider_id uuid REFERENCES providers(id),   -- business-run session
  mode             text NOT NULL,            -- 'fixed' | 'rally'
  status           text NOT NULL,            -- draft|open|confirmed|full|cancelled|completed
  visibility       text NOT NULL,            -- public|friends|link_only|invite
  starts_at        timestamptz,              -- null while a rally is still voting
  ends_at          timestamptz,
  timezone         text NOT NULL,
  capacity_min     smallint DEFAULT 2,
  capacity_max     smallint,
  decision_deadline timestamptz,             -- rally: when it confirms or dies
  join_policy      text DEFAULT 'open',      -- open|approval|invite
  cost_cents       int, cost_notes text,
  meeting_point    geography(Point,4326),    -- must be a public place; see doc 08
  meeting_notes    text,
  waiver_version   text,                     -- required when activity.risk_tier >= 2
  audience_restriction text,                 -- see legal caveat in doc 03/11
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX outings_discovery_ix ON outings (starts_at)
  WHERE status IN ('open','confirmed') AND visibility = 'public';

CREATE TABLE outing_time_options (           -- rally mode
  id uuid PRIMARY KEY, outing_id uuid REFERENCES outings(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL
);

CREATE TABLE outing_votes (
  outing_id uuid, time_option_id uuid REFERENCES outing_time_options(id),
  user_id uuid REFERENCES users(id),
  availability text NOT NULL,                -- yes|maybe|no
  PRIMARY KEY (time_option_id, user_id)
);

CREATE TABLE outing_participants (
  outing_id uuid REFERENCES outings(id) ON DELETE CASCADE,
  user_id   uuid REFERENCES users(id),
  role      text NOT NULL DEFAULT 'attendee',  -- host|cohost|attendee
  state     text NOT NULL,                     -- interested|requested|joined|waitlisted|declined|removed
  guests    smallint DEFAULT 0,
  joined_at timestamptz,
  checked_in_at timestamptz,
  attendance text,                             -- attended|no_show|excused  (set post-hoc)
  waiver_accepted_at timestamptz,
  PRIMARY KEY (outing_id, user_id)
);
```

> **Concurrency:** joining a full outing is a classic race. Either take
> `SELECT ... FOR UPDATE` on the outing row before counting, or enforce capacity with a
> constraint trigger. Do not count-then-insert without a lock; at scale you *will*
> oversell popular outings.

```sql
-- ---------- Social & safety ----------

CREATE TABLE blocks (
  blocker_id uuid, blocked_id uuid, created_at timestamptz DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE reports (
  id uuid PRIMARY KEY,
  reporter_id uuid, subject_type text, subject_id uuid,   -- user|activity|outing|message|photo|review
  reason text NOT NULL, details text,
  severity smallint, status text DEFAULT 'open',
  assigned_to uuid, resolution text,
  created_at timestamptz DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX reports_triage_ix ON reports (status, severity DESC, created_at);

CREATE TABLE moderation_decisions (          -- append-only audit trail
  id bigserial PRIMARY KEY, subject_type text, subject_id uuid,
  decision text, reason text, actor text,    -- 'ai:haiku' | 'user:<uuid>' | 'system'
  model_version text, scores jsonb, created_at timestamptz DEFAULT now()
);
```

```sql
-- ---------- Media, reviews, engagement ----------

CREATE TABLE media (
  id uuid PRIMARY KEY,
  owner_type text, owner_id uuid,            -- activity|outing|user|provider
  storage_key text NOT NULL,                 -- R2 object key
  kind text,                                 -- photo|video
  width int, height int, bytes bigint, blurhash text,
  provenance text NOT NULL,                  -- owner_upload|instagram|tiktok|facebook|user_upload|open_data
  license text, attribution text,            -- REQUIRED for open-data imports
  source_url text, imported_at timestamptz,
  safety_status text DEFAULT 'pending',      -- pending|approved|rejected
  quality_score real, is_hero boolean DEFAULT false, sort_order int
);

CREATE TABLE reviews (
  id uuid PRIMARY KEY, activity_id uuid, user_id uuid,
  rating smallint CHECK (rating BETWEEN 1 AND 5),
  body text, locale text,
  visited_at date, verified_attendance boolean DEFAULT false,   -- came from a checked-in outing
  status text DEFAULT 'published',
  created_at timestamptz DEFAULT now(),
  UNIQUE (activity_id, user_id)
);

CREATE TABLE saves (
  user_id uuid, activity_id uuid, list_id uuid, created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, activity_id, list_id)
);

-- High-volume, append-only. Partition by day, retain 90 days, roll up nightly.
CREATE TABLE impressions (
  user_id uuid, activity_id uuid, surface text, position smallint,
  shown_at timestamptz NOT NULL, clicked boolean DEFAULT false
) PARTITION BY RANGE (shown_at);
```

## Versioning & community edits

Activities are wiki-like: business owners, the community, and AI all write to them.

```sql
CREATE TABLE activity_revisions (
  id bigserial PRIMARY KEY, activity_id uuid, revision int,
  patch jsonb NOT NULL,                     -- JSON-merge-patch of what changed
  author_type text, author_id uuid,         -- owner|community|ai|import
  status text DEFAULT 'applied',            -- proposed|applied|reverted|rejected
  created_at timestamptz DEFAULT now()
);
```

Rules:
- **Owner-set fields beat community-set fields beat AI-set fields**, per field, tracked in
  `activity_tags.source` and a parallel `field_provenance jsonb` on the activity.
- A community edit to an *owner-claimed* listing becomes a **proposal** the owner can accept
  in one tap, auto-applying after 7 days if untouched and if the editor is trust_level ≥ 2.
- Everything is revertible. Vandalism on a claimed listing is a support ticket, not a crisis.

## Deletion & retention

Design this now; retrofitting deletion into a social graph is miserable.

- `users.deleted_at` → hard-delete PII within 30 days; keep an anonymized `deleted_user`
  tombstone so outing history and counts don't corrupt.
- Reviews and public contributions survive as "Former member" unless the user requests
  removal (Law 25 / GDPR erasure — see [11](11-legal-and-compliance.md)).
- Outing chat: purge 90 days after the outing ends.
- Impressions/location logs: 30–90 days, then aggregate.
- Everything deletable must be deletable **by a background job with a resumable cursor**,
  not a single transaction.

## Indexing summary (the ones that matter)

| Index | Query it serves |
|---|---|
| GIST on `activity_locations.geom` | "near me" radius |
| B-tree on `activity_locations.h3_r7` | candidate-set caching by cell |
| GIN on `activities.tag_slugs` | multi-tag AND filtering |
| GIN on `activities.search_tsv` (fr + en) | keyword search |
| HNSW on `activities.embedding` | semantic search, "more like this" |
| Partial B-tree on `outings (starts_at) WHERE status IN (...)` | upcoming outings feed |
| trigram on `venues.name` | dedup + admin search |
