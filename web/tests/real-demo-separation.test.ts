import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId, MapLayerId } from "../src/lib/contracts";
import {
  adoptSavedState,
  applyEnvDefaults,
  applyLayerSelection,
  DEFAULT_MAP_STATE,
  applyModeSwitch,
  areForecastsAvailableInMode,
  areJourneysAvailableInMode,
  areSchoolsAvailableInMode,
  areaEvidencePath,
  buildShareUrl,
  createEvidenceRequestScope,
  DATA_MODE_LABELS,
  DEMO_RELEASE,
  requestAreaEvidence,
  type FetchLike,
  isLayerAvailableInMode,
  isModeReleaseConflict,
  matchRequestPath,
  modeConflictNotice,
  normalizeModeRelease,
  parseMapState,
  parseMapStateWithStatus,
  REAL_PILOT_RELEASE,
  planEvidenceRequest,
  restoreSavedMapState,
  serializeMapState,
  shouldAdoptSavedState,
  urlModeNotice,
  valuePackPath,
} from "../src/lib/map-state";
import {
  getAreaSummary,
  isFixtureSourceVersion,
  METRICS,
  unavailableAreaSchools,
  unavailableForecast,
  unavailableJourney,
} from "../src/lib/fixtures";

const CRIME_AREA: GeographyId = "uk:lsoa:E01000001";

function realCrimeLink(): URLSearchParams {
  return new URLSearchParams(
    `mode=real&release=${encodeURIComponent(REAL_PILOT_RELEASE)}` +
      `&layer=crime&period=2026-06&selected=${encodeURIComponent(CRIME_AREA)}`,
  );
}

test("a real deep link opens validated real state", () => {
  const { state, appliedLegacyDefault, rejectedConflict } = parseMapStateWithStatus(realCrimeLink());

  assert.equal(state.mode, "real");
  assert.equal(state.release, REAL_PILOT_RELEASE);
  assert.equal(state.layer, "crime");
  assert.equal(state.selected, CRIME_AREA);
  assert.equal(appliedLegacyDefault, false);
  assert.equal(rejectedConflict, false);
});

test("a bare review-stack URL adopts the configured real default", () => {
  const parameters = new URLSearchParams();
  applyEnvDefaults(parameters, { mode: "real", release: "rel-2026-09-crime-12m-v1" });
  const { state, rejectedConflict } = parseMapStateWithStatus(parameters);

  assert.equal(state.mode, "real");
  assert.equal(state.release, "rel-2026-09-crime-12m-v1");
  assert.equal(rejectedConflict, false);
});

test("explicit developer links and invalid env values beat the configured default", () => {
  const explicit = new URLSearchParams("mode=demo&release=preview-2026-09&dev=1");
  applyEnvDefaults(explicit, { mode: "real", release: "rel-2026-09-crime-12m-v1" });
  assert.equal(parseMapState(explicit).mode, "demo");

  const invalid = new URLSearchParams();
  applyEnvDefaults(invalid, { mode: "real", release: "preview-2026-09" });
  assert.equal(parseMapStateWithStatus(invalid).state.mode, "demo");

  const empty = new URLSearchParams();
  applyEnvDefaults(empty, {});
  assert.equal(parseMapStateWithStatus(empty).state.mode, "demo");
});

test("legacy links fall back to the documented demo default", () => {
  const { state, appliedLegacyDefault, rejectedConflict } = parseMapStateWithStatus(new URLSearchParams());

  assert.equal(state.mode, "demo");
  assert.equal(state.release, DEMO_RELEASE);
  assert.equal(appliedLegacyDefault, true);
  assert.equal(rejectedConflict, false);
});

test("conflicting mode and release combinations are rejected", () => {
  for (const query of [`mode=real&release=${DEMO_RELEASE}`, "mode=demo&release=official-2026-06", "mode=real"]) {
    const { state, rejectedConflict } = parseMapStateWithStatus(new URLSearchParams(query));

    assert.equal(rejectedConflict, true, query);
    assert.equal(state.mode, "demo", query);
    assert.equal(state.release, DEMO_RELEASE, query);
    assert.equal(isModeReleaseConflict(state.mode, state.release), false, query);
  }
  assert.equal(isModeReleaseConflict("real", DEMO_RELEASE), true);
  assert.equal(isModeReleaseConflict("demo", REAL_PILOT_RELEASE), true);
  assert.equal(normalizeModeRelease(null, null).appliedLegacyDefault, true);
});

test("the real pilot publishes the loaded analytic layers and real personal matching", () => {
  // Noise and Clean air are loaded by the v4 D1 bundles (RELEASE-CHECKLIST 6p): no longer "Unavailable in Real data".
  for (const layer of ["price-per-square-metre", "crime", "deprivation", "income", "social-renting", "noise", "air-no2",
    "personal-match"] as const) {
    assert.equal(isLayerAvailableInMode(layer, "real"), true, layer);
    assert.equal(isLayerAvailableInMode(layer, "demo"), true, layer);
  }
});

test("switching to a newly published real layer adopts its default period", () => {
  const switched = applyLayerSelection(
    { layer: "crime", period: "2026-06", mode: "real", release: REAL_PILOT_RELEASE },
    "income",
    "2023-01",
    "Estimated household income",
  );

  assert.equal(switched.layer, "income");
  assert.equal(switched.period, "2023-01");
  assert.equal(switched.notice, null);

  const allowed = applyLayerSelection(
    { layer: "crime", period: "2026-06", mode: "demo", release: DEMO_RELEASE },
    "income",
    "2023-01",
    "Estimated household income",
  );

  assert.equal(allowed.layer, "income");
  assert.equal(allowed.period, "2023-01");
  assert.equal(allowed.notice, null);
});

test("published real layers produce an evidence fetch", () => {
  const requested = planEvidenceRequest({
    selected: CRIME_AREA,
    layer: "income",
    layerLabel: "Estimated household income",
    metric: "income",
    period: "2023-01",
    mode: "real",
    release: REAL_PILOT_RELEASE,
  });

  assert.equal(requested.kind, "fetch");
  if (requested.kind === "fetch") {
    assert.match(requested.path, /metric=income/);
    assert.match(requested.path, /mode=real/);
  }

  const crime = planEvidenceRequest({
    selected: CRIME_AREA,
    layer: "crime",
    layerLabel: "Recorded crime",
    metric: "crime",
    period: "2026-06",
    mode: "real",
    release: REAL_PILOT_RELEASE,
  });

  assert.equal(crime.kind, "fetch");
  if (crime.kind === "fetch") {
    assert.match(crime.path, /mode=real/);
    assert.match(crime.path, new RegExp(`release=${encodeURIComponent(REAL_PILOT_RELEASE)}`));
  }

  assert.equal(
    planEvidenceRequest({
      selected: null,
      layer: "crime",
      layerLabel: "Recorded crime",
      metric: "crime",
      period: "2026-06",
      mode: "real",
      release: REAL_PILOT_RELEASE,
    }).kind,
    "idle",
  );
});

test("real requests never return fixture numbers", async () => {
  const fixtureSummary = getAreaSummary(CRIME_AREA, "crime", "2026-06");
  assert.ok(fixtureSummary);
  assert.equal(fixtureSummary.value, 54);
  assert.equal(isFixtureSourceVersion(fixtureSummary.sourceVersion), true);
  const upstreamBody = {
    schemaVersion: "area-summary.v1",
    summary: fixtureSummary,
    parentId: null,
    priceTimeline: [],
    metricTimeline: [],
  };
  const stubFetch: FetchLike = async () => ({ ok: true, status: 200, json: async () => upstreamBody });

  const rejected = await requestAreaEvidence(
    { path: areaEvidencePath({ selected: CRIME_AREA, metric: "crime", period: "2026-06", mode: "real", release: REAL_PILOT_RELEASE }), mode: "real", release: REAL_PILOT_RELEASE },
    stubFetch,
  );

  assert.equal(rejected.status, "unavailable");
  assert.ok(!("payload" in rejected));

  const demo = await requestAreaEvidence(
    { path: areaEvidencePath({ selected: CRIME_AREA, metric: "crime", period: "2026-06", mode: "demo", release: DEMO_RELEASE }), mode: "demo", release: DEMO_RELEASE },
    stubFetch,
  );

  assert.equal(demo.status, "available");
  if (demo.status === "available") assert.equal(demo.payload.summary.value, 54);
});

test("losing the API connection is explicit and never falls back to fixtures", async () => {
  const failingFetch: FetchLike = async () => {
    throw new TypeError("fetch failed");
  };
  const lost = await requestAreaEvidence(
    { path: areaEvidencePath({ selected: CRIME_AREA, metric: "crime", period: "2026-06", mode: "real", release: REAL_PILOT_RELEASE }), mode: "real", release: REAL_PILOT_RELEASE },
    failingFetch,
  );

  assert.equal(lost.status, "connection-lost");
  assert.ok(!("payload" in lost));

  const missingFetch: FetchLike = async () => ({ ok: false, status: 404, json: async () => ({ error: "area-not-found" }) });
  const missing = await requestAreaEvidence(
    { path: areaEvidencePath({ selected: CRIME_AREA, metric: "crime", period: "2026-06", mode: "real", release: REAL_PILOT_RELEASE }), mode: "real", release: REAL_PILOT_RELEASE },
    missingFetch,
  );

  assert.equal(missing.status, "unavailable");
  assert.ok(!("payload" in missing));
});

test("stale prior-mode responses cannot overwrite the current selection", async () => {
  const scope = createEvidenceRequestScope();
  const demoSequence = scope.issue();
  const realSequence = scope.issue();

  assert.equal(scope.isCurrent(demoSequence), false);
  assert.equal(scope.isCurrent(realSequence), true);

  let fetched = 0;
  const skipped: FetchLike = async () => {
    fetched += 1;
    return { ok: false, status: 410, json: async () => ({}) };
  };
  const stale = await requestAreaEvidence(
    { path: "/api/v1/areas/stale?mode=demo", mode: "demo", release: DEMO_RELEASE },
    skipped,
    { scope, sequence: demoSequence },
  );

  assert.equal(stale.status, "stale");
  assert.equal(fetched, 0);
});

test("saved state restores validated mode and release", () => {
  const saved = serializeMapState({ ...parseMapState(realCrimeLink()), latitude: 51.5, longitude: -0.12, zoom: 12, pitch: 0, bearing: 0 });
  const restored = restoreSavedMapState(saved);

  assert.ok(restored);
  assert.equal(restored.mode, "real");
  assert.equal(restored.release, REAL_PILOT_RELEASE);
  assert.equal(restored.layer, "crime");
  assert.equal(restoreSavedMapState(`mode=real&release=${DEMO_RELEASE}`), null);
  assert.equal(restoreSavedMapState(null), null);
});

test("explicit links win over saved state while legacy links adopt it", () => {
  assert.equal(shouldAdoptSavedState("?layer=crime"), true);
  assert.equal(shouldAdoptSavedState(""), true);
  assert.equal(shouldAdoptSavedState(`?mode=real&release=${encodeURIComponent(REAL_PILOT_RELEASE)}`), false);
  assert.equal(shouldAdoptSavedState("?mode=real"), false);
});

test("shared links always carry explicit mode and release", () => {
  const state = parseMapState(realCrimeLink());
  const shared = buildShareUrl("https://example.invalid", state);

  assert.match(shared, /mode=real/);
  assert.match(shared, new RegExp(`release=${encodeURIComponent(REAL_PILOT_RELEASE)}`));
  assert.deepEqual(parseMapState(new URLSearchParams(new URL(shared).search)).mode, "real");
  assert.match(valuePackPath({ metric: "crime", period: "2026-06", mode: "real", release: REAL_PILOT_RELEASE }), /mode=real/);
  assert.match(matchRequestPath("real", REAL_PILOT_RELEASE), /mode=real/);
});

test("real pilot leaves schools, journeys, and forecasts unavailable", () => {
  assert.equal(areSchoolsAvailableInMode("real"), false);
  assert.equal(areJourneysAvailableInMode("real"), false);
  assert.equal(areForecastsAvailableInMode("real"), false);
  assert.equal(areSchoolsAvailableInMode("demo"), true);
  assert.equal(areJourneysAvailableInMode("demo"), true);
  assert.equal(areForecastsAvailableInMode("demo"), true);

  const forecast = unavailableForecast(CRIME_AREA, "1y", REAL_PILOT_RELEASE);
  assert.equal(forecast.status, "insufficient-history");
  assert.equal(forecast.range, null);
  assert.match(forecast.suppressionReason ?? "", /not published/);

  const schools = unavailableAreaSchools(CRIME_AREA, REAL_PILOT_RELEASE);
  assert.deepEqual(schools.schools, []);
  assert.match(schools.unavailableReason, /not published/);

  const journey = unavailableJourney();
  assert.equal(journey.status, "unreachable");
  assert.equal(journey.medianMinutes, null);
});

test("demo data stays labeled and fixture releases are detectable", () => {
  assert.match(DATA_MODE_LABELS.demo, /demo/i);
  assert.match(DATA_MODE_LABELS.real, /real/i);
  assert.equal(isFixtureSourceVersion(DEMO_RELEASE), true);
  assert.equal(isFixtureSourceVersion(REAL_PILOT_RELEASE), false);
  for (const metric of METRICS) {
    assert.equal(isFixtureSourceVersion(metric.provenance.release), true, metric.id);
  }
});

test("conflicting requests describe the reset instead of failing silently", () => {
  assert.equal(modeConflictNotice(new URLSearchParams("")), null);
  assert.equal(
    modeConflictNotice(new URLSearchParams("mode=real&release=official-2026-06")),
    null,
  );
  assert.match(
    modeConflictNotice(new URLSearchParams("mode=real&release=preview-2026-09")) ?? "",
    /conflict.*mode real.*preview-2026-09.*demo defaults/i,
  );
  assert.match(modeConflictNotice(new URLSearchParams("mode=banana")) ?? "", /conflict/i);
});

test("mode switches normalize the release instead of mixing universes", () => {
  const toReal = applyModeSwitch({ mode: "demo", release: DEMO_RELEASE }, "real");

  assert.equal(toReal.mode, "real");
  assert.equal(toReal.release, REAL_PILOT_RELEASE);
  assert.match(toReal.notice ?? "", /^Real data/);

  const toDemo = applyModeSwitch({ mode: "real", release: REAL_PILOT_RELEASE }, "demo");

  assert.equal(toDemo.mode, "demo");
  assert.equal(toDemo.release, DEMO_RELEASE);
  assert.match(toDemo.notice ?? "", /demo/i);

  const unchanged = applyModeSwitch({ mode: "real", release: REAL_PILOT_RELEASE }, "real");

  assert.equal(unchanged.release, REAL_PILOT_RELEASE);
  assert.equal(unchanged.notice, null);
});

test("the guarded request path reports connection loss and recovery", async () => {
  const seen: string[] = [];
  const failingFetch: FetchLike = async () => {
    throw new TypeError("fetch failed");
  };
  const lost = await requestAreaEvidence(
    { path: "/api/v1/areas/offline?mode=real", mode: "real", release: REAL_PILOT_RELEASE },
    failingFetch,
    { onConnection: (status) => seen.push(status) },
  );

  assert.equal(lost.status, "connection-lost");
  assert.deepEqual(seen, ["offline"]);

  const summary = getAreaSummary(CRIME_AREA, "crime", "2026-06");
  assert.ok(summary);
  const okFetch: FetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ summary, priceTimeline: [], metricTimeline: [] }),
  });
  const recovered = await requestAreaEvidence(
    { path: areaEvidencePath({ selected: CRIME_AREA, metric: "crime", period: "2026-06", mode: "demo", release: DEMO_RELEASE }), mode: "demo", release: DEMO_RELEASE },
    okFetch,
    { onConnection: (status) => seen.push(status) },
  );

  assert.equal(recovered.status, "available");
  assert.deepEqual(seen, ["offline", "online"]);
});

test("the guarded request path plans unavailable layers without fetching", () => {
  // Every shipped layer is published in the real pilot now, so a synthetic
  // id keeps the guard itself covered for the next unpublished layer.
  const unpublished = "air-quality" as MapLayerId;
  const planned = planEvidenceRequest({
    selected: CRIME_AREA,
    layer: unpublished,
    layerLabel: "Air quality",
    metric: unpublished,
    period: "2026-06",
    mode: "real",
    release: REAL_PILOT_RELEASE,
  });

  assert.equal(planned.kind, "unavailable");
  assert.ok(!("path" in planned));
  if (planned.kind === "unavailable") assert.match(planned.reason, /not published/);
});

test("a saved real release never outlives the release the deployment now serves", () => {
  const saved = { ...DEFAULT_MAP_STATE, mode: "real" as const, release: "official-2026-06" };
  const servedReal = { ...DEFAULT_MAP_STATE, mode: "real" as const, release: "rel-2026-09-london-6m-v1" };
  const demoDefault = { ...DEFAULT_MAP_STATE, mode: "demo" as const, release: "preview-2026-09" };

  assert.deepEqual(adoptSavedState(saved, servedReal), { mode: "real", release: "rel-2026-09-london-6m-v1" });
  assert.deepEqual(adoptSavedState(saved, demoDefault), { mode: "real", release: "official-2026-06" });
  assert.deepEqual(adoptSavedState({ ...saved, mode: "demo", release: "preview-2026-09" }, servedReal),
    { mode: "demo", release: "preview-2026-09" });
});

test("a real deployment ignores /?mode=demo without ?dev=1 and says nothing about it (Going public)", () => {
  assert.equal(urlModeNotice("?mode=demo", false), null);
  assert.equal(urlModeNotice("?mode=real&release=preview-2026-09", false), null);
  assert.match(urlModeNotice("?mode=demo&dev=1", true) ?? "", /conflict/i);
});
