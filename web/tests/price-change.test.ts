import assert from "node:assert/strict";
import test from "node:test";

import type { AreaSummary } from "../src/lib/contracts";
import { periodYearsBefore, priceChange } from "../src/lib/price-change";

function point(period: string, value: number | null): AreaSummary {
  return {
    geographyId: "uk:lsoa:E01000001",
    metricId: "price-per-square-metre",
    period,
    value,
    regionPercentile: null,
    countryPercentile: null,
    sampleCount: null,
    quality: "observed",
    sourceVersion: "test",
    carrier: "lsoa",
  };
}

test("a period moves back whole years and keeps its month", () => {
  assert.equal(periodYearsBefore("2026-06", 1), "2025-06");
  assert.equal(periodYearsBefore("2026-06", 20), "2006-06");
  assert.equal(periodYearsBefore("June 2026", 1), null);
});

test("change compares the latest point with the same month years earlier", () => {
  const timeline = [point("2021-06", 5000), point("2025-06", 7000), point("2025-12", 7300), point("2026-06", 7350)];
  const year = priceChange(timeline, 1);
  assert.equal(year?.from.period, "2025-06");
  assert.equal(year?.percent.toFixed(1), "5.0");
  assert.equal(priceChange(timeline, 5)?.percent.toFixed(1), "47.0");
});

test("falling prices give a negative change", () => {
  assert.ok((priceChange([point("2025-06", 8000), point("2026-06", 7600)], 1)?.percent ?? 0) < 0);
});

test("missing ends give no change instead of a guessed zero", () => {
  assert.equal(priceChange([], 1), null);
  assert.equal(priceChange([point("2026-06", 7000)], 1), null, "history too short");
  assert.equal(priceChange([point("2025-06", null), point("2026-06", 7000)], 1), null);
  assert.equal(priceChange([point("2025-06", 7000), point("2026-06", null)], 1), null);
  assert.equal(priceChange([point("2025-06", 0), point("2026-06", 7000)], 1), null);
});
