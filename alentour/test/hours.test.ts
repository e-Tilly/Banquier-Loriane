import { test } from "node:test";
import assert from "node:assert/strict";
import { isOpenAt, parseOpeningHours } from "../src/catalog/hours.ts";

const at = (s: string) => new Date(s);   // local time

test("24/7 is always open", () => {
  assert.equal(isOpenAt("24/7", at("2026-09-23T03:00:00")), "open");
});

test("day ranges and time spans", () => {
  const spec = "Mo-Fr 09:00-17:00";
  assert.equal(isOpenAt(spec, at("2026-09-23T10:00:00")), "open");   // Wednesday
  assert.equal(isOpenAt(spec, at("2026-09-23T18:00:00")), "closed");
  assert.equal(isOpenAt(spec, at("2026-09-26T10:00:00")), "closed"); // Saturday
});

test("multiple rules", () => {
  const spec = "Mo-Fr 06:00-23:00; Sa-Su 08:00-21:00";
  assert.equal(isOpenAt(spec, at("2026-09-26T09:00:00")), "open");   // Sat
  assert.equal(isOpenAt(spec, at("2026-09-26T07:00:00")), "closed");
  assert.equal(isOpenAt(spec, at("2026-09-23T22:00:00")), "open");   // Wed
});

test("explicit off wins over a span", () => {
  assert.equal(isOpenAt("Mo-Su 10:00-18:00; Tu off", at("2026-09-22T12:00:00")), "closed");
});

test("overnight spans cross midnight", () => {
  const spec = "We-Su 17:00-01:00";
  assert.equal(isOpenAt(spec, at("2026-09-23T23:00:00")), "open");   // Wed late
  assert.equal(isOpenAt(spec, at("2026-09-24T00:30:00")), "open");   // Thu early, Wed's span
  assert.equal(isOpenAt(spec, at("2026-09-24T02:00:00")), "closed");
});

test("unparseable or missing specs return unknown, never a guess", () => {
  assert.equal(isOpenAt(undefined, at("2026-09-23T10:00:00")), "unknown");
  assert.equal(isOpenAt("sunrise-sunset", at("2026-09-23T10:00:00")), "unknown");
  assert.equal(isOpenAt("Mo-Fr 09:00+", at("2026-09-23T10:00:00")), "unknown");
  assert.equal(parseOpeningHours("PH off"), null);
});

test("comma day lists", () => {
  const spec = "Mo,We,Fr 10:00-12:00";
  assert.equal(isOpenAt(spec, at("2026-09-23T11:00:00")), "open");   // Wed
  assert.equal(isOpenAt(spec, at("2026-09-24T11:00:00")), "closed"); // Thu
});
