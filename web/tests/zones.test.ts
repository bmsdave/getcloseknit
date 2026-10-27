import assert from "node:assert/strict";
import test from "node:test";

import { assertPreferenceProfile, type MatchZone, type PreferenceProfile, type PreferenceProfileV2 } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { applyRelaxation, buildMatchPack, describeUnmetLimits, scoreMatchPack, type RawMatchArea } from "../src/lib/matching";
import { sensitiveFieldPreview } from "../src/lib/profile-state";
import {
  previewSimilarAreas,
  SIMILARITY_FACTORS,
  similarAreas,
  similarAreasPath,
  type AreaVector,
} from "../src/lib/similar-areas";
import { addZone, previewZoneLsoas, searchPreviewStations } from "../src/lib/zones";

const WESTMINSTER_STATION: MatchZone = {
  kind: "station", stationId: "osm:n9000001", maxWalkMinutes: 10, label: "Westminster preview station",
};

function crimeProfile(zones?: MatchZone[]): PreferenceProfile {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.factors = [{ factorId: "crime", weight: 4, direction: "lower", minimumUtility: null, maximumUtility: null }];
  if (zones) profile.zones = zones;
  return profile;
}

test("zones validate like the API and stay optional", () => {
  assertPreferenceProfile(crimeProfile());
  assertPreferenceProfile(crimeProfile([]));
  assertPreferenceProfile(crimeProfile([
    WESTMINSTER_STATION, { kind: "borough", id: "uk:lad:E09000002" },
    { kind: "lsoas", ids: ["uk:lsoa:E01000003"] },
  ]));
  const bad: unknown[] = [
    [WESTMINSTER_STATION, WESTMINSTER_STATION, WESTMINSTER_STATION, WESTMINSTER_STATION],
    [{ ...WESTMINSTER_STATION, maxWalkMinutes: 4 }],
    [{ ...WESTMINSTER_STATION, maxWalkMinutes: 31 }],
    [{ ...WESTMINSTER_STATION, maxWalkMinutes: 7.5 }],
    [{ ...WESTMINSTER_STATION, stationId: "940GZZLUWSM" }],
    [{ ...WESTMINSTER_STATION, colour: "red" }],
    [{ kind: "postcode", id: "SW1A" }],
    [{ kind: "borough", id: "uk:lsoa:E01000001" }],
    [{ kind: "lsoas", ids: [] }],
    [{ kind: "lsoas", ids: Array.from({ length: 51 }, (_, index) => `uk:lsoa:E01${String(index).padStart(6, "0")}`) }],
    [{ kind: "lsoas", ids: ["uk:lsoa:E01000001", "uk:lsoa:E01000001"] }],
  ];
  for (const zones of bad) {
    assert.throws(() => assertPreferenceProfile({ ...crimeProfile(), zones } as PreferenceProfile), JSON.stringify(zones));
  }
});

test("preview zones expand to LSOAs by station walk, borough and name", () => {
  assert.equal(previewZoneLsoas(undefined), null);
  assert.equal(previewZoneLsoas([]), null);
  assert.deepEqual([...previewZoneLsoas([WESTMINSTER_STATION])!], ["uk:lsoa:E01000001"]);
  assert.deepEqual([...previewZoneLsoas([{ ...WESTMINSTER_STATION, maxWalkMinutes: 15 }])!].sort(),
    ["uk:lsoa:E01000001", "uk:lsoa:E01000003"]);
  assert.deepEqual([...previewZoneLsoas([{ kind: "borough", id: "uk:lad:E09000002" }])!], ["uk:lsoa:E01000002"]);
  assert.deepEqual([...previewZoneLsoas([{ kind: "lsoas", ids: ["uk:lsoa:E01000003"] }])!], ["uk:lsoa:E01000003"]);
  assert.deepEqual(searchPreviewStations("westminster").map((station) => station.stationId), ["osm:n9000001"]);
});

test("a station zone is the first ranked criterion: inside leads, outside scores lower and is never out (v4 Task 8)", () => {
  const zoned = buildMatchPack(crimeProfile([WESTMINSTER_STATION]));

  assert.deepEqual(zoned.criteria!.map((criterion) => criterion.id), ["zone", "crime"]);
  assert.equal(zoned.values[0].geographyId, "uk:lsoa:E01000001");
  assert.equal(zoned.values[0].inZone, true);
  for (const value of zoned.values.slice(1)) {
    assert.equal(value.excluded, false);
    assert.equal(value.inZone, false);
    const where = value.components.find((component) => component.factorId === "zone")!;
    assert.ok(where.rawValue > 0 && where.fit! < 1);
  }
  assert.ok(buildMatchPack(crimeProfile()).values.every((value) => value.inZone === undefined));
});

test("a must Where filters, says why, and relaxes (v4 Task 8)", () => {
  const profile: PreferenceProfileV2 = {
    schemaVersion: "preference-profile.v2", market: "buy", targetBudget: 500_000, maximumBudget: 650_000,
    criteria: [{ kind: "where", zones: [WESTMINSTER_STATION], must: true },
      { kind: "range", layer: "crime", scale: "percentile", min: null, max: 50, softMin: null, softMax: 75 }],
  };
  const zoned = buildMatchPack(profile);
  const out = zoned.values.filter((value) => value.excluded);
  assert.deepEqual(zoned.values.filter((value) => !value.excluded).map((value) => value.geographyId), ["uk:lsoa:E01000001"]);
  for (const value of out) {
    assert.deepEqual(value.unmetLimits, ["zone:outside"]);
    assert.deepEqual(describeUnmetLimits(value, profile), ["Outside the zones you chose"]);
  }
  const relaxed = applyRelaxation(zoned, ["zone"], profile);
  assert.ok(relaxed.values.every((value) => !value.excluded));
});

test("the fit falls with distance outside the zone", () => {
  const area = (id: string, crime: number): RawMatchArea => ({
    geographyId: id as RawMatchArea["geographyId"], name: id, price: 400_000, monthlyRent: 2_000, journeys: {},
    factors: { crime: { rawValue: crime, percentile: crime, carrierGeographyId: id as RawMatchArea["geographyId"], quality: "observed", sourceVersion: "t" } },
  });
  const areas = [area("uk:lsoa:E01000010", 40), area("uk:lsoa:E01000011", 10), area("uk:lsoa:E01000012", 40)];
  const distances = new Map([["uk:lsoa:E01000010", 2500], ["uk:lsoa:E01000011", 500], ["uk:lsoa:E01000012", 0]]);
  const zoned = scoreMatchPack(crimeProfile([WESTMINSTER_STATION]), areas, undefined, [], new Set(["uk:lsoa:E01000012"]), distances);
  // Where first (0.75), crime second (0.25, all inside its range): 1, 0.5^0.75 = 0.595, 0.
  assert.deepEqual(zoned.values.map((value) => [value.geographyId, value.score]),
    [["uk:lsoa:E01000012", 100], ["uk:lsoa:E01000011", 59], ["uk:lsoa:E01000010", 0]]);
});

test("adding zones respects the three-zone and fifty-neighbourhood limits", () => {
  let zones: MatchZone[] = [];
  zones = addZone(zones, WESTMINSTER_STATION);
  assert.equal(addZone(zones, WESTMINSTER_STATION), zones);
  zones = addZone(zones, { kind: "lsoas", ids: ["uk:lsoa:E01000001"] });
  zones = addZone(zones, { kind: "lsoas", ids: ["uk:lsoa:E01000002"] });
  assert.equal(zones.length, 2);
  assert.deepEqual(zones[1], { kind: "lsoas", ids: ["uk:lsoa:E01000001", "uk:lsoa:E01000002"] });
  zones = addZone(zones, { kind: "borough", id: "uk:lad:E09000001" });
  assert.equal(addZone(zones, { kind: "borough", id: "uk:lad:E09000002" }), zones);
});

test("zones appear in the share preview before a link is created", () => {
  const preview = sensitiveFieldPreview(crimeProfile([WESTMINSTER_STATION, { kind: "lsoas", ids: ["uk:lsoa:E01000003"] }]));
  assert.ok(preview.includes("Zone: Within 10 min walk of Westminster preview station"));
  assert.ok(preview.includes("Zone: 1 chosen neighbourhood"));
});

test("similar areas use percentile distance over the five utility factors only", () => {
  assert.deepEqual(SIMILARITY_FACTORS, ["crime", "deprivation", "income", "market-level", "station-access"]);
  const vector = (id: string, utilities: number[], price: number): AreaVector => ({
    geographyId: id as AreaVector["geographyId"], name: id,
    factors: Object.fromEntries(SIMILARITY_FACTORS.map((factor, index) => [factor, {
      rawValue: factor === "market-level" ? price : utilities[index], utility: utilities[index], unit: "u",
    }])),
  });
  const areas = [
    vector("uk:lsoa:E01000010", [30, 70, 80, 80, 20], 9000),
    vector("uk:lsoa:E01000011", [35, 65, 80, 85, 25], 9500),
    vector("uk:lsoa:E01000012", [32, 70, 78, 60, 30], 7000),
    vector("uk:lsoa:E01000013", [90, 10, 20, 10, 90], 4000),
  ];
  const found = similarAreas("uk:lsoa:E01000010", areas, SIMILARITY_FACTORS);
  assert.deepEqual(found.map((area) => area.geographyId), ["uk:lsoa:E01000011", "uk:lsoa:E01000012", "uk:lsoa:E01000013"]);
  // RMS of (5, 5, 0, 5, 5) = sqrt(20) ≈ 4.47 → 95.5
  assert.equal(found[0].similarity, 95.5);
  const cheaper = similarAreas("uk:lsoa:E01000010", areas, SIMILARITY_FACTORS, { cheaper: true });
  assert.deepEqual(cheaper.map((area) => area.geographyId), ["uk:lsoa:E01000012", "uk:lsoa:E01000013"]);
  const outside = similarAreas("uk:lsoa:E01000010", areas, SIMILARITY_FACTORS, { exclude: new Set(["uk:lsoa:E01000011"]) });
  assert.equal(outside[0].geographyId, "uk:lsoa:E01000012");
});

test("the preview similar-areas answer mirrors the API shape and wording", () => {
  const payload = previewSimilarAreas("uk:lsoa:E01000001", { cheaper: false, zones: null, socialRenting: false })!;
  assert.equal(payload.schemaVersion, "similar-areas.v1");
  assert.equal(payload.values.length, 2);
  assert.ok(!payload.factors.includes("social-renting"));
  assert.doesNotMatch(JSON.stringify(payload), /\bbest\b/i);
  const cheaper = previewSimilarAreas("uk:lsoa:E01000001", { cheaper: true, zones: null, socialRenting: false })!;
  assert.ok(cheaper.values.every((area) => area.components.find((item) => item.factorId === "market-level")!.rawValue < 9_600));
  const outside = previewSimilarAreas("uk:lsoa:E01000001", {
    cheaper: false, zones: [{ kind: "lsoas", ids: ["uk:lsoa:E01000002"] }], socialRenting: false,
  })!;
  assert.deepEqual(outside.values.map((area) => area.geographyId), ["uk:lsoa:E01000003"]);
  assert.equal(outside.outsideZones, true);
  assert.equal(previewSimilarAreas("uk:lsoa:E01999999", { cheaper: false, zones: null, socialRenting: false }), null);
});

test("similar-area requests carry zones only when asked to leave them out", () => {
  assert.equal(similarAreasPath("uk:lsoa:E01000001", { cheaper: false, outsideZones: null }),
    "/api/v1/areas/uk%3Alsoa%3AE01000001/similar");
  const path = similarAreasPath("uk:lsoa:E01000001", { cheaper: true, outsideZones: [WESTMINSTER_STATION] });
  const query = new URL(path, "http://local").searchParams;
  assert.equal(query.get("cheaper"), "true");
  assert.deepEqual(JSON.parse(query.get("outsideZones")!), [WESTMINSTER_STATION]);
});
