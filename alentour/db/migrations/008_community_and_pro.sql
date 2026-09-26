-- Stage 6: user-created activities, the "still accurate?" loop, and Business Pro billing.
-- See docs/alentour/07 (user-created activities), 08 (trust levels) and 12 (Pro).

-- ------------------------------------------------------------ community submissions
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booking_url text,                    -- Pro: a "Book" button in the app
  ADD COLUMN IF NOT EXISTS review_note text;
CREATE INDEX IF NOT EXISTS activities_created_by_ix ON activities (created_by) WHERE created_by IS NOT NULL;

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'catalog' CHECK (origin IN ('catalog', 'community')),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- "Is this still accurate?" from people who saved or went. Two confirmations re-verify a
-- listing; two disputes flag it for review (doc 07).
CREATE TABLE activity_confirmations (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accurate    boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

-- ------------------------------------------------------------ Business Pro (Stripe)
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status    text,            -- Stripe's own status string
  ADD COLUMN IF NOT EXISTS pro_until              timestamptz;     -- end of the paid period
ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_tier_check;
ALTER TABLE providers ADD CONSTRAINT providers_tier_check CHECK (subscription_tier IN ('free', 'pro'));

-- Every webhook event once. Stripe retries, and replays must be harmless.
CREATE TABLE stripe_events (
  id          text PRIMARY KEY,
  type        text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL
);
