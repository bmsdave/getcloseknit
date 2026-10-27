import assert from "node:assert/strict";
import test from "node:test";

import { PROFILE_METRIC_IDS } from "../src/lib/contracts";
import { areaProfilePath, readAreaProfile, readLondonRanks } from "../src/lib/area-profile";
import { fixtureAreaProfile } from "../src/lib/area-profile-fixture";

test("the demo profile carries every profile metric at or before the period", () => {
  const profile = fixtureAreaProfile("uk:lsoa:E01000001", "2026-06");
  assert.ok(profile);
  assert.equal(profile.schemaVersion, "area-profile.v1");
  for (const metric of profile.metrics) {
    assert.ok((PROFILE_METRIC_IDS as readonly string[]).includes(metric.metricId), metric.metricId);
    assert.ok(metric.period <= "2026-06", `${metric.metricId} ${metric.period}`);
    assert.notEqual(metric.value, null);
  }
  assert.ok(profile.metrics.some((metric) => metric.metricId === "price-per-square-metre"));
  assert.ok(profile.schools && profile.schools.primary + profile.schools.secondary > 0);
  assert.equal(profile.noise, null, "no demo noise data: unknown, never quiet");
  // The demo ranks only its fixture schools; every other rating stays "No rating", never an invented score.
  assert.deepEqual([profile.regionRanks?.gettingAround, profile.regionRanks?.quiet, profile.regionRanks?.greenSpace], [null, null, null]);
  assert.equal(profile.regionRanks?.bestPrimary?.school.urn, "100001");
  assert.equal(profile.regionRanks?.bestSecondary?.school.urn, "100002");
});

test("a neighbourhood answered by its wider area still names its best schools", () => {
  const profile = fixtureAreaProfile("uk:lsoa:E01000002", "2026-06");
  assert.equal(profile?.geographyId, "uk:msoa:E02000002");
  assert.equal(profile?.regionRanks?.bestPrimary?.school.urn, "100001");
  assert.equal(profile?.regionRanks?.bestSecondary?.school.urn, "100002");
});

test("an unknown area has no profile", () => {
  assert.equal(fixtureAreaProfile("uk:lsoa:E09999999", "2026-06"), null);
});

test("real mode rejects fixture numbers and malformed payloads", () => {
  const profile = fixtureAreaProfile("uk:lsoa:E01000001", "2026-06");
  assert.equal(readAreaProfile(profile, "demo").status, "available");
  assert.equal(readAreaProfile(profile, "real").status, "unavailable");
  assert.equal(readAreaProfile({ schemaVersion: "area-summary.v1" }, "demo").status, "unavailable");
});

test("the profile path carries period, mode and release", () => {
  assert.equal(
    areaProfilePath({ selected: "uk:lsoa:E01000001", period: "2026-06", mode: "real", release: "r1" }),
    "/api/v1/areas/uk%3Alsoa%3AE01000001/profile?period=2026-06&mode=real&release=r1",
  );
});

// The area-profile.v1 regionRanks contract (api/area_api/places.py, migration 054).
const RANKS = {
  scope: "london-lsoa",
  gettingAround: { percentile: 1, higherIsBetter: false, value: 3.1, unit: "minutes", ranked: 4988, sourceReleaseId: "src-osm" },
  quiet: { percentile: 72, higherIsBetter: false, value: 0.54, unit: "share", ranked: 4993, sourceReleaseId: "src-defra" },
  greenSpace: null,
  bestPrimary: {
    percentile: 92, higherIsBetter: true, value: 88, unit: "percent", ranked: 1265, sourceReleaseId: "src-dfe",
    school: { urn: "100447", name: "St Peter and St Paul", distanceMetres: 831, academicYear: "2024/25" },
  },
  sources: [{ id: "src-defra", licence: "OGL-3.0", attribution: "Defra" }],
};

test("London ranks are 0-100 or null", () => {
  const ranks = readLondonRanks(RANKS);
  assert.ok(ranks);
  for (const key of ["gettingAround", "quiet", "greenSpace", "bestPrimary"] as const) {
    const rank = ranks[key];
    assert.ok(rank === null || (rank.percentile >= 0 && rank.percentile <= 100), key);
  }
  assert.equal(ranks.bestPrimary?.school.name, "St Peter and St Paul");
  assert.equal(ranks.greenSpace, null);
  // An API without secondary ranks reads as unknown, never a guess.
  assert.equal(ranks.bestSecondary, null);
  assert.equal(ranks.sources.length, 1);
});

test("a malformed London rank becomes null, never a score", () => {
  const ranks = readLondonRanks({
    ...RANKS,
    gettingAround: { ...RANKS.gettingAround, percentile: 101 },
    quiet: { ...RANKS.quiet, percentile: "72" },
    bestPrimary: { ...RANKS.bestPrimary, school: undefined },
    sources: undefined,
  });
  assert.deepEqual([ranks?.gettingAround, ranks?.quiet, ranks?.bestPrimary], [null, null, null]);
  assert.deepEqual(ranks?.sources, []);
  assert.equal(readLondonRanks(null), null);
  assert.equal(readLondonRanks({ scope: "england" }), null);
});

test("London rank sources keep only entries with string id, licence and attribution", () => {
  const ranks = readLondonRanks({
    ...RANKS,
    sources: [
      RANKS.sources[0],
      null,
      "src-osm",
      { id: "src-osm", licence: "ODbL-1.0" },
      { id: "src-dfe", licence: null, attribution: "DfE" },
      { id: 7, licence: "OGL-3.0", attribution: "TfL" },
    ],
  });
  assert.deepEqual(ranks?.sources, [RANKS.sources[0]]);
});

test("profiles from older APIs read as no London ranks", () => {
  const profile = fixtureAreaProfile("uk:lsoa:E01000001", "2026-06");
  const { regionRanks: _omitted, ...older } = profile!;
  const read = readAreaProfile(older, "demo");
  assert.equal(read.status, "available");
  assert.equal(read.status === "available" && read.profile.regionRanks, null);
  const withRanks = readAreaProfile({ ...older, regionRanks: RANKS }, "demo");
  assert.equal(withRanks.status === "available" && withRanks.profile.regionRanks?.quiet?.percentile, 72);
});
