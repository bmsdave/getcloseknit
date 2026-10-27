import assert from "node:assert/strict";
import test from "node:test";

import type { AreaSummary, MetricId } from "../src/lib/contracts";
import {
  EVIDENCE_SECTIONS,
  parseFolded,
  planningKeyFigure,
  sectionKeyFigures,
  toggleFolded,
  type KeyFigureInput,
} from "../src/lib/evidence-sections";
import type { AreaFacts } from "../src/lib/overview-text";

function summary(metricId: MetricId, value: number | null, regionPercentile: number | null): AreaSummary {
  return { metricId, value, regionPercentile } as AreaSummary;
}

const EMPTY_FACTS: AreaFacts = {
  name: null, price: null, change: null, crime: null, deprivation: null, income: null,
  socialRenting: null, schools: null, noise: null, homeSize: 70,
} as AreaFacts;

function input(overrides: Partial<KeyFigureInput> = {}): KeyFigureInput {
  return { facts: EMPTY_FACTS, flood: "unknown", places: { status: "unavailable", reason: "test" }, history: null, planning: null, loading: false, ...overrides };
}

test("sections run in the one topic order", () => {
  assert.deepEqual(EVIDENCE_SECTIONS.map((section) => section.title), [
    "Price & market", "Transport", "Crime", "Schools", "Environment", "Planning", "Property", "People",
  ]);
});

test("stored folding keeps known ids only and survives malformed values", () => {
  assert.deepEqual(parseFolded(null), []);
  assert.deepEqual(parseFolded("not json"), []);
  assert.deepEqual(parseFolded('{"crime":true}'), []);
  assert.deepEqual(parseFolded('["crime","housing","crime","schools"]'), ["crime", "schools"]);
});

test("toggling folds and opens one section, keeping panel order", () => {
  assert.deepEqual(toggleFolded([], "schools"), ["schools"]);
  assert.deepEqual(toggleFolded(["schools"], "crime"), ["crime", "schools"]);
  assert.deepEqual(toggleFolded(["crime", "schools"], "crime"), ["schools"]);
});

test("headers read one key figure each from the summary's data", () => {
  const facts: AreaFacts = {
    ...EMPTY_FACTS,
    price: summary("price-per-square-metre", 12_345, 80),
    change: { percent: 4.21 } as AreaFacts["change"],
    crime: summary("crime", 141.53, 88),
    income: summary("income", 45_000, 55),
    socialRenting: summary("social-renting", 20, 55),
    schools: { primary: 3, secondary: 1, radiusMetres: 1000 } as AreaFacts["schools"],
    noise: { available: true, any55Share: 0.123 } as AreaFacts["noise"],
  };
  const figures = sectionKeyFigures(input({
    facts,
    flood: { riversSea: { highestBand: "low" } } as KeyFigureInput["flood"],
    places: { status: "available", places: { stations: [{ name: "Far", distanceMetres: 900 }, { name: "Near", distanceMetres: 320 }], connectivity: { score: 9 } } } as KeyFigureInput["places"],
    history: { transactions: [{ date: "2019-05-01", nominalPrice: 400_000 }, { date: "2022-11-03", nominalPrice: 570_000 }] } as KeyFigureInput["history"],
    planning: "4 applications · Westminster",
  }));
  assert.equal(figures.price, "£12,300/m² · ▲ 4.2% a year");
  assert.equal(figures.crime, "Higher than most of London · 142 crimes per 1,000 people a year");
  // Places, not people: the homes, never income.
  assert.equal(figures.people, "20% of homes social rent");
  assert.equal(figures.schools, "3 primary · 1 secondary within 1 km");
  assert.equal(figures.environment, "Flood low · about 1 in 10 homes hear busy-road noise");
  assert.equal(figures.transport, "Excellent · 4 min walk to Near");
  assert.equal(figures.planning, "4 applications · Westminster");
  assert.equal(figures.property, "Last sold £570,000 · 2022");
});

test("missing figures read unknown, or … while loading, never 0", () => {
  const unknown = sectionKeyFigures(input());
  for (const id of ["price", "crime", "people", "schools", "environment", "transport"] as const) {
    assert.equal(unknown[id], "unknown", id);
  }
  assert.equal(unknown.planning, "unknown");
  assert.equal(unknown.property, "No recorded sale for this home");
  const loading = sectionKeyFigures(input({ loading: true, flood: null, places: null }));
  for (const id of ["price", "crime", "people", "schools", "environment", "transport"] as const) {
    assert.equal(loading[id], "…", id);
  }
});

test("preview planning header counts the pilot borough's applications", () => {
  assert.match(planningKeyFigure("uk:lsoa:E01000001"), /^\d+ applications? · |^Outside the pilot boroughs$/);
});
