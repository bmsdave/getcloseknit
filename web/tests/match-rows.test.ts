import assert from "node:assert/strict";
import test from "node:test";

import type { PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { flipDeltas, liftTransform, measureTops, playFlip, settleRows, type FlipElement } from "../src/lib/flip";
import { rowsReducer } from "../src/lib/match-rows";
import { addCriterion, searchItems, setBudget } from "../src/lib/match-search";

// My match's rows (board "My match · Your order rows"): the reducer behind open/close and × with Undo, and the FLIP
// helper that slides the other rows while one is dragged.

function search(): PreferenceProfile {
  let profile = setBudget(structuredClone(DEFAULT_PROFILE), { maximum: 650000 });
  profile = addCriterion(profile, { kind: "range", layer: "crime", scale: "percentile", min: null, max: 50, softMin: null, softMax: 75, must: false });
  profile = addCriterion(profile, { kind: "range", layer: "schools", scale: "percentile", min: 50, max: null, softMin: 25, softMax: null, must: false });
  return profile;
}

const ids = (profile: PreferenceProfile) => searchItems(profile).map((item) => item.id);

test("rows reducer: a header toggles its row open and closed; one open at a time", () => {
  const closed = { profile: search(), open: null };
  const crime = rowsReducer(closed, { type: "toggle", id: "range:crime" });
  assert.equal(crime.open, "range:crime");
  assert.equal(crime.profile, closed.profile);
  const schools = rowsReducer(crime, { type: "toggle", id: "range:schools" });
  assert.equal(schools.open, "range:schools");
  assert.equal(rowsReducer(schools, { type: "toggle", id: "range:schools" }).open, null);
  assert.equal(rowsReducer(schools, { type: "close" }).open, null);
  assert.equal(rowsReducer(closed, { type: "close" }), closed);
});

test("rows reducer: × removes the criterion and closes its body; Undo restores the search as it was", () => {
  const before = { profile: search(), open: "range:crime" };
  assert.deepEqual(ids(before.profile), ["affordability", "range:crime", "range:schools"]);
  const removed = rowsReducer(before, { type: "remove", id: "range:crime" });
  assert.deepEqual(ids(removed.profile), ["affordability", "range:schools"]);
  assert.equal(removed.open, null, "the removed row's body closes");
  // Another row stays open when a different one goes.
  const other = rowsReducer({ profile: search(), open: "range:schools" }, { type: "remove", id: "range:crime" });
  assert.equal(other.open, "range:schools");
  // An id not in the search changes nothing.
  assert.equal(rowsReducer(before, { type: "remove", id: "range:noise" }), before);
  const restored = rowsReducer(removed, { type: "restore", profile: before.profile });
  assert.deepEqual(restored.profile, before.profile);
  assert.deepEqual(ids(restored.profile), ["affordability", "range:crime", "range:schools"]);
  assert.equal(restored.open, null);
});

/** A row for the FLIP helper: a top, an inline style and a reflow counter. */
function fakeRow(top: number): FlipElement & { reflows: number; log: string[] } {
  const row = {
    reflows: 0,
    log: [] as string[],
    style: { transform: "", transition: "" },
    getBoundingClientRect: () => ({ top }),
    get offsetHeight() { row.reflows += 1; row.log.push(`reflow ${row.style.transform}|${row.style.transition}`); return 44; },
  };
  return row;
}

test("flip: deltas are before − after for rows in both measurements that moved", () => {
  const before = new Map([["a", 0], ["b", 48], ["c", 96], ["gone", 144]]);
  const after = new Map([["b", 0], ["a", 48], ["c", 96.2], ["new", 144]]);
  assert.deepEqual([...flipDeltas(before, after)], [["b", 48], ["a", -48]]);
});

test("flip: measure reads each row's top; settle clears inline transforms", () => {
  const rows = new Map<string, FlipElement>([["a", fakeRow(10)], ["b", fakeRow(54)]]);
  assert.deepEqual([...measureTops(rows)], [["a", 10], ["b", 54]]);
  for (const row of rows.values()) { row.style.transform = "translateY(9px)"; row.style.transition = "transform 180ms ease"; }
  settleRows(rows);
  for (const row of rows.values()) assert.deepEqual(row.style, { transform: "", transition: "none" });
});

test("flip: play inverts without a transition, reflows, then transitions to the layout place", () => {
  const a = fakeRow(0);
  const b = fakeRow(48);
  const rows = new Map<string, FlipElement>([["a", a], ["b", b]]);
  playFlip(rows, new Map([["a", 48]]), { ms: 180, easing: "ease" });
  assert.deepEqual(a.log, ["reflow translateY(48px)|none"]);
  assert.deepEqual(a.style, { transform: "", transition: "transform 180ms ease" });
  assert.equal(b.reflows, 0, "a row that did not move is left alone");
  assert.deepEqual(b.style, { transform: "", transition: "" });
});

test("flip: reduced motion jumps rows into place with no transition", () => {
  const a = fakeRow(0);
  a.style.transform = "translateY(-48px)";
  playFlip(new Map([["a", a]]), new Map([["a", 48]]), { ms: 180, reduced: true });
  assert.equal(a.reflows, 0);
  assert.deepEqual(a.style, { transform: "", transition: "none" });
});

test("flip: the lifted row follows the pointer from where it was grabbed, scaled up a little", () => {
  // Grabbed 20px below its top at y=120 (top 100); the pointer at 190 while the layout now puts it at 148: 190 − 20 − 148.
  assert.equal(liftTransform(190, 20, 148), "translateY(22px) scale(1.02)");
  assert.equal(liftTransform(120, 20, 100), "translateY(0px) scale(1.02)");
});
