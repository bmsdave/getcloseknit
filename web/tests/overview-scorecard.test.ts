import assert from "node:assert/strict";
import test from "node:test";

import type { AreaSummary } from "../src/lib/contracts";
import {
  busyCentre,
  crimeVerdict,
  defaultHomeSize,
  formatPricePerSquareMetre,
  homeCost,
  londonVerdict,
  noiseShareWords,
  londonScore,
  noiseWords,
  schoolsWords,
  scoreTone,
  trendWords,
} from "../src/lib/overview-scorecard";
import { priceChange } from "../src/lib/price-change";

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

test("home size follows the saved bedrooms, else a 2-bed", () => {
  assert.equal(defaultHomeSize(1), 50);
  assert.equal(defaultHomeSize(2), 70);
  assert.equal(defaultHomeSize(3), 95);
  assert.equal(defaultHomeSize(5), 95);
  assert.equal(defaultHomeSize(0), 70);
  assert.equal(defaultHomeSize(null), 70);
});

test("home cost is floor area times the rounded £/m², rounded to £1,000; unknown price stays unknown", () => {
  // 7,646 rounds to 7,600/m², so the shown sum (70 m² × £7,600/m²) adds up.
  assert.equal(homeCost(7646, 70), 532_000);
  assert.equal(homeCost(9600, 50), 480_000);
  assert.equal(homeCost(10_119.05, 70), 707_000);
  assert.equal(homeCost(null, 70), null);
  assert.equal(homeCost(0, 70), null);
});

test("trend arrow follows the sign of the one-year change", () => {
  const rising = priceChange([point("2025-06", 7000), point("2026-06", 7350)], 1);
  assert.deepEqual(trendWords(rising), { direction: "up", arrow: "▲", text: "5.0%" });
  const falling = priceChange([point("2025-06", 8000), point("2026-06", 7600)], 1);
  assert.deepEqual(trendWords(falling), { direction: "down", arrow: "▼", text: "5.0%" });
  const flat = priceChange([point("2025-06", 8000), point("2026-06", 8001)], 1);
  assert.equal(trendWords(flat).direction, "flat");
  assert.deepEqual(trendWords(null), { direction: "unknown", arrow: "", text: "unknown" });
});

test("London score is the tenth of London the area falls in", () => {
  assert.equal(londonScore(0, "higher-is-more"), 1);
  assert.equal(londonScore(9.9, "higher-is-more"), 1);
  assert.equal(londonScore(10, "higher-is-more"), 2);
  assert.equal(londonScore(55, "neutral"), 6);
  assert.equal(londonScore(92, "higher-is-more"), 10);
  assert.equal(londonScore(100, "higher-is-more"), 10);
  assert.equal(londonScore(null, "higher-is-more"), null);
});

test("deprivation scores flip so 10 means most deprived", () => {
  // Deprivation decile 10 is the least deprived: the top tenth scores 1.
  assert.equal(londonScore(92, "higher-is-better"), 1);
  assert.equal(londonScore(5, "higher-is-better"), 10);
});

test("badges run green to red only where more is worse", () => {
  assert.equal(scoreTone("crime", 1), "1");
  assert.equal(scoreTone("crime", 10), "5");
  assert.equal(scoreTone("deprivation", 6), "3");
  assert.equal(scoreTone("income", 10), "neutral");
  assert.equal(scoreTone("social-renting", 2), "neutral");
  assert.equal(scoreTone("price-per-square-metre", 10), "neutral");
  assert.equal(scoreTone("crime", null), "neutral");
});

test("schools count both phases within 1 km; no count is unknown, never 0", () => {
  assert.equal(schoolsWords({ primary: 3, secondary: 1, radiusMetres: 1000 }), "3 primary · 1 secondary within 1 km");
  assert.equal(schoolsWords({ primary: 0, secondary: 0, radiusMetres: 1000 }), "0 primary · 0 secondary within 1 km");
  assert.equal(schoolsWords(null), "unknown");
});

test("noise bands: under 10% quiet, 10–40% some road noise, over 40% busy", () => {
  assert.equal(noiseWords({ available: true, any55Share: 0.05 }), "Quiet");
  assert.equal(noiseWords({ available: true, any55Share: 0.1 }), "Some road noise");
  assert.equal(noiseWords({ available: true, any55Share: 0.4 }), "Some road noise");
  assert.equal(noiseWords({ available: true, any55Share: 0.41 }), "Busy");
  assert.equal(noiseWords({ available: false, any55Share: null }), "unknown");
  assert.equal(noiseWords({ available: true, any55Share: null }), "unknown");
  assert.equal(noiseWords(null), "unknown");
});

test("the London verdict uses one wording everywhere (area, brief, postcode pages)", () => {
  assert.equal(londonVerdict(20), "Lower than most of London");
  assert.equal(londonVerdict(40), "Lower than most of London");
  assert.equal(londonVerdict(49), "About average for London");
  assert.equal(londonVerdict(60), "Higher than most of London");
  assert.equal(londonVerdict(null), null);
  assert.equal(crimeVerdict({ value: 59.3, regionPercentile: 43 }), "About average for London · 59 crimes per 1,000 people a year");
  assert.equal(crimeVerdict({ value: 59.3, regionPercentile: null }), "59 crimes per 1,000 people a year");
  assert.equal(crimeVerdict({ value: null, regionPercentile: 43 }), null);
});

test("a busy centre is a rate carried by few residents", () => {
  assert.equal(busyCentre({ value: 64.08, sampleCount: 94 }), false);
  assert.equal(busyCentre({ value: 640, sampleCount: 900 }), true);
  assert.equal(busyCentre({ value: 150, sampleCount: 120 }), true);
  assert.equal(busyCentre(null), false);
});

test("£/m² rounds one way everywhere, and noise reads in words", () => {
  assert.equal(formatPricePerSquareMetre(10_119.05), "£10,100/m²");
  assert.equal(formatPricePerSquareMetre(10_150), "£10,200/m²");
  assert.equal(noiseShareWords({ available: true, any55Share: 0.489 }), "about half of homes hear busy-road noise");
  assert.equal(noiseShareWords({ available: true, any55Share: 0.02 }), "very few homes hear busy-road noise");
  assert.equal(noiseShareWords({ available: true, any55Share: null }), null);
});
