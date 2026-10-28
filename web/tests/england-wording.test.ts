/** England journey gaps (CUJ England 2026-10-27): London words and London-only links stay on London's pages. */
import assert from "node:assert/strict";
import test from "node:test";

import { areaDisplayName, areaTitle, friendlyTitle, plainPlaceName } from "../src/lib/area-labels";
import { councilWord, localNote } from "../src/lib/coverage-words";
import { crumbName } from "../src/lib/entity-nav";
import { postcodeHomesState, rentTableWords } from "../src/lib/postcode-page";

test("G-E01: a postcode without a homes list links none; outside London it says London only", () => {
  assert.equal(postcodeHomesState([], true), "listed");
  assert.equal(postcodeHomesState(null, true), "none");
  assert.equal(postcodeHomesState(null, false), "london-only");
});

test("G-E04: the rent table names the area's region and says council outside London", () => {
  assert.deepEqual(rentTableWords("Leeds", "Yorkshire and The Humber"), { name: "Leeds", region: "Yorkshire and The Humber", unit: "council" });
  assert.deepEqual(rentTableWords(null, "London"), { name: "the borough", region: "London", unit: "borough" });
  assert.equal(rentTableWords("Bristol, City of", "South West").name, "Bristol");
});

test("G-E15: a local authority is a borough in London and a council elsewhere", () => {
  assert.equal(councilWord(true), "borough");
  assert.equal(councilWord(false, true), "councils");
});

test("G-E24: ONS inverted names read as people say them", () => {
  assert.equal(plainPlaceName("Bristol, City of"), "Bristol");
  assert.equal(plainPlaceName("Herefordshire, County of"), "Herefordshire");
  assert.equal(plainPlaceName("Kingston upon Hull, City of"), "Kingston upon Hull");
  assert.equal(plainPlaceName("City of London"), "City of London");
  assert.equal(plainPlaceName("  "), null);
  assert.equal(friendlyTitle({ friendlyName: "Bristol, City of" }), "Bristol");
  assert.equal(areaTitle("Bristol, City of", null).title, "Bristol");
  assert.equal(areaDisplayName({ name: "Herefordshire, County of" }), "Herefordshire");
  assert.equal(crumbName({ name: "Bristol, City of", friendlyName: null }), "Bristol");
});

test("G-E15: source notes say council outside London and keep names that hold the word", () => {
  const rents = "Borough-wide: every neighbourhood in a borough reads the borough's rents.";
  assert.equal(localNote(rents, true), rents);
  assert.equal(localNote(rents, false), "Council-wide: every neighbourhood in a council reads the council's rents.");
  assert.equal(localNote("fall back to their MSOA, then borough; borough/MSOA rates", false),
    "fall back to their MSOA, then council; council/MSOA rates");
  assert.equal(localNote("boroughs pool", false), "councils pool");
  assert.equal(localNote("Peterborough and Borough Market", false), "Peterborough and Borough Market");
});
