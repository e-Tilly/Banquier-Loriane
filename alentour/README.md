# Alentour — the code

A filterable dictionary of things to do in Montréal, with small-group outings organized by an
AI concierge that is never a participant. This folder implements the plan in
[`../docs/alentour/`](../docs/alentour/); start with
[02 — Scope & roadmap](../docs/alentour/02-scope-and-roadmap.md) for the why, and
[15 — Deploy & operate](../docs/alentour/15-deploy-and-operate.md) to put it online.

All six stages of the roadmap are built. Each one works without the next: you can ship Stage 1
alone (a static catalog, ~$10/month) and switch the rest on as the gates in
[12](../docs/alentour/12-monetization-and-metrics.md) are met.

| Stage | What it adds | Switched on by |
|---|---|---|
| 1 — Catalog, no backend | Browse, shelves, filters, map, lists, FR/EN, weather-aware ranking | Upload `catalog.*.json` to R2 |
| 2 — Accounts & sync | Passwordless sign-in, synced saves and lists, export, deletion | Deploy the API, set `EXPO_PUBLIC_API_URL` |
| 3 — Business claims | Claim a listing, owner edit pages, admin review | Nothing extra |
| 4 — AI enrichment | Website → structured draft → owner review; bulk seeding; photos; freshness emails | `ANTHROPIC_API_KEY`, R2 for photos |
| 5 — Outings | Venue sessions, rallies, AI concierge, chat, safety constraints | `TWILIO_*`, `OPERATOR_EMAIL` |
| 6 — Community & revenue | User-added activities, "still accurate?", Business Pro | `STRIPE_*` |

## Layout

```
taxonomy/taxonomy.yaml   the closed vocabulary — 80 tags, 10 facets, versioned; synced into Postgres
db/migrations/           001–008, applied in order by `npm run db:migrate`
db/seed/                 10 real Plateau/Mile End activities, FR and EN
db/seed-input/           the JSONL shape the bulk seeding pipeline reads
src/catalog/             filter, rank, shelves, hours, export     ← shared with the app
src/api/                 Hono API + server-rendered owner pages (/owner) + unsubscribe (/u)
src/claims/              claims and owner edits with revision history
src/enrichment/          website reading (SSRF-safe, robots.txt), Claude extraction, the gate,
                         copy, photo stripping and triage, R2 storage, Batch API seeding
src/outings/             sessions, rallies, the concierge, chat moderation, blocks, phone, push
src/community/           user-added activities, trust, the accuracy loop
src/billing/             Stripe Checkout, signed webhooks, entitlements
src/outreach/            the AI ambassador that writes to businesses — CASL-gated, human-approved
src/freshness/           90-day owner nudges, stale-listing demotion
src/weather/             one forecast per city per hour, published as a static file
scripts/                 db, admin CLI, enrich, freshness, outreach-send, dev weather
app/                     the Expo app (SDK 57, Expo Router, FR/EN, offline-first)
test/                    187 tests; the database ones need DATABASE_URL, none need an API key
```

## Setup

Requires Node 22 and Postgres 14+ (no extensions beyond what ships with Postgres).

```bash
npm install
cp .env.example .env              # DATABASE_URL is the only required value for development
npm run db:reset                  # migrate + seed (refuses anything that looks like production)
npm run catalog:export            # → out/catalog.fr-CA.json, catalog.en-CA.json
npm run dev:weather               # → out/weather.montreal.json (synthetic; --rain / --cold)
npm run api:dev                   # API on :8787; sign-in codes and SMS codes print to the log
```

The app:

```bash
cd app && npm install
cp .env.example .env              # EXPO_PUBLIC_CDN_URL, EXPO_PUBLIC_API_URL, …
npx expo start --clear            # --clear after any EXPO_PUBLIC_* change
```

Serve `out/` on the CDN URL (`npx serve out -l 3000` works). Without `EXPO_PUBLIC_API_URL` the
app is the Stage 1 dictionary: no accounts, no outings, nothing that needs a server.

## Commands

```bash
npm test                          # everything; database tests skip without DATABASE_URL
npm run typecheck                 # and: cd app && npx tsc --noEmit
npm run taxonomy:check            # validate the vocabulary
npm run catalog:export            # Postgres → static catalog files
npm run weather:publish -- ./out  # real forecast (Open-Meteo)
npm run enrich -- load db/seed-input/montreal-sample.jsonl   # queue venues for AI seeding
npm run enrich -- run             # …or batch:prepare / batch:submit / batch:collect <id>
npm run freshness                 # monthly "still accurate?" emails to owners
npm run outreach:run              # find demand, draft messages (dry run by default)
npm run outreach:send             # send what you approved (refuses while OUTREACH_DRY_RUN=1)
npm run admin -- <command>        # the operator's toolbox — run with no command for the list
```

## How it fits together

```
 laptop / CI                          Cloudflare R2 + CDN                 phones
 ─────────────                        ───────────────────                 ──────
 Postgres ──catalog:export──────────► catalog.fr-CA.json ───────────────► Expo app
          ──weather:publish (hourly)► weather.montreal.json ────────────►  filters on-device
                                      photos (m/*.jpg) ─────────────────►
 API (one container) ◄──────────────────────────────────────────────────  accounts, sync,
   ├─ /v1/*   JSON for the app                                             outings, chat,
   ├─ /owner  web pages for businesses (claim, onboard, edit, billing)     additions
   ├─ /u      CASL unsubscribe
   ├─ enrichment worker (onboarding drafts)
   └─ outing clock (sessions, concierge, deadlines, reminders, purge)
```

The catalog never goes through the API: 2,000 activities is ~1 MB gzipped, filtered on the
phone, cached for offline. The API only holds what is personal.

## Invariants — the things not to break

Each one is enforced in code *and* tested; most are also enforced in the database.

- **The AI never asserts accessibility.** A Postgres trigger refuses `source='ai'` + `value=true`
  on any `a11y.*` tag. The enrichment model can only *mention* what a website says; the owner
  answers. Accessibility is tri-state everywhere: absent means unknown, never "no".
- **The AI never invents a fact.** Every extracted field needs a verbatim quote found in the
  source; prices and ages must appear in their quote; copy may only use numbers from the
  checked facts. The outreach agent may only cite numbers from its demand signal.
- **The concierge is never a participant.** It has no row in `users`, so it cannot be an
  attendee, a voter or a chat author; a constraint requires its messages to have no author.
  Its texts are checked for any hint that it will be there, or of a crowd that doesn't exist.
- **Blocks are enforced in SQL**, through the `outing_members` view, on every outing read and
  write. A blocked outing answers 404, exactly like one that does not exist.
- **Outings are venue-anchored, 18+, phone-verified, max 8**, capacity counted under a row lock.
  A report pauses the outing immediately.
- **Nothing reaches the app unreviewed**: AI-seeded listings, new owners without a domain
  match, and community additions (all of them for new places) wait for `admin publish`.
- **CASL**: no outreach without a recorded consent basis, human approval of every message, the
  legal footer added by code the model never touches, a permanent domain-wide unsubscribe,
  one message per business per 30 days (an exclusion constraint), dry run by default.
- **Money only changes through a verified webhook**, and each Stripe event applies once.

## Tests

`npm test` runs 187 tests: pure units (taxonomy, hours, filters, shelves, the enrichment gate,
image stripping, SigV4 against the AWS vector, webhook signatures, slot proposal across daylight
saving) and flows against a real Postgres (each file gets its own `alentour_test_*` database):
sign-in, sync, claims, onboarding with a stubbed model, seeding and Batch mode, outings with
races for the last spot, blocks, auto-pause, the reminder clock, community additions, Stripe,
outreach sending and unsubscribe. CI runs all of it on every push
(`.github/workflows/alentour-ci.yml`), plus both typechecks and a web build of the app.
