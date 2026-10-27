import assert from "node:assert/strict";
import test from "node:test";

import type { BriefSchool, PriceContext } from "../src/lib/brief-model";
import type { GeographyId, SimilarAreasResponse } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { applyLikeSeed, likeSeed, likeSummary, targetVector } from "../src/lib/find-like";
import { previewSimilarAreas } from "../src/lib/similar-areas";

const AREA = "uk:lsoa:E01000002" as GeographyId;
const similar = (): SimilarAreasResponse => previewSimilarAreas(AREA, { cheaper: false, zones: null, socialRenting: false })!;
const band: PriceContext = {
  available: true, sales: 40, windowMonths: 24, minimumSample: 5, matched: "size-and-type", floorBand: [60, 80], above: 0,
  median: 640_000, p25: 560_000, p75: 726_000, bins: [], budgetMinPercentile: null, budgetMaxPercentile: null,
};
const school = (tier: BriefSchool["grade"]["tier"], distanceMetres: number): BriefSchool => ({
  urn: "100000", name: "A school", phase: "Primary", latitude: 51.5, longitude: -0.1, distanceMetres,
  grade: { tier, label: tier, year: null }, attainment8: null, selectivity: null, nearAreas: [],
});

test("the area's own percentiles are read back from the similar-areas answer", () => {
  const vector = targetVector(similar());
  assert.deepEqual(vector.crime, { rawValue: 112, utility: 70 });
  assert.deepEqual(vector["station-access"], { rawValue: 13.5, utility: 78 });
  assert.deepEqual(targetVector(null), {});
});

test("every criterion the area has evidence for is taken, with tolerances around its own fit", () => {
  const seed = likeSeed({ market: "buy", area: { estimatedPrice: 650_000, priceContext: band }, schools: [school("good", 900)], similar: similar() });
  assert.equal(seed.budget, 730_000);
  const byId = Object.fromEntries(seed.factors.map((factor) => [factor.factorId, factor]));
  // Price per m² at the 38th percentile: a band either side (fit 62 ± 10).
  assert.deepEqual([byId["market-level"].minimumUtility, byId["market-level"].maximumUtility], [52, 72]);
  // Crime at the 70th percentile (fit 30): no more than 15 points worse, any amount better.
  assert.deepEqual([byId.crime.minimumUtility, byId.crime.maximumUtility], [15, null]);
  assert.deepEqual([byId["station-access"].minimumUtility, byId["station-access"].maximumUtility], [7, null]);
  // The official deprivation decile (4 here, the 40th percentile; higher is less deprived): a band either side (40 ± 15).
  assert.deepEqual([byId.deprivation.minimumUtility, byId.deprivation.maximumUtility], [25, 55]);
  assert.equal(byId.deprivation.direction, "higher");
  assert.ok(seed.factors.every((factor) => factor.direction === (factor.factorId === "deprivation" ? "higher" : "lower") && factor.weight === 3));
  assert.equal(seed.schools, true);
  // Household income and social renting are never compared.
  assert.ok(!seed.factors.some((factor) => ["income", "social-renting"].includes(factor.factorId)));
  assert.equal(likeSummary("Highbury", seed), "Like Highbury: budget up to £730k (middle half of 40 sales here in 24 months: £560k–£726k), "
    + "about £6.8k per m², crime no higher than here, a station within about a 14-minute walk, "
    + "official deprivation decile about 4 (1 = most deprived), good schools nearby.");
});

test("without a sales band the budget is the area's typical price; no evidence, no criterion", () => {
  const seed = likeSeed({ market: "buy", area: { estimatedPrice: 654_000, priceContext: { available: false } }, schools: [school("good", 2_000), school("inadequate", 300)], similar: null });
  assert.equal(seed.budget, 650_000);
  assert.deepEqual(seed.factors, []);
  assert.equal(seed.schools, false);
  assert.equal(likeSummary("Highbury", seed), "Like Highbury: budget about £650k (a typical home price here).");
  const rent = likeSeed({ market: "rent", area: { estimatedPrice: 2_130, priceContext: band }, schools: [], similar: null });
  assert.equal(rent.budget, 2_150);
  assert.match(rent.criteria[0], /£2,150 a month/);
  assert.equal(likeSeed({ market: "buy", area: null, schools: [], similar: null }).budget, null);
});

test("the seed replaces those criteria and keeps the household's others", () => {
  const seed = likeSeed({ market: "buy", area: null, schools: [], similar: similar() });
  const profile = { ...DEFAULT_PROFILE, factors: [
    { factorId: "crime" as const, weight: 5, direction: "lower" as const, minimumUtility: 80, maximumUtility: null },
    { factorId: "noise" as const, weight: 2, direction: "lower" as const, minimumUtility: null, maximumUtility: null },
  ] };
  const next = applyLikeSeed(profile, seed);
  assert.deepEqual(next.factors.map((factor) => factor.factorId).sort(), ["crime", "deprivation", "market-level", "noise", "station-access"]);
  assert.equal(next.factors.find((factor) => factor.factorId === "crime")!.minimumUtility, 15);
  assert.equal(next.factors.find((factor) => factor.factorId === "noise")!.weight, 2);
});

test("the summary never states a price for one home", () => {
  const seed = likeSeed({ market: "buy", area: { estimatedPrice: 650_000, priceContext: band }, schools: [], similar: similar() });
  assert.doesNotMatch(likeSummary("Highbury", seed), /estimated price|\bworth\b|valuation|would be around/i);
});
