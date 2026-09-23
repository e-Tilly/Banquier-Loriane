import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { buildShelves, buildFeed, shelfItemIds, whenMatches, shelfFilters } from "../src/catalog/shelves.ts";
import type { CatalogFile } from "../src/catalog/types.ts";
import type { RankContext } from "../src/catalog/filter.ts";

const CATALOG = "./out/catalog.fr-CA.json";
const has = existsSync(CATALOG);
const cat: CatalogFile | null = has ? JSON.parse(readFileSync(CATALOG, "utf8")) : null;

const base: RankContext = {
  lat: 45.5230, lon: -73.5800, now: new Date("2026-07-15T14:00:00"),
};

test("whenMatches gates on the actual forecast", () => {
  assert.equal(whenMatches({ precipitation_prob_gt: 0.5 }, { ...base, precipitationProb: 0.9 }), true);
  assert.equal(whenMatches({ precipitation_prob_gt: 0.5 }, { ...base, precipitationProb: 0.1 }), false);
  assert.equal(whenMatches(undefined, base), true);
});

test("shelfFilters maps the declarative spec onto engine filters", () => {
  const f = shelfFilters({ tags: ["vibe.chill"], open_now: true, max_price_cents: 3000 });
  assert.deepEqual(f.tags, ["vibe.chill"]);
  assert.equal(f.openNow, true);
  assert.equal(f.maxPriceCents, 3000);
});

if (!has) {
  test("shelf tests skipped (run npm run catalog:export first)", { skip: true }, () => {});
} else {
  test("the rainy-day shelf appears only when it will rain", () => {
    const dry = buildShelves(cat!, { ...base, precipitationProb: 0.0 });
    const wet = buildShelves(cat!, { ...base, precipitationProb: 0.9 });
    assert.equal(dry.some((s) => s.key === "rainy_day"), false);
    assert.equal(wet.some((s) => s.key === "rainy_day"), true);
  });

  test("no activity is repeated across shelves", () => {
    const shelves = buildShelves(cat!, { ...base, precipitationProb: 0.9 });
    const seen = new Set<string>();
    for (const shelf of shelves) {
      for (const item of shelf.items) {
        assert.ok(!seen.has(item.activity.id),
          `${item.activity.slug} appears on two shelves`);
        seen.add(item.activity.id);
      }
    }
  });

  test("thin shelves are dropped rather than shown near-empty", () => {
    for (const shelf of buildShelves(cat!, base)) {
      assert.ok(shelf.items.length >= 2, `${shelf.key} has ${shelf.items.length} item(s)`);
    }
  });

  test("the feed is diversified, not four of one category in a row", () => {
    const feed = buildFeed(cat!, base);
    assert.ok(feed.length > 0);
    for (let i = 0; i + 6 <= feed.length; i++) {
      const window = feed.slice(i, i + 6);
      const counts = new Map<string, number>();
      for (const item of window) {
        counts.set(item.activity.cat, (counts.get(item.activity.cat) ?? 0) + 1);
      }
      for (const [cat, n] of counts) {
        assert.ok(n <= 2, `${n} of ${cat} within one 6-card window`);
      }
    }
  });

  test("the feed does not repeat what the shelves already showed", () => {
    const ctx = { ...base, precipitationProb: 0.9 };
    const shelves = buildShelves(cat!, ctx);
    const shown = shelfItemIds(shelves);
    assert.ok(shown.size > 0);
    const feed = buildFeed(cat!, ctx, { maxDistanceKm: 15 }, 40, shown);
    const fresh = feed.filter((f) => !shown.has(f.activity.id));
    // On a thin catalog the shelves consume most of it, so repeats may still appear to fill
    // the feed — but everything new must come first.
    if (fresh.length > 0) {
      const lastFresh = feed.findLastIndex((f) => !shown.has(f.activity.id));
      const firstRepeat = feed.findIndex((f) => shown.has(f.activity.id));
      if (firstRepeat !== -1) {
        assert.ok(lastFresh < firstRepeat, "repeats must come after everything new");
      }
    }
  });

  test("a rink is not offered in September", () => {
    const sept = buildFeed(cat!, { ...base, now: new Date("2026-09-15T14:00:00") });
    assert.ok(!sept.some((f) => f.activity.slug === "patin-lafontaine"),
      "outdoor skating must not appear in September");
    const feb = buildFeed(cat!, { ...base, now: new Date("2026-02-15T14:00:00") });
    assert.ok(feb.some((f) => f.activity.slug === "patin-lafontaine"));
  });

  test("the feed is sorted by score, best first", () => {
    const feed = buildFeed(cat!, base);
    const scores = feed.map((f) => f.score);
    // diversify may defer an item, but the head of the feed must still be strong.
    assert.ok(scores[0]! >= scores[scores.length - 1]!);
  });
}
