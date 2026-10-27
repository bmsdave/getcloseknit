import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId } from "../src/lib/contracts";
import { applyComparisonAdopt, applyComparisonToggle, MAX_COMPARED_AREAS } from "../src/lib/area-comparison";

const AREAS = ["uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003", "uk:msoa:E02000001", "uk:msoa:E02000002"] as GeographyId[];

test("toggling an unselected area adds it", () => {
  const next = applyComparisonToggle([], AREAS[0]);
  assert.deepEqual(next.ids, [AREAS[0]]);
  assert.equal(next.refused, null);
});

test("toggling a selected area removes it instead of duplicating", () => {
  const next = applyComparisonToggle([AREAS[0], AREAS[1]], AREAS[0]);
  assert.deepEqual(next.ids, [AREAS[1]]);
  assert.equal(next.refused, null);
});

test("the fifth selection is refused without replacing an existing one", () => {
  const current = [AREAS[0], AREAS[1], AREAS[2], AREAS[3]];
  assert.equal(current.length, MAX_COMPARED_AREAS);
  const next = applyComparisonToggle(current, AREAS[4]);
  assert.deepEqual(next.ids, current);
  assert.equal(next.refused, AREAS[4]);
});

test("adopting more than four candidates keeps the first four", () => {
  const next = applyComparisonAdopt([...AREAS, "uk:lad:E09000001" as GeographyId]);
  assert.deepEqual(next.ids, AREAS.slice(0, 4));
  assert.equal(next.truncated, 2);
});

test("adopting four or fewer candidates truncates nothing", () => {
  const next = applyComparisonAdopt(AREAS.slice(0, 3));
  assert.deepEqual(next.ids, AREAS.slice(0, 3));
  assert.equal(next.truncated, 0);
});
