import assert from "node:assert/strict";
import test from "node:test";

import { airShown, healthPath, healthRatings, readAreaHealth, type AreaHealthResponse } from "../src/lib/area-health";
import { ratingModel } from "../src/lib/rating";

const HEALTH: AreaHealthResponse = {
  schemaVersion: "area-health.v1", productReleaseId: "r1", geographyId: "uk:lsoa:E01002718", available: true,
  air: { no2: 31.2, pm25: 10.6, year: 2019, regionPercentile: 72.5, no2Percentile: 75, pm25Percentile: 66 },
  heat: { value: 32.1, unit: "°C", year: 2018, regionPercentile: 85 },
  gp: { patientsPerGp: 2141, practices: 3, nearestMetres: 310, month: "2026-09-01", regionPercentile: 64, withinMetres: 1000 },
  notes: ["NO₂ 31.2 µg/m³"], sources: [], caveats: [],
};

test("health reads only area-health.v1 and builds its path", () => {
  assert.equal(readAreaHealth({ schemaVersion: "area-location.v1", notes: [] }), null);
  assert.equal(readAreaHealth(HEALTH), HEALTH);
  assert.equal(healthPath("uk:lsoa:E01002718"), "/api/v1/areas/uk%3Alsoa%3AE01002718/health");
});

test("three ratings where lower values rate better, with one fact each", () => {
  const [air, heat, gp] = healthRatings(HEALTH);
  assert.deepEqual([air.label, heat.label, gp.label], ["Clean air", "Cool nights", "GP access"]);
  assert.equal(air.fact, "NO₂ 31.2 · PM2.5 10.6 µg/m³");
  assert.equal(heat.fact, "32.1°C on summer nights");
  assert.equal(gp.fact, "2,141 patients per GP");
  // More polluted than 72.5% of London rates low.
  assert.equal(ratingModel(air.percentile, air.higherIsBetter, air.comparative).score, 3);
});

test("unloaded layers say No rating and no fact; no practice nearby is said plainly", () => {
  assert.ok(healthRatings(null).every((rating) => rating.percentile === null && rating.fact === undefined));
  const [, , gp] = healthRatings({ ...HEALTH, gp: { ...HEALTH.gp!, practices: 0, patientsPerGp: null } });
  assert.equal(gp.fact, "No GP within 1 km");
  const [, , borough] = healthRatings({ ...HEALTH, gp: { ...HEALTH.gp!, practices: 0, patientsPerGp: null, withinMetres: null } });
  assert.equal(borough.fact, "No GP in the area");
});

test("with CLOSE_KNIT_AIR_QUALITY off the API says so and Clean air is left out", () => {
  const off = { ...HEALTH, airEnabled: false, air: null };
  assert.deepEqual(healthRatings(off).map((rating) => rating.label), ["Cool nights", "GP access"]);
  assert.equal(airShown(off), false);
  assert.equal(airShown(HEALTH), true);  // older payloads without the field keep Clean air
  assert.equal(airShown({ ...HEALTH, airEnabled: true }), true);
});
