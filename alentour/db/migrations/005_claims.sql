-- Stage 3: business claims, owner membership, and the revision history of edits.
-- See docs/alentour/07-supply-onboarding-and-ai.md (claim flow) and 04-data-model.md (revisions).

ALTER TABLE venues ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES providers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS venues_provider_ix ON venues (provider_id);

CREATE TABLE provider_members (
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'editor')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, user_id)
);
CREATE INDEX provider_members_user_ix ON provider_members (user_id);

CREATE TABLE claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  claimant_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name   text NOT NULL,
  role            text NOT NULL,                 -- "owner", "manager", … as the claimant describes it
  contact_email   text NOT NULL,
  contact_phone   text,
  message         text,
  -- email_domain: a code sent to an address at the venue's own website domain (instant).
  -- manual:       reviewed by a person (phone call, document, anything else).
  method          text NOT NULL CHECK (method IN ('email_domain', 'manual')),
  code_hash       text,
  code_expires_at timestamptz,
  code_attempts   smallint NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'verified', 'rejected', 'withdrawn')),
  reviewed_by     text,
  review_note     text,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claims_queue_ix ON claims (status, created_at);
-- One open claim per person per venue; contested claims (two different claimants) are allowed
-- and land in the review queue together, which is exactly where a human should see them.
CREATE UNIQUE INDEX claims_one_open_per_claimant
  ON claims (venue_id, claimant_id) WHERE status = 'pending';

-- Every change to a listing, whoever made it. Revertible, attributable, and the audit trail
-- for "who said this place is step-free?".
CREATE TABLE activity_revisions (
  id           bigserial PRIMARY KEY,
  activity_id  uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  author_type  text NOT NULL CHECK (author_type IN ('owner', 'community', 'ai', 'import', 'admin')),
  author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  patch        jsonb NOT NULL,                    -- the fields that changed, new values
  previous     jsonb NOT NULL,                    -- the same fields, old values — makes revert exact
  status       text NOT NULL DEFAULT 'applied' CHECK (status IN ('proposed', 'applied', 'rejected', 'reverted')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_revisions_ix ON activity_revisions (activity_id, created_at DESC);
