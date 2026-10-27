import assert from "node:assert/strict";
import test from "node:test";

import {
  AREA_FILL_LAYERS, areaIdFromTile, areaLevelZooms, areaOutlineFilter, areaTileId, areaTileLayers, areaTileSource, areaTileTarget,
  featureAreaId, isAreaTiles, registerAreaTileProtocol,
} from "../src/lib/area-tiles";

const TILES = { release: "a1-0123456789ab", minzoom: 5, maxzoom: 12, url: "/api/v1/tiles/areas/a1-0123456789ab/{kind}/{z}/{x}/{y}.mvt" };

test("a tile feature's id is the area's ONS code as a number, and back (api map_tiles.py)", () => {
  assert.equal(areaTileId("uk:lsoa:E01000001"), 1000001);
  assert.equal(areaTileId("uk:msoa:E02007116"), 2007116);
  assert.equal(areaTileId("uk:lad:E09000033"), 9000033);
  assert.ok(Number.isNaN(areaTileId("uk:lsoa:W01000001")));
  assert.equal(areaIdFromTile("lsoa", 1000001), "uk:lsoa:E01000001");
  assert.equal(areaIdFromTile("borough", "9000033"), "uk:lad:E09000033");
  assert.equal(areaIdFromTile("ward", 1), null);
  assert.deepEqual(areaTileTarget("uk:msoa:E02000001"), { source: "area-tiles-msoa", sourceLayer: "msoa", id: 2000001 });
});

test("a rendered feature reads as its area id on the tiles and as itself elsewhere", () => {
  assert.equal(featureAreaId({ id: 1000004, source: "area-tiles-lsoa", sourceLayer: "lsoa" }), "uk:lsoa:E01000004");
  assert.equal(featureAreaId({ id: 42, source: "properties", sourceLayer: "parcels" }), 42);
});

test("each kind's source fetches its own tiles over England only", () => {
  assert.ok(isAreaTiles(TILES));
  assert.ok(!isAreaTiles({ release: "x" }));
  const source = areaTileSource(TILES, "lsoa", "https://example.test");
  assert.deepEqual(source.tiles, ["https://example.test/api/v1/tiles/areas/a1-0123456789ab/lsoa/{z}/{x}/{y}.mvt"]);
  assert.equal(source.maxzoom, 12);
});

test("a kind's static archive is read through the pmtiles protocol, tile by tile", () => {
  const archive = { release: "0123456789ab", minzoom: 5, maxzoom: 12, url: "/tiles/areas-0123456789ab-{kind}.pmtiles" };
  assert.deepEqual(areaTileSource(archive, "lad", "https://example.test").tiles,
    ["pmtiles://https://example.test/tiles/areas-0123456789ab-borough.pmtiles/{z}/{x}/{y}"]);
  // On the main thread for every map, in MapLibre's workers once (they are shared by every map).
  const registered: string[] = [];
  const maplibre = {
    addProtocol: (name: string, load: unknown) => { assert.equal(typeof load, "function"); registered.push(name); },
    importScriptInWorkers: async (url: string) => { registered.push(url); },
  };
  registerAreaTileProtocol(maplibre);
  registerAreaTileProtocol(maplibre);
  assert.deepEqual(registered, ["pmtiles", "/maplibre/dev/area-tiles-dev.mjs", "pmtiles"]);
});

test("each kind keeps its own fill, hairlines, halo and outline; a tap reads every fill", () => {
  assert.deepEqual(areaTileLayers("lad"), { fill: "area-fill-borough", edge: "area-edge-borough", halo: "area-selection-halo-borough", outline: "area-outline-borough" });
  assert.deepEqual(AREA_FILL_LAYERS, ["area-fill-lsoa", "area-fill-msoa", "area-fill-borough"]);
});

test("a kind's outline holds the selected area's tile feature alone, none for another kind or nothing selected", () => {
  assert.deepEqual(areaOutlineFilter("lsoa", "uk:lsoa:E01000004"), ["==", ["id"], 1000004]);
  assert.deepEqual(areaOutlineFilter("lad", "uk:lad:E09000033"), ["==", ["id"], 9000033]);
  assert.deepEqual(areaOutlineFilter("msoa", "uk:lsoa:E01000004"), ["==", ["id"], -1]);
  assert.deepEqual(areaOutlineFilter("lsoa", null), ["==", ["id"], -1]);
});

test("the kind painted draws at every zoom; on an LSOA layer the others draw on their rung of the ladder (LAD, MSOA, LSOA)", () => {
  const nowhere = [24, 24];
  // MSOAs painted (zoom 6.5-9): LSOAs draw from 9 and LADs below 6.5, still clear, so their tiles load while their colours come.
  assert.deepEqual(areaLevelZooms("msoa", true), { msoa: [0, 24], lsoa: [9, 24], borough: [0, 6.5] });
  // LSOAs painted: they keep drawing below 9 until the MSOAs' colours land.
  assert.deepEqual(areaLevelZooms("lsoa", true), { lsoa: [0, 24], msoa: [6.5, 9], borough: [0, 6.5] });
  assert.deepEqual(areaLevelZooms("lad", true), { borough: [0, 24], msoa: [6.5, 9], lsoa: [9, 24] });
  // A layer of MSOAs or boroughs: one kind at every zoom, the others nowhere.
  assert.deepEqual(areaLevelZooms("msoa", false), { msoa: [0, 24], lsoa: nowhere, borough: nowhere });
  assert.deepEqual(areaLevelZooms("lad", false), { borough: [0, 24], lsoa: nowhere, msoa: nowhere });
  // Another kind the paint's values name (demo data's sparse area carries its MSOA's value) draws at every zoom too.
  assert.deepEqual(areaLevelZooms("lsoa", true, ["lsoa", "msoa"]), { lsoa: [0, 24], msoa: [0, 24], borough: [0, 6.5] });
});
