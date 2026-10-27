import assert from "node:assert/strict";
import test from "node:test";

import type { MapLayerId } from "../src/lib/contracts";
import { parseMapState, REAL_PUBLISHED_LAYERS } from "../src/lib/map-state";

// Open data wave A layers, loaded on production 2026-10-19 (rel-202610190546-open-data-a).
const LOADED: MapLayerId[] = [
  "hpi-change-5y", "hpi-change-10y", "rent-change-1y", "rent-change-5y", "council-tax-band-mean",
  "short-lets-per-1000", "pipeline-homes-per-1000", "mobile-4g-indoor", "mobile-5g-outdoor", "hmo-per-1000",
  "future-station-distance",
];

test("loaded open data layers are published in Real data and open from links", () => {
  for (const layer of LOADED) {
    assert.ok(REAL_PUBLISHED_LAYERS.includes(layer), layer);
    assert.equal(parseMapState(new URLSearchParams(`layer=${layer}`)).layer, layer);
  }
});
