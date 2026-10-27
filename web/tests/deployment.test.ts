import assert from "node:assert/strict";
import test from "node:test";

import { deploymentDefaults, isKnownArea, parseMetricsRelease } from "../src/lib/deployment";

test("no API means demo defaults and no release override", () => {
  assert.deepEqual(deploymentDefaults({ api: null, env: {} }, null), { mode: undefined, release: undefined });
});

test("an API without env overrides defaults to real mode on the served release", () => {
  const served = { productReleaseId: "rel-2026-09-london-6m-v1", defaultPeriod: "2026-06" };
  assert.deepEqual(deploymentDefaults({ api: "http://api", env: {} }, served),
    { mode: "real", release: "rel-2026-09-london-6m-v1" });
});

test("explicit env wins over the served release and the pilot fallback covers an unreachable API", () => {
  const env = { NEXT_PUBLIC_AE_DEFAULT_MODE: "demo", NEXT_PUBLIC_AE_DEFAULT_RELEASE: "official-2026-06" };
  assert.deepEqual(deploymentDefaults({ api: "http://api", env }, null), { mode: "demo", release: "official-2026-06" });
  assert.deepEqual(deploymentDefaults({ api: "http://api", env: {} }, null), { mode: "real", release: "official-2026-06" });
});

test("metrics payload yields the release, the price default period and each layer's carrier and months", () => {
  const payload = {
    productReleaseId: "rel-1",
    metrics: [
      { id: "crime", carrier: "lsoa", defaultPeriod: "2026-07", periods: ["2026-06", "2026-07"] },
      { id: "price-per-square-metre", defaultPeriod: "2026-06" },
    ],
  };
  assert.deepEqual(parseMetricsRelease(payload), {
    productReleaseId: "rel-1", defaultPeriod: "2026-06",
    layers: { crime: { carrier: "lsoa", defaultPeriod: "2026-07", periods: ["2026-06", "2026-07"] } },
  });
  assert.equal(parseMetricsRelease({ nope: true }), null);
  assert.equal(parseMetricsRelease({ productReleaseId: "rel-1", metrics: [] })?.defaultPeriod, null);
});

test("known areas: fixtures in demo, an area summary from the API in real mode", () => {
  assert.equal(isKnownArea({ mode: "demo", fixture: true, upstreamStatus: null }), true);
  assert.equal(isKnownArea({ mode: "demo", fixture: false, upstreamStatus: null }), false);
  assert.equal(isKnownArea({ mode: "real", fixture: false, upstreamStatus: 200 }), true);
  assert.equal(isKnownArea({ mode: "real", fixture: true, upstreamStatus: 404 }), false);
  // A dead API must not turn every permanent link into a 404.
  assert.equal(isKnownArea({ mode: "real", fixture: false, upstreamStatus: 503 }), true);
});
