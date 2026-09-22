import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadTaxonomy, allSlugs, aiAssertableSlugs, isAiAssertable, priceBand, SLUG_PATTERN,
} from "../src/taxonomy/load.ts";

const t = loadTaxonomy();

test("the shipped taxonomy is valid and non-trivial", () => {
  assert.ok(t.version >= 1);
  assert.ok(allSlugs(t).length > 50);
  assert.deepEqual(t.locales, ["fr-CA", "en-CA"]);
});

test("every slug is unique and namespaced", () => {
  const slugs = allSlugs(t);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.match(s, SLUG_PATTERN);
});

test("AI may never assert an accessibility tag", () => {
  const assertable = new Set(aiAssertableSlugs(t));
  for (const slug of allSlugs(t).filter((s) => s.startsWith("a11y."))) {
    assert.equal(assertable.has(slug), false, `${slug} must not be AI-assertable`);
    assert.equal(isAiAssertable(t, slug), false);
  }
  // ...but ordinary tags still are, or enrichment would do nothing.
  assert.equal(isAiAssertable(t, "vibe.chill"), true);
});

test("price bands skew cheap for an 18-30 audience", () => {
  assert.equal(priceBand(t, 0), "price.free");
  assert.equal(priceBand(t, 1200), "price.low");
  assert.equal(priceBand(t, 2500), "price.mid");
  assert.equal(priceBand(t, 5000), "price.high");
  assert.equal(priceBand(t, 20000), "price.premium");
  assert.equal(priceBand(t, null), null);
});

test("every shelf references tags that exist", () => {
  const slugs = new Set(allSlugs(t));
  for (const shelf of t.shelves) {
    for (const slug of (shelf.filters as { tags?: string[] }).tags ?? []) {
      assert.ok(slugs.has(slug), `shelf ${shelf.key} -> ${slug}`);
    }
  }
});
