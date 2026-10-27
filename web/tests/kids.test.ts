import assert from "node:assert/strict";
import test from "node:test";

import { casualtyTrend, cycleFact, fixtureAreaKids, kidsPath, nurseryFact, nurseryGrade, roadFact } from "../src/lib/kids";
import { CYCLE_KEY, cycleLayers, cycleSource } from "../src/lib/map-cycle-lanes";
import { parseTileCoordinate } from "../src/lib/tile-proxy";

test("road casualties: last two years against the first two, up is bad", () => {
  const years = [10, 10, 9, 8, 7].map((count, index) => ({ year: 2021 + index, count }));
  assert.deepEqual(casualtyTrend(years), { pct: -25, period: "2021–22", goodWhenUp: false, n: 35 });
  assert.equal(casualtyTrend(years.slice(0, 3)), undefined);
  assert.equal(casualtyTrend([0, 0, 1, 2].map((count, index) => ({ year: 2021 + index, count }))), undefined);
});

test("tile facts are four words at most", () => {
  const kids = fixtureAreaKids("uk:lsoa:E01000002")!;
  assert.equal(nurseryFact(kids.nurseries!), "5/6 rated well");
  assert.equal(nurseryFact({ ...kids.nurseries!, rated: 0, wellRated: 0 }), "None rated nearby");
  assert.equal(roadFact(kids.roadSafety!), "32 hurt, 2 children");
  assert.equal(roadFact({ ...kids.roadSafety!, children: 1 }), "32 hurt, 1 child");
  assert.equal(cycleFact(kids.cycling!), "0 km protected");
  assert.equal(cycleFact({ ...kids.cycling!, protectedKm: 12.4 }), "12 km protected");
  assert.equal(cycleFact({ ...kids.cycling!, protectedKm: 1.43 }), "1.4 km protected");
});

test("a nursery's grade says which framework and year", () => {
  const [old, card] = fixtureAreaKids("uk:lsoa:E01000001")!.nurseries!.nearest;
  assert.equal(nurseryGrade(old), "Good · 2024");
  assert.equal(nurseryGrade(card), "Expected standard (report card) · 2026");
  assert.equal(nurseryGrade({ ...old, inspected: null }), "Good");
});

test("demo fixtures cover the preview LSOAs and MSOAs, not boroughs", () => {
  assert.equal(fixtureAreaKids("uk:msoa:E02000001")?.schemaVersion, "area-kids.v1");
  assert.equal(fixtureAreaKids("uk:lad:E09000001"), null);
  assert.equal(kidsPath("uk:lsoa:E01000001"), "/api/v1/areas/uk%3Alsoa%3AE01000001/kids");
});

test("cycle lanes overlay: sky dashes on cream casing (tangerine is collisions only), painted lanes only up close, a key for each kind", () => {
  const layers = cycleLayers();
  assert.deepEqual(layers.map((layer) => layer.id), ["cycle-casing", "cycle-lane-casing", "cycle-lane", "cycle-cycleway", "cycle-protected"]);
  for (const id of ["cycle-lane", "cycle-cycleway", "cycle-protected"]) {
    const paint = (layers.find((layer) => layer.id === id) as { paint: Record<string, unknown> }).paint;
    assert.equal(paint["line-color"], "#4aa3df", id);
    assert.ok(Array.isArray(paint["line-dasharray"]), `${id} is dashed`);
  }
  assert.equal(layers.find((layer) => layer.id === "cycle-lane")?.minzoom, 13);
  assert.match(cycleSource("https://x").tiles![0], /\/api\/v1\/tiles\/cycle-lanes\/\{z\}\/\{x\}\/\{y\}\.pbf$/);
  assert.match(String(cycleSource("https://x").attribution), /Powered by TfL Open Data/);
  assert.deepEqual(CYCLE_KEY.map((item) => item.kind), ["protected", "cycleway", "lane"]);
  assert.deepEqual(parseTileCoordinate("14", "8186", "5448.pbf"), { z: 14, x: 8186, y: 5448 });
});
