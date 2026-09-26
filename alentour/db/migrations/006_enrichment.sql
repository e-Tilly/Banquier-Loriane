-- Stage 4: AI enrichment jobs, self-serve onboarding, photo handling and the freshness loop.
-- See docs/alentour/07-supply-onboarding-and-ai.md.

-- One row per enrichment run. Onboarding jobs belong to the owner who started them; seed jobs
-- are created by the batch CLI. The job is the audit trail: what was read (sources), what the
-- model proposed after the gate (draft), what the gate threw away and why (dropped).
CREATE TABLE enrichment_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin       text NOT NULL CHECK (origin IN ('onboarding', 'seed')),
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'fetching', 'extracting', 'writing', 'ready',
                                 'failed', 'published', 'discarded')),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  input        jsonb NOT NULL,            -- {name, pitch, website, address, lat, lon, neighbourhood}
  sources      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{url, fetchedAt, chars}] — provenance
  draft        jsonb,                     -- gated extraction + copy, per-field confidence/evidence
  dropped      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{field, reason}] — what the gate removed
  usage        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- token counts, for the cost model
  error        text,
  attempts     smallint NOT NULL DEFAULT 0,
  batch_id     text,                      -- Message Batches id, seed mode
  venue_id     uuid REFERENCES venues(id) ON DELETE SET NULL,   -- set on publish
  locked_at    timestamptz,               -- worker lease; a crashed worker's job is retried
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enrichment_jobs_user_ix ON enrichment_jobs (requested_by, created_at DESC);
CREATE INDEX enrichment_jobs_queue_ix ON enrichment_jobs (status, created_at)
  WHERE status IN ('queued', 'fetching', 'extracting', 'writing');

-- Photos can arrive before the listing exists (on the onboarding review screen), so media may
-- hang off a job until it is published.
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_owner_type_check;
ALTER TABLE media ADD CONSTRAINT media_owner_type_check
  CHECK (owner_type IN ('activity', 'venue', 'provider', 'job'));
ALTER TABLE media
  ADD COLUMN IF NOT EXISTS uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS triage       jsonb,        -- {kind, quality, hasFaces, textOverlay}
  ADD COLUMN IF NOT EXISTS has_faces    boolean,
  -- The media-rights licence (doc 07): the owner grants a display licence and confirms they may.
  ADD COLUMN IF NOT EXISTS licence_granted_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now();

-- Where a listing came from, so review queues and quality dashboards can split by pipeline.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'curated'
    CHECK (origin IN ('curated', 'seed_ai', 'onboarding', 'community'));

-- The 90-day "still accurate?" nudge is sent at most once a month per business.
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_nudged_at timestamptz;
