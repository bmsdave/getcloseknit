// v4.4 brief-compare track: /compare speaks the area page's tile words and shows the search (findings 10, 51).
import assert from "node:assert/strict";
import test from "node:test";

import { placesTable, withSearchRows } from "../src/lib/compare-table";
import type { GeographyId, MatchCriterion } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { fixtureAreaProfile } from "../src/lib/area-profile-fixture";
import { contractProfile } from "../src/lib/match-model";
import { MATCH_CHIPS } from "../src/lib/match-ranges";
import { addCriterion, freshSearch, setBudget } from "../src/lib/match-search";
import { buildMatchPack } from "../src/lib/matching";
import { fixtureStandouts } from "../src/lib/standouts-fixture";

const IDS = ["uk:lsoa:E01000002", "uk:lsoa:E01000003"] as GeographyId[];
const kingsCross: MatchCriterion = {
  kind: "place", id: "kings-cross", label: "King's Cross", target: { kind: "point", latitude: 51.5306, longitude: -0.1239 },
  mode: "transit", targetMinutes: 35, must: false,
};

function table() {
  return placesTable(IDS.map((id) => ({ id, profile: fixtureAreaProfile(id, "2025-09"), standouts: fixtureStandouts(id) })));
}

test("compare rows use the v4 tile words: Safety · safer than N%, noise in dB, schools within 1.5 km", () => {
  const rows = table().rows;
  const labels = rows.map((row) => row.label);
  assert.deepEqual(labels.slice(0, 2), ["Price", "Safety"]);
  assert.ok(!labels.includes("Crime") && !labels.includes("Schools near"));
  const text = rows.flatMap((row) => row.cells.map((cell) => cell.text)).join(" | ");
  assert.doesNotMatch(text, /\/1k|% loud| in 1 km/);
  const safety = rows.find((row) => row.label === "Safety");
  const noise = rows.find((row) => row.label === "Noise");
  const schools = rows.find((row) => row.label === "Schools");
  assert.ok(safety && noise && schools);
  for (const cell of safety.cells) assert.match(cell.text, /^(Safer than|More crime than) \d+%$/);
  // The best is the one its words call safest.
  assert.equal(safety.cells.find((cell) => cell.best)?.text, "Safer than 62%");
  for (const cell of noise.cells) assert.match(cell.text, /% over 55 dB$/);
  for (const cell of schools.cells) assert.match(cell.text, /within 1\.5 km$/);
  // Every tile row still names a winner (by London standing: the tiles carry no raw figure).
  for (const label of ["Schools", "Station walk", "Noise"]) {
    const row = rows.find((entry) => entry.label === label)!;
    assert.equal(row.cells.filter((cell) => cell.best).length, 1, label);
  }
});

test("without tiles (a district) the same words come from the profile, never the old ones", () => {
  const rows = placesTable(IDS.map((id) => ({ id, profile: fixtureAreaProfile(id, "2025-09") }))).rows;
  const text = rows.flatMap((row) => row.cells.map((cell) => cell.text)).join(" | ");
  assert.doesNotMatch(text, /\/1k|% loud/);
});

test("with a search: Match first, then a row per place after Schools (CUJ03 step 2)", () => {
  let profile = setBudget(freshSearch(structuredClone(DEFAULT_PROFILE)), { market: "buy", maximum: 650_000 });
  profile = addCriterion(profile, kingsCross);
  profile = addCriterion(profile, MATCH_CHIPS.find((entry) => entry.id === "safer-streets")!.criterion);
  const pack = buildMatchPack(contractProfile(profile));
  const rows = withSearchRows(table(), pack, profile);
  assert.equal(rows[0].label, "Match");
  for (const cell of rows[0].cells) assert.match(cell.text, /^\d+$|^Out$/);
  const at = rows.findIndex((row) => row.label === "King's Cross");
  assert.ok(at > rows.findIndex((row) => row.label === "Safety"));
  for (const cell of rows[at].cells) assert.match(cell.text, /^\d+ min$/);
  // No search pack: the table's own rows.
  assert.deepEqual(withSearchRows(table(), null, profile), table().rows);
});
