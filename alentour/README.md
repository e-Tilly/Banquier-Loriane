# Alentour — Stage 1 toolchain

Implementation of the plan in [`../docs/alentour/`](../docs/alentour/). Start with
[02 — Scope & roadmap](../docs/alentour/02-scope-and-roadmap.md).

**Stage 1 has no backend.** Postgres runs on your laptop as the authoring source; the app
consumes a static JSON catalog from R2. See [09 — Architecture](../docs/alentour/09-architecture.md).

```
taxonomy/taxonomy.yaml     the closed vocabulary — 80 tags, 10 facets, versioned
db/migrations/             the real schema, from doc 04
src/taxonomy/              loader + validation; the enum the AI is constrained to
src/outreach/              the AI ambassador that writes to businesses (doc 14)
test/                      28 tests, no network required
```

## Setup

```bash
npm install
createdb alentour && psql alentour -f db/migrations/001_init.sql
psql alentour -f db/migrations/002_outreach.sql
cp .env.example .env        # fill in DATABASE_URL at minimum
```

## Commands

```bash
npm test               # 28 tests, no API key needed
npm run typecheck
npm run taxonomy:check # validate the vocabulary — run this in CI
npm run outreach:run   # dry run by default; prints what it would queue
```

## The outreach agent

Finds venues people are saving but can't book, and drafts a note to the business suggesting
they host a session. Full design: [14 — Outreach agent](../docs/alentour/14-outreach-agent.md).

```
demand.ts   → SQL: venues with ≥5 distinct savers in 30d and no upcoming sessions
consent.ts  → the CASL gate. Fails closed. Never constructs a basis, only validates one
draft.ts    → Claude Opus 5, structured output. Writes the body only
verify.ts   → every number in the prose must trace to the demand signal, or the draft dies
render.ts   → appends the legally-required footer, which the model never touches
run.ts      → orchestrator. DRY RUN by default
```

### Before you send a single real message

1. **`OUTREACH_DRY_RUN=1` stays set until a lawyer reviews the templates and the consent
   logic.** CASL penalties reach $1M for an individual. The code is built so the basis for
   every send is auditable; a lawyer confirms the basis is sound.
2. You need a **real mailing address** in `.env` — it is legally mandatory in every message,
   and `render.ts` refuses to build one without it.
3. Populate `consent_records` **when you collect an address**, not at send time. For
   `conspicuous_publication` you must store the source URL, the capture date, and the result
   of the anti-solicitation check — the database `CHECK` constraint enforces all three.
4. Wire the unsubscribe endpoint before the first send. It must work for 60 days minimum and
   write to `suppressions` with `scope='domain'`.

### Two invariants worth not breaking

**The AI never asserts accessibility.** `tags.ai_may_assert = false` for every `a11y.*` slug,
enforced by a Postgres trigger (`001_init.sql`) as well as in the loader. A hallucinated
step-free entrance strands a wheelchair user at a door.

**The AI never invents demand.** `verify.ts` checks every claim against the snapshotted
`DemandSignal` and rejects the draft on any mismatch, including numbers that appear in the
prose without a backing claim. Same principle as the consumer-side concierge: it organizes,
it never fabricates participation.

## Not built yet

The Expo app, the catalog export script, and the enrichment pipeline. Next up is
`src/catalog/export.ts` — Postgres → `catalog.json` — which is what makes Stage 1 shippable.
