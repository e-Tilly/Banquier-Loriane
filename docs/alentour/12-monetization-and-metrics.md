# 12 — Monetization & Metrics

## Principle

**Users never pay to browse or to join a free outing.** Both sides of the marketplace need
to be dense before either is worth monetizing, and a paywall on discovery kills the density
you're trying to build. Revenue comes from businesses who get measurable customers, plus a
thin premium tier for power users.

Sequence: **liquidity first, then business revenue, then transactions.** Monetizing before
liquidity is the most common way products in this category die.

---

## Revenue lines, in order of introduction

### 1. Business Pro subscription — the core line (Phase 3)

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | Claimed profile, up to 6 photos, hours, basic stats, respond to reviews |
| **Pro** | **$39/mo** or $390/yr | Unlimited photos + video, publish sessions & events, full analytics (views, saves, direction taps, outing attendance), priority in "verified" filters, booking link, respond-first on reviews, multi-location |
| **Multi-site** | $99–299/mo | 5+ locations, team seats, API, bulk publishing |

Free tier must be genuinely useful — an unclaimed or crippled profile is bad for *users*,
which is the wrong trade. Pro sells on **attribution**: "142 people got directions to you
from Alentour last month" is worth $39 to a climbing gym, and it's a number no other channel
gives them.

**Realistic conversion:** 8–15% of claimed businesses to Pro. In a city with 3,000 claimed
businesses, that's 240–450 × $39 ≈ **$9k–18k MRR per mature city.**

### 2. Promoted placement (Phase 3)

CPC or CPM, always **labeled "Sponsored"**, capped at 1 slot per 8 organic results, and
excluded from accessibility- and safety-critical filter results. If sponsorship can push a
genuinely worse result into a "wheelchair accessible" search, don't sell it there.

Expect this to be smaller than subscriptions early — local ad budgets are tiny and the
sales cost is high — but it scales better later. Roughly $2–5k/mo per mature city at first.

### 3. Paid outings commission (Phase 4)

When an operator or an experienced community host runs a paid outing: **8–12% + payment
processing**. Only worth building when there's enough volume to justify the refund, dispute,
chargeback, and tax machinery — that's a real operational burden, not a Stripe integration.

### 4. Affiliate / referral (Phase 3, low effort)

Ticketed and bookable activities via GetYourGuide, Viator, and local booking systems: 5–10%
referral. Nearly free to add; modest revenue; useful mainly as a signal of which categories
convert.

### 5. Consumer premium — "Alentour+" (Phase 4, optional)

$4.99/mo: offline maps and saved lists, advanced/saved filters, unlimited lists, early
access to popular outings, no sponsored results, a supporter badge. Expect **1–3%**
conversion. At 1M MAU that's $50–150k/mo, which is not nothing — but treat it as upside, and
**never gate safety features or accessibility filters behind it.**

### 6. Data & partnerships (Phase 4+, carefully)

Aggregate, anonymized insights to tourism boards, municipalities, and BIAs ("where do people
actually go on rainy Saturdays"). Genuinely valuable to city planners. **Aggregate only,
k-anonymity enforced, never individual-level, and disclosed in the privacy policy.** The
reputational downside of getting this wrong exceeds the revenue; if in doubt, don't.

### Explicitly rejected

- **Charging users to join outings.** Kills the core loop.
- **Charging businesses to be listed at all.** Destroys catalog coverage, which is the moat.
- **Selling user location data.** Ever. This is a bright line.
- **Meetup's organizer-fee model.** It's why Meetup's long tail died.

---

## Unit economics at 1M MAU

| | |
|---|---|
| Infra + AI cost | ~$0.008/MAU/mo |
| Trust & safety + ops | ~$0.06–0.10/MAU/mo |
| **Total variable cost** | **~$0.09/MAU/mo ≈ $1.10/MAU/yr** |
| Business subscriptions (10 mature cities) | ~$120k/mo |
| Promoted placement | ~$30k/mo |
| Premium (2% × $4.99) | ~$100k/mo |
| Affiliate + commissions | ~$25k/mo |
| **Revenue** | **~$275k/mo (~$3.3M ARR)** |
| **Variable cost** | **~$90k/mo** |
| **Contribution margin** | **~67%** |

Salaries, marketing, and city launches sit on top. The model works; the risk isn't margin,
it's **whether cities reach liquidity**, which is why [02](02-scope-and-roadmap.md) insists on
a repeatable, budgeted city playbook.

---

## Metrics

### North star

> **Confirmed attendances per month** — the number of times someone actually showed up and
> did something they found in the app.

It's the only metric that captures both sides of the value: discovery that led to a real
outcome. DAU rewards addictive scrolling, which is not what this product is for; saves reward
intent that may never convert. If you optimize one number, optimize this one.

### The funnel to instrument on day one

```
install → location granted → first browse → first filter applied → first save
       → first activity detail → first outing viewed → first join/vote
       → first ATTENDANCE → second attendance (the retention moment)
```

Second attendance within 30 days is the single strongest predictor of long-term retention in
comparable products. Optimize the path to it relentlessly.

### Dashboards

**Demand**
- MAU / DAU, W1 / W4 / M3 retention (by cohort **and by city**)
- Sessions/user, filter usage rate, searches/session
- Saves per active user, save → attendance conversion
- Feed CTR by position, ranker version, and context

**Supply**
- Activities per km² in the active area *(the density metric that predicts retention)*
- % with ≥ 3 photos, % claimed, % verified in the last 6 months
- New listings/week by source (seeded / claimed / UGC)
- **Time to first 100 impressions** for a new listing (supply-side fairness)
- Business churn, Pro conversion

**Liquidity — watch these weekly**
- Outings created / week, **rally → quorum rate** (target ≥ 60%)
- Median time to quorum (< 36h)
- Attendance rate of confirmed outings (≥ 80%), no-show rate (< 20%)
- **Organic host rate** — % of outings not hosted by paid ambassadors (≥ 70% by month 6).
  *This is the metric that tells you if it's a product or a subsidy.*
- % of MAU who attended ≥ 1 outing (≥ 25%)

**Health & cost**
- $/MAU, LLM spend/day, candidate-cache hit rate, feed p95 latency
- Moderation items per 1,000 MAU, queue age, decision reversal rate on appeal
- **Safety incidents per 1,000 outings** — target < 1, every one human-reviewed. Report this
  to the whole company monthly; make it impossible to ignore.

### City-launch scorecard

Before declaring a city launched: ≥ 800 activities, ≥ 30 activities/km² in the core area,
≥ 100 claimed businesses, ≥ 15 open outings/week, and ≥ 25% W4 retention in the local cohort.
**Don't spend acquisition money in a city that hasn't hit these.** That is how marketing
budgets evaporate.

### Vanity metrics to actively ignore

Total registered users · total listings nationwide · app-store rating in isolation · page
views · social followers. Each of these can double while the product gets worse.
