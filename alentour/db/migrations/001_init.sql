-- Alentour — core schema.
-- Stage 1 runs this on a LOCAL Postgres only. It is the authoring source for the
-- static catalog file; it is not deployed until Stage 2. See docs/alentour/09-architecture.md.
--
-- Requires only pg_trgm and pgcrypto — both ship with core Postgres.
--
-- Coordinates are plain doubles here, NOT PostGIS geography. Stage 1 filters on-device with
-- haversine over a JSON catalog, so nothing queries spatially; requiring a PostGIS build just
-- to author 500 rows on a laptop is a tax with no benefit. 003_postgis.sql adds the geography
-- columns and GIST indexes when queries move server-side at Stage 2. The lat/lon columns stay,
-- so that migration is additive.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================ venues
CREATE TABLE venues (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  lat              double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon              double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  address          jsonb,
  neighbourhood    text,
  timezone         text NOT NULL DEFAULT 'America/Toronto',
  external_ids     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {overture:…, osm:…, google_place_id:…}
  operating_status text NOT NULL DEFAULT 'open'
                   CHECK (operating_status IN ('open','temporarily_closed','permanently_closed','seasonal_closed')),
  website          text,
  phone_e164       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venues_name_trgm ON venues USING GIN (name gin_trgm_ops);

-- ============================================================ providers (businesses)
CREATE TABLE providers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name   text NOT NULL,
  legal_name     text,
  claim_status   text NOT NULL DEFAULT 'unclaimed'
                 CHECK (claim_status IN ('unclaimed','pending','verified','rejected')),
  claim_method   text,
  claimed_at     timestamptz,
  subscription_tier text NOT NULL DEFAULT 'free',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ activities
CREATE TABLE activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text UNIQUE NOT NULL,
  kind             text NOT NULL
                   CHECK (kind IN ('place','scheduled_event','recurring_program','self_guided','seasonal')),
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','pending_review','published','hidden','removed')),
  provider_id      uuid REFERENCES providers(id) ON DELETE SET NULL,

  primary_category text NOT NULL,                        -- a category.* slug
  secondary_categories text[] NOT NULL DEFAULT '{}',

  -- money: integer cents + explicit currency, never floats
  price_min_cents  integer CHECK (price_min_cents >= 0),
  price_max_cents  integer CHECK (price_max_cents >= 0),
  currency         char(3) NOT NULL DEFAULT 'CAD',
  price_unit       text CHECK (price_unit IN ('per_person','per_group','per_hour','per_day','per_entry')),
  is_free          boolean NOT NULL DEFAULT false,
  has_free_option  boolean NOT NULL DEFAULT false,

  duration_min_minutes integer,
  duration_max_minutes integer,
  typical_duration_minutes integer,

  physical_demand  smallint CHECK (physical_demand BETWEEN 0 AND 4),
  skill_required   smallint CHECK (skill_required  BETWEEN 0 AND 4),
  risk_tier        smallint NOT NULL DEFAULT 0 CHECK (risk_tier BETWEEN 0 AND 3),
  icebreaker_score smallint CHECK (icebreaker_score BETWEEN 0 AND 2),

  months_open      smallint NOT NULL DEFAULT 4095,        -- 12-bit mask, Jan = bit 0
  best_months      smallint,
  weather_dependency text CHECK (weather_dependency IN ('indoor','covered','outdoor','either')),
  opening_hours    text,                                  -- OSM opening_hours syntax
  min_age          smallint,
  max_age          smallint,

  starts_at        timestamptz,                           -- scheduled_event / seasonal only
  ends_at          timestamptz,

  -- denormalized query path; truth + provenance lives in activity_tags
  tag_slugs        text[] NOT NULL DEFAULT '{}',

  quality_score    real NOT NULL DEFAULT 0,
  completeness     real NOT NULL DEFAULT 0,
  taxonomy_version integer NOT NULL,
  last_verified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT price_range_sane CHECK (price_max_cents IS NULL OR price_min_cents IS NULL
                                     OR price_max_cents >= price_min_cents),
  CONSTRAINT event_has_window CHECK (kind <> 'scheduled_event' OR starts_at IS NOT NULL)
);
CREATE INDEX activities_tags_gin  ON activities USING GIN (tag_slugs);
CREATE INDEX activities_live_ix   ON activities (primary_category, quality_score DESC)
  WHERE status = 'published';

-- one row per locale; never title_fr / title_en columns
CREATE TABLE activity_content (
  activity_id  uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  locale       text NOT NULL,
  title        text NOT NULL,
  summary      text,
  description  text,
  what_to_bring text,
  accessibility_notes text,
  source       text NOT NULL DEFAULT 'owner'
               CHECK (source IN ('owner','ai','community','translated','import')),
  PRIMARY KEY (activity_id, locale)
);

-- an activity happens at one or more venues; geom denormalized for the hot query
CREATE TABLE activity_locations (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  venue_id    uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  is_primary  boolean NOT NULL DEFAULT false,
  -- denormalized from venues: the hot query is "activities near me", not "venues near me"
  lat         double precision NOT NULL,
  lon         double precision NOT NULL,
  PRIMARY KEY (activity_id, venue_id)
);

-- Keep the denormalized coordinates honest.
CREATE OR REPLACE FUNCTION sync_activity_location_coords() RETURNS trigger AS $$
BEGIN
  SELECT v.lat, v.lon INTO NEW.lat, NEW.lon FROM venues v WHERE v.id = NEW.venue_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_locations_coords
  BEFORE INSERT OR UPDATE OF venue_id ON activity_locations
  FOR EACH ROW EXECUTE FUNCTION sync_activity_location_coords();

-- ============================================================ tags
CREATE TABLE tags (
  slug          text PRIMARY KEY,
  facet         text NOT NULL,
  label_i18n    jsonb NOT NULL,
  is_filterable boolean NOT NULL DEFAULT true,
  is_tristate   boolean NOT NULL DEFAULT false,
  ai_may_assert boolean NOT NULL DEFAULT true,
  sort_order    integer,
  deprecated_at timestamptz
);

CREATE TABLE activity_tags (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  tag_slug    text NOT NULL REFERENCES tags(slug),
  value       boolean,                     -- NULL = unknown (tri-state). Absence != false.
  source      text NOT NULL CHECK (source IN ('owner','ai','community','derived')),
  confidence  real CHECK (confidence BETWEEN 0 AND 1),
  verified_at timestamptz,
  PRIMARY KEY (activity_id, tag_slug)
);

-- An AI may never assert an accessibility claim. Enforced in the database, not just in code:
-- a hallucinated step-free entrance strands a wheelchair user at a door.
CREATE OR REPLACE FUNCTION enforce_ai_assertion_rules() RETURNS trigger AS $$
BEGIN
  IF NEW.source = 'ai' AND NEW.value IS TRUE THEN
    IF EXISTS (SELECT 1 FROM tags t WHERE t.slug = NEW.tag_slug AND t.ai_may_assert = false) THEN
      RAISE EXCEPTION 'AI may not assert tag % as true (ai_may_assert = false)', NEW.tag_slug;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_tags_ai_guard
  BEFORE INSERT OR UPDATE ON activity_tags
  FOR EACH ROW EXECUTE FUNCTION enforce_ai_assertion_rules();

-- Keep the denormalized array in sync with the normalized truth.
--
-- Accessibility tags are deliberately EXCLUDED from tag_slugs. They are tri-state, and this
-- array cannot express "unknown" — a slug is either present or not. Including them would
-- create a second query path where a missing tag reads as "not accessible", silently
-- collapsing unknown into false. Accessibility is queried only through activity_tags (and,
-- in the exported catalog, the dedicated `a11y` object), so there is exactly one way to ask.
CREATE OR REPLACE FUNCTION sync_tag_slugs() RETURNS trigger AS $$
DECLARE target uuid := COALESCE(NEW.activity_id, OLD.activity_id);
BEGIN
  UPDATE activities SET tag_slugs = COALESCE((
    SELECT array_agg(tag_slug ORDER BY tag_slug)
    FROM activity_tags
    WHERE activity_id = target AND value IS TRUE AND tag_slug NOT LIKE 'a11y.%'
  ), '{}') WHERE id = target;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_tags_sync
  AFTER INSERT OR UPDATE OR DELETE ON activity_tags
  FOR EACH ROW EXECUTE FUNCTION sync_tag_slugs();

-- ============================================================ media
CREATE TABLE media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type   text NOT NULL CHECK (owner_type IN ('activity','venue','provider')),
  owner_id     uuid NOT NULL,
  storage_key  text NOT NULL,
  kind         text NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo','video')),
  width        integer, height integer, bytes bigint, blurhash text,
  provenance   text NOT NULL
               CHECK (provenance IN ('owner_upload','instagram','tiktok','facebook','user_upload','open_data')),
  license      text, attribution text, source_url text,
  safety_status text NOT NULL DEFAULT 'pending'
               CHECK (safety_status IN ('pending','approved','rejected')),
  is_hero      boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  imported_at  timestamptz
);
CREATE INDEX media_owner_ix ON media (owner_type, owner_id, sort_order);

-- ============================================================ empty until later stages
-- These ship in Stage 1 deliberately: empty tables are free, re-modelling a live catalog is not.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject   text UNIQUE,
  email          text UNIQUE,
  phone_e164     text UNIQUE,
  locale         text NOT NULL DEFAULT 'fr-CA',
  birth_year     smallint,                    -- year only: never store a DOB you don't need
  trust_level    smallint NOT NULL DEFAULT 0,
  verified_phone boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE saves (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, activity_id)
);
CREATE INDEX saves_activity_recent_ix ON saves (activity_id, created_at DESC);

CREATE TABLE outings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   uuid NOT NULL REFERENCES activities(id),
  venue_id      uuid NOT NULL REFERENCES venues(id),       -- venue-anchored only (v2)
  host_user_id  uuid REFERENCES users(id),
  host_provider_id uuid REFERENCES providers(id),
  mode          text NOT NULL CHECK (mode IN ('fixed','rally','venue_session')),
  status        text NOT NULL DEFAULT 'draft',
  starts_at     timestamptz,
  capacity_min  smallint NOT NULL DEFAULT 2,
  capacity_max  smallint NOT NULL DEFAULT 8 CHECK (capacity_max <= 8),
  decision_deadline timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_host CHECK (num_nonnulls(host_user_id, host_provider_id) = 1)
);
