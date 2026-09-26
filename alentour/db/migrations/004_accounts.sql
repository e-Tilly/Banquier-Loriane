-- Stage 2: accounts, sessions, sync, reports.
-- See docs/alentour/08-trust-safety-and-moderation.md and 11-legal-and-compliance.md.

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- One user, many ways to prove it's them (email code, Apple, Google).
CREATE TABLE user_identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    text NOT NULL CHECK (provider IN ('email', 'apple', 'google')),
  subject     text NOT NULL,              -- lowercased email, or the provider's `sub`
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX user_identities_user_ix ON user_identities (user_id);

-- One-time email codes. Only an HMAC of the code is stored; never the code itself.
CREATE TABLE auth_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    smallint NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  ip_hash     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_codes_email_ix ON auth_codes (email, created_at DESC);

-- Opaque sessions, stored hashed, so account deletion revokes them immediately — which a
-- stateless JWT cannot do.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text
);
CREATE INDEX sessions_user_ix ON sessions (user_id);

-- The synced library: saves + lists with timestamps and tombstones (src/user/library.ts).
-- Stored as one document because merge is per-entry last-writer-wins over the whole thing.
CREATE TABLE libraries (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT library_size CHECK (pg_column_size(data) < 262144)   -- 256 KB is thousands of saves
);

-- "Report a problem" — in Stage 1-2 this is most of the moderation system.
CREATE TABLE reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('activity', 'venue', 'user', 'outing', 'message', 'photo')),
  subject_id   text NOT NULL,
  reason       text NOT NULL,
  details      text,
  severity     smallint NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 4),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  ip_hash      text,
  resolution   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX reports_triage_ix ON reports (status, severity DESC, created_at);
CREATE INDEX reports_subject_ix ON reports (subject_type, subject_id);

-- `saves` (001) stays, derived from the library on every sync: the outreach agent counts
-- saves per venue in SQL, which a jsonb blob would make needlessly awkward.
