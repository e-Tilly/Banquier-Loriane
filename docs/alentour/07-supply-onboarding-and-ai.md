# 07 — Supply: Seeding, Business Onboarding & AI Enrichment

Three distinct supply pipelines, in order of how much of the catalog they produce:

1. **Seeded** — open data + AI, no human. Gets you from 0 to thousands of listings per city.
2. **Claimed & self-serve** — a business owner connects their social accounts; AI drafts;
   they approve. Gets you *quality* and freshness.
3. **User-created** — the community adds what no database knows about.

---

## 1. Seeding the catalog

### Sources, and their licence constraints

| Source | Coverage | Licence | Verdict |
|---|---|---|---|
| **[Overture Maps Places](https://docs.overturemaps.org/guides/places/)** | ~61M global POIs, categories, names, addresses, socials | **CDLA-Permissive 2.0** — no share-alike | **Primary base layer.** Attribution required; no copyleft on your derived DB. |
| **OpenStreetMap** | Trails, parks, rinks, playgrounds, viewpoints — the free outdoor stuff no commercial DB has | **ODbL** — share-alike | Use, but understand the trap below |
| **Municipal / provincial open data** | Pools, arenas, community centres, libraries, parks, event calendars | Usually permissive (CC-BY / open gov) | **Highest-value per hour of work.** Montréal, Québec, and most Canadian cities publish excellent datasets. |
| **Wikidata / Wikipedia** | Landmarks, museums, historic sites, descriptions | CC0 / CC-BY-SA | Great for enrichment context |
| **Tourism boards / SÉPAQ / Parks Canada** | Curated activities, trails, permits | Varies — ask, they usually say yes | High quality, often partnership-friendly |
| **Event APIs** (Eventbrite, Ticketmaster) | Ticketed events | Per API terms | Fine for `scheduled_event`, check redistribution terms |
| **Google Places API** | Everything | **Restrictive — see below** | Onboarding autocomplete only |

> ### The Google Places trap — design around it now
>
> Google's [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies)
> prohibit pre-fetching, caching, or storing Places content, with narrow exceptions:
> `place_id` may be stored indefinitely, and coordinates may be cached for a limited window.
> **Display name, formatted address, rating, hours, and photos have no general caching
> exception** — every render is another billable call. With Enterprise-tier SKUs in the
> **$35–40 per 1,000 requests** range, a catalog built on Places is not merely expensive,
> it is structurally impossible to operate at 1M users.
>
> **Rule: Google Places is used exactly once, at business-onboarding time, for the owner's
> own address autocomplete. Nothing from it enters the catalog except `place_id`.** Verify
> the current terms with counsel before shipping — they change.

> ### The ODbL trap
>
> OSM's share-alike can extend to a "Derivative Database". Mixing OSM into your main
> activities table risks obligating you to publish it. Mitigation: keep OSM-derived records
> in a **separate, clearly-attributed layer**, treat it as a *Collective Database* rather
> than merging fields into non-OSM records, and get a lawyer's read before launch. Overture
> Places deliberately contains **no OSM data** for exactly this reason — which is why it's
> the base layer.

### Seeding pipeline: from POI to activity

A POI is not an activity. This conversion is where the value is created.

```
Overture/OSM/open data
   → normalize + geocode + dedup (name trigram + 150m radius + phone/domain match)
   → classify: is this an activity venue at all? (~90% of POIs are not: banks, pharmacies)
   → EXPLODE: one venue → N activities
   → enrich (AI, below) → confidence-gate → publish or hold
```

**The explode step is the product insight.** "Parc Jean-Drapeau" is one POI and roughly eight
activities: swimming at the beach, cycling the circuit, the outdoor pool, winter snowshoeing,
the Biosphère, festival grounds, kayak rental, the lookout. A competitor importing POIs gets
one boring map pin. You get eight browsable, filterable, individually-taggable things to do.

Do the explode with an LLM prompted over the POI + its Wikipedia/Wikidata entry + the
municipal dataset description, constrained to the taxonomy, and **hold everything below a
confidence threshold for human review**. Budget ~200 human-review hours per launch city and
treat it as a fixed launch cost.

**Seeded listings publish as `unclaimed`, clearly labelled "Not yet verified", with no
accessibility claims set to `true` and no AI-written marketing prose** — just facts. A
seeded listing's job is to exist so the owner can claim it.

---

## 2. Business onboarding from social profiles

The user asked for signup "using their photos, videos and info from Facebook, Instagram,
TikTok or Maps". Here is what is actually possible, legally and technically.

### What is and isn't allowed

**Scraping a public Instagram/TikTok/Facebook profile from a pasted URL is out.** It breaches
those platforms' terms, it breaks constantly, and it creates copyright exposure on media you
don't have a licence to. Do not build it, whatever a vendor promises you.

**What works is owner-authenticated OAuth import** — the owner proves they control the
account, and the platform hands you their content through a supported API:

| Platform | Mechanism | Real constraints |
|---|---|---|
| **Instagram** | Meta Business Login → Instagram Graph API (`instagram_basic`, `pages_show_list`, `pages_read_engagement`) | **Only Professional (Business/Creator) accounts** linked to a Facebook Page. Personal accounts cannot be imported at all — they must convert first. The Basic Display API was killed in Dec 2024. **App Review is mandatory and takes 2–4 weeks per submission.** |
| **Facebook Page** | Same Meta Business Login | Owner must be a Page admin. Gets name, about, hours, category, photos, events. |
| **TikTok** | Login Kit + Display API (`user.info.basic`, `video.list`) | Returns the authenticated user's own videos + metadata. App review required. |
| **Google Business Profile** | Google Business Profile API, owner OAuth | **The owner must already have claimed the listing**, and *you* must apply to Google for API access — a real gate with a real approval queue. Apply early; it is a long pole. |
| **Website** | Server-side fetch of a URL the owner supplies, respecting `robots.txt` | The universal fallback. Works for the 40% with no usable social presence. |
| **Camera roll** | Plain upload | Always available; never assume the social path works. |

**Plan for the fallback to be the primary path at first.** Meta app review will not be
approved on day one, and a meaningful share of small operators have a personal IG account
they will not convert. The onboarding must be excellent with *only* a website URL and six
photos from a phone.

### Media rights — do this properly

Importing an owner's Instagram photos means storing copies (IG CDN URLs expire, so linking
isn't an option). That requires a licence:

- At connect time, an explicit, separate consent: *"You grant Alentour a non-exclusive
  licence to display media you import, and you confirm you have the right to grant it."*
- Store `provenance`, `source_url`, `imported_at`, and the consent record **per asset**
  (`media` table, [04](04-data-model.md)).
- Propagate deletion: if the owner disconnects the account or deletes the source post,
  remove the copy. Build the disconnect flow at the same time as the connect flow.
- **Strip EXIF on every upload** — geotags in photos are a real privacy leak.
- Third-party faces in imported photos: flag images with identifiable faces for owner
  confirmation. Do not use face recognition to do it — a simple detector, no identification.

### The onboarding flow (target: under 5 minutes)

```
1. "What do you do?"    → one sentence, free text
2. "Where?"             → address autocomplete (Places, once) or map pin
3. "Bring your stuff"   → [Connect Instagram] [Connect Facebook] [TikTok]
                          [Paste a website] [Upload photos]     ← any one is enough
4. ~40s spinner with honest progress   → AI enrichment pipeline runs
5. REVIEW SCREEN — the whole product   → pre-filled draft, everything editable,
                                          confidence shown, one-tap accept per field
6. Two mandatory human confirmations   → accessibility claims, price
7. Publish
```

**Step 5 is the entire feature.** The AI does not "create the profile" — it removes 95% of
the typing and then asks the owner to confirm. Framing matters: *"We drafted this from your
Instagram — check it over"* converts far better than an empty form, and far better than a
finished page that the owner didn't author and doesn't trust.

### The enrichment pipeline

Asynchronous, queued, idempotent, and fully re-runnable per activity.

```
INPUT: name, address, hours, bio, up to 30 captions, up to 20 photos, up to 5 video
       thumbnails, website text, public reviews (where licensing permits)
   │
   ├─ [1] Media triage    — Claude Haiku 4.5 over each image
   │      → classify {venue, activity_in_progress, food, people, logo, screenshot,
   │        poster, irrelevant}, quality 0–1, has_faces, has_text_overlay, is_duplicate
   │      → pick hero (activity_in_progress > venue > food), order the gallery, drop junk
   │
   ├─ [2] Structured extraction — Claude Opus 5, structured outputs, enum-constrained
   │      → tags (ONLY from the taxonomy enum), price, duration, effort axes,
   │        season mask, booking type, what-to-bring, audience
   │      → per field: value + confidence + evidence ("from caption of post 4")
   │
   ├─ [3] Copywriting — Claude Opus 5
   │      → FR + EN: 1-line summary + 2-3 paragraph description, in a house voice,
   │        factual, no superlatives, no invented facts
   │
   ├─ [4] Explode      — does this describe more than one activity? propose a split
   ├─ [5] Dedup        — trigram + geo + phone + embedding vs existing catalog
   │                     → if match, route to CLAIM instead of create
   ├─ [6] Safety       — moderation classifier on all text and images
   └─ [7] Confidence gate
          high  → pre-fill and show to owner
          low   → leave blank and ask the owner directly (a blank field beats a wrong one)
```

**Six non-negotiable rules for the AI layer:**

1. **Enum-constrained output.** Use structured outputs with the taxonomy as an enum, so the
   model physically cannot emit a tag that doesn't exist. Free-text tag generation destroys
   a taxonomy in a week.
2. **Provenance and confidence on every field.** Stored, and surfaced in the review UI.
3. **No AI-asserted accessibility. Ever.** The model may *suggest* `step_free_entry` as
   "unconfirmed"; only a human sets it `true`. Wrongly claimed accessibility strands a
   wheelchair user at a door. This is the one place where a hallucination causes direct harm.
4. **No AI-asserted prices, safety requirements, or age limits without owner confirmation.**
5. **Never invent.** Prompt for extraction, not generation; require an evidence span for
   every extracted fact; drop anything without one.
6. **Human in the loop before publish** for any owner-facing listing. The owner *is* the
   human in the loop — that's what makes this affordable.

### Model choice and cost

Prices from the Anthropic API as of this writing — verify before you budget:

| Model | Input / Output per MTok | Use |
|---|---|---|
| Claude Opus 5 (`claude-opus-5`) | $5 / $25 | Extraction + copywriting — the quality-critical passes |
| Claude Haiku 4.5 (`claude-haiku-4-5`) | $1 / $5 | Image triage, moderation, NL-query parsing — the high-volume passes |

Per business onboarding:

| Pass | Tokens | Model | Cost |
|---|---|---|---|
| Media triage (20 images ≈ 1.5k tok each) | ~30k in / 2k out | Haiku | ~$0.04 |
| Structured extraction | ~12k in / 3k out | Opus 5 | ~$0.14 |
| Copywriting FR+EN | ~6k in / 2.5k out | Opus 5 | ~$0.09 |
| **Total** | | | **≈ $0.27 per business** |

10,000 businesses ≈ **$2,700 one-time**. For seeding (non-interactive), use the
[Message Batches API at 50% off](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
→ ~$0.14 each. Set `output_config.effort` to `medium` for triage and `high` for extraction;
cache the taxonomy and system prompt with `cache_control` — it's the same ~4k tokens on
every call, so caching cuts real input cost substantially.

Compare: a human doing this well is 20–40 minutes at $20/h ≈ **$10 per listing**, or ~40×
more. That ratio is the entire reason this catalog is buildable.

### The claim flow

Seeded listings must be claimable, or owners will just create duplicates.

```
Owner finds their listing → "Is this your business?" → verify:
   • Meta/Google OAuth where the account matches the listing  (instant, preferred)
   • Automated phone call / SMS to the listed number          (instant)
   • Email at the listing's domain                            (instant)
   • Postcard code to the address                             (slow, high assurance)
   • Manual review                                            (fallback)
→ verified → owner inherits edit rights, prior community edits preserved as history
```

Handle the contested case (two claimants, business sold, franchise vs location) with a human
queue from day one. It's rare and it's always a mess.

---

## 3. User-created activities

The community knows about the swimming hole, the free Tuesday, the sledding hill.

**Creation flow (must be under 90 seconds):** photo → pin on map → title → category → 3
suggested tags to confirm → post. AI fills the rest from the photo and title and proposes
tags; the user confirms. Same enrichment pipeline, different confidence thresholds.

**Quality control, layered:**
- **Trust levels gate what publishes instantly** ([08](08-trust-safety-and-moderation.md)).
  New users' submissions go to review; established users publish immediately.
- **Dedup at creation time**, in the UI: "Did you mean *Sledding at Parc du Mont-Royal*?"
  → contribute a photo to the existing one instead. This is the single most effective
  quality mechanism, and it also feels *helpful* rather than restrictive.
- **Community editing**, wiki-style, with revisions and reverts ([04](04-data-model.md)).
- **Confirmation loop:** "Is this still accurate?" prompts to users who saved or attended.
  Two confirmations promote a listing's verification status; two disputes demote it.
- **Auto-expiry:** anything unverified for 12 months is de-ranked hard and flagged for review.
  Stale data is the failure mode that kills catalog apps, and it happens silently.

**Two hazards specific to UGC activities:**
- **Private property / doxxing.** A user "creating" an activity at a home address. Enforce:
  pins must snap to a public place or a known venue for anything with a public outing;
  moderation flags residential-zoned pins.
- **Dangerous activities.** Cliff jumping, urban exploration, trespassing. The `risk_tier`
  field exists partly for this: tier 3 UGC cannot be published as a hostable outing, and a
  policy list of prohibited activity types is enforced at moderation. Get this in the ToS
  and the moderation playbook before UGC opens, not after.
