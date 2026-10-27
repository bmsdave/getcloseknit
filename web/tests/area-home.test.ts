import assert from "node:assert/strict";
import test from "node:test";

import { type AreaHomeResponse, demoAreaHome, homeFigures, homeRatings, readAreaHome, sharePercent } from "../src/lib/area-home";
import { ratingScore } from "../src/lib/rating";

const CAMDEN_LSOA: AreaHomeResponse = {
  schemaVersion: "area-home.v1", productReleaseId: "r1", geographyId: "uk:lsoa:E01000842", available: true,
  borough: { id: "uk:lad:E09000007", name: "Camden" },
  extend: {
    restrictedShare: 0.7, conservationShare: 0.6, article4Share: 0.3,
    listed: { gradeI: 1, gradeIIStar: 0, gradeII: 1203, total: 1204 },
    regionPercentile: 91, regionShare: 0.2266, article4Data: "published",
  },
  broadband: { share: 0.9987, regionPercentile: 88, regionShare: 0.9121, premises: 795, boroughFullFibreShare: 0.8596 },
  settled: { share: 0.819, regionPercentile: 19, regionShare: 0.868, residents: 1409 },
  notes: ["n"], sources: [], caveats: [],
};

test("Home ratings: protected land reads worse, gigabit and settledness read better", () => {
  const [extend, broadband, settled] = homeRatings(CAMDEN_LSOA);
  assert.deepEqual([extend.label, broadband.label, settled.label], ["Extending", "Broadband", "Settled"]);
  assert.equal(ratingScore(extend.percentile, extend.higherIsBetter), 1);
  assert.equal(ratingScore(broadband.percentile, broadband.higherIsBetter), 9);
  assert.equal(ratingScore(settled.percentile, settled.higherIsBetter), 2);
  assert.equal(extend.fact, "70% of land protected · 1,204 listed");
  assert.equal(broadband.fact, "Gigabit 100% · full fibre 86% (borough)");
  assert.equal(settled.fact, "82% at the same address a year on");
});

test("Home ratings keep their tiles without data and never read a missing borough as no Article 4", () => {
  assert.deepEqual(homeRatings(null).map((rating) => rating.percentile), [null, null, null]);
  const islington = { ...CAMDEN_LSOA, borough: { id: "uk:lad:E09000019" as const, name: "Islington" },
    extend: { ...CAMDEN_LSOA.extend!, article4Share: 0, article4Data: "not-published" as const } };
  assert.match(homeRatings(islington)[0].fact!, /Article 4 not published$/);
  assert.deepEqual(homeFigures(islington).find(([term]) => term === "Article 4 (householder)"),
    ["Article 4 (householder)", "Not published by Islington"]);
});

test("Home figures and shares", () => {
  const figures = Object.fromEntries(homeFigures(CAMDEN_LSOA));
  assert.equal(figures["Listed buildings"], "1,204 (I: 1, II*: 0, II: 1203)");
  assert.equal(figures["Gigabit available"], "100% of 795 homes");
  assert.equal(figures["Full fibre, Camden"], "86%");
  assert.equal(sharePercent(0.001), "Under 1%");
  assert.equal(sharePercent(null), null);
});

test("Home payloads are recognised; demo mode says it is not loaded", () => {
  assert.equal(readAreaHome(CAMDEN_LSOA), CAMDEN_LSOA);
  assert.equal(readAreaHome({ schemaVersion: "area-location.v1", notes: [] }), null);
  const demo = demoAreaHome("uk:lsoa:E01000842");
  assert.equal(demo.available, false);
  assert.equal(readAreaHome(demo), demo);
});
