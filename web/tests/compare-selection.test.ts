import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId } from "../src/lib/contracts";
import {
  COMPARE_CHANGE_EVENT, COMPARE_STORAGE_KEY, addCompared, readCompared, removeCompared, resetCompareMemory,
  showComparedOnly, subscribeCompared, toggleCompared, writeCompared,
} from "../src/lib/compare-selection";

const A = "uk:lsoa:E01000001" as GeographyId;
const B = "uk:lsoa:E01000002" as GeographyId;
const C = "uk:lsoa:E01000003" as GeographyId;
const D = "uk:lsoa:E01000004" as GeographyId;
const E = "uk:lsoa:E01000005" as GeographyId;

/** A page with working (or refusing) localStorage. */
function page(blocked = false) {
  const data = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => { if (blocked) throw new DOMException("denied", "SecurityError"); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (blocked) throw new DOMException("denied", "QuotaExceededError"); data.set(key, value); },
    removeItem: (key: string) => { if (blocked) throw new DOMException("denied", "SecurityError"); data.delete(key); },
  };
  const window = Object.assign(new EventTarget(), { localStorage });
  (globalThis as unknown as { window: unknown }).window = window;
  resetCompareMemory();
  return { data, window };
}

test("the selection is restored from storage (a reload)", () => {
  const { data } = page();
  data.set(COMPARE_STORAGE_KEY, JSON.stringify([A, B]));
  assert.deepEqual(readCompared(), [A, B]);
  // Same stored value, same array (useSyncExternalStore needs a stable snapshot).
  assert.equal(readCompared(), readCompared());
  toggleCompared(C);
  resetCompareMemory();
  assert.deepEqual(readCompared(), [A, B, C]);
  assert.deepEqual(JSON.parse(data.get(COMPARE_STORAGE_KEY)!), [A, B, C]);
});

test("damaged or foreign values read as no selection", () => {
  const { data } = page();
  data.set(COMPARE_STORAGE_KEY, "{not json");
  assert.deepEqual(readCompared(), []);
  data.set(COMPARE_STORAGE_KEY, JSON.stringify(["x", 3, A, A, "uk:lsoa:<script>"]));
  assert.deepEqual(readCompared(), [A]);
});

test("the comparison holds four areas and refuses a fifth without evicting anyone", () => {
  page();
  for (const id of [A, B, C, D]) assert.equal(addCompared(id).refused, null);
  const full = addCompared(E);
  assert.equal(full.refused, E);
  assert.deepEqual(readCompared(), [A, B, C, D]);
  assert.deepEqual(addCompared(A), { ids: [A, B, C, D], refused: null });
  assert.deepEqual(removeCompared(B), [A, C, D]);
  writeCompared([A, B, C, D, E]);
  assert.deepEqual(readCompared(), [A, B, C, D]);
});

test("blocked storage keeps the selection in memory for the page", () => {
  page(true);
  assert.deepEqual(readCompared(), []);
  assert.equal(writeCompared([A]), false);
  assert.deepEqual(toggleCompared(B).ids, [A, B]);
  assert.deepEqual(readCompared(), [A, B]);
});

test("changes notify this page and other tabs", () => {
  const { window } = page();
  let calls = 0;
  const stop = subscribeCompared(() => { calls += 1; });
  toggleCompared(A);
  assert.equal(calls, 1);
  window.dispatchEvent(Object.assign(new Event("storage"), { key: COMPARE_STORAGE_KEY }));
  assert.equal(calls, 2);
  window.dispatchEvent(Object.assign(new Event("storage"), { key: "something-else" }));
  assert.equal(calls, 2);
  stop();
  window.dispatchEvent(new Event(COMPARE_CHANGE_EVENT));
  assert.equal(calls, 2);
});

test("a shared link's areas are shown, not stored, until the user changes them", () => {
  const { data } = page();
  data.set(COMPARE_STORAGE_KEY, JSON.stringify([D]));
  showComparedOnly([A, B]);
  assert.deepEqual(readCompared(), [A, B]);
  assert.deepEqual(JSON.parse(data.get(COMPARE_STORAGE_KEY)!), [D]);
  toggleCompared(C);
  assert.deepEqual(JSON.parse(data.get(COMPARE_STORAGE_KEY)!), [A, B, C]);
});
