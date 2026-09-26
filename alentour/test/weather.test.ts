import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fromOpenMeteo, CITIES, openMeteoUrl } from "../src/weather/publish.ts";
import { currentConditions, NEUTRAL } from "../src/weather/conditions.ts";

const body = JSON.parse(readFileSync("test/fixtures/open-meteo-montreal.json", "utf8"));
const city = CITIES[0]!;
const generated = new Date("2026-07-18T12:00:00Z");       // 08:00 local
const w = fromOpenMeteo(city, body, generated);

test("maps the Open-Meteo response", () => {
  assert.equal(w.hours.length, 48);
  assert.equal(w.days.length, 2);
  assert.equal(w.city, "montreal");
  assert.match(openMeteoUrl(city), /precipitation_probability/);
});

test("rain in the next few hours counts, not just this hour", () => {
  // 11:00 local = 15:00Z. Rain starts at 13:00 local, within the 3h lookahead.
  const c = currentConditions(w, new Date("2026-07-18T15:00:00Z"));
  assert.equal(c.fresh, true);
  assert.ok(c.precipitationProb >= 0.9, `got ${c.precipitationProb}`);
});

test("a dry morning reads as dry", () => {
  // 09:00 local = 13:00Z; lookahead reaches 12:00 local, before the rain.
  const c = currentConditions(w, new Date("2026-07-18T13:00:00Z"));
  assert.ok(c.precipitationProb < 0.1);
  assert.equal(c.isDark, false);
});

test("after sunset it is dark", () => {
  // 22:00 local = 02:00Z next day.
  const c = currentConditions(w, new Date("2026-07-19T02:00:00Z"));
  assert.equal(c.isDark, true);
});

test("a stale file yields neutral weather, not yesterday's sunshine", () => {
  const c = currentConditions(w, new Date("2026-07-19T12:00:00Z"));   // 24h later
  assert.equal(c.fresh, false);
  assert.equal(c.precipitationProb, NEUTRAL.precipitationProb);
});

test("missing file is neutral", () => {
  assert.deepEqual(currentConditions(null, new Date()), NEUTRAL);
});

test("rejects an unexpected response shape", () => {
  assert.throws(() => fromOpenMeteo(city, { nope: true }), /Unexpected/);
});
