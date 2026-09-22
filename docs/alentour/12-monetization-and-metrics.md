# 12 — Monetization & Metrics *(v2: side-project economics)*

## The goal is different now

This is a side project with no runway to defend and no investors to satisfy. So the honest
objective is not "$3.3M ARR" — it is, in order:

1. **Cover its own costs** (~$10/month now, ~$375/month at 100k registered). A trivially low bar.
2. **Pay for your time** if it works, so it can stop being a side project.
3. **Keep the option open** that it becomes a real business.

Optimizing for #3 at the expense of #1 is how unfunded projects die. Revenue comes late and
cheap to build.

## Sequence

**Stages 1–4 (months 1–11): no monetization at all.** You have no leverage until the catalog
is dense and businesses see traffic. A paywall or ad on an empty app costs more in trust than
it earns in dollars.

**Stage 5–6 (months 12+), in this order — easiest first:**

### 1. Business Pro — the core line, and the only one worth real effort

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | Claimed profile, 6 photos, hours, basic stats, reply to reviews |
| **Pro** | **$29/mo** or $290/yr | Unlimited photos + video, publish sessions/events, full analytics, booking link, priority in verified filters |

$29 rather than v1's $39: you're a solo unknown, and the price has to be obviously worth it on
month one. It sells on **attribution** — *"142 people got directions to you from Alentour last
month"* is a number no other channel gives a Montréal climbing gym.

Realistic: 8–12% of claimed businesses convert. 500 claimed × 10% × $29 ≈ **$1,450/month**.
That covers all costs and starts paying you. 2,000 claimed ≈ **$5,800/month**, at which point
the maths on quitting your job becomes interesting.

### 2. Affiliate — nearly free to add

Ticketed activities via GetYourGuide, Viator, local booking systems: 5–10% referral. A few
hundred dollars a month at best, but it's an afternoon of work and it tells you which
categories actually convert.

### 3. Promoted placement — later, and carefully

Always labeled "Sponsored", capped at 1 in 8 results, never in accessibility- or safety-
filtered results. Local ad sales is high-touch work you don't have time for; treat as Stage 6+.

### Deliberately rejected

- **Charging users to browse or to join a free outing.** Kills the core loop.
- **Charging businesses to be listed at all.** Destroys catalog coverage, which is the moat.
- **Consumer premium subscription at this stage.** 1–3% of a small user base is noise, and it
  splits your attention. Revisit past 100k registered.
- **Selling user location data.** Ever. Bright line.

---

## Metrics

### North star

> **Confirmed attendances per month** once outings exist. Before that: **saves that convert to
> a reported visit** — the "I went and did it" signal from your report-a-problem and
> post-save prompts.

DAU rewards addictive scrolling, which is not what this is for.

### What to actually watch as a solo dev

You will not maintain twelve dashboards. Pick **five numbers** and look at them weekly:

| # | Metric | Why this one | Target |
|---|---|---|---|
| 1 | **W4 retention** | The only honest verdict on whether the product is useful | ≥ 25% |
| 2 | **Filter usage rate** | Validates the entire taxonomy thesis; if low, the product premise is wrong | ≥ 35% |
| 3 | **Activities per km² in the core area** | The supply-density number that predicts everything downstream | ≥ 30 |
| 4 | **Saves per active user per month** | Intent — the leading indicator of attendance | ≥ 5 |
| 5 | **$/month vs. revenue** | Keeps the side project a side project and not a liability | cost < revenue by month 15 |

Add, once outings ship: **rally → quorum rate** (≥50%), **no-show rate** (<20%), and
**safety reports per 1,000 outings** (<1, each reviewed by you personally).

### Stage gates

Don't advance until the previous stage earns it:

| Gate | Requirement |
|---|---|
| Stage 1 → 2 | ≥35% filter usage · ≥25% W2 return · 10 people who say they went |
| Stage 2 → 3 | ≥25% W4 retention · ≥5 saves/active/month |
| Stage 3 → 4 | 50 businesses claimed manually · you can describe the enrichment pipeline from experience |
| Stage 4 → 5 | 2,000+ activities · ≥30/km² core · 1,000+ registered |
| Stage 5 → 6 | Outings running ≥8 weeks · zero serious incidents · moderation queue clearable in 15 min/day |

### Vanity metrics to ignore

Total registered accounts · total listings · app-store rating in isolation · social followers.
Each can double while the product gets worse.

---

## The realistic outcome distribution

Worth being clear-eyed about, since this is your free time:

- **Most likely (~60%):** you build a genuinely good Montréal activity dictionary, a few
  thousand people use it, it costs $30/month, and it stays a thing you're proud of. That is a
  fine outcome and the plan is designed so it's reachable in ~6 months of evenings.
- **Good (~30%):** the catalog gets dense, businesses claim it, Pro converts, it pays for
  itself and then some, and you decide whether to go further.
- **Big (~10%):** outings work, it becomes the default way 18–30 Montréal plans a weekend, and
  it stops being a side project.

Every stage is independently useful, so you're never one all-or-nothing bet from zero.
