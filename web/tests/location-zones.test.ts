import assert from "node:assert/strict";
import test from "node:test";

import { drawnFeatures } from "../src/components/match/zone-draw";
import { readAreaLocation, demoAreaLocation } from "../src/lib/area-location";
import { assertPreferenceProfile, type MatchZone, type PlacePreference, type PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { buildMatchPack } from "../src/lib/matching";
import { LONDON_SCOPE, type ServedScope } from "../src/lib/scope";
import { decodeSharedProfile, encodeSharedProfile, sensitiveFieldPreview } from "../src/lib/profile-state";
import {
  addAlternative, addZone, describeZone, drawnZone, firstPointOnly, insidePolygon, previewZoneLsoas, previewZoneShapes, zoneKey,
} from "../src/lib/zones";

// Drawn zones and "near any of" places: the same rules as api/area_api/matching.py (stream G3).
const AROUND_HIGHBURY: MatchZone = { kind: "polygon", points: [[51.55, -0.1], [51.55, -0.085], [51.54, -0.085], [51.54, -0.1]] };

function profile(extra: Partial<PreferenceProfile>): PreferenceProfile {
  const value = structuredClone({ ...DEFAULT_PROFILE, ...extra });
  value.factors = [{ factorId: "crime", weight: 4, direction: "lower", minimumUtility: null, maximumUtility: null }];
  return value;
}

test("drawn zones validate like the API", () => {
  assertPreferenceProfile(profile({ zones: [AROUND_HIGHBURY, { ...AROUND_HIGHBURY, label: "Highbury" }] }));
  const corners = (count: number) => Array.from({ length: count }, (_, i) => [51.5 + i * 0.001, -0.1 + (i % 2) * 0.01]);
  assertPreferenceProfile(profile({ zones: [{ kind: "polygon", points: corners(50) as [number, number][] }] }));
  const bad: unknown[] = [
    { kind: "polygon", points: corners(2) },
    { kind: "polygon", points: corners(51) },
    { kind: "polygon", points: [[51.5, -0.1], [51.5, -0.1], [51.51, -0.1]] },
    { kind: "polygon", points: [[48.85, 2.35], [48.86, 2.35], [48.86, 2.36]] },
    { kind: "polygon", points: [[51.5, -0.1], [51.51, -0.1], ["51.5", -0.11]] },
    { kind: "polygon", points: [[51.5, -0.1, 3], [51.51, -0.1], [51.5, -0.11]] },
    { ...AROUND_HIGHBURY, colour: "red" },
  ];
  for (const zone of bad) {
    assert.throws(() => assertPreferenceProfile(profile({ zones: [zone as MatchZone] })), JSON.stringify(zone));
  }
});

test("a drawn zone in preview holds the preview areas whose centre it covers", () => {
  assert.deepEqual([...previewZoneLsoas([AROUND_HIGHBURY])!], ["uk:lsoa:E01000002"]);
  assert.equal(insidePolygon([51.545, -0.094], AROUND_HIGHBURY.kind === "polygon" ? AROUND_HIGHBURY.points : []), true);
  assert.equal(insidePolygon([51.501, -0.1416], AROUND_HIGHBURY.kind === "polygon" ? AROUND_HIGHBURY.points : []), false);
  const pack = buildMatchPack(profile({ zones: [AROUND_HIGHBURY] }));
  const inside = pack.values.filter((result) => result.inZone).map((result) => result.geographyId);
  assert.deepEqual(inside, ["uk:lsoa:E01000002"]);
  // The zones are the first ranked criterion (v4 Task 8): outside is scored lower, never out.
  assert.ok(pack.values.every((result) => !result.excluded));
  assert.equal(pack.values[0].geographyId, "uk:lsoa:E01000002");
});

test("drawing: a finished drawing becomes a zone only when valid, and can be added and described", () => {
  assert.equal(drawnZone([[51.55, -0.1], [51.54, -0.1]]), null);
  assert.equal(drawnZone([[48.85, 2.35], [48.86, 2.35], [48.86, 2.36]]), null);
  const zone = drawnZone([[51.55, -0.1], [51.55, -0.085], [51.54, -0.085]], "Area you drew 1")!;
  assert.deepEqual(zone, { kind: "polygon", points: [[51.55, -0.1], [51.55, -0.085], [51.54, -0.085]], label: "Area you drew 1" });
  assert.equal(describeZone(zone), "Area you drew 1");
  assert.equal(describeZone(AROUND_HIGHBURY), "An area you drew (4 corners)");
  assert.equal(addZone([zone], zone).length, 1);
  assert.equal(addZone([zone], AROUND_HIGHBURY).length, 2);
  assert.notEqual(zoneKey(zone), zoneKey(AROUND_HIGHBURY));
});

test("a drawn zone outside London follows the API's coverage: London's box, England's with CLOSE_KNIT_ENGLAND on", () => {
  // Around Manchester: matching._validate_polygon_zone takes it with the England flag on (the scope's box).
  const ENGLAND: ServedScope = { ...LONDON_SCOPE, level: "nation", name: "England", bbox: [-6.45, 49.86, 1.77, 55.82] };
  const manchester: [number, number][] = [[53.48, -2.25], [53.49, -2.25], [53.49, -2.23]];
  assert.equal(drawnZone(manchester, undefined, LONDON_SCOPE), null, "London's scope keeps London's box");
  assert.deepEqual(drawnZone(manchester, undefined, ENGLAND), { kind: "polygon", points: manchester });
  assert.equal(drawnZone([[48.85, 2.35], [48.86, 2.35], [48.86, 2.36]], undefined, ENGLAND), null, "Paris is outside England");
  // A saved or linked search is never dropped for a coverage the page has not loaded yet: the API checks its own box.
  const manchesterZone: MatchZone = { kind: "polygon", points: manchester };
  assert.deepEqual(assertPreferenceProfile(profile({ zones: [manchesterZone] })).zones, [manchesterZone]);
  assert.throws(() => assertPreferenceProfile(profile({ zones: [{ kind: "polygon", points: [[48.85, 2.35], [48.86, 2.35], [48.86, 2.36]] }] })),
    /in England/);
});

test("the map shows drawn zones and the draft's outline and corners", () => {
  const empty = drawnFeatures(undefined, null);
  assert.equal(empty.features.length, 0);
  const features = drawnFeatures([AROUND_HIGHBURY, { kind: "borough", id: "uk:lad:E09000019" }], [[51.5, -0.1], [51.51, -0.1], [51.51, -0.09]]);
  // Task 8: three corners already fill as an area ("draft-area") while the outline and corners are drawn.
  assert.deepEqual(features.features.map((feature) => feature.properties?.kind), ["zone", "draft-area", "draft", "corner", "corner", "corner"]);
  assert.deepEqual(drawnFeatures(undefined, [[51.5, -0.1], [51.51, -0.1]]).features.map((feature) => feature.properties?.kind),
    ["draft", "corner", "corner"], "two corners are a line, not an area yet");
  const ring = (features.features[0].geometry as GeoJSON.Polygon).coordinates[0];
  assert.deepEqual(ring[0], [-0.1, 51.55]);
  assert.deepEqual(ring.at(-1), ring[0]);
});

test("a station, borough or list of areas is outlined from its loaded shape (v4.2); a drawn zone from its corners", () => {
  const borough: MatchZone = { kind: "borough", id: "uk:lad:E09000002" };
  const station: MatchZone = { kind: "station", stationId: "osm:n9000001", maxWalkMinutes: 10 };
  const answer = previewZoneShapes([borough, AROUND_HIGHBURY, station, { kind: "station", stationId: "osm:n9000002", maxWalkMinutes: 1 }]);
  assert.equal(answer.schemaVersion, "zone-shapes.v1");
  assert.deepEqual(answer.zones.map((zone) => [zone.kind, zone.geometry?.type ?? null]),
    [["borough", "MultiPolygon"], ["polygon", null], ["station", "MultiPolygon"], ["station", null]]);
  const shapes = new Map([[zoneKey(borough), answer.zones[0].geometry], [zoneKey(station), answer.zones[2].geometry]]);
  const drawn = drawnFeatures([borough, AROUND_HIGHBURY, station], null, shapes);
  assert.deepEqual(drawn.features.map((feature) => [feature.properties?.kind, feature.geometry.type]),
    [["zone", "MultiPolygon"], ["zone", "Polygon"], ["zone", "MultiPolygon"]]);
  // Before the shapes arrive only the drawn zone shows.
  assert.equal(drawnFeatures([borough, AROUND_HIGHBURY], null).features.length, 1);
});

const office: PlacePreference = {
  id: "office", label: "Office", target: { kind: "point", latitude: 51.503, longitude: -0.089 },
  mode: "transit", targetMinutes: 30, weight: 4, must: false,
};

test("near any of: two or three points, validated like the API", () => {
  const either = addAlternative(office.target, 51.545, -0.094)!;
  assert.deepEqual(either, { kind: "any-of", points: [[51.503, -0.089], [51.545, -0.094]] });
  const three = addAlternative(either, 51.5, -0.14)!;
  assert.equal(addAlternative(three, 51.51, -0.12), null);
  assert.equal(addAlternative({ kind: "category", category: "park" }, 51.5, -0.1), null);
  assert.deepEqual(firstPointOnly(three), office.target);
  assertPreferenceProfile(profile({ places: [{ ...office, target: three }] }));
  for (const target of [{ kind: "any-of", points: [[51.5, -0.1]] }, { kind: "any-of", points: [[51.5, -0.1], [91, 0]] },
    { kind: "any-of", points: [[1, 2], [3, 4], [5, 6], [7, 8]] }, { kind: "any-of" }]) {
    assert.throws(() => assertPreferenceProfile(profile({ places: [{ ...office, target } as PlacePreference] })), JSON.stringify(target));
  }
});

test("near any of scores the quicker point, as the API takes the best row", () => {
  const minutes = (place: PlacePreference, area: string) => buildMatchPack(profile({ places: [place] })).values
    .find((result) => result.geographyId === area)!.components.find((part) => part.factorId === "place:office")!.rawValue as number;
  const highbury = { ...office, target: { kind: "point" as const, latitude: 51.545, longitude: -0.094 } };
  const either = { ...office, target: addAlternative(office.target, 51.545, -0.094)! };
  for (const area of ["uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003"]) {
    assert.equal(minutes(either, area), Math.min(minutes(office, area), minutes(highbury, area)), area);
  }
});

test("drawn zones and near-any-of places survive the share link and show in its preview", () => {
  const shared = profile({ zones: [AROUND_HIGHBURY], places: [{ ...office, target: addAlternative(office.target, 51.545, -0.094)! }] });
  assert.deepEqual(decodeSharedProfile(encodeSharedProfile(shared)), shared);
  const preview = sensitiveFieldPreview(shared);
  assert.ok(preview.includes("Zone: An area you drew (4 corners)"));
  assert.ok(preview.includes("Place Office (exact location shared)"));
});

test("location notes read only area-location.v1 payloads; demo says it has none", () => {
  assert.equal(readAreaLocation({ schemaVersion: "area-flood.v1", notes: [] }), null);
  assert.equal(readAreaLocation(null), null);
  const demo = demoAreaLocation("uk:lsoa:E01000001");
  assert.equal(readAreaLocation(demo), demo);
  assert.equal(demo.available, false);
  assert.deepEqual(demo.notes, []);
});
