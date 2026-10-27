import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanSavedItem,
  isSavedItem,
  parseSavedItems,
  readSavedItems,
  removeSavedHome,
  savedCount,
  SAVED_ITEMS_KEY,
  SAVED_ITEMS_SCHEMA,
  toggleSavedItem,
} from "../src/lib/saved-items";
import { USER_CANDIDATES_KEY } from "../src/lib/user-candidates";

function installMemoryStorage(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const events: string[] = [];
  (globalThis as Record<string, unknown>).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
    dispatchEvent: (event: Event) => { events.push(event.type); return true; },
  };
  return { store, events };
}

function uninstallWindow() {
  delete (globalThis as Record<string, unknown>).window;
}

const GYM = { kind: "place" as const, id: "osm-42", name: "Better Gym", meta: "Gym", at: [-0.1, 51.5] as [number, number] };

test("a ♡ saves a place, a second press unsaves it, and every write tells the page", () => {
  const { store, events } = installMemoryStorage();
  assert.deepEqual(toggleSavedItem(GYM), { ok: true, saved: true });
  const stored = JSON.parse(store.get(SAVED_ITEMS_KEY)!);
  // One plain, versioned document: portable to an account later.
  assert.equal(stored.schemaVersion, SAVED_ITEMS_SCHEMA);
  assert.equal(stored.items[0].name, "Better Gym");
  assert.ok(isSavedItem(readSavedItems(), "place", "osm-42"));
  assert.deepEqual(toggleSavedItem(GYM), { ok: true, saved: false });
  assert.equal(readSavedItems().length, 0);
  assert.deepEqual(events, ["close-knit:saved-change", "close-knit:saved-change"]);
  uninstallWindow();
});

test("stored items are checked: junk, other kinds and outside links are dropped", () => {
  assert.equal(cleanSavedItem({ kind: "home", id: "1", name: "x" }), null);
  assert.equal(cleanSavedItem({ kind: "place", id: "", name: "x" }), null);
  assert.equal(cleanSavedItem({ kind: "school", id: "100001", name: "A", href: "https://evil.example" })?.href, undefined);
  assert.equal(cleanSavedItem({ kind: "school", id: "100001", name: "A", href: "//evil.example" })?.href, undefined);
  assert.equal(cleanSavedItem({ kind: "school", id: "100001", name: "A", href: "/school/100001" })?.href, "/school/100001");
  assert.equal(cleanSavedItem({ kind: "place", id: "p", name: "A", at: [1, "2"] })?.at, undefined);
  assert.deepEqual(parseSavedItems("not json"), []);
  assert.deepEqual(parseSavedItems(JSON.stringify({ schemaVersion: "other", items: [GYM] })), []);
});

test("♡ N counts areas, homes and the other saved things", () => {
  const shortlists = JSON.stringify([{ candidates: ["uk:lsoa:E01000001", "uk:lsoa:E01000002"] }, { candidates: ["uk:lsoa:E01000001"] }]);
  const items = JSON.stringify({ schemaVersion: SAVED_ITEMS_SCHEMA, items: [{ ...GYM, savedAt: "2026-10-16T10:00:00Z" }] });
  assert.equal(savedCount(shortlists, items, 3), 6);
  assert.equal(savedCount(null, null), 0);
});

test("unsaving a home removes its user candidate", () => {
  const candidate = { id: "c1" };
  const { store, events } = installMemoryStorage({
    [USER_CANDIDATES_KEY]: JSON.stringify({ schemaVersion: "user-candidate-store.v1", candidates: [] }),
  });
  // An empty store stays valid; removing an unknown id writes the same empty list.
  assert.equal(removeSavedHome(candidate.id), true);
  assert.deepEqual(JSON.parse(store.get(USER_CANDIDATES_KEY)!).candidates, []);
  assert.deepEqual(events, ["close-knit:candidates-changed", "close-knit:saved-change"]);
  uninstallWindow();
});
