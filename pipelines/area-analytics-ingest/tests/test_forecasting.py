import unittest

from area_analytics.forecasting import (
    ForecastObservation,
    build_backtest_report,
    build_price_forecast,
    evaluate_horizon,
    rolling_forecasts,
)


class ForecastingTests(unittest.TestCase):
    def test_sparse_history_is_suppressed_instead_of_extrapolated(self):
        observations = [ForecastObservation(f"2026-{month:02d}", 5_000 + month * 10) for month in range(1, 13)]

        forecast = build_price_forecast("uk:msoa:E02000001", observations, horizon_months=12)

        self.assertEqual(forecast.status, "insufficient-history")
        self.assertIsNone(forecast.median)

    def test_supported_forecast_returns_ordered_ranges_and_backtest_metadata(self):
        observations = monthly_growth_series(72, 4_000, 18)

        forecast = build_price_forecast("uk:msoa:E02000001", observations, horizon_months=12)

        self.assertEqual(forecast.status, "available")
        self.assertLess(forecast.lower, forecast.median)
        self.assertLess(forecast.median, forecast.upper)
        self.assertGreater(forecast.backtest_samples, 0)
        self.assertIn(forecast.model, {"no-change", "damped-trend"})
        self.assertLess(forecast.lower, forecast.p20)
        self.assertLess(forecast.p20, forecast.median)
        self.assertGreaterEqual(forecast.interval_coverage, 0.7)
        self.assertEqual(forecast.training_start, "2020-01")
        self.assertEqual(forecast.training_end, "2025-12")
        self.assertLessEqual(forecast.conservative_growth_percent, forecast.base_growth_percent)

    def test_model_is_suppressed_when_it_does_not_beat_seasonal_naive(self):
        observations = monthly_seasonal_series(72, 4_000)

        forecast = build_price_forecast("uk:msoa:E02000001", observations, horizon_months=12)

        self.assertEqual(forecast.status, "failed-backtest")
        self.assertIsNone(forecast.median)

    def test_local_trend_is_shrunk_toward_parent_and_london_trends(self):
        local = monthly_growth_series(144, 4_000, 35)
        parent = monthly_growth_series(144, 4_000, 8)
        london = monthly_growth_series(144, 4_000, 5)

        local_only = build_price_forecast("uk:lsoa:E01000001", local, 60)
        shrunk = build_price_forecast(
            "uk:lsoa:E01000001", local, 60,
            parent_observations=parent, region_observations=london,
        )

        self.assertEqual(shrunk.status, "available")
        self.assertLess(shrunk.median, local_only.median)


class ForecastValidationTests(unittest.TestCase):
    def test_duplicated_periods_are_rejected_before_any_forecast(self):
        observations = monthly_growth_series(72, 4_000, 18)
        observations = observations + [observations[10]]

        forecast = build_price_forecast("uk:msoa:E02000001", observations, horizon_months=12)

        self.assertEqual(forecast.status, "duplicate-periods")
        self.assertIsNone(forecast.median)

    def test_missing_months_are_rejected_before_any_forecast(self):
        observations = [item for index, item in enumerate(monthly_growth_series(72, 4_000, 18)) if index != 30]

        forecast = build_price_forecast("uk:msoa:E02000001", observations, horizon_months=12)

        self.assertEqual(forecast.status, "non-contiguous-history")
        self.assertIsNone(forecast.median)

    def test_rolling_forecasts_use_only_past_observations(self):
        values = [item.value for item in monthly_growth_series(72, 4_000, 18)]

        full = rolling_forecasts(values, 12, "damped-trend")
        truncated = rolling_forecasts(values[:60], 12, "damped-trend")

        self.assertGreater(len(truncated), 0)
        for (late_origin, _), (early_origin, early_prediction) in zip(full, truncated):
            self.assertEqual(late_origin, early_origin)
        for (_, late_prediction), (_, early_prediction) in zip(full, truncated):
            self.assertEqual(late_prediction, early_prediction)

    def test_future_carrier_observations_do_not_leak_into_the_forecast(self):
        local = monthly_growth_series(72, 4_000, 18)
        parent = monthly_growth_series(72, 4_000, 8)
        future_parent = parent + [ForecastObservation("2030-01", 99_000_000.0)]

        without_future = build_price_forecast("uk:lsoa:E01000001", local, 12, parent_observations=parent)
        with_future = build_price_forecast("uk:lsoa:E01000001", local, 12, parent_observations=future_parent)

        self.assertEqual(with_future, without_future)

    def test_strong_short_horizon_model_must_pass_the_displayed_longer_horizon(self):
        observations = trend_break_series()

        short = build_price_forecast("uk:msoa:E02000001", observations, horizon_months=1)
        displayed = build_price_forecast("uk:msoa:E02000001", observations, horizon_months=12)
        report = build_backtest_report("uk:msoa:E02000001", observations, horizons=(1, 12), as_of="2026-09-06")

        self.assertEqual(short.status, "available")
        self.assertEqual(displayed.status, "failed-backtest")
        self.assertIsNone(displayed.median)
        self.assertEqual(report["horizons"][1]["selection_model"], "damped-trend")
        self.assertEqual(report["horizons"][12]["selection_model"], "damped-trend")
        self.assertEqual(report["horizons"][12]["status"], "failed-backtest")

    def test_under_covered_intervals_fail_the_gate(self):
        observations = calm_then_volatile_series()

        forecast = build_price_forecast("uk:msoa:E02000001", observations, horizon_months=12)

        self.assertEqual(forecast.status, "under-covered-intervals")
        self.assertIsNone(forecast.median)
        self.assertIsNotNone(forecast.evaluation_coverage)
        self.assertLess(forecast.evaluation_coverage, 0.7)

    def test_long_horizon_without_evaluation_samples_is_suppressed(self):
        observations = monthly_growth_series(72, 4_000, 18)

        forecast = build_price_forecast("uk:msoa:E02000001", observations, horizon_months=60)

        self.assertEqual(forecast.status, "insufficient-evaluation")
        self.assertIsNone(forecast.median)

    def test_source_versions_and_revisions_are_retained(self):
        observations = monthly_growth_series(72, 4_000, 18)

        forecast = build_price_forecast(
            "uk:msoa:E02000001", observations, horizon_months=12,
            source_version="price-2026-06", source_revision="rev-9",
        )

        self.assertEqual(forecast.status, "available")
        self.assertEqual(forecast.source_version, "price-2026-06")
        self.assertEqual(forecast.source_revision, "rev-9")

    def test_dated_backtest_report_is_deterministic_and_names_carriers(self):
        observations = monthly_growth_series(72, 4_000, 18)
        parent = monthly_growth_series(72, 4_000, 8)

        first = build_backtest_report(
            "uk:msoa:E02000001", observations, horizons=(12, 60),
            parent_observations=parent, carriers={"parent": "uk:lad:E09000001"},
            as_of="2026-09-06", source_version="price-2026-06", source_revision="rev-9",
        )
        second = build_backtest_report(
            "uk:msoa:E02000001", observations, horizons=(12, 60),
            parent_observations=parent, carriers={"parent": "uk:lad:E09000001"},
            as_of="2026-09-06", source_version="price-2026-06", source_revision="rev-9",
        )

        self.assertEqual(first, second)
        self.assertEqual(first["report_date"], "2026-09-06")
        self.assertEqual(first["source_version"], "price-2026-06")
        self.assertEqual(first["carriers"], {"parent": "uk:lad:E09000001"})
        self.assertIn("no_change_error", first["horizons"][12])
        self.assertIn("seasonal_error", first["horizons"][12])
        self.assertIn("evaluation_coverage", first["horizons"][12])
        self.assertEqual(first["horizons"][12]["status"], "available")
        self.assertEqual(first["horizons"][60]["status"], "insufficient-evaluation")

    def test_evaluation_gate_compares_both_baselines_at_the_displayed_horizon(self):
        observations = monthly_growth_series(72, 4_000, 18)

        backtest = evaluate_horizon(observations, 12)

        self.assertEqual(backtest.status, "available")
        self.assertLess(backtest.model_error, backtest.no_change_error)
        self.assertLess(backtest.model_error, backtest.seasonal_error)
        self.assertGreaterEqual(backtest.evaluation_coverage, 0.7)


def trend_break_series() -> list[ForecastObservation]:
    observations = []
    for index in range(96):
        year = 2020 + index // 12
        month = index % 12 + 1
        if index < 72:
            value = 4_000 + 18 * index
        else:
            value = 4_000 + 18 * 71 - 30 * (index - 71)
        observations.append(ForecastObservation(f"{year}-{month:02d}", value))
    return observations


def calm_then_volatile_series() -> list[ForecastObservation]:
    observations = []
    for index in range(72):
        year = 2020 + index // 12
        month = index % 12 + 1
        value = 4_000 + 18 * index
        if index >= 62 and index % 2 == 0:
            value += 150
        elif index >= 62:
            value -= 150
        observations.append(ForecastObservation(f"{year}-{month:02d}", value))
    return observations


def monthly_growth_series(count: int, initial: float, increment: float) -> list[ForecastObservation]:
    values = []
    for index in range(count):
        year = 2020 + index // 12
        month = index % 12 + 1
        seasonal = (index % 4 - 1.5) * 4
        values.append(ForecastObservation(f"{year}-{month:02d}", initial + increment * index + seasonal))
    return values


def monthly_seasonal_series(count: int, initial: float) -> list[ForecastObservation]:
    return [
        ForecastObservation(f"{2020 + index // 12}-{index % 12 + 1:02d}", initial + (index % 12) * 20)
        for index in range(count)
    ]


if __name__ == "__main__":
    unittest.main()
