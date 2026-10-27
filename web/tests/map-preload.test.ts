import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MAP_STATE, type MapState } from "../src/lib/map-state";
import type { MapCoverage } from "../src/lib/map-coverage";
import { mapPreloads } from "../src/lib/map-preload";

const RELEASE = "rel-1";
const LAYERS = {
  crime: { carrier: "lsoa" as const, defaultPeriod: "2026-08", periods: ["2026-07", "2026-08"] },
  "census-birth-uk": { carrier: "msoa" as const, defaultPeriod: "2021-03", periods: ["2021-03"] },
};
const COVERAGE: MapCoverage = {
  coverage: "england", productReleaseId: RELEASE, bounds: [[-6, 49.8], [2, 55.9]],
  regions: [
    { id: "E12000007", region: "E12000007", bbox: [-0.52, 51.28, 0.34, 51.7] },
    { id: "E12000002", region: "E12000002", bbox: [-3.2, 52.9, -1.9, 55.2] },
  ],
  chunks: [
    { id: "E12000007", region: "E12000007", bbox: [-0.52, 51.28, 0.34, 51.7] },
    { id: "E08000003", region: "E12000002", bbox: [-2.32, 53.34, -2.15, 53.55] },
    { id: "E08000009", region: "E12000002", bbox: [-2.48, 53.4, -2.25, 53.48] },
    { id: "E08000008", region: "E12000002", bbox: [-2.15, 53.38, -2.0, 53.5] },
  ],
};

function state(overrides: Partial<MapState>): MapState {
  return { ...DEFAULT_MAP_STATE, mode: "real", release: RELEASE, ...overrides };
}

const paths = (urls: string[]) => urls.filter((url) => url.startsWith("/api/"));

test("a London start names the catalogue, the coverage, London's boxes and the layer's pack for its default month", () => {
  const urls = mapPreloads(state({ layer: "crime", period: "2026-06" }), { linkedPeriod: false, layers: LAYERS, coverage: COVERAGE });
  assert.match(urls[0], /^\/maplibre\/[^/]+\/maplibre-gl-worker\.mjs$/);
  assert.match(urls[1], /^\/maplibre\/[^/]+\/maplibre-gl-shared\.mjs$/);
  assert.deepEqual(paths(urls), [
    "/api/v1/metrics",
    "/api/v1/map/coverage?release=rel-1",
    "/api/v1/areas/boxes?carrier=lsoa&chunk=E12000007&v=rel-1&release=rel-1",
    "/api/v1/value-packs/crime/2026-08?mode=real&release=rel-1&chunk=E12000007&format=compact&v=rel-1",
  ]);
});

test("a linked month the layer has is kept; one it lacks falls back to the default", () => {
  const kept = mapPreloads(state({ layer: "crime", period: "2026-07" }), { linkedPeriod: true, layers: LAYERS });
  assert.ok(kept.some((url) => url.startsWith("/api/v1/value-packs/crime/2026-07?")));
  const fallback = mapPreloads(state({ layer: "crime", period: "2025-01" }), { linkedPeriod: true, layers: LAYERS });
  assert.ok(fallback.some((url) => url.startsWith("/api/v1/value-packs/crime/2026-08?")));
});

test("an MSOA layer's London pack is its own carrier's; criteria, unknown layers and demo name no pack", () => {
  const msoa = mapPreloads(state({ layer: "census-birth-uk" }), { linkedPeriod: false, layers: LAYERS });
  assert.ok(msoa.includes("/api/v1/value-packs/census-birth-uk/2021-03?mode=real&release=rel-1&chunk=E12000007&format=compact"));
  for (const layer of ["custom:gyms", "personal-match", "nope"] as const) {
    assert.ok(!mapPreloads(state({ layer: layer as MapState["layer"] }), { linkedPeriod: false, layers: LAYERS })
      .some((url) => url.includes("/value-packs/")), layer);
  }
  assert.deepEqual(paths(mapPreloads(state({ layer: "crime", mode: "demo" }), { linkedPeriod: false, layers: LAYERS })), []);
});

test("all of England names England's LAD boxes and their one pack", () => {
  const urls = paths(mapPreloads(state({ layer: "crime", latitude: 52.9, longitude: -1.5, zoom: 6 }),
    { linkedPeriod: false, layers: LAYERS, coverage: COVERAGE }));
  assert.deepEqual(urls.slice(2), [
    "/api/v1/areas/boxes?carrier=lad&v=rel-1&release=rel-1",
    "/api/v1/value-packs/crime/2026-08?mode=real&release=rel-1&level=lad&format=compact&v=rel-1",
  ]);
});

test("a regional view names each region's boxes and their one pack (every screen sees them all)", () => {
  const urls = paths(mapPreloads(state({ layer: "crime", latitude: 52.9, longitude: -1.5, zoom: 6.5 }),
    { linkedPeriod: false, layers: LAYERS, coverage: COVERAGE }));
  assert.deepEqual(urls.slice(2), [
    "/api/v1/areas/boxes?carrier=msoa&chunk=E12000007&v=rel-1&release=rel-1",
    "/api/v1/areas/boxes?carrier=msoa&chunk=E12000002&v=rel-1&release=rel-1",
    "/api/v1/value-packs/crime/2026-08?mode=real&release=rel-1&chunk=E12000007&level=msoa&format=compact&v=rel-1",
    "/api/v1/value-packs/crime/2026-08?mode=real&release=rel-1&chunk=E12000002&level=msoa&format=compact&v=rel-1",
  ]);
});

test("a neighbourhood view elsewhere names a phone's pieces only, and no pack when a laptop sees more", () => {
  const urls = paths(mapPreloads(state({ layer: "crime", latitude: 53.4808, longitude: -2.2426, zoom: 11 }),
    { linkedPeriod: false, layers: LAYERS, coverage: COVERAGE }));
  assert.ok(urls.includes("/api/v1/areas/boxes?carrier=lsoa&chunk=E08000003&v=rel-1&release=rel-1"));
  assert.ok(!urls.some((url) => url.includes("E08000008")), "a laptop's piece alone is not named");
  assert.ok(!urls.some((url) => url.includes("/value-packs/")));
  // Without the coverage nothing outside London is named.
  assert.deepEqual(paths(mapPreloads(state({ layer: "crime", latitude: 53.4808, longitude: -2.2426, zoom: 11 }),
    { linkedPeriod: false, layers: LAYERS })).length, 2);
});

test("no shapes are named: the area tiles load with the map, a piece's own request is its box index", () => {
  const urls = paths(mapPreloads(state({ layer: "crime" }), { linkedPeriod: false, layers: LAYERS, coverage: COVERAGE }));
  assert.ok(!urls.some((url) => url.includes("/areas/geometry") || url.includes("/tiles/areas/")), urls.join("\n"));
});
