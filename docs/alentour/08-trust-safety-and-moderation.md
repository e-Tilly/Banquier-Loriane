# 08 — Trust, Safety & Moderation *(v2: constraint instead of staffing)*

The v1 plan assumed 8–12 moderators and 24/7 triage. **You have none of that.** So safety here
is achieved by *narrowing what the product allows*, not by supervising what people do with it.

That is a legitimate strategy — it is how small products ship social features responsibly —
but it only works if the constraints are real, enforced in code, and not quietly relaxed when
growth stalls.

## Your single biggest safety asset: 18+

Your audience is 18–30, so the minimum age is **18**, and that deletes an enormous amount of
work and risk:

- No minor-protection rules, no age-gating of alcohol venues, no mandated-reporting playbook,
  no "under-18s can't see attendee lists", no parental-consent regime.
- Enforce with a date-of-birth gate at signup (store the **year only** — you never need more)
  plus a terms attestation. Not bulletproof, but proportionate and standard.

## Stage-gated exposure

Most of this document does not apply until Stage 5, ~month 12. Until then the product is a
read-only catalog with device-local saves, whose entire safety surface is "is the listing
accurate."

| Stage | Social surface | Moderation load |
|---|---|---|
| 1 — Catalog, no backend | None. No accounts, no UGC. | Zero |
| 2 — Accounts & sync | Saves only, private | Near zero |
| 3–4 — Business claims, AI enrichment | Owner-submitted content | Low — you review every claim personally |
| 5 — Outings | **Strangers meeting in person** | The real thing |
| 6 — UGC activities | User-authored listings | Moderate, automatable |

**Do not skip ahead.** Shipping outings before the catalog is dense is bad product *and* bad
risk management — it front-loads your only dangerous feature.

---

## The constraints that replace moderators (Stage 5)

Every one of these is enforced in code, not policy text:

1. **18+ only.** As above.
2. **Venue-anchored outings only.** An outing must attach to a listed public venue from the
   catalog. No user-chosen meeting points, no free-text addresses, no residential locations.
   One constraint, an entire class of harm removed.
3. **Phone verification** to join any outing. Cheap (~$0.01/SMS), and it stops casual repeat
   abuse better than anything else at this budget.
4. **Max 8 attendees.** Small enough to stay social; small enough to limit blast radius.
5. **No DMs.** Outing-scoped chat only, opening at confirmation, read-only 48h after, purged
   at 90 days. 1:1 chat only after mutual post-outing opt-in — and not before Stage 6.
6. **Blocks are total, silent, and enforced in the query.** A blocked user cannot see, join,
   or be shown your outings, and gets no signal. Filtering client-side is a data leak.
7. **Fail-safe reporting.** A report **auto-pauses** the outing and notifies participants
   pending your review — rather than sitting in a queue until you wake up. Conservative
   defaults are the only correct choice for a solo operator.
8. **Rate limits** on outing creation, joins, and messages, per user and per device.

## Automated moderation

Cheap enough to run on everything, so run it on everything:

```
UGC (message, listing, review, profile text, photo)
 → [1] Deterministic: rate limits, link/contact-info rules, duplicate hashing   ($0)
 → [2] Claude Haiku 4.5, structured output: {harassment, sexual, violence, hate,
       self_harm, illegal, spam, pii, dangerous_activity} each 0–1               (~$0.0003/item)
 → [3] Route: low → publish · medium → publish + flag for you · high → hold
       critical → block + auto-restrict + email you immediately
 → [4] Log every decision (append-only, with model version and scores)
```

At 220k MAU and ~1M moderated items/month this is **~$200/month**. Layer 1 catches the
highest-volume junk at zero cost — never let the LLM be the only thing between a user and harm.

**Your queue must stay small enough for one person.** Tune thresholds so you see ~10–20 items
a day, not 200. If the queue grows past what you can clear in 15 minutes daily, tighten the
automated thresholds — accept more false positives — rather than letting it rot.

## Incident response, solo

Write this before you need it. One page.

- **Severity 3+ (physical harm, threats, sexual misconduct): push notification to your phone,
  immediately.** Not an email digest.
- Published response times you can actually meet: acknowledge < 24h, resolve < 72h. **Promise
  less than a funded company and meet it**, rather than promising parity and failing.
- Preserve evidence on report — snapshot immediately; deletion by the reported user must not
  destroy it.
- A written escalation note: what gets police involved, and the SPVM non-emergency number.
- If you are away for more than a few days with outings live, **pause new outing creation**.
  Build that switch on day one.

> **The honest statement.** Strangers meeting strangers, organized by one part-time person, is
> the riskiest thing in this plan. The constraints above are real mitigations, but they are
> constraints, not supervision. If outings ever outrun what you can personally watch, turning
> the feature off and keeping the dictionary is a correct decision, not a failure.

---

## Content accuracy — the part that matters from day one

With no UGC and no outings, Stage 1's entire safety surface is **is the catalog true**. Wrong
hours waste someone's evening; a permanently-closed venue destroys trust in the whole app.

- `last_verified_at` shown in the UI when older than 6 months.
- "Report a problem" on every listing with fast reasons: *closed · wrong hours · wrong price ·
  wrong accessibility · doesn't exist · dangerous*. This is your entire moderation system in
  Stage 1, and it works.
- Owner nudge every 90 days once claims exist (Stage 3): one tap to confirm.
- Auto-demote anything unverified for 12 months.
- **Accessibility claims are never AI-asserted** — still true even though the facet is demoted
  ([03](03-taxonomy.md)). A wrongly-claimed step-free entrance strands somebody, and that
  remains the one place where a hallucination causes direct physical harm.
