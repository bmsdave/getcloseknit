import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId } from "../src/lib/contracts";
import {
  isForecastHorizonValidated,
  unvalidatedForecast,
  VALIDATED_FORECAST_HORIZONS,
} from "../src/lib/fixtures";
import { buildMatchPack } from "../src/lib/matching";
import { weightedProfile } from "./weighted-profile";

const AREA: GeographyId = "uk:lsoa:E01000001";

test("no forecast horizon has passed predeclared validation yet", () => {
  assert.deepEqual([...VALIDATED_FORECAST_HORIZONS], []);
  assert.equal(isForecastHorizonValidated("1y"), false);
  assert.equal(isForecastHorizonValidated("5y"), false);
});

test("unvalidated horizons publish a failed gate instead of a fixture forecast", () => {
  for (const horizon of ["1y", "5y"] as const) {
    const forecast = unvalidatedForecast(AREA, horizon, "preview-2026-09");

    assert.equal(forecast.schemaVersion, "price-forecast.v1");
    assert.equal(forecast.horizon, horizon);
    assert.equal(forecast.status, "failed-backtest");
    assert.equal(forecast.range, null);
    assert.equal(forecast.scenarios, null);
    assert.equal(forecast.backtest, null);
    assert.match(forecast.suppressionReason ?? "", /validation/);
    assert.equal(forecast.sourceVersion, "preview-2026-09");
  }
});

test("unsupported growth contributes nothing to matches at any horizon", () => {
  for (const forecastHorizon of ["1y", "5y"] as const) {
    const profile = weightedProfile();
    profile.forecastHorizon = forecastHorizon;
    profile.factors.find((factor) => factor.factorId === "growth-outlook")!.weight = 5;

    const pack = buildMatchPack(profile);

    assert.deepEqual(pack.values.map((value) => value.rank), [1, 2, 3]);
    assert.ok(pack.values.every(
      (value) => !value.components.some((part) => part.factorId === "growth-outlook"),
    ));
  }
});

test("matching stays optional on growth: profiles without it still rank", () => {
  const profile = weightedProfile();
  profile.factors = profile.factors.filter((factor) => factor.factorId !== "growth-outlook");

  const pack = buildMatchPack(profile);

  assert.deepEqual(pack.values.map((value) => value.rank), [1, 2, 3]);
});
