import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { applyFilters, haversineKm, diversify, a11yValue } from "../src/catalog/filter.ts";
import type { CatalogActivity, CatalogFile } from "../src/catalog/types.ts";

const CATALOG = "./out/catalog.fr-CA.json";
const has = existsSync(CATALOG);
const cat: CatalogFile | null = has ? JSON.parse(readFileSync(CATALOG, "utf8")) : null;

// Somewhere in the Plateau.
const ctx = { lat: 45.5230, lon: 45.5230 * 0 - 73.5800, now: new Date("2026-07-15T14:00:00") };

test("haversine matches a known Montréal distance", () => {
  // Mont-Royal belvedere to Marché Jean-Talon is roughly 4 km.
  const d = haversineKm(45.5048, -73.5878, 45.5360, -73.6145);
  assert.ok(d > 3.5 && d < 4.5, `got ${d.toFixed(2)} km`);
});

test("a11yValue distinguishes unknown from false", () => {
  const a = { a11y: { "a11y.step_free_entry": false } } as unknown as CatalogActivity;
  assert.equal(a11yValue(a, "a11y.step_free_entry"), false);
  assert.equal(a11yValue(a, "a11y.accessible_washroom"), null);   // unknown, NOT false
});

test("diversify caps a run of one category", () => {
  const mk = (cat: string, i: number) =>
    ({ activity: { id: String(i), cat } , distanceKm: 0, score: 1, openState: "open" }) as any;
  const input = [mk("a", 1), mk("a", 2), mk("a", 3), mk("a", 4), mk("b", 5)];
  const out = diversify(input, 2, 6);
  assert.equal(out.length, 5, "nothing is discarded, only deferred");
  assert.equal(out.slice(0, 3).filter((s) => s.activity.cat === "a").length, 2);
});

if (!has) {
  test("catalog-backed tests skipped (run npm run catalog:export first)", { skip: true }, () => {});
} else {
  test("the exported catalog is internally consistent", () => {
    const venueIds = new Set(cat!.venues.map((v) => v.id));
    for (const a of cat!.activities) {
      assert.ok(venueIds.has(a.venueId), `${a.slug} -> missing venue`);
      assert.ok(a.title.length > 0);
      assert.ok(!a.tags.some((t) => t.startsWith("a11y.")), `${a.slug} leaks a11y into tags`);
    }
  });

  test("free filter returns only free activities", () => {
    const r = applyFilters(cat!.activities, { freeOnly: true }, ctx);
    assert.ok(r.matches.length > 0);
    assert.ok(r.matches.every((m) => m.activity.free));
  });

  test("price filter excludes the expensive spa", () => {
    const r = applyFilters(cat!.activities, { maxPriceCents: 3000 }, ctx);
    assert.ok(!r.matches.some((m) => m.activity.slug === "bota-bota-thermal"));
  });

  test("seasonal activities are hidden out of season", () => {
    const july = applyFilters(cat!.activities, {}, { ...ctx, now: new Date("2026-07-15T14:00:00") });
    const january = applyFilters(cat!.activities, {}, { ...ctx, now: new Date("2026-01-15T14:00:00") });
    const skating = (r: typeof july) => r.matches.some((m) => m.activity.slug === "patin-lafontaine");
    assert.equal(skating(july), false, "no outdoor rink in July");
    assert.equal(skating(january), true, "rink is open in January");
  });

  test("accessibility: unknown is separated, never silently dropped", () => {
    const r = applyFilters(cat!.activities, { requireA11y: ["a11y.step_free_entry"] }, ctx);
    // Known-true venues match.
    assert.ok(r.matches.some((m) => m.activity.slug === "bota-bota-thermal"));
    // Known-false is excluded entirely.
    assert.ok(!r.matches.some((m) => m.activity.slug === "mont-royal-belvedere"));
    assert.ok(!r.unknownA11y.some((m) => m.activity.slug === "mont-royal-belvedere"));
    // Unknown lands in its own bucket rather than vanishing.
    assert.ok(r.unknownA11y.length > 0, "unknown-access venues must still be surfaced");
    assert.ok(r.unknownA11y.every((m) => m.a11yUnknown === true));
  });

  test("rainy weather promotes indoor activities", () => {
    const dry = applyFilters(cat!.activities, {}, { ...ctx, precipitationProb: 0 });
    const wet = applyFilters(cat!.activities, {}, { ...ctx, precipitationProb: 0.9 });
    const rank = (r: typeof dry, slug: string) =>
      r.matches.findIndex((m) => m.activity.slug === slug);
    // An indoor activity should rank strictly better in the rain than in the dry.
    assert.ok(rank(wet, "ceramique-peinture") < rank(dry, "ceramique-peinture"),
      "indoor ceramics should climb when it rains");
  });

  test("closed venues are dimmed, not dropped", () => {
    const night = applyFilters(cat!.activities, {}, { ...ctx, now: new Date("2026-07-15T03:00:00") });
    assert.ok(night.matches.some((m) => m.openState === "closed"),
      "browsing at 3am should still show closed venues for tomorrow");
    const openNow = applyFilters(cat!.activities, { openNow: true },
      { ...ctx, now: new Date("2026-07-15T03:00:00") });
    assert.ok(openNow.matches.every((m) => m.openState === "open"));
  });

  test("a single-filter miss drops exactly one filter", () => {
    const r = applyFilters(cat!.activities, {
      categories: ["category.wellness"], maxPriceCents: 100,
    }, ctx);
    assert.equal(r.matches.length, 0);
    assert.deepEqual(r.relaxed!.droppedFilters, ["maxPriceCents"]);
  });

  test("an over-constrained search relaxes instead of showing nothing", () => {
    const r = applyFilters(cat!.activities, {
      freeOnly: true, maxDistanceKm: 0.1, categories: ["category.wellness"],
    }, ctx);
    assert.equal(r.matches.length, 0);
    assert.ok(r.relaxed, "must offer a relaxed result set rather than an empty screen");
    assert.ok(r.relaxed!.matches.length > 0);
    // It had to give up more than one filter here — free wellness within 100 m doesn't exist.
    assert.ok(r.relaxed!.droppedFilters.length >= 2);
    // Distance is what the user most clearly meant, so it is surrendered last.
    assert.equal(r.relaxed!.droppedFilters.at(-1), "maxDistanceKm");
  });
}
