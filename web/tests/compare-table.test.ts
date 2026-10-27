import assert from "node:assert/strict";
import test from "node:test";

import { cleanCompareIds, compareHref, compareRow, homesTable, parseCompareQuery, placesTable } from "../src/lib/compare-table";
import type { GeographyId } from "../src/lib/contracts";
import { fixtureAreaProfile } from "../src/lib/area-profile-fixture";
import { demoPropertyProfile } from "../src/lib/property-profile-fixture";

test("a row marks its best value only where better has a direction and the values differ", () => {
  const row = compareRow("Crime", "low", true, [{ text: "62", value: 62 }, { text: "98", value: 98 }, { text: "—", value: null }]);
  assert.deepEqual(row.cells.map((cell) => cell.best), [true, false, false]);
  // v4.5: a longer bar is the better value, so on a lower-is-better row the lowest has the full bar.
  assert.equal(row.cells[0].bar, 1);
  assert.equal(row.cells[1].bar, 62 / 98);
  assert.equal(row.cells[2].bar, null);
  const same = compareRow("Crime", "low", true, [{ text: "5", value: 5 }, { text: "5", value: 5 }]);
  assert.ok(same.cells.every((cell) => !cell.best));
  const plain = compareRow("Type", null, false, [{ text: "Flat", value: null }, { text: "House", value: null }]);
  assert.ok(plain.cells.every((cell) => !cell.best && cell.bar === null));
  // Negative figures get no bar (a bar from zero would mislead).
  assert.ok(compareRow("Progress", "high", true, [{ text: "-0.2", value: -0.2 }, { text: "0.3", value: 0.3 }]).cells.every((cell) => cell.bar === null));
});

test("one kind per link: ids are checked for their kind, once each, at most four", () => {
  assert.deepEqual(cleanCompareIds("places", ["uk:lsoa:E01000001", "uk:lad:E09000001", "uk:lsoa:E01000001", "100001"]),
    ["uk:lsoa:E01000001", "uk:lad:E09000001"]);
  assert.deepEqual(cleanCompareIds("schools", ["100001", "100002", "uk:lsoa:E01000001"]), ["100001", "100002"]);
  assert.equal(cleanCompareIds("homes", ["1", "2", "3", "4", "5"]).length, 4);
  assert.equal(compareHref("schools", ["100001", "100002"]), "/compare?kind=schools&ids=100001,100002");
  assert.equal(compareHref("homes", []), "/compare?kind=homes");
  assert.deepEqual(parseCompareQuery({ kind: "gyms", ids: "uk:lsoa:E01000001,uk:msoa:E02000001" }),
    { kind: "places", ids: ["uk:lsoa:E01000001", "uk:msoa:E02000001"] });
});

test("places side by side: an area and a borough, figures as text, best marked", () => {
  const ids = ["uk:lsoa:E01000001", "uk:lsoa:E01000002"] as GeographyId[];
  const table = placesTable(ids.map((id) => ({ id, profile: fixtureAreaProfile(id, "2025-09") })));
  assert.deepEqual(table.columns.map((column) => column.href), ["/area/lsoa/E01000001", "/area/lsoa/E01000002"]);
  assert.ok(table.rows.length > 0);
  for (const row of table.rows) assert.equal(row.cells.length, 2);
  assert.ok(table.rows.some((row) => row.cells.some((cell) => cell.best)));
  const unknown = placesTable([{ id: "uk:lad:E09000001" as GeographyId, profile: null }]);
  assert.equal(unknown.columns[0].tag, "Borough");
  assert.equal(unknown.rows.length, 0);
});

test("homes side by side: recorded facts and area statistics, never an estimate for a home", () => {
  const profile = demoPropertyProfile("100000000001")?.profile ?? null;
  assert.ok(profile);
  const table = homesTable([{ uprn: "100000000001", profile }, { uprn: "999", profile: null }]);
  assert.equal(table.columns[0].href, "/property/100000000001");
  const labels = table.rows.map((row) => row.label);
  assert.ok(labels.includes("Type"));
  assert.ok(!labels.some((label) => /estimate|worth|value/i.test(label)));
  assert.ok(table.rows.every((row) => row.cells[1].text === "—"));
});
