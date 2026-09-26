import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyLibrary, toggleSave, isSaved, savedIds, createList, toggleInList, deleteList,
  renameList, visibleLists, mergeLibraries, compact, parseLibrary, fromLegacySaves,
} from "../src/user/library.ts";

const t0 = new Date("2026-09-01T10:00:00Z");
const t1 = new Date("2026-09-01T11:00:00Z");
const t2 = new Date("2026-09-01T12:00:00Z");

test("toggling a save twice leaves a tombstone, not nothing", () => {
  let lib = toggleSave(emptyLibrary(), "a", t0);
  assert.equal(isSaved(lib, "a"), true);
  lib = toggleSave(lib, "a", t1);
  assert.equal(isSaved(lib, "a"), false);
  assert.equal(lib.saves.a?.deleted, true, "deletion must be recorded so it can sync");
});

test("saved ids are most-recent first", () => {
  let lib = toggleSave(emptyLibrary(), "old", t0);
  lib = toggleSave(lib, "new", t1);
  assert.deepEqual(savedIds(lib), ["new", "old"]);
});

test("a deletion on one device survives merging with a stale device", () => {
  const phone = toggleSave(toggleSave(emptyLibrary(), "a", t0), "a", t2);   // saved then removed
  const tablet = toggleSave(emptyLibrary(), "a", t1);                        // saved, never removed
  const merged = mergeLibraries(tablet, phone);
  assert.equal(isSaved(merged, "a"), false, "the later deletion must win");
});

test("merge is commutative and idempotent", () => {
  const a = toggleSave(createList(emptyLibrary(), "L1", "Pluie", t0), "x", t1);
  const b = toggleSave(toggleSave(emptyLibrary(), "y", t0), "x", t2);
  assert.deepEqual(mergeLibraries(a, b), mergeLibraries(b, a));
  const m = mergeLibraries(a, b);
  assert.deepEqual(mergeLibraries(m, m), m);
});

test("identical timestamps still merge deterministically", () => {
  const a = createList(emptyLibrary(), "L", "Alpha", t0);
  const b = createList(emptyLibrary(), "L", "Beta", t0);
  assert.deepEqual(mergeLibraries(a, b), mergeLibraries(b, a));
});

test("lists: create, add, remove, rename, delete", () => {
  let lib = createList(emptyLibrary(), "L", "  Jours de pluie  ", t0);
  assert.equal(visibleLists(lib)[0]!.name, "Jours de pluie");
  lib = toggleInList(lib, "L", "a", t1);
  lib = toggleInList(lib, "L", "b", t1);
  lib = toggleInList(lib, "L", "a", t2);
  assert.deepEqual(visibleLists(lib)[0]!.items, ["b"]);
  lib = renameList(lib, "L", "Pluie", t2);
  assert.equal(visibleLists(lib)[0]!.name, "Pluie");
  lib = deleteList(lib, "L", t2);
  assert.equal(visibleLists(lib).length, 0);
  assert.equal(lib.lists.L?.deleted, true);
});

test("empty list names are rejected", () => {
  assert.throws(() => createList(emptyLibrary(), "L", "   ", t0), /required/);
});

test("compact drops only old tombstones", () => {
  let lib = toggleSave(toggleSave(emptyLibrary(), "gone", t0), "gone", t0);
  lib = toggleSave(lib, "kept", t0);
  const later = new Date(t0.getTime() + 120 * 86_400_000);
  const c = compact(lib, later);
  assert.equal(c.saves.gone, undefined);
  assert.ok(c.saves.kept);
});

test("parseLibrary survives garbage from storage", () => {
  assert.deepEqual(parseLibrary(null), emptyLibrary());
  assert.deepEqual(parseLibrary("nope"), emptyLibrary());
  const lib = parseLibrary({ saves: { a: { at: "x" }, b: { nope: 1 } }, lists: { L: { name: "n", items: [1, "a"], at: "x" } } });
  assert.deepEqual(Object.keys(lib.saves), ["a"]);
  assert.deepEqual(lib.lists.L?.items, ["a"]);
});

test("stage-1 saves migrate without loss", () => {
  const lib = fromLegacySaves(["a", "b"], t0);
  assert.deepEqual(savedIds(lib).sort(), ["a", "b"]);
});
