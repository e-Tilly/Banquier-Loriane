# 15 — Deploy & operate *(the runbook)*

How to put Alentour online stage by stage, what each piece costs, and the routine that keeps it
healthy with one person and ~15 minutes a day. Code lives in [`alentour/`](../../alentour/).

---

## 1. Accounts you need, in the order you need them

| When | Service | Why | Cost |
|---|---|---|---|
| Stage 1 | **Cloudflare** (R2 bucket + custom domain) | Catalog, weather and photo files; $0 egress | Free tier |
| Stage 1 | **Apple Developer**, Google Play Console | TestFlight / internal testing | $99/yr, $25 once |
| Stage 1 | **Expo** (EAS) | Builds and store submission | Free tier |
| Stage 2 | **Postgres** (Supabase, Neon, or Fly Postgres) | The live database | Free tier → ~$25/mo |
| Stage 2 | **API host** (Fly.io, Render, or a VPS) | One small container | ~$5/mo |
| Stage 2 | **Resend** | Sign-in codes, owner emails | Free (3,000/mo) |
| Stage 4 | **Anthropic API** | Enrichment, triage, moderation, concierge | ~$0.27 per business onboarded |
| Stage 5 | **Twilio** (Messaging Service) | Phone verification | ~$0.01 per SMS |
| Stage 6 | **Stripe** (+ Stripe Tax) | Business Pro | 2.9% + 30¢ |

## 2. Stage 1 — the catalog, no backend

1. Create the R2 bucket, attach a custom domain (e.g. `catalog.alentour.app`), allow public
   reads. Add CORS `GET` from `*` so the web build can fetch it.
2. Curate on your laptop: `npm run db:reset`, edit, `npm run catalog:export`.
3. Add the repository secrets `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_BUCKET`. The `alentour-publish` workflow then uploads weather every hour on its own, and
   the catalog when you run it by hand ("Run workflow" → tick *catalog*).
4. Build the app with `EXPO_PUBLIC_CDN_URL=https://catalog.alentour.app` and ship it to
   TestFlight / Play internal testing with EAS:
   ```bash
   cd alentour/app && npx eas init && npx eas build --profile preview --platform all
   ```
   `eas init` also writes the project id push notifications need (Stage 5).

**Protomaps tiles** for the map: build `montreal.pmtiles` once from the Protomaps daily build
(`pmtiles extract … --bbox=-74.0,45.35,-73.45,45.72`), upload to R2, point
`EXPO_PUBLIC_MAP_STYLE_URL` at a style that references it. Without it the map shows markers on
a plain canvas.

## 3. Stage 2+ — the API

The API is one container ([`alentour/Dockerfile`](../../alentour/Dockerfile)). It runs the
migrations on boot, then serves. In production it **refuses to start** without the settings a
real deployment needs — that is deliberate.

Minimum environment (see `alentour/.env.example` for everything):

```
NODE_ENV=production
DATABASE_URL=postgres://…            # sslmode=require for hosted Postgres
API_SECRET=<openssl rand -hex 32>
PUBLIC_URL=https://api.alentour.app
CORS_ORIGINS=https://alentour.app
TRUST_PROXY=1                        # behind Fly/Render, so rate limits see real IPs
RESEND_API_KEY=… MAIL_FROM="Alentour <allo@alentour.app>"
APPLE_AUDIENCE=app.alentour.mobile   GOOGLE_AUDIENCE=<oauth client id>
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com  R2_BUCKET=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=…
MEDIA_PUBLIC_URL=https://media.alentour.app
TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… TWILIO_MESSAGING_SERVICE_SID=…
OPERATOR_EMAIL=you@…
```

Fly.io, for example:

```bash
cd alentour
fly launch --no-deploy --name alentour-api      # accept the Dockerfile
fly secrets set $(grep -v '^#' .env.production | xargs)
fly deploy
curl https://alentour-api.fly.dev/health        # {"ok":true}
```

Then rebuild the app with `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_MEDIA_URL`, and (for the publish
workflow's nightly catalog export) add `DATABASE_URL` as a repository secret.

**One process, on purpose.** The enrichment worker and the outing clock run inside the API
process on timers, with database leases and idempotent steps, so running two instances is safe
but never necessary below ~50k MAU. If you scale out, nothing needs to change.

### Stage-specific switches

- **Stage 4:** `ANTHROPIC_API_KEY`. Without it, owner onboarding still works — owners get an
  empty draft to fill in. `ENRICH_PER_USER_DAILY` / `ENRICH_DAILY_LIMIT` cap spend.
- **Stage 5:** Twilio and `OPERATOR_EMAIL`. Outings are on as soon as the API is; use
  `npm run admin -- pause-outings on` to keep them dark until you're ready.
- **Stage 6:** create a product with a $29/month and a $290/year price, turn on Stripe Tax,
  add a webhook to `https://api…/v1/stripe/webhook` for `checkout.session.completed` and
  `customer.subscription.created|updated|deleted`, then set `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`. Enable the
  customer portal in the Stripe dashboard.

### Scheduled jobs

| Job | Where | Frequency |
|---|---|---|
| Weather | `alentour-publish` workflow | Hourly (built in) |
| Catalog export | `alentour-publish` workflow, or by hand | Nightly once live; after any curation |
| Outing clock, enrichment worker | Inside the API | Every minute / on demand |
| Owner freshness emails | `npm run freshness` (cron on the host, or a workflow) | Weekly — spacing is enforced in SQL |
| Outreach | `npm run outreach:run`, review, `npm run outreach:send` | By hand, weekdays |

## 4. Before specific switches — the non-code checklist

- [ ] **Lawyer review** before `OUTREACH_DRY_RUN=0`: the consent bases, templates and footer
      (CASL; [11](11-legal-and-compliance.md), [14](14-outreach-agent.md)).
- [ ] **ODbL read** on OSM-derived data and Nominatim geocodes ([07](07-supply-onboarding-and-ai.md)).
- [ ] **Open-Meteo** is free for non-commercial use: switch to the paid tier (or Environment
      Canada's open data) before Business Pro takes money.
- [ ] **Privacy policy and terms** (Law 25): what is collected, retention (chat 90 days,
      codes 10 minutes), the export and deletion buttons, the Privacy Officer's name.
- [ ] **Outings terms**: 18+, Alentour does not vet participants, the prohibited-activity list,
      how reports work. Written before outings go live, not after.
- [ ] **Incident note**: the SPVM non-emergency number, what gets police involved, how you
      preserve evidence (reports and held messages are kept; `admin cancel` does not delete).

## 5. The operator's day (~15 minutes)

```bash
npm run admin -- stats        # the dashboard: pending claims, reports, listings, media, outings
npm run admin -- reports      # most severe first — severity 3+ also emailed you already
npm run admin -- outings      # anything paused (⏸) needs a decision: unpause or cancel
npm run admin -- claims       # approve / reject; contested claims flagged ⚠ — call the venue
npm run admin -- pending      # listings waiting: seeded, self-serve, community → publish <venue>
npm run admin -- media        # photos with people in them → media-ok / media-no
```

Weekly: `admin stale` (listings nobody confirmed in a year), `admin jobs` (enrichment spend),
`admin outreach` → approve or reject drafts → `npm run outreach:send`.

**Going away for more than a couple of days with outings live:**
`npm run admin -- pause-creation on`. Existing outings continue; nothing new starts. Turn it
off when you're back.

**Something serious happened:** `admin pause-outings on` stops everything in one command —
joins, votes and new outings — while the dictionary keeps working. Turning outings off and
keeping the catalog is a correct decision, not a failure ([08](08-trust-safety-and-moderation.md)).

## 6. What it costs, as built

Matches [10](10-cost-model.md): ~$10/month in Stage 1 (Apple, amortized), ~$15–40 once the API
and database are online, then driven by the Anthropic bill (onboarding and moderation) and SMS.
Every AI call in the code uses prompt caching for its fixed instructions, the small model for
high-volume work (triage, moderation, invites), and the Batch API for seeding.
