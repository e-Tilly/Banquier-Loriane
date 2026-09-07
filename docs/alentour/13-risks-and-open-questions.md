# 13 — Risks & Open Questions

## Risk register

Ordered by expected damage, not probability.

| # | Risk | Likelihood | Impact | Mitigation | Early warning signal |
|---|---|---|---|---|---|
| R1 | **A serious safety incident at an outing** | Medium | **Existential** | Full T&S stack before outings ship; public meeting points; verification ladder; 24/7 triage on severity 3+; insurance; rehearsed incident playbook ([08](08-trust-safety-and-moderation.md)) | Any report of harassment or unwanted contact; rising "left early" signals |
| R2 | **Empty-room failure — outings never reach quorum** | **High** | Severe | Rally mechanic; paid ambassadors; business-seeded sessions; gate the outings tab until ≥15 open outings/week ([06](06-groups-and-outings.md)) | Rally→quorum rate < 40%; organic host rate flat |
| R3 | **Supply density too thin — "nothing near me"** | **High** | Severe | One neighbourhood at a time; Overture + open data seeding; the "explode" step; density scorecard gates launch ([02](02-scope-and-roadmap.md), [07](07-supply-onboarding-and-ai.md)) | Activities/km² below 30 in the core; searches returning < 10 results |
| R4 | **Catalog rots** — wrong hours, closed businesses | **High** | High | 90-day owner nudges; community verification; `last_verified_at` shown; auto-demote at 12 months ([08](08-trust-safety-and-moderation.md)) | Rising "wrong info" reports; verification age distribution drifting |
| R5 | **The app drifts into a dating app** | Medium | Severe | Product-level enforcement, not policy text: no swipe, no photo browsing of attendees, aggressive action on unsolicited advances ([06](06-groups-and-outings.md)) | Gender ratio skew in joins; unsolicited-contact reports |
| R6 | **Meta / TikTok / Google API access denied or revoked** | **High** | Medium | Website + camera-roll path is the *primary* onboarding flow, social import is an accelerant; apply for Google Business Profile access early ([07](07-supply-onboarding-and-ai.md)) | App review rejections; permission scope changes |
| R7 | **Cost blowout from a mispriced dependency** | Medium | High | Avoid all nine traps in [10](10-cost-model.md); alert on daily LLM spend; weekly $/MAU review | $/MAU rising as MAU rises (it should fall) |
| R8 | **Taxonomy proves wrong after launch** | Medium | Medium | Versioned taxonomy + re-runnable enrichment; Phase 0 exists specifically to find this out early ([03](03-taxonomy.md)) | Filters unused; "0 results" rate high; owners mis-tagging |
| R9 | **AI enrichment quality too low — owners reject drafts** | Medium | Medium | Human review is the design, not a fallback; blank beats wrong; measure accept-unedited rate ([07](07-supply-onboarding-and-ai.md)) | Accept-unedited rate < 60%; onboarding abandonment at the review screen |
| R10 | **Google or Meta ships the feature** | Low-Medium | High | The moat is a structured local catalog + social graph, which neither is incentivized to build; move fast on depth in one region | — |
| R11 | **Seasonality collapse (Québec winter)** | **Certain** | Medium | Make it a feature: winter taxonomy, winter shelves, indoor-first ranking in January. Plan for 2× summer / 0.6× winter and don't panic in February | — |
| R12 | **ODbL contamination of the main database** | Medium | Medium | Overture (no OSM data) as the base; OSM in a separate attributed layer; counsel review ([11](11-legal-and-compliance.md)) | — |
| R13 | **Privacy/regulatory failure (Law 25)** | Low | High | PIA before launch, Privacy Officer, deletion/export built in Phase 1 ([11](11-legal-and-compliance.md)) | — |
| R14 | **Moderation costs scale worse than revenue** | Medium | Medium | Automate the low band aggressively; trust levels reduce review volume; measure moderation items per 1,000 MAU as a first-class metric | Cost per MAU flat or rising |

**The two that should keep you up at night are R1 and R2.** R1 because it's the only one on
the list that ends the company in a week. R2 because it's the most likely, and because it
fails *quietly* — nothing breaks, the app just isn't interesting, and you find out six months
late from a retention chart.

---

## Things I'd do differently than the brief suggests

Three places where I'd push back on the request as stated. All three are recommendations,
not blockers — say the word and I'll plan it the other way.

1. **Don't launch groups with the catalog.** The brief bundles them. I'd ship the dictionary
   alone first (Phase 1) and add outings ~4 months later. Groups need supply density and a
   trust & safety stack to exist first; shipping them into an empty catalog produces empty
   outings, which is a worse first impression than no outings at all.

2. **"Import from a pasted Instagram/TikTok URL" isn't buildable as stated.** Scraping those
   platforms breaches their terms and breaks constantly. What *is* buildable is owner-OAuth
   import — the owner proves they control the account and the platform hands you the content.
   That's better anyway (it doubles as ownership verification), but it means: only Instagram
   *Professional* accounts, mandatory Meta app review taking 2–4 weeks, and a Google Business
   Profile API application with a real approval queue. **Plan the website-URL + camera-roll
   path as the primary flow**, with social import as an accelerant that arrives later.

3. **User-created activities should come after business onboarding, not with it.** The brief
   treats them as parallel. UGC without a moderation stack and a dedup pipeline produces
   duplicates and junk that degrade the catalog you just spent months building — and catalog
   trust, once lost, is very hard to win back.

---

## Open questions — answer these and I'll tighten the plan

Roughly in order of how much they change the work.

1. **Launch city and market?** I assumed Montréal/Québec (A1), which drove bilingual-at-launch,
   Law 25, Bill 96, and the winter-seasonality design. A different market changes the legal
   section substantially and the taxonomy somewhat.

2. **Does "1M users" mean 1M monthly actives, or 1M registered?** I assumed MAU (A7). If it
   means registered accounts, every number in [10](10-cost-model.md) drops roughly 3×.

3. **What's the funding and runway?** The plan assumes a small team building for ~12 months
   before meaningful revenue. If it's bootstrapped, I'd cut Phase 3's self-serve onboarding,
   keep business onboarding manual for much longer (it's better research anyway), and get to
   revenue in month 6 instead of 12.

4. **Do you already have a city, a category, or a community to start from?** An existing
   community — a running club, a newcomers' group, a university, a specific neighbourhood —
   is worth more than any amount of engineering, because it solves R2 and R3 at once. If you
   have one, the whole Phase 0/1 plan should be rebuilt around it.

5. **Is the group feature the point, or a feature?** They're different products. If meeting
   people is the *point*, invert the roadmap: build outings first with a thin curated catalog
   of ~200 hand-picked "good for meeting people" activities, and let the dictionary grow later.
   That's a defensible strategy and it changes Phase 1 completely. My plan assumes the
   dictionary is the point and groups are the retention engine — tell me if that's backwards.

6. **Are you building this yourself, hiring, or contracting?** The stack in
   [09](09-architecture.md) is chosen for a small in-house team who'll live with it. A contract
   build would justify different, more conventional choices (and more managed services).

7. **How do you feel about paid ambassadors?** [06](06-groups-and-outings.md) budgets $2–4k/month
   per city for seeded outings. It's the standard solution to R2 and I think it's necessary,
   but it's real money and some founders hate the idea of subsidized supply.

8. **Any existing brand, name, or domain?** "Alentour" is my placeholder. Naming affects
   nothing technical but everything about the Phase 0 landing page.

9. **Accessibility: core promise or one filter among many?** I've treated it as a first-class
   commitment — tri-state modelling, provenance rules, community verification, a dedicated
   filter entry point. That's a meaningful amount of extra work and a genuine differentiator
   (nobody else does it properly). Worth confirming you want to carry it.

10. **Web presence — never, or later?** I deferred it to Phase 4 for SEO. If organic search is
    a primary acquisition channel in your thinking, the read-only web surface should move much
    earlier, and that changes the architecture (server-rendered pages, a different caching
    story).

---

## What I'd do in the next two weeks

If you want to start Monday, in priority order:

1. **Pick the neighbourhood.** One. Draw it on a map.
2. **Hand-build 100 activities in it**, using the taxonomy in [03](03-taxonomy.md) and a
   spreadsheet. Not code — a spreadsheet. You will find five things wrong with the taxonomy,
   and finding them now costs nothing.
3. **Talk to 10 small operators** in that neighbourhood. Ask what they'd need to claim a
   profile, and watch them try to describe their business in one sentence. This is where the
   enrichment prompts get written.
4. **Pull the Overture Places extract** for the city and see what coverage actually looks
   like. It will be better than you expect for businesses, worse than you expect for the free
   outdoor things people actually love.
5. **Apply for Google Business Profile API access.** It has the longest lead time of anything
   in the plan, and starting the clock costs an afternoon.
