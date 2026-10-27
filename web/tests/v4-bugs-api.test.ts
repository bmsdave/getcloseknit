// v4 G5 Tasks 23, 24, 25 (page part) and 27: names not codes, the save-listing area call, months a
// metric is published for, and pages that say "try again" instead of throwing.
import assert from "node:assert/strict";
import test from "node:test";

import { areaDisplayName, isCodeName } from "../src/lib/area-labels";
import { demoFriendlyFields } from "../src/lib/area-labels-fixture";
import { demoAreaNames, fetchAreaNames, idsToResolve, mergeNames } from "../src/lib/area-names";
import { placesTable } from "../src/lib/compare-table";
import type { GeographyId, MatchPack } from "../src/lib/contracts";
import { isTransientStatus } from "../src/lib/deployment";
import { areaSummaryPath } from "../src/lib/listing-save";
import { namedPack } from "../src/lib/match-brief";
import { periodForMetric } from "../src/lib/map-state";

test("Task 24: the name to show is the friendly title, else the API's, a row title, then the official name", () => {
  assert.equal(areaDisplayName({ friendlyName: "Highbury East", postcodeDistrict: "N5", name: "Islington 012A" }), "Highbury East · N5");
  assert.equal(areaDisplayName({ displayName: "Highbury East · N5", name: "Islington 012A" }), "Highbury East · N5");
  assert.equal(areaDisplayName({ title: "Pitshanger · W5", name: "Ealing 001A" }), "Pitshanger · W5");
  assert.equal(areaDisplayName({ name: "Islington 012A" }), "Islington 012A");
  assert.equal(areaDisplayName(null), null);
});

test("Task 24: stored names that are codes or ids are resolved; real names are left alone", () => {
  assert.ok(isCodeName("Haringey 019A"));
  assert.ok(isCodeName("Westminster 013"));
  assert.ok(isCodeName("uk:lsoa:E01000001", "uk:lsoa:E01000001"));
  assert.ok(isCodeName(""));
  assert.ok(!isCodeName("Highbury East · N5"));
  assert.ok(!isCodeName("City of London"));
  const ids = ["uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003"];
  assert.deepEqual(idsToResolve({ "uk:lsoa:E01000001": "Haringey 019A", "uk:lsoa:E01000002": "Highbury · N5" }, ids),
    ["uk:lsoa:E01000001", "uk:lsoa:E01000003"]);
  assert.deepEqual(mergeNames({ a: "Haringey 019A", b: "Kept" }, { a: "Highbury · N5", b: " " }), { a: "Highbury · N5", b: "Kept" });
});

test("Task 24: the names lookup reads area-names.v1 and fails quietly", async () => {
  const asked: string[] = [];
  const ok = (async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify({ schemaVersion: "area-names.v1", names: { "uk:lsoa:E01000001": "St James's · SW1A" } }));
  }) as typeof fetch;
  assert.deepEqual(await fetchAreaNames(["uk:lsoa:E01000001"], ok), { "uk:lsoa:E01000001": "St James's · SW1A" });
  assert.equal(asked[0], "/api/v1/areas/names?ids=uk%3Alsoa%3AE01000001");
  assert.deepEqual(await fetchAreaNames([], ok), {});
  assert.equal(asked.length, 1, "nothing to resolve, no request");
  const down = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
  assert.deepEqual(await fetchAreaNames(["uk:lsoa:E01000001"], down), {});
  const broken = (async () => { throw new Error("offline"); }) as typeof fetch;
  assert.deepEqual(await fetchAreaNames(["uk:lsoa:E01000001"], broken), {});
});

test("Task 24: demo names follow the API rule", () => {
  assert.deepEqual(demoAreaNames(["uk:lsoa:E01000001", "uk:lsoa:E09999999"], demoFriendlyFields).names,
    { "uk:lsoa:E01000001": "St James's · SW1A" });
});

test("Task 24: Compare columns and the brief's results carry names, not codes", () => {
  const table = placesTable([{ id: "uk:lsoa:E01000001" as GeographyId, name: null, profile: {
    schemaVersion: "area-profile.v1", geographyId: "uk:lsoa:E01000001", name: "Haringey 019A",
    friendlyName: "Tottenham Hale", postcodeDistrict: "N17", metrics: [], schools: null, noise: null,
  } as never }]);
  assert.equal(table.columns[0].name, "Tottenham Hale · N17");
  const pack = { values: [{ geographyId: "uk:lsoa:E01000001", name: "Haringey 019A", title: "Tottenham Hale · N17" },
    { geographyId: "uk:lsoa:E01000002", name: "Haringey 020B", title: null }] } as unknown as MatchPack;
  assert.deepEqual(namedPack(pack).values.map((result) => result.name), ["Tottenham Hale · N17", "Haringey"]);
});

test("Task 23: the save-listing area call names its metric and month", () => {
  assert.equal(areaSummaryPath("uk:lsoa:E01004734" as GeographyId, "2026-06"),
    "/api/v1/areas/uk%3Alsoa%3AE01004734?metric=price-per-square-metre&period=2026-06");
  assert.equal(areaSummaryPath("uk:lsoa:E01004734" as GeographyId, null),
    "/api/v1/areas/uk%3Alsoa%3AE01004734?metric=price-per-square-metre");
  assert.equal(areaSummaryPath("uk:lsoa:E01004734" as GeographyId, "June"),
    "/api/v1/areas/uk%3Alsoa%3AE01004734?metric=price-per-square-metre", "a malformed month is left out");
});

test("Task 25: each metric is asked for a month it is published for", () => {
  const deprivation = { periods: ["2025-01"], defaultPeriod: "2025-01" };
  const price = { periods: ["2026-04", "2026-05", "2026-06"], defaultPeriod: "2026-06" };
  assert.equal(periodForMetric(deprivation, "2026-06"), "2025-01", "the map's month falls back to the latest before it");
  assert.equal(periodForMetric(deprivation, "2025-01"), "2025-01", "a deep link's ?period is honoured");
  assert.equal(periodForMetric(price, "2026-05"), "2026-05");
  assert.equal(periodForMetric(price, "2025-01"), "2026-06", "nothing earlier: the default");
  assert.equal(periodForMetric({ periods: [], defaultPeriod: "" }, "2026-06"), "2026-06", "a placeholder keeps the map's month");
});

test("Task 27: rate limits and outages are worth a retry, never a 404", () => {
  assert.ok(isTransientStatus(429));
  assert.ok(isTransientStatus(503));
  assert.ok(isTransientStatus(500));
  assert.ok(!isTransientStatus(404));
  assert.ok(!isTransientStatus(400));
  assert.ok(!isTransientStatus(200));
  assert.ok(!isTransientStatus(0), "no API (demo) is not an outage");
});
