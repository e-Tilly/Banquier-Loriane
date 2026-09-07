# 06 — Groups & Outings

The feature that turns a browsing app into a habit. Also the feature most likely to fail
quietly, because **an outing with zero attendees is an advertisement for how empty your app
is**, and users only give you one or two chances to show them one.

## The central problem: nobody joins an empty room

Real dynamics, observed across every social-activity product:

- Joining an event with 0 attendees costs social risk. Most people won't.
- Joining an event with 3–5 attendees is easy. Almost everyone will.
- So you need to get from 0 to 3 without anyone being the first person.
- And hosting is even scarier: proposing a time and having nobody come is a public
  humiliation, so people don't host, so there's nothing to join.

Everything below is designed around that single chokepoint.

## Three outing types

| Type | Who creates it | Commitment | Purpose |
|---|---|---|---|
| **Rally** *(default for users)* | Any user | Vote on availability, not attendance | Solves the empty room |
| **Fixed outing** | A user, or a friend group | Join a specific time | For when the time is already known |
| **Business session** | A verified provider | Book a real class/session | Real supply, real reliability |

### The Rally — the core mechanic

Instead of "pick a time and hope", a user says:

> "I want to do **bouldering at Allez Up**. I'm free **Thu 18:00, Sat 10:00, or Sun 14:00**.
> Let's go if **at least 3 of us** are in. I'll decide by **Wednesday 20:00**."

Others see a lightweight card and tap availability per option — `yes` / `maybe` / `no`.
That's it. No commitment to a time that may not happen.

At the deadline (or as soon as quorum is unambiguous):
- **Quorum met** → the winning slot is chosen, the outing auto-confirms, everyone who said
  `yes` to that slot is auto-joined and notified, a chat opens, calendar invites go out.
- **Quorum not met** → auto-cancels with a gentle message and *one-tap re-rally next week*.
  Nobody was rejected; the system was.

Why this works:
1. **Voting is cheap.** "I might be free Saturday" is not a commitment; "I will attend this
   event" is. Conversion on the cheap action is several times higher.
2. **It removes the host's fear of failure.** The rally didn't reach quorum — the host wasn't
   rejected. This is the difference between people hosting and not hosting.
3. **Better scheduling.** You get the slot most people can make, not the slot the host guessed.
4. **A deadline creates urgency**, which is the only reliable driver of RSVP behaviour.

Implementation notes:
- Slot selection = maximize `2·yes + 1·maybe`, tie-break to the earliest slot.
- Show a live "**2 more and this happens**" progress bar. Loss aversion works; use it honestly.
- Push the host *and* voters at `deadline − 24h` if quorum is close ("one more yes and Saturday
  is on").
- Auto-nudge the "maybe" voters at quorum − 1.
- Cap open rallies per user (3) to prevent spam.

### Fixed outings

Straight RSVP with capacity, waitlist (auto-promote on cancellation), guests (+1/+2 with the
host's permission), approval-required joins for hosts who want them, and link-only visibility
for friend groups. Support **co-hosts** — a second person materially reduces cancellations.

### Business sessions

A provider publishes real availability against a `recurring_program` activity. Same UI, but
with an inventory count, a booking link or in-app hold, and a cancellation policy. These are
the reliability backbone: a user's *first* outing should ideally be a business session,
because it definitely happens.

---

## Bootstrapping supply of outings (do not skip this)

The mechanic is necessary but not sufficient. For the first 3–6 months per city:

1. **Paid ambassadors.** 10–15 locals hosting 5–10 outings/week, paid ~$25–40 per hosted
   outing. Budget $2–4k/month per city. Unglamorous, absolutely essential, and every
   successful product in this category did it while claiming they didn't.
2. **Business-seeded sessions.** Get 30 partner businesses to list real sessions. Instant
   supply that reliably happens.
3. **Ghost-free defaults.** Never show a "0 going" outing in the main feed. Rank outings with
   ≥ 2 confirmed above ones with 0, and put fresh 0-attendee rallies in a distinct
   "Help these happen" shelf where the framing is *contribution*, not *emptiness*.
4. **Digest push, not per-outing push.** "3 outings near you this weekend" beats three
   separate notifications, and doesn't burn notification permission.
5. **Critical-mass gating.** Do not enable the outings tab in a city until there are ≥ 15
   open outings/week. A user who opens an empty tab does not come back to it.

---

## Lifecycle & states

```
 rally:  draft → voting → (quorum met) → confirmed → in_progress → completed
                        ↘ (deadline, no quorum) → cancelled → [one-tap re-rally]
 fixed:  draft → open → (capacity) → full → confirmed → in_progress → completed
                     ↘ cancelled_by_host / cancelled_low_turnout
```

Participant states: `interested → requested → joined → waitlisted → checked_in → attended`,
with `no_show` and `cancelled_late` as terminal negatives.

**Timed jobs** (a queue, not cron-in-the-app): rally deadline evaluation, T−24h and T−2h
reminders, check-in window open at T−30min, attendance finalization at T+3h, post-outing
prompt at T+4h, chat purge at T+90d.

## Chat

- **Outing-scoped only.** No open DMs at launch — see [08](08-trust-safety-and-moderation.md).
  A 1:1 channel between two people who have attended the same outing can come later, gated
  by mutual opt-in.
- Opens when the outing confirms; read-only 48h after it ends; purged at 90 days.
- Host gets mute/remove; every message is reportable; automated moderation on send
  ([08](08-trust-safety-and-moderation.md)).
- **Do not build a realtime chat platform.** Postgres-backed messages + push + a lightweight
  subscription is enough for outing chat. Per-connection realtime SaaS is a cost trap at 1M
  users ([10](10-cost-model.md)).

## Attendance & reputation

- **Check-in** at the meeting point via a geofence (± 200 m, host confirms) or a host-shown
  code. Voluntary, but it unlocks the verified-attendance review badge, which is the carrot.
- **Reputation is behavioural, never a star rating of a person.** Public signals only:
  - `Reliable` badge — attended ≥ 5 outings with < 10% no-show
  - `Host` badge — hosted ≥ 3 completed outings
  - `Verified` badges — phone / ID
  - Member since; number of outings attended
- No-shows: first is free (life happens), a pattern (≥ 30% over 5+ outings) reduces
  `trust_level`, which restricts joining approval-required and high-demand outings. Tell the
  user this is happening and let them recover. Never a public shame score.
- **Cancellation asymmetry:** a host cancelling 2h before is far more costly than an attendee
  doing so. Penalize accordingly, and require a reason.

## Discovery of outings

- **"Outings" tab:** upcoming, near, filtered by the same taxonomy plus `spots_left`,
  `starts_within`, `group_size`, `icebreaker_score`, and audience fit.
- **From an activity page:** "3 outings here this week" — the highest-converting entry point
  in the app, because intent is already established. Put it above the fold.
- **"People like you are going"** — collaborative signal, phrased carefully so it doesn't
  read as surveillance.
- **Friends' outings first**, always.

## Group formation quality

Randomly-assembled groups often fail socially. Cheap improvements:

- **Prefer parallel activities for stranger groups.** Surface `icebreaker_score ≥ 1`
  activities in the "meet people" shelves. Pottery, bouldering, and board games work; a
  concert or a movie does not.
- **Cap stranger outings at 4–8.** Below 4 it's fragile if one drops; above 8 it fragments
  and nobody meets anyone.
- **Show composition honestly before joining:** how many are attending, how many are new to
  the app, the age range as a band (not individual ages), the language(s). No photos-first
  browsing of attendees — that turns it into a dating app, which changes who shows up and
  ruins it for everyone else.
- **A structured first 10 minutes.** A host prompt card ("go around: name, what brought you
  here, one thing you're bad at") measurably improves outcomes and costs nothing.
- **Post-outing:** "would you do something with this group again?" — private, and a mutual
  yes unlocks 1:1 chat. This is the safe path to a social graph.

## Explicitly not a dating app

State it in onboarding, in the ToS, and in moderation policy. Enforce it: no swipe UI, no
attendee-photo browsing, no "singles" filters, aggressive action on unsolicited romantic
DMs. The moment it drifts, women leave, and the product dies. This is a well-documented
failure mode for every mixed activity/social app; the defense is product design, not policy
text.

## Metrics for this feature

| Metric | Target |
|---|---|
| Rally → quorum rate | ≥ 60% |
| Median time from rally creation to quorum | < 36 h |
| Confirmed outing → attendance rate | ≥ 80% |
| No-show rate | < 20% |
| % of attendees who join a 2nd outing within 30 days | ≥ 40% |
| % of outings hosted by non-ambassadors (organic host rate) | ≥ 70% by month 6 |
| Reported safety incidents per 1,000 outings | < 1, and every one reviewed by a human |

The organic host rate is the one that tells you whether this is a real product or a
subsidized event calendar. Watch it weekly.
