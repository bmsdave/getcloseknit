import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { AREA_ID_BOOT } from "../src/lib/area-id-boot";
import { canonicalApiText, canonicalPath, movedArea } from "../src/lib/canonical-path";
import { canonicalAreaId, canonicalAreaIds, carrierOfId, tileKindOf } from "../src/lib/contracts";
import { areaIdFromTile, areaTileTarget } from "../src/lib/area-tiles";
import { parseMapState } from "../src/lib/map-state";
import { decodeSharedProfile } from "../src/lib/profile-state";

// Step R2 (docs/architecture/global-geography.md): LAD ids uk:borough:<code> -> uk:lad:<code>, pages /area/lad/<code>.
const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/agent-share-links.json", import.meta.url), "utf8")) as {
  cases: { name: string; fragment: string }[];
};
// The fixture's first case as the site encoded it before R2 (its borough zone: uk:borough:E09000007).
const OLD_FRAGMENT = "#profile=v1.WzAsNTUwMDAwLDYwMDAwMCwyLDEsW1szLDQsMSxudWxsLG51bGxdLFs5LDMsMSw0MCxudWxsXSxbMSwwLDEsbnVsbCxudWxsXV0sW10sW1sicHJpbWFyeSJdLFtdLFtdLFtdLDNdLDAsW1swLCJvc206bjExOTI3NDQ2NCIsMTUsIktpbmcncyBDcm9zcyBTdCBQYW5jcmFzIl0sWzEsInVrOmJvcm91Z2g6RTA5MDAwMDA3Il0sWzIsWyJ1azpsc29hOkUwMTAwMDk1MSIsInVrOmxzb2E6RTAxMDAxMjM0Il0sIkNhZsOpICYgY28g4oCUIMO8bsOvY29kZSJdXV0";

test("an old borough page moves for good (301) to /area/lad/, sub-pages and case included", () => {
  assert.equal(canonicalPath("/area/borough/E09000009"), "/area/lad/E09000009");
  assert.equal(canonicalPath("/area/borough/e09000009/pack"), "/area/lad/E09000009/pack");
  assert.equal(canonicalPath("/area/lad/E09000009"), null);
  assert.ok(movedArea("/area/borough/E09000009"));
  assert.ok(!movedArea("/area/lad/e09000009"));
});

test("old ids read as current ones: in ids, decoded values and the BFF's API paths", () => {
  assert.equal(canonicalAreaId("uk:borough:E09000001"), "uk:lad:E09000001");
  assert.equal(canonicalAreaId("uk:msoa:E02000001"), "uk:msoa:E02000001");
  assert.deepEqual(canonicalAreaIds({ "uk:borough:E09000002": ["uk:borough:E09000003", 1] }), { "uk:lad:E09000002": ["uk:lad:E09000003", 1] });
  assert.equal(carrierOfId("uk:borough:E09000001"), "lad");
  assert.equal(canonicalApiText("/api/v1/areas/uk%3Aborough%3AE09000001/rents"), "/api/v1/areas/uk%3Alad%3AE09000001/rents");
  assert.equal(canonicalApiText("?ids=uk:borough:E09000001"), "?ids=uk:lad:E09000001");
});

test("tiles keep their kind 'borough' while the ids they stand for say lad", () => {
  assert.equal(tileKindOf("lad"), "borough");
  assert.equal(areaIdFromTile("borough", 9000009), "uk:lad:E09000009");
  assert.deepEqual(areaTileTarget("uk:lad:E09000009"), { source: "area-tiles-borough", sourceLayer: "borough", id: 9000009 });
});

test("a link shared before R2 opens with the same search, its borough zone on the lad id", () => {
  const old = decodeSharedProfile(OLD_FRAGMENT);
  assert.ok(old);
  assert.deepEqual(old, decodeSharedProfile(fixture.cases[0].fragment));
  assert.ok(JSON.stringify(old).includes("uk:lad:E09000007"));
  assert.ok(!JSON.stringify(old).includes("uk:borough:"));
  assert.equal(parseMapState(new URLSearchParams("selected=uk:borough:E09000009")).selected, "uk:lad:E09000009");
});

test("what this browser saved before R2 is rewritten once, before the page reads it", () => {
  const store = new Map<string, string>([
    ["close-knit.saved-items.v1", JSON.stringify({ ids: ["uk:borough:E09000001", "uk:lsoa:E01000001"] })],
    ["close-knit.compare.v1", "[\"uk:lsoa:E01000002\"]"],
    ["other-site", "uk:borough:E09000001"],
  ]);
  const writes: string[] = [];
  const localStorage = {
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); store.set(key, value); },
  };
  runInNewContext(AREA_ID_BOOT, { window: { localStorage } });
  assert.deepEqual(JSON.parse(store.get("close-knit.saved-items.v1") ?? ""), { ids: ["uk:lad:E09000001", "uk:lsoa:E01000001"] });
  assert.deepEqual(writes, ["close-knit.saved-items.v1"], "only values holding an old id are written");
  assert.equal(store.get("other-site"), "uk:borough:E09000001");
  runInNewContext(AREA_ID_BOOT, { window: {} });  // blocked storage: nothing thrown
});
