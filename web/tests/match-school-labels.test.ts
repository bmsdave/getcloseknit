import assert from "node:assert/strict";
import test from "node:test";

import type { BriefSchool } from "../src/lib/brief-model";
import { ASKED_FAR, ASKED_NEAR, labelledSchools } from "../src/lib/match-school-labels";

const CENTER: [number, number] = [-0.1, 51.5];

function school(index: number, tier: BriefSchool["grade"]["tier"], metresEast: number): BriefSchool {
  return {
    urn: String(index), name: `School ${index}`, phase: "Primary", longitude: CENTER[0] + metresEast / 69_000, latitude: CENTER[1],
    grade: { tier, label: tier, year: null }, attainment8: null, selectivity: null, nearAreas: ["uk:lsoa:E01000001"],
  } as unknown as BriefSchool;
}

// 30 schools near the selected area, as at zoom 12 after a Top-10 row (final prod check: dozens of overlapping labels).
const MANY = Array.from({ length: 30 }, (_, index) => school(index, index % 5 === 0 ? "outstanding" : "good", 100 + index * 50));

test("schools asked for: further out only the best few, the best grade then the nearest", () => {
  const shown = labelledSchools(MANY, true, false, CENTER);
  assert.equal(shown.length, ASKED_FAR);
  assert.ok(shown.every((entry) => entry.grade.tier === "outstanding"));
  assert.deepEqual(shown.map((entry) => entry.urn), ["0", "5", "10"]);
});

test("schools asked for: close in the nearest few, never all of them", () => {
  const shown = labelledSchools(MANY, true, true, CENTER);
  assert.equal(shown.length, ASKED_NEAR);
  assert.deepEqual(shown.map((entry) => entry.urn), ["0", "1", "2", "3", "4", "5", "6", "7"]);
});

test("schools not asked for: none further out, at most two outstanding close by when zoomed in", () => {
  assert.deepEqual(labelledSchools(MANY, false, false, CENTER), []);
  const near = labelledSchools(MANY, false, true, CENTER);
  assert.equal(near.length, 2);
  assert.ok(near.every((entry) => entry.grade.tier === "outstanding"));
});
