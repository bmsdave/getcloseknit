import assert from "node:assert/strict";
import test from "node:test";

import {
  adjustByIndex,
  buildPriceHistorySeries,
  compareHistoricalPrice,
  describeComposition,
  describePriceSample,
  priceEnglandComparison,
  toPricePerSquareFoot,
  toPricePerSquareMetre,
} from "../src/lib/price-history";

test("historical prices expose nominal, inflation, and market comparisons", () => {
  assert.deepEqual(
    compareHistoricalPrice({
      nominalPrice: 100_000,
      cpihAtSale: 80,
      cpihLatest: 120,
      localPricePerSquareMetreAtSale: 2_000,
      localPricePerSquareMetreLatest: 5_000,
    }),
    {
      nominalPrice: 100_000,
      inflationAdjustedPrice: 150_000,
      localMarketAdjustedPrice: 250_000,
    },
  );
});

test("missing local evidence suppresses the market comparison", () => {
  const result = compareHistoricalPrice({
    nominalPrice: 100_000,
    cpihAtSale: 80,
    cpihLatest: 120,
    localPricePerSquareMetreAtSale: null,
    localPricePerSquareMetreLatest: 5_000,
  });

  assert.equal(result.localMarketAdjustedPrice, null);
});

test("square-metre and square-foot prices convert through one tested factor", () => {
  assert.equal(Math.round(toPricePerSquareFoot(10_000)), 929);
  assert.equal(
    Math.round(toPricePerSquareMetre(toPricePerSquareFoot(7_450))),
    7_450,
  );
});

test("inflation and market adjustments share one index helper", () => {
  assert.equal(adjustByIndex(100_000, 80, 120), 150_000);
});

test("histories keep nominal, CPIH, and local series separate", () => {
  const series = buildPriceHistorySeries(
    [
      { period: "2025-06", nominal: 5_000 },
      { period: "2026-06", nominal: 6_000 },
    ],
    { "2026-06": 120 },
    120,
    { "2025-06": 4_000, "2026-06": 6_000 },
    6_000,
  );

  assert.deepEqual(series, [
    { period: "2025-06", nominal: 5_000, inflationAdjusted: null, localMarketAdjusted: 7_500 },
    { period: "2026-06", nominal: 6_000, inflationAdjusted: 6_000, localMarketAdjusted: 6_000 },
  ]);
});

test("sample explanations keep all, matched, excluded, and carrier counts distinct", () => {
  const sample = describePriceSample({
    allSales: 27,
    matchedSales: 20,
    excludedSales: 7,
    carrierSales: 20,
    carrier: "lsoa",
  });

  assert.equal(sample.allSales, 27);
  assert.equal(sample.matchedSales, 20);
  assert.equal(sample.excludedSales, 7);
  assert.equal(sample.carrierSales, 20);
  assert.match(sample.explanation, /20 matched/);
  assert.match(sample.explanation, /LSOA/);
});

test("composition reports type mix and new-build share", () => {
  const composition = describeComposition([
    { propertyType: "F", newBuild: false },
    { propertyType: "F", newBuild: false },
    { propertyType: "D", newBuild: true },
    { propertyType: "D", newBuild: true },
  ]);

  assert.deepEqual(composition.byPropertyType, { F: 2, D: 2 });
  assert.equal(composition.newBuildShare, 0.5);
});

test("absent national coverage suppresses England percentile claims", () => {
  const comparison = priceEnglandComparison();

  assert.equal(comparison.value, null);
  assert.match(comparison.note, /Not published/);
});
