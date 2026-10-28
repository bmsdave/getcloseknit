import assert from "node:assert/strict";
import test from "node:test";

import {
  AMENITY_GROUPS, LIFESTYLE_AMENITY_GROUPS, amenityName, connectivity, connectivityScore, formatDistance, lineNames, placesPath,
  readAreaPlaces, scoreWords, stationMode, stationModes, stationRingPoints, walkMinutes, zoneLabel, type RailMode,
} from "../src/lib/places";
import { fixtureAreaPlaces } from "../src/lib/places-fixture";

const tube = [{ mode: "tube" as RailMode }];

// Same vectors as api/tests/test_places.py: the demo score uses the API formula.
test("connectivity score matches the API's shared vectors", () => {
  const cases: Array<[Parameters<typeof connectivity>[0], number]> = [
    [[], 1],
    [[{ distanceMetres: 300, lines: tube, modes: ["tube"] }], 5],
    [[{ distanceMetres: 200, lines: [...tube, ...tube, ...tube, ...tube], modes: ["tube"] }], 8],
    [[{ distanceMetres: 1000, lines: [{ mode: "national-rail" }], modes: ["national-rail"] }], 2],
    [[{ distanceMetres: 1300, lines: tube, modes: ["tube"] }], 1],
    [[{ distanceMetres: 400, lines: [], modes: ["tram"] }], 4],
    [Array(3).fill({ distanceMetres: 100, lines: Array(9).fill(tube[0]), modes: ["tube"] }), 10],
  ];
  for (const [stations, score] of cases) assert.equal(connectivity(stations).score, score, JSON.stringify(stations));
  assert.equal(connectivityScore(-1), 1);
  assert.equal(connectivityScore(99), 10);
});

test("missing data reads as unknown, never as a low score", () => {
  assert.equal(scoreWords(null), "Unknown");
  assert.equal(scoreWords(1), "Few trains nearby");
  assert.equal(scoreWords(10), "Excellent");
  assert.equal(zoneLabel({ zone: null, modes: ["national-rail"] }), "Unknown");
  assert.equal(zoneLabel({ zone: null, modes: ["tram"] }), "No zones");
  assert.equal(zoneLabel({ zone: "2/3", modes: ["tube"] }), "Zone 2/3");
  // Outside TfL's London (East Didsbury, Didsbury Village tram): no zone slot, never "Unknown" or "No zones".
  assert.equal(zoneLabel({ zone: null, modes: ["national-rail"] }, false), null);
  assert.equal(zoneLabel({ zone: null, modes: ["tram"] }, false), null);
});

test("plain labels for distances, lines and unnamed places", () => {
  assert.equal(formatDistance(234), "230 m");
  assert.equal(formatDistance(1260), "1.3 km");
  assert.equal(walkMinutes(800), 10);
  assert.equal(walkMinutes(10), 1);
  assert.deepEqual(lineNames({ lines: [], modes: ["dlr", "tram"] }), ["DLR", "Tram"]);
  assert.equal(amenityName({ name: null, kind: "pharmacy", distanceMetres: 1 }), "Unnamed pharmacy");
});

test("paths carry the home only when one is chosen", () => {
  assert.equal(placesPath({ selected: "uk:lsoa:E01000001", uprn: null, mode: "demo", release: "r" }),
    "/api/v1/areas/uk%3Alsoa%3AE01000001/places?mode=demo&release=r");
  assert.match(placesPath({ selected: "uk:lsoa:E01000001", uprn: "12", mode: "real", release: "r" }), /&uprn=12$/);
});

test("demo fixtures are complete and refused in real mode", () => {
  for (const id of ["uk:lsoa:E01000001", "uk:msoa:E02000002", "uk:lad:E09000003"] as const) {
    const places = fixtureAreaPlaces(id, null);
    assert.ok(places, id);
    assert.deepEqual(places.amenities.map((group) => group.group), [...AMENITY_GROUPS, ...LIFESTYLE_AMENITY_GROUPS]);
    assert.deepEqual(places.connectivity, connectivity(places.stations));
    assert.equal(readAreaPlaces(places, "demo").status, "available");
    assert.deepEqual(readAreaPlaces(places, "real"), { status: "unavailable", reason: "fixture-places-in-real-mode" });
  }
  assert.equal(fixtureAreaPlaces("uk:lsoa:E01000001", "100000000001")?.origin.kind, "home");
  assert.equal(fixtureAreaPlaces("uk:lsoa:E01999999", null), null);
});

test("payloads without loaded places are unavailable", () => {
  const empty = { ...fixtureAreaPlaces("uk:lsoa:E01000001", null)!, productReleaseId: "rel", sources: [], available: false };
  assert.deepEqual(readAreaPlaces(empty, "real"), { status: "unavailable", reason: "places-not-loaded" });
  assert.deepEqual(readAreaPlaces({ schemaVersion: "area-profile.v1" }, "demo"),
    { status: "unavailable", reason: "invalid-places-response" });
});

test("stations become ring points coloured by mode, spread evenly when a bearing is missing", () => {
  const station = (name: string, modes: RailMode[], distanceMetres: number, bearingDegrees?: number) => ({
    name, modes, zone: "1", lines: [], distanceMetres, ...(bearingDegrees === undefined ? {} : { bearingDegrees }),
  });
  const known = stationRingPoints([station("A", ["national-rail", "tube"], 300, 90), station("B", ["dlr"], 900, 180)]);
  assert.equal(known.directions, true);
  assert.deepEqual(known.points.map((point) => [point.bearingDegrees, point.tone]), [[90, "c1"], [180, "c3"]]);
  const spread = stationRingPoints([station("A", ["tram"], 300, 90), station("B", ["tram"], 900)]);
  assert.equal(spread.directions, false);
  assert.deepEqual(spread.points.map((point) => point.bearingDegrees), [0, 180]);
  assert.equal(stationMode(station("C", [], 1)), null);
  assert.deepEqual(stationModes([station("A", ["national-rail"], 1), station("B", ["tube", "overground"], 2)]),
    ["tube", "national-rail"]);
});
