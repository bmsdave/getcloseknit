// v4.5 compare-brief track (check round 2): Compare's Schools winner and bars, one £/m² series, the brief's request.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compareRow, placesTable } from "../src/lib/compare-table";
import type { GeographyId } from "../src/lib/contracts";
import { fixtureAreaProfile } from "../src/lib/area-profile-fixture";
import { savedAreaMeta } from "../src/lib/saved-panel";
import { PRICE_TILE_SOURCE, type AreaStandouts } from "../src/lib/standouts";
import { fixtureStandouts } from "../src/lib/standouts-fixture";

const IDS = ["uk:lsoa:E01000002", "uk:lsoa:E01000003"] as GeographyId[];
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The fixture's tiles with the schools tile set as the API sends it: a count, and a school-results standing. */
function withSchools(id: GeographyId, count: number, standing: number): AreaStandouts {
  const standouts = structuredClone(fixtureStandouts(id)!);
  standouts.tiles = standouts.tiles.map((tile) => (tile.id === "schools"
    ? { ...tile, available: true, value: count, display: `${count} within 1.5 km`, standing } : tile));
  return standouts;
}

test("Schools goes to the area with more schools nearby, whatever the school-results standing says", () => {
  // Round 2: Highbury Fields "20 within 1.5 km" was ticked over Canonbury East "26 within 1.5 km".
  const rows = placesTable([
    { id: IDS[0], profile: fixtureAreaProfile(IDS[0], "2025-09"), standouts: withSchools(IDS[0], 20, 90) },
    { id: IDS[1], profile: fixtureAreaProfile(IDS[1], "2025-09"), standouts: withSchools(IDS[1], 26, 40) },
  ]).rows;
  const schools = rows.find((row) => row.label === "Schools")!;
  assert.deepEqual(schools.cells.map((cell) => [cell.text, cell.best]), [["20 within 1.5 km", false], ["26 within 1.5 km", true]]);
  assert.equal(schools.cells[1].bar, 1);
  // A tile without its figure (the demo's) still ranks by the count its words start with.
  const words = withSchools(IDS[0], 0, 0);
  words.tiles = words.tiles.map((tile) => (tile.id === "schools" ? { ...tile, value: null, display: "31 within 1.5 km" } : tile));
  const demo = placesTable([
    { id: IDS[0], profile: null, standouts: words },
    { id: IDS[1], profile: null, standouts: withSchools(IDS[1], 26, 99) },
  ]).rows.find((row) => row.label === "Schools")!;
  assert.deepEqual(demo.cells.map((cell) => cell.best), [true, false]);
});

test("a longer bar is always the better value: lower-is-better rows give the lowest the full bar", () => {
  const park = compareRow("Park", "low", true, [{ text: "124 m", value: 124 }, { text: "280 m", value: 280 }]);
  assert.deepEqual(park.cells.map((cell) => cell.best), [true, false]);
  assert.equal(park.cells[0].bar, 1);
  assert.equal(park.cells[1].bar, 124 / 280);
  const higher = compareRow("Match", "high", true, [{ text: "40", value: 40 }, { text: "80", value: 80 }]);
  assert.deepEqual(higher.cells.map((cell) => cell.bar), [0.5, 1]);
  // Zero is the best a lower-is-better figure can be: full bar, the others the floor.
  const zero = compareRow("Walk", "low", true, [{ text: "0 min", value: 0 }, { text: "9 min", value: 9 }]);
  assert.deepEqual(zero.cells.map((cell) => cell.bar), [1, 0.06]);
});

test("Saved and Compare show one £/m² series, the area's Price tile, and say which", () => {
  const rows = placesTable(IDS.map((id) => ({ id, profile: fixtureAreaProfile(id, "2025-09"), standouts: fixtureStandouts(id) }))).rows;
  const price = rows.find((row) => row.label === "Price")!;
  assert.equal(price.note, PRICE_TILE_SOURCE);
  const tile = fixtureStandouts(IDS[0])!.tiles.find((entry) => entry.id === "price")!;
  assert.equal(price.cells[0].text, tile.display);
  // Saved puts the same words on the area's line (use-saved-prices.ts reads the same tile).
  assert.equal(savedAreaMeta(IDS[0], tile.display!), tile.display);
  const hook = read("../src/components/use-saved-prices.ts");
  assert.match(hook, /standoutsPath\(id\)/);
  assert.match(hook, /entry\.id === "price"/);
  // The since answer's market median is no longer a £/m² Saved shows.
  assert.doesNotMatch(read("../src/components/use-saved-since.ts"), /prices\[/);
});

test("/brief asks for its search as Compare and Saved do (v2), never the v1 panel JSON the API refused", () => {
  const page = read("../src/components/brief/brief-page.tsx");
  assert.match(page, /useSearchPack\(own === undefined \? null : searchKey\(profile\)/);
  assert.doesNotMatch(page, /useSearchPack\([^)]*JSON\.stringify\(profile\)/);
  // The partner's actions also sit under the title while ranking, or when it fails.
  assert.match(page, /own === null && <SharedBriefActions share=\{share\} \/>/);
});
