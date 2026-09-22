# 06 — Groups & Outings *(v2: AI concierge, no paid humans)*

Per your answer, groups are **a feature, not the point** — so this ships at Stage 5 (~month
12), after the catalog works. And the bootstrapping problem gets solved by an **AI concierge
plus venue-anchored outings** instead of paid ambassadors.

## The problem is unchanged

- Joining an outing with 0 attendees costs social risk. Most people won't.
- Joining one with 3–5 is easy. Almost everyone will.
- Hosting is scarier still: proposing a time and having nobody come is a public humiliation.
- So: get from 0 to 3 without anyone having to be first, **and without a human organizer**,
  because there isn't one.

---

## The bright line on AI ambassadors

You asked for AI ambassadors that handle invitations and guidance up to the moment people
show up. That is buildable, and it replaces essentially all of an ambassador's *labour*.

**One hard constraint: the AI is the organizer, never a participant.**

| The AI may | The AI may never |
|---|---|
| Notice latent demand and propose an outing | Appear in an attendee list |
| Write and send invitations | Count toward quorum or capacity |
| Collect votes, chase maybes, pick the slot | Have a human name, face, or fake profile |
| Send logistics, weather, what-to-bring | Be described as "going" or "interested" |
| Post icebreakers and a first-10-minutes card | Imply a human will be there who won't |
| Nudge check-ins and run the post-outing loop | Be the accountable host of a physical gathering |

**Why this is not negotiable:** if five people are shown as going and two are synthetic, you
have manufactured social proof. Three people standing outside a bar waiting for two that
don't exist ends the product by word of mouth, and in most consumer-protection regimes
fabricated participation is a deceptive practice, not a growth tactic. Every outing's headcount
must be humans who actually intend to show up.

Presented honestly — *"Alentour noticed 6 people near you saved this. Want to go together?"* —
the concierge is a **feature people like**, not a compromise. It is a smart app, not a fake friend.

---

## Two mechanisms replace the ambassador budget

### A. Venue-anchored outings — the one that actually solves the empty room

**Attach outings to things that already happen anyway.** A climbing gym's Tuesday beginner
night. A bar's Wednesday trivia. A run club's Saturday 9am. A board-game café's open table.
The museum's free first Sunday.

The event happens whether or not anyone on Alentour shows up. So:

- **There is no empty room.** Worst case, one user goes to a real thing that was running regardless.
- **No host is needed.** The venue is the host.
- **No trust burden on a stranger.** It's a public business with staff and a street address.
- **It costs you nothing.** These are already in your catalog as `recurring_program`
  activities — you are surfacing a schedule you already have.

This should be **the default outing type at launch**, and probably 80% of outings in year one.
A solo founder with no budget can absolutely populate "things happening near you this week"
from opening hours and recurring programs. Start here, not with user-hosted meetups.

### B. The Rally, run by the concierge

For everything else, the v1 Rally mechanic, with the AI doing the organizing work:

```
1. TRIGGER   Concierge spots latent demand: ≥4 users within ~3 km saved the same
             activity in 14 days, or an activity matches several taste vectors.
             (Or: any user taps "propose this" — same flow, human-initiated.)

2. INVITE    Concierge drafts a personalized FR/EN invite, proposes 3 time windows
             from the venue's real opening hours + typical free evenings.
             Sends to those users only. Clearly from Alentour.

3. VOTE      Each replies yes / maybe / no per window. Cheap, non-committal.
             Concierge nudges maybes at quorum−1, and everyone at deadline−24h.

4. RESOLVE   Quorum met  → slot locks (max 2·yes + 1·maybe), chat opens,
                            calendar invites, logistics card sent.
             Not met     → auto-cancels. "The system didn't find a time" —
                            nobody was rejected. One-tap re-rally next week.

5. PRE-SHOW  T−24h: what to bring, how to get there, cost, weather.
             T−2h:  exact meeting point, who's coming (real humans, count only).
             T−0:   check-in prompt, icebreaker card for the first 10 minutes.

6. AFTER     "How was it?" → rating, re-rally prompt, optional mutual-opt-in
             1:1 chat for people who'd do it again.
```

Steps 1–2 and 5–6 are the ambassador's job. All of it is automatable. **Step 3 still requires
real humans to say yes** — that's the part you cannot and must not fake.

**Cost:** a full rally lifecycle is ~10 Haiku 4.5 calls at ~1k tokens. Even at 10,000 rallies
a month that is **under $50** — versus $2–4k/month for human ambassadors. This answer is both
cheaper and more scalable than the thing it replaces.

---

## Safety constraints that substitute for staffing

You cannot run 24/7 triage alone. So the product is constrained instead. All of these ship
with outings, none are optional ([08](08-trust-safety-and-moderation.md)):

- **18+ only.** Matches your 18–30 audience and removes the entire minor-protection burden —
  age gates, mandated reporting, adult-venue rules. Materially less work *and* less risk.
- **Venue-anchored only in v1.** An outing must attach to a listed public venue. No
  user-chosen meeting points, no residential addresses, ever.
- **Phone verification** required to join any outing.
- **Max 8 people.** Small enough to stay social, small enough to limit blast radius.
- **Blocks enforced in the candidate query**, not filtered client-side.
- **Fail-safe reporting:** a report **auto-pauses** the outing and notifies participants,
  pending your review. Conservative by default, because you might be asleep.
- **No DMs.** Outing-scoped chat only, auto-moderated, purged 90 days after.
- **Explicit framing** in onboarding: Alentour does not vet anyone. Say it plainly.

> **The honest risk statement.** Strangers meeting strangers, organized by one part-time
> person with no moderation team, is the highest-risk thing in this plan. The mitigations
> above are real, but they are constraints, not supervision. If you ever feel the outings
> feature outrunning your ability to watch it, the correct move is to turn it off and keep
> the dictionary running — the dictionary has no such exposure.

## Explicitly not a dating app

18–30 makes this drift *more* likely, not less. Enforce in the product: no swipe UI, no
browsing attendees by photo, no romantic-intent filters, in-app contact only until an outing
confirms, and the concierge never frames an outing around who else is attractive. The moment
it drifts, women leave and the product dies.

## Metrics

| Metric | Target |
|---|---|
| Venue-anchored outings as % of all outings (year 1) | ~80% — this is healthy, not a failure |
| Rally → quorum rate | ≥ 50% (lower than v1's 60%; no human chasing) |
| Confirmed → attendance | ≥ 80% |
| No-show rate | < 20% |
| % of attendees who join a 2nd outing within 30 days | ≥ 40% |
| Concierge invite → vote rate | ≥ 25% |
| Safety reports per 1,000 outings | < 1, every one reviewed by you personally |
