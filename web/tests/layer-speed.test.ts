import assert from "node:assert/strict";
import test from "node:test";

import { presetIdOf, type CustomCriterion } from "../src/lib/custom-criteria";
import { CUSTOM_PRESETS } from "../src/lib/custom-presets";
import { LONDON_COVERAGE, lsoaPieces, type MapCoverage } from "../src/lib/map-coverage";
import { mapPeriod } from "../src/lib/map-period";
import { catalogueEtag, etagMatches } from "../src/lib/metrics-cache";

// Layer load speed (perf/layer-load/analysis-2026-10-23.md): the fixes' rules.

const crime = { periods: ["2026-06", "2026-07", "2026-08"], defaultPeriod: "2026-08" };

test("the map waits for a linked layer's month instead of asking for the default one first", () => {
  assert.equal(mapPeriod({ metric: crime, period: "2026-06", waiting: true, placeholder: true, followsLayer: true }), "");
  // Known: the layer's own month at once (crime was built twice: 2026-06, then 2026-08).
  assert.equal(mapPeriod({ metric: crime, period: "2026-06", waiting: false, placeholder: false, followsLayer: true }), "2026-08");
  // A month the layer lacks (census 2021-03 vs the price month) goes to the layer's own.
  assert.equal(mapPeriod({ metric: { periods: ["2021-03"], defaultPeriod: "2021-03" }, period: "2026-06", waiting: false, placeholder: false, followsLayer: false }), "2021-03");
  // A month the address named, or one the timeline moved to, stays.
  assert.equal(mapPeriod({ metric: crime, period: "2026-07", waiting: false, placeholder: false, followsLayer: false }), "2026-07");
  // The default layer before the catalogue answers, and layers without packs, keep the month they have.
  assert.equal(mapPeriod({ metric: crime, period: "2026-06", waiting: false, placeholder: true, followsLayer: false }), "2026-06");
  assert.equal(mapPeriod({ metric: null, period: "2026-06", waiting: false, placeholder: false, followsLayer: true }), "2026-06");
});

const ENGLAND: MapCoverage = {
  coverage: "england", productReleaseId: "rel-1", bounds: [[-6, 49.8], [2, 55.9]],
  regions: [{ id: "E12000007", name: "London", bbox: [-0.51, 51.28, 0.34, 51.7] }, { id: "E12000002", name: "North West", bbox: [-3.6, 52.9, -2, 55.2] }],
  chunks: [
    { id: "E12000007", region: "E12000007", bbox: [-0.51, 51.28, 0.34, 51.7], areas: 4994 },
    { id: "E08000003", region: "E12000002", bbox: [-2.32, 53.34, -2.14, 53.55], areas: 295 },
  ],
} as MapCoverage;

test("a ready-made criterion paints on the LSOA pieces in view, never England's whole LSOA file", () => {
  const london: [number, number, number, number] = [-0.3, 51.4, 0.05, 51.6];
  assert.deepEqual(lsoaPieces(ENGLAND, "real", london, 11).map((entry) => [entry.chunk, entry.carrier]), [["E12000007", "lsoa"]]);
  const england: [number, number, number, number] = [-6, 49.8, 2, 55.9];
  assert.deepEqual(lsoaPieces(ENGLAND, "real", england, 6).map((entry) => [entry.chunk, entry.carrier, entry.rolledUp]),
    [["E12000007", "lsoa", false], ["E12000002", "lsoa", false]]);
  assert.deepEqual(lsoaPieces(ENGLAND, "real", england, 8).map((entry) => entry.chunk), ["E12000007", "E12000002"]);
  assert.equal(lsoaPieces(LONDON_COVERAGE, "real", london, 11)[0].chunk, "E12000007");
});

test("a ready-made criterion is fetched as its preset (cacheable), a household's own is not", () => {
  const preset = CUSTOM_PRESETS[0].criterion;
  const reordered = Object.fromEntries(Object.entries(preset).reverse()) as unknown as CustomCriterion;
  assert.equal(presetIdOf(reordered), preset.id);
  assert.equal(presetIdOf({ ...preset, radiusMetres: (preset.radiusMetres ?? 800) + 1 }), null);
  assert.equal(presetIdOf({ ...preset, id: "mine" }), null);
});

test("the metric catalogue revalidates by release", () => {
  const etag = catalogueEtag("rel-202610230107-census-layers-england")!;
  assert.equal(etag, '"metrics-rel-202610230107-census-layers-england"');
  assert.equal(catalogueEtag(null), null);
  assert.equal(catalogueEtag("bad release\""), null);
  assert.ok(etagMatches(`W/${etag}`, etag));
  assert.ok(etagMatches(`"other", ${etag}`, etag));
  assert.ok(!etagMatches('"metrics-rel-older"', etag));
  assert.ok(!etagMatches(null, etag));
});
