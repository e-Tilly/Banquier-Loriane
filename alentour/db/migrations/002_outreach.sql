-- Alentour — outreach agent (the AI ambassador that writes to businesses).
-- See docs/alentour/14-outreach-agent.md.
--
-- CASL note: every row in outreach_messages must be traceable to a consent basis and its
-- evidence. The CRTC's due-diligence defence depends on being able to prove it later.

-- ------------------------------------------------------------ contacts
CREATE TABLE business_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid REFERENCES providers(id) ON DELETE CASCADE,
  venue_id      uuid REFERENCES venues(id) ON DELETE CASCADE,
  email         text NOT NULL,
  email_domain  text GENERATED ALWAYS AS (lower(split_part(email, '@', 2))) STORED,
  contact_name  text,
  locale        text NOT NULL DEFAULT 'fr-CA',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_has_subject CHECK (num_nonnulls(provider_id, venue_id) >= 1),
  UNIQUE (email)
);
CREATE INDEX business_contacts_domain_ix ON business_contacts (email_domain);

-- ------------------------------------------------------------ consent evidence
-- One row per basis we rely on. Never inferred at send time — it must already exist.
CREATE TABLE consent_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   uuid NOT NULL REFERENCES business_contacts(id) ON DELETE CASCADE,
  basis        text NOT NULL CHECK (basis IN
                 ('express_consent','existing_business_relationship','conspicuous_publication')),

  -- conspicuous_publication evidence (CASL s.10(9)(b)): all three must hold
  source_url            text,        -- where the business published this address
  captured_at           timestamptz, -- when we saw it
  snapshot_key          text,        -- stored copy of the page, for the audit trail
  anti_solicitation_checked boolean NOT NULL DEFAULT false,
  anti_solicitation_found   boolean,  -- true => basis is INVALID
  relevance_note        text,        -- why the message relates to their business role

  -- express / EBR evidence
  event_type   text,                 -- 'claimed_listing' | 'enquiry' | 'opt_in_form' | 'subscription'
  event_at     timestamptz,
  event_detail jsonb,

  expires_at   timestamptz,          -- EBR: event_at + 24 months. NULL for express.
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT publication_evidence_complete CHECK (
    basis <> 'conspicuous_publication' OR (
      source_url IS NOT NULL AND captured_at IS NOT NULL
      AND anti_solicitation_checked = true AND anti_solicitation_found = false
      AND relevance_note IS NOT NULL
    )
  ),
  CONSTRAINT relationship_evidence_complete CHECK (
    basis <> 'existing_business_relationship' OR (event_type IS NOT NULL AND event_at IS NOT NULL)
  )
);
CREATE INDEX consent_records_contact_ix ON consent_records (contact_id, basis);

-- ------------------------------------------------------------ suppression (permanent)
-- An unsubscribe is forever and applies to the whole domain. There is no re-permissioning.
CREATE TABLE suppressions (
  email_or_domain text PRIMARY KEY,
  scope           text NOT NULL CHECK (scope IN ('email','domain')),
  reason          text NOT NULL CHECK (reason IN
                    ('unsubscribed','complained','bounced_hard','manual','not_interested','cap_reached')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ demand signals
-- The evidence a message is allowed to cite. Snapshotted so the claim stays provable
-- even after the underlying saves change.
CREATE TABLE demand_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  activity_id     uuid REFERENCES activities(id) ON DELETE SET NULL,
  window_days     integer NOT NULL,
  distinct_users  integer NOT NULL,
  saves_count     integer NOT NULL,
  failed_rallies  integer NOT NULL DEFAULT 0,
  top_slots       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{weekday, hour, weight}]
  segments        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {beginners: 5, never_booked: 8}
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demand_signals_venue_ix ON demand_signals (venue_id, computed_at DESC);

-- ------------------------------------------------------------ messages
CREATE TABLE outreach_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    uuid NOT NULL REFERENCES business_contacts(id) ON DELETE CASCADE,
  signal_id     uuid NOT NULL REFERENCES demand_signals(id),
  consent_id    uuid NOT NULL REFERENCES consent_records(id),

  sequence_no   smallint NOT NULL DEFAULT 1,            -- 1 = first touch, 2 = the single follow-up
  locale        text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,                          -- model-written body, WITHOUT the footer
  claims        jsonb NOT NULL DEFAULT '[]'::jsonb,     -- every factual assertion, for verification
  proposed_slots jsonb NOT NULL DEFAULT '[]'::jsonb,

  model         text,
  verified      boolean NOT NULL DEFAULT false,         -- claims checked against signal_id
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN
                  ('draft','rejected','approved','sent','replied','bounced','unsubscribed')),
  reviewed_by   text,
  reviewed_at   timestamptz,
  sent_at       timestamptz,
  replied_at    timestamptz,
  unsubscribe_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- nothing leaves 'draft' unverified, and nothing is sent without human review
  CONSTRAINT verified_before_approval CHECK (status IN ('draft','rejected') OR verified = true),
  CONSTRAINT reviewed_before_send     CHECK (status NOT IN ('sent','replied') OR reviewed_at IS NOT NULL)
);
CREATE INDEX outreach_contact_ix ON outreach_messages (contact_id, sent_at DESC);
CREATE INDEX outreach_queue_ix    ON outreach_messages (status, created_at);

-- Frequency cap: no two SENT messages to one contact within 30 days.
-- An exclusion constraint states the rule directly. (A unique index on the day would only
-- prevent two sends on the same calendar day, and date_trunc is STABLE, not IMMUTABLE, so it
-- cannot be indexed at all.) consent.ts enforces the same rule before drafting; this is the
-- backstop that makes it impossible to violate by any path.
-- `timestamptz + interval` is STABLE (day arithmetic depends on the session timezone across
-- DST), so the window end cannot be computed inside the constraint. Store it instead.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE outreach_messages ADD COLUMN cooloff_until timestamptz;

CREATE OR REPLACE FUNCTION set_outreach_cooloff() RETURNS trigger AS $$
BEGIN
  NEW.cooloff_until := CASE WHEN NEW.sent_at IS NULL THEN NULL
                            ELSE NEW.sent_at + interval '30 days' END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outreach_cooloff
  BEFORE INSERT OR UPDATE OF sent_at ON outreach_messages
  FOR EACH ROW EXECUTE FUNCTION set_outreach_cooloff();

ALTER TABLE outreach_messages ADD CONSTRAINT outreach_one_per_30d
  EXCLUDE USING gist (
    contact_id WITH =,
    tstzrange(sent_at, cooloff_until) WITH &&
  ) WHERE (sent_at IS NOT NULL);

-- Immutable send log. Separate from outreach_messages so an edit to a draft can never
-- rewrite history — this is the table you show a regulator.
CREATE TABLE outreach_send_log (
  id          bigserial PRIMARY KEY,
  message_id  uuid NOT NULL REFERENCES outreach_messages(id),
  contact_email text NOT NULL,
  consent_basis text NOT NULL,
  consent_evidence jsonb NOT NULL,
  rendered_body text NOT NULL,      -- exactly what was sent, footer included
  sent_at     timestamptz NOT NULL DEFAULT now()
);
