/**
 * A user's saves and lists, designed for offline-first sync.
 *
 * Every entry carries the time it last changed, and deletions are kept as tombstones. That is
 * what lets two devices (or a device and the server, from Stage 2) merge without losing a
 * deletion or resurrecting something the user removed. Merge is last-writer-wins per entry,
 * which is the right trade-off for data this low-stakes: no conflicts to show the user, ever.
 *
 * Pure functions only — shared by the app and the API.
 */

export interface SaveEntry { at: string; deleted?: true }
export interface ListEntry { name: string; items: string[]; at: string; deleted?: true }

export interface Library {
  saves: Record<string, SaveEntry>;
  lists: Record<string, ListEntry>;
}

export const emptyLibrary = (): Library => ({ saves: {}, lists: {} });

export const MAX_LIST_NAME = 60;
export const MAX_LISTS = 50;

export function isSaved(lib: Library, activityId: string): boolean {
  const e = lib.saves[activityId];
  return !!e && !e.deleted;
}

export function savedIds(lib: Library): string[] {
  return Object.entries(lib.saves)
    .filter(([, e]) => !e.deleted)
    .sort((a, b) => b[1].at.localeCompare(a[1].at))      // most recent first
    .map(([id]) => id);
}

export function toggleSave(lib: Library, activityId: string, now: Date): Library {
  const at = now.toISOString();
  const saves = { ...lib.saves };
  saves[activityId] = isSaved(lib, activityId) ? { at, deleted: true } : { at };
  return { ...lib, saves };
}

export function visibleLists(lib: Library): { id: string; name: string; items: string[] }[] {
  return Object.entries(lib.lists)
    .filter(([, l]) => !l.deleted)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, l]) => ({ id, name: l.name, items: l.items }));
}

export function createList(lib: Library, id: string, name: string, now: Date): Library {
  const clean = name.trim().slice(0, MAX_LIST_NAME);
  if (!clean) throw new Error("List name is required");
  if (visibleLists(lib).length >= MAX_LISTS) throw new Error("Too many lists");
  return { ...lib, lists: { ...lib.lists, [id]: { name: clean, items: [], at: now.toISOString() } } };
}

export function renameList(lib: Library, id: string, name: string, now: Date): Library {
  const l = lib.lists[id];
  const clean = name.trim().slice(0, MAX_LIST_NAME);
  if (!l || l.deleted || !clean) return lib;
  return { ...lib, lists: { ...lib.lists, [id]: { ...l, name: clean, at: now.toISOString() } } };
}

export function deleteList(lib: Library, id: string, now: Date): Library {
  const l = lib.lists[id];
  if (!l || l.deleted) return lib;
  return { ...lib, lists: { ...lib.lists, [id]: { ...l, items: [], at: now.toISOString(), deleted: true } } };
}

export function toggleInList(lib: Library, id: string, activityId: string, now: Date): Library {
  const l = lib.lists[id];
  if (!l || l.deleted) return lib;
  const items = l.items.includes(activityId)
    ? l.items.filter((x) => x !== activityId)
    : [...l.items, activityId];
  return { ...lib, lists: { ...lib.lists, [id]: { ...l, items, at: now.toISOString() } } };
}

/** Last-writer-wins per entry. Commutative and idempotent, so sync order never matters. */
export function mergeLibraries(a: Library, b: Library): Library {
  return {
    saves: mergeRecords(a.saves, b.saves),
    lists: mergeRecords(a.lists, b.lists),
  };
}

function mergeRecords<T extends { at: string }>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const mine = out[k];
    if (!mine || v.at > mine.at || (v.at === mine.at && stableKey(v) > stableKey(mine))) out[k] = v;
  }
  return out;
}

/** Tie-break identical timestamps deterministically so merge(a,b) === merge(b,a). */
function stableKey(v: unknown): string {
  return JSON.stringify(v);
}

/** Tombstones older than this are dropped; every device has long since seen them. */
export function compact(lib: Library, now: Date, keepDays = 90): Library {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString();
  const keep = <T extends { at: string; deleted?: true }>(r: Record<string, T>) =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => !(v.deleted && v.at < cutoff)));
  return { saves: keep(lib.saves), lists: keep(lib.lists) };
}

/** Defensive parse of anything read from storage or the network. */
export function parseLibrary(raw: unknown): Library {
  const lib = emptyLibrary();
  if (!raw || typeof raw !== "object") return lib;
  const r = raw as Partial<Library>;
  for (const [k, v] of Object.entries(r.saves ?? {})) {
    if (v && typeof v.at === "string") lib.saves[k] = v.deleted ? { at: v.at, deleted: true } : { at: v.at };
  }
  for (const [k, v] of Object.entries(r.lists ?? {})) {
    if (v && typeof v.at === "string" && typeof v.name === "string" && Array.isArray(v.items)) {
      lib.lists[k] = {
        name: v.name.slice(0, MAX_LIST_NAME),
        items: v.items.filter((x): x is string => typeof x === "string"),
        at: v.at,
        ...(v.deleted ? { deleted: true as const } : {}),
      };
    }
  }
  return lib;
}

/** Migrate the Stage-1 flat array of saved ids into a Library. */
export function fromLegacySaves(ids: string[], now: Date): Library {
  const lib = emptyLibrary();
  for (const id of ids) lib.saves[id] = { at: now.toISOString() };
  return lib;
}
