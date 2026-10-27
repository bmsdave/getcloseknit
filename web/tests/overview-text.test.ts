import assert from "node:assert/strict";
import test from "node:test";

import type { AreaSummary, MetricId } from "../src/lib/contracts";
import { crimeCategories, topicSentence, type AreaFacts } from "../src/lib/overview-text";
import { priceChange } from "../src/lib/price-change";

function summary(metricId: MetricId, value: number | null, regionPercentile: number | null, extra: Partial<AreaSummary> = {}): AreaSummary {
  return {
    geographyId: "uk:lsoa:E01000001",
    metricId,
    period: "2026-06",
    value,
    regionPercentile,
    countryPercentile: null,
    sampleCount: null,
    quality: "observed",
    sourceVersion: "test",
    carrier: "lsoa",
    ...extra,
  };
}

const KNOWN: AreaFacts = {
  name: "Westminster preview",
  price: summary("price-per-square-metre", 9600, 92),
  change: priceChange([
    { ...summary("price-per-square-metre", 9327, null), period: "2025-06" },
    summary("price-per-square-metre", 9600, 92),
  ], 1),
  crime: summary("crime", 54, 92, { breakdown: { "violence": 30, "theft": 20, "burglary": 10 } }),
  deprivation: summary("deprivation", 8, 92),
  income: summary("income", 72000, 92),
  socialRenting: summary("social-renting", 14, 30),
  schools: { primary: 3, secondary: 1, radiusMetres: 1000 },
  noise: { available: true, any55Share: 0.18 },
  homeSize: 70,
};

const UNKNOWN: AreaFacts = {
  name: null, price: null, change: null, crime: null, deprivation: null, income: null, socialRenting: null,
  schools: null, noise: null, homeSize: 70,
};

test("topic sentences are plain, with the raw figure and London comparison", () => {
  assert.equal(topicSentence("price", KNOWN), "About £9,600/m², pricier than 92% of London areas.");
  assert.equal(
    topicSentence("crime", KNOWN),
    "Higher than most of London · 54 crimes per 1,000 people a year. Most recorded: violence (27), theft (18), burglary (9) per 1,000.",
  );
  assert.equal(topicSentence("deprivation", KNOWN), "Less deprived than 92% of London areas.");
  assert.equal(topicSentence("income", KNOWN), "Typical household income about £72,000 a year, higher than in 92% of London areas.");
  assert.equal(topicSentence("social-renting", KNOWN), "14% of homes are rented from a council or housing association, fewer than in 70% of London areas.");
  assert.equal(topicSentence("schools", KNOWN), "3 primary and 1 secondary state schools within 1 km.");
  assert.equal(topicSentence("noise", KNOWN), "About 1 in 5 homes hear busy-road noise.");
  assert.equal(topicSentence("deprivation", { ...KNOWN, deprivation: summary("deprivation", 5, 50) }), "Deprivation is about average for London.");
});

test("every topic says unknown when its figure is missing", () => {
  for (const topic of ["price", "crime", "deprivation", "income", "social-renting", "schools", "noise"] as const) {
    assert.equal(topicSentence(topic, UNKNOWN), "unknown", topic);
  }
  assert.equal(topicSentence("noise", { ...UNKNOWN, noise: { available: false, any55Share: null } }), "unknown");
});

test("crime categories rank by count and carry a per-1,000 rate", () => {
  assert.deepEqual(crimeCategories(summary("crime", 50, 50, { breakdown: { "anti-social-behaviour": 1, "violence": 4 } })), [
    { name: "violence", rate: 40 },
    { name: "anti social behaviour", rate: 10 },
  ]);
  assert.deepEqual(crimeCategories(summary("crime", 50, 50)), []);
});
