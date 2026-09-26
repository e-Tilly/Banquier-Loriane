-- Stage 5: outings, rallies, the AI concierge, and the safety constraints that replace a
-- moderation team. See docs/alentour/06-groups-and-outings.md and 08-trust-safety-and-moderation.md.
--
-- THE BRIGHT LINE, IN THE SCHEMA: the concierge has no row in `users`. Participants, votes and
-- chat authors reference users(id), so the AI cannot appear in an attendee list, count toward
-- quorum or capacity, or post as a person — there is nothing to put there. Its chat messages
-- have kind = 'concierge' and a NULL author, and the app labels them "Alentour".

-- ------------------------------------------------------------ users: what joining requires
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS adult_attested_at timestamptz,          -- "I am 18 or older"
  ADD COLUMN IF NOT EXISTS outings_opt_in    boolean NOT NULL DEFAULT false,  -- concierge may invite me
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS restricted_until  timestamptz;          -- auto-restriction after a critical report

-- ------------------------------------------------------------ outings
ALTER TABLE outings DROP CONSTRAINT IF EXISTS one_host;
ALTER TABLE outings
  ADD COLUMN IF NOT EXISTS organizer text NOT NULL DEFAULT 'user'
    CHECK (organizer IN ('user', 'venue', 'concierge')),
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cards_sent text[] NOT NULL DEFAULT '{}',  -- 't24', 't2', 'checkin', 'after'
  ADD COLUMN IF NOT EXISTS purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outings ALTER COLUMN status SET DEFAULT 'voting';
ALTER TABLE outings ADD CONSTRAINT outings_status_check
  CHECK (status IN ('voting', 'confirmed', 'paused', 'cancelled', 'completed'));
-- A person-organized outing has an accountable human host; the concierge and venues do not
-- host anyone — the venue is a public business with staff and a street address.
ALTER TABLE outings ADD CONSTRAINT outings_host_check CHECK (
  (organizer = 'user' AND host_user_id IS NOT NULL) OR (organizer <> 'user' AND host_user_id IS NULL));
ALTER TABLE outings ADD CONSTRAINT outings_capacity_check CHECK (capacity_min >= 2 AND capacity_min <= capacity_max);
ALTER TABLE outings ADD CONSTRAINT outings_rally_deadline CHECK (mode <> 'rally' OR decision_deadline IS NOT NULL);
ALTER TABLE outings ADD CONSTRAINT outings_scheduled CHECK (mode = 'rally' OR starts_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS outings_upcoming_ix ON outings (starts_at) WHERE status IN ('voting', 'confirmed');
CREATE INDEX IF NOT EXISTS outings_activity_ix ON outings (activity_id, created_at DESC);
-- Venue sessions are generated idempotently: one per program run.
CREATE UNIQUE INDEX IF NOT EXISTS outings_one_session
  ON outings (activity_id, starts_at) WHERE mode = 'venue_session';

CREATE TABLE outing_time_options (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outing_id  uuid NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  starts_at  timestamptz NOT NULL,
  position   smallint NOT NULL,
  UNIQUE (outing_id, starts_at)
);

-- Only the people a rally was offered to may vote on it.
CREATE TABLE outing_invites (
  outing_id  uuid NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     text NOT NULL CHECK (reason IN ('saved', 'proposer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (outing_id, user_id)
);

CREATE TABLE outing_votes (
  option_id  uuid NOT NULL REFERENCES outing_time_options(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer     text NOT NULL CHECK (answer IN ('yes', 'maybe', 'no')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, user_id)
);

CREATE TABLE outing_participants (
  outing_id     uuid NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'maybe', 'left', 'removed')),
  joined_at     timestamptz NOT NULL DEFAULT now(),
  checked_in_at timestamptz,
  rating        smallint CHECK (rating BETWEEN 1 AND 5),
  would_repeat  boolean,
  PRIMARY KEY (outing_id, user_id)
);
CREATE INDEX outing_participants_user_ix ON outing_participants (user_id);

-- Outing-scoped chat only. No DMs. Purged 90 days after the outing.
CREATE TABLE outing_messages (
  id          bigserial PRIMARY KEY,
  outing_id   uuid NOT NULL REFERENCES outings(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('user', 'concierge', 'system')),
  body        text NOT NULL CHECK (length(body) <= 2000),
  status      text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'held', 'removed')),
  moderation  jsonb,                      -- {layer, scores, model, decision}
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concierge_has_no_author CHECK ((kind = 'user') = (author_id IS NOT NULL))
);
CREATE INDEX outing_messages_ix ON outing_messages (outing_id, id);

-- Blocks are total and silent, and every outing query filters on them.
CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_ix ON blocks (blocked_id);

-- SMS codes for phone verification; HMAC only, like email codes.
CREATE TABLE phone_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_e164  text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_codes_user_ix ON phone_codes (user_id, created_at DESC);

-- In-app inbox; push is a best-effort copy of it.
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  outing_id  uuid REFERENCES outings(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_ix ON notifications (user_id, id DESC);

CREATE TABLE push_tokens (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_ix ON push_tokens (user_id);

-- Operator switches. "If you are away for more than a few days with outings live, pause new
-- outing creation. Build that switch on day one." (doc 08)
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES ('outings', '{"paused": false, "creationPaused": false}')
ON CONFLICT (key) DO NOTHING;

-- Everyone attached to an outing, for block enforcement: going/maybe participants, the host,
-- and anyone who voted yes/maybe on a rally option. Every outing query filters through this.
CREATE VIEW outing_members AS
  SELECT outing_id, user_id FROM outing_participants WHERE status IN ('going', 'maybe')
  UNION
  SELECT id, host_user_id FROM outings WHERE host_user_id IS NOT NULL
  UNION
  SELECT t.outing_id, v.user_id FROM outing_votes v JOIN outing_time_options t ON t.id = v.option_id
   WHERE v.answer <> 'no';
