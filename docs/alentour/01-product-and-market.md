# 01 — Product & Market

## The problem, stated precisely

There are three distinct failures people have with local activities, and existing apps
each solve one and ignore the others:

1. **"I don't know what exists."** You've lived somewhere for six years and have never
   heard of the archery range 12 minutes away. Google Maps only answers queries you
   already know how to type. This is a *discovery* failure.
2. **"I know what exists but not what fits."** You want something today, under $30,
   indoors because it's raining, that your friend with a knee injury can do. No app lets
   you express that. This is a *filtering* failure.
3. **"I found something but I'm not going alone."** The single largest reason a saved
   activity never happens. This is a *coordination* failure.

Nobody covers all three. That gap is the product.

## Who it's for

> **v2 audience lock: Montréal, 18–30.** The personas below are narrowed accordingly — the
> weekend-planner/parent persona is now out of scope as a design target (keep the Family &
> Kids category in the catalog; drop it from the shelves and the marketing).

**Primary — "the restless local," 18–30, urban.** Has money and time but a thin
repertoire; defaults to the same three bars. Motivated by novelty and by not being bored.
Acquisition: this is the person who screenshots and shares "look at this" — the app must
be screenshot-worthy.

**Secondary — "the new arrival."** Moved cities in the last 18 months (student, expat,
new job, post-breakup). Has the highest willingness to meet strangers and the highest
pain. Small in number but *enormously* high intent, and the best possible seed cohort for
the group feature. This cohort is why Timeleft and Bumble BFF exist.

**Deprioritized — "the weekend planner / parent."** Real, valuable, and *not your audience*.
Their needs (age suitability, stroller access, nap-window durations) pull the taxonomy in a
direction 18–30 doesn't need. Serve them incidentally, design for them never.

**What 18–30 in Montréal specifically implies:** heavily price-sensitive (free and sub-$20
dominate), largely car-free (transit/bike/walk matters, parking barely does), late hours are
normal, French and English both required, student status is a live discount, and the social
motivation is strongest in exactly this band — which is why outings still earn a place in the
plan even as a Stage 5 feature.

**Supply side — "the small operator."** Climbing gym, pottery studio, kayak rental, escape
room, community centre, independent guide. Has an Instagram, has no website worth the
name, will never fill out a 40-field form, and is deeply skeptical of another platform
asking for money. Winning them is the whole business. See [07](07-supply-onboarding-and-ai.md).

**Explicitly not the target at launch:** tourists. Tourism is a different product
(different trust signals, different frequency, dominated by TripAdvisor/GetYourGuide, and
it does not build the local-density flywheel). Tourists will use it; don't design for them.

## Competitive landscape and where the seam is

| Player | What it does well | Where it leaves a seam |
|---|---|---|
| **Google Maps** | Coverage, reviews, navigation, "open now" | Query-driven, not browse-driven. No sense of "activity". No filters that matter (no difficulty, accessibility, duration, vibe). No social layer. |
| **Meetup** | Recurring groups, genuine community | Group-first, not activity-first. Dated UX, thin outside big cities, organizer-fee model kills the long tail. You must join a *group* before you can do a *thing*. |
| **Eventbrite / Fever / Ticketmaster** | Ticketed events, commerce | Only *events*, only *ticketed*. A hiking trail or a free lookout can never exist there. Nothing to do next Tuesday at 6pm. |
| **AllTrails / Komoot** | Deep vertical (trails), great filters | Exactly one category. Proves the filter thesis works — people will absolutely filter by difficulty, length, dog-friendliness. |
| **TripAdvisor / GetYourGuide / Viator** | Bookable experiences | Tourist-priced, tourist-shaped, thin on the free and the mundane. Nobody uses it in their own city. |
| **Timeleft / Bumble BFF / Meetup's newer social** | Meeting strangers | The *activity* is an afterthought (usually dinner). No catalog. |
| **Instagram / TikTok "things to do in [city]"** | Where discovery actually happens today | Ephemeral, unfilterable, unsearchable, no logistics, no way to act on it. This is the real incumbent. |
| **Facebook Events** | Distribution, free | Dying for this use case; discovery is broken; no filtering; no long tail of evergreen activities. |

**The seam:** *evergreen activities + deep filters + a group-forming mechanic*, in that
order. Every competitor has at most two of those three, and nobody has the first one
done properly, because building a real activity catalog is unglamorous work that a
venture-funded events company won't do.

## What makes it defensible (in order of durability)

1. **A structured, verified activity catalog with a tag layer nobody else has.** Slow to
   build, slow to copy. This is the moat, and it is the reason [07](07-supply-onboarding-and-ai.md)
   exists — AI is what makes building it affordable.
2. **Local social graph and outing history.** Once someone has done four outings and knows
   people through the app, the switching cost is real.
3. **Claimed business relationships.** A claimed, maintained profile is a stickiness
   mechanism and a distribution channel.
4. **Taste data.** Real signal on what an individual actually *did*, not what they clicked.
   Far better than ad-network intent data. (Handle with care — see [11](11-legal-and-compliance.md).)

Not defensible: the UI, the filter list, the AI enrichment. All copyable in a quarter.

## The three things that make the product feel magic

Everything else is table stakes. These are the demo moments:

1. **Weather-and-season-aware ranking.** Open the app on a rainy Saturday and the feed is
   already indoor. Open it on the first warm day in April and it leads with terraces and
   trails. This costs almost nothing to build (see [05](05-discovery-and-ranking.md)) and
   is the single highest ratio of "feels alive" to engineering effort in the entire plan.
2. **"Reachable by transit in 30 minutes."** Nobody does this. It is a genuinely hard
   filter for a car-free urban user and it is achievable with GTFS data.
3. **One-tap Rally.** From any activity: "propose this to people" → three time options →
   the app finds you five strangers who also want to go. See [06](06-groups-and-outings.md).

## Positioning statement

> For curious people who are tired of doing the same thing, Alentour is a local activity
> dictionary that shows you everything you can actually do nearby — filtered by what you
> can afford, how far you'll go, and how much effort you're up for — and gets you there
> with other people. Unlike Google Maps or Instagram, it's browsable, filterable, and it
> ends in a plan on a date.

## Why now

- **Overture Maps** made a permissively-licensed global POI base available in 2024–2026,
  removing the historical blocker (you either paid Google forever or you had no catalog).
- **LLMs made catalog enrichment ~100× cheaper.** Turning a business's Instagram and a
  messy website into 40 structured, correctly-tagged fields used to be a $15 human task.
  It is now roughly $0.10–0.25 (see [10](10-cost-model.md)). *This is the actual unlock
  for the entire plan* — the catalog was previously uneconomic to build.
- **Post-pandemic loneliness and remote work** made "meet people around an activity" a
  mainstream want rather than a niche one.
