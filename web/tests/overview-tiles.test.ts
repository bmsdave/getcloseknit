import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type { AreaSummary } from "../src/lib/contracts";
import type { AreaFloodResponse, FloodBand } from "../src/lib/flood-risk";

// The chart kit imports its stylesheet; Node has no CSS loader, so stylesheets load as empty modules here.
registerHooks({
  load: (url, context, next) => url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context),
});
// The old x/10 OverviewTiles are gone (v4 Task 12); the helpers the area view still uses stay here.
const overview = await import("../src/components/overview-tiles");
const { floodWorst, versusLondonWords, yearTrend } = overview;

test("the old x/10 tiles are deleted: no OverviewTiles, layerTile or rating tiles left", () => {
  for (const gone of ["OverviewTiles", "layerTile", "FloodRating", "CrimeCard", "LondonContextCard", "TILE_IDS"]) {
    assert.equal(gone in overview, false, gone);
  }
});

test("the map reading names its London comparison in the metric's words", () => {
  assert.equal(versusLondonWords("price-per-square-metre", 92), "Pricier than 92% of London areas");
  assert.equal(versusLondonWords("crime", 20), "Less crime than 80% of London areas");
  assert.equal(versusLondonWords("income", 50), "About average for London");
  assert.equal(versusLondonWords("crime", null), "London comparison unknown");
});

test("flood follows the worse of rivers & sea and surface water, and names the source", () => {
  const flood = (riversSea: FloodBand | null, surfaceWater: FloodBand | null) =>
    ({ riversSea: riversSea && { highestBand: riversSea }, surfaceWater: surfaceWater && { highestBand: surfaceWater } }) as AreaFloodResponse;
  assert.deepEqual(floodWorst(flood("very-low", "high")), { band: "high", source: "Surface water", share: null });
  assert.deepEqual(floodWorst(flood("medium", "low")), { band: "medium", source: "Rivers & sea", share: null });
  assert.deepEqual(floodWorst(flood("low", "low")), { band: "low", source: "Rivers & sea, surface water", share: null });
  assert.deepEqual(floodWorst(flood(null, "medium")), { band: "medium", source: "Surface water", share: null });
  assert.equal(floodWorst(null), null);
  const shares = { "very-low": 0.8, low: 0.08, medium: 0.07, high: 0.05 };
  const parts = { riversSea: { highestBand: "very-low", shares: { "very-low": 1, low: 0, medium: 0, high: 0 } }, surfaceWater: { highestBand: "high", shares } } as AreaFloodResponse;
  assert.ok(Math.abs((floodWorst(parts)?.share ?? 0) - 0.12) < 1e-9);
});

test("year trend: the newest point against a year before, or the oldest at least 11 months back", () => {
  const point = (period: string, value: number) => ({ period, value, sampleCount: 50 }) as AreaSummary;
  const trend = yearTrend([point("2025-09", 100), point("2026-03", 90), point("2026-08", 93)], false);
  assert.equal(Math.round(trend!.pct), -7);
  assert.deepEqual({ ...trend, pct: 0 }, { pct: 0, period: "Sep 2025", goodWhenUp: false, n: 50 });
  assert.equal(yearTrend([point("2026-01", 100), point("2026-08", 93)], false), null);
  assert.equal(yearTrend([], false), null);
});
