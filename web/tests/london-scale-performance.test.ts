import assert from "node:assert/strict";
import test from "node:test";

import {
  LONDON_LSOA_COUNT,
  buildLondonScaleFixture,
  londonScaleGeoJson,
  londonScaleValuePack,
} from "../src/lib/london-scale-fixture";
import { createMorphStore } from "../src/lib/map-morph";

const SEED = 2026_09_06;

test("london fixture is deterministic for a fixed seed", () => {
  const first = buildLondonScaleFixture(SEED);
  const second = buildLondonScaleFixture(SEED);
  assert.deepEqual(first, second);
});

test("london fixture covers a representative London-scale area count", () => {
  const fixture = buildLondonScaleFixture(SEED);
  assert.equal(fixture.areas.length, LONDON_LSOA_COUNT);
  assert.ok(LONDON_LSOA_COUNT >= 4_000, "representative of ~4,835 London LSOAs");
  assert.equal(new Set(fixture.areas.map((area) => area.geographyId)).size, fixture.areas.length);
});

test("london fixture geometry stays inside Greater London and closes rings", () => {
  const fixture = buildLondonScaleFixture(SEED);
  for (const area of fixture.areas) {
    const ring = area.polygon.coordinates[0];
    assert.ok(ring.length >= 5, `${area.geographyId} needs a closed recognisable outline`);
    const firstPoint = ring[0];
    const lastPoint = ring[ring.length - 1];
    assert.deepEqual(lastPoint, firstPoint);
    for (const [longitude, latitude] of ring) {
      assert.ok(longitude >= -0.52 && longitude <= 0.34, `longitude ${longitude} outside London`);
      assert.ok(latitude >= 51.28 && latitude <= 51.7, `latitude ${latitude} outside London`);
    }
  }
});

test("london value pack covers every fixture area", () => {
  const fixture = buildLondonScaleFixture(SEED);
  const pack = londonScaleValuePack(fixture, "price-per-square-metre", "2026-06");
  assert.equal(pack.values.length, fixture.areas.length);
  assert.deepEqual(
    pack.values.map((entry) => entry.geographyId),
    fixture.areas.map((area) => area.geographyId),
  );
});

test("london geojson carries one feature per area", () => {
  const fixture = buildLondonScaleFixture(SEED);
  const collection = londonScaleGeoJson(fixture);
  assert.equal(collection.features.length, fixture.areas.length);
});

function countingStore() {
  const writes: string[] = [];
  return { writes, store: createMorphStore((id) => writes.push(id)) };
}

test("a year's morph at London scale writes each area once to load and moves only areas that differ", () => {
  const fixture = buildLondonScaleFixture(SEED);
  const pack = londonScaleValuePack(fixture, "price-per-square-metre", "2026-06");
  const { writes, store } = countingStore();
  store.load("a", pack.values, 0);
  assert.equal(writes.length, fixture.areas.length);
  writes.length = 0;
  const next = pack.values.map((entry, index) => index % 2 ? { ...entry, value: (entry.value ?? 0) + 1 } : entry);
  const start = performance.now();
  store.load("b", next, 0);
  store.weigh(0.5);
  const elapsed = performance.now() - start;
  const changed = next.filter((entry, index) => entry.value !== pack.values[index].value).length;
  // Every area loads into the free key; the frame writes only the areas that move.
  assert.equal(writes.length, fixture.areas.length + changed);
  // eslint-disable-next-line no-console
  console.log(`london-scale morph load + frame: ${elapsed.toFixed(2)}ms for ${fixture.areas.length} areas`);
});

test("identical re-load at London scale issues no feature-state writes", () => {
  const fixture = buildLondonScaleFixture(SEED);
  const pack = londonScaleValuePack(fixture, "price-per-square-metre", "2026-06");
  const { writes, store } = countingStore();
  store.load("a", pack.values, 0);
  writes.length = 0;
  store.load("a", pack.values, 0);
  assert.equal(writes.length, 0);
});

test("single value change at London scale issues one feature-state write", () => {
  const fixture = buildLondonScaleFixture(SEED);
  const pack = londonScaleValuePack(fixture, "price-per-square-metre", "2026-06");
  const { writes, store } = countingStore();
  store.load("a", pack.values, 0);
  writes.length = 0;
  const updated = pack.values.map((entry, index) =>
    index === 7 ? { ...entry, value: (entry.value ?? 0) + 1 } : entry,
  );
  store.load("a", updated, 0);
  assert.deepEqual(writes, [pack.values[7].geographyId]);
});
