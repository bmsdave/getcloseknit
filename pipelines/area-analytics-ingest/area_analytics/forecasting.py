from dataclasses import dataclass
from datetime import date
from math import exp, log, sqrt
from statistics import fmean
from typing import Mapping, Sequence


MINIMUM_HISTORY_MONTHS = 60
MIN_TRAINING_MONTHS = 24
MIN_PERIOD_ORIGINS = 3
MIN_EVALUATION_COVERAGE = 0.7
OFFERED_HORIZON_MONTHS = (12, 60)
CANDIDATE_MODELS = ("no-change", "damped-trend")


@dataclass(frozen=True)
class ForecastObservation:
    period: str
    value: float


@dataclass(frozen=True)
class HorizonBacktest:
    horizon_months: int
    status: str
    model: str | None
    selection_model: str | None
    selection_samples: int
    calibration_samples: int
    evaluation_samples: int
    model_error: float | None
    no_change_error: float | None
    seasonal_error: float | None
    evaluation_coverage: float | None
    spread: float | None


@dataclass(frozen=True)
class PriceForecast:
    geography_id: str
    horizon_months: int
    status: str
    lower: float | None
    p20: float | None
    median: float | None
    upper: float | None
    conservative_growth_percent: float | None
    base_growth_percent: float | None
    downside_growth_percent: float | None
    upside_growth_percent: float | None
    model: str | None
    backtest_samples: int
    mean_absolute_error: float | None
    baseline_error: float | None
    interval_coverage: float | None
    training_start: str | None
    training_end: str | None
    no_change_error: float | None = None
    evaluation_samples: int = 0
    evaluation_coverage: float | None = None
    source_version: str | None = None
    source_revision: str | None = None


def build_price_forecast(
    geography_id: str,
    observations: Sequence[ForecastObservation],
    horizon_months: int,
    parent_observations: Sequence[ForecastObservation] = (),
    region_observations: Sequence[ForecastObservation] = (),
    source_version: str | None = None,
    source_revision: str | None = None,
) -> PriceForecast:
    ordered = sorted(observations, key=lambda observation: observation.period)
    problem = _check_monthly(ordered)
    if problem is not None:
        return _suppressed(geography_id, horizon_months, problem)
    if len(ordered) < MINIMUM_HISTORY_MONTHS:
        return _suppressed(geography_id, horizon_months, "insufficient-history")
    values = [observation.value for observation in ordered]
    if any(value <= 0 for value in values):
        return _suppressed(geography_id, horizon_months, "failed-backtest")
    backtest = evaluate_horizon(observations, horizon_months, parent_observations, region_observations)
    if backtest.status != "available":
        return _suppressed(
            geography_id, horizon_months, backtest.status,
            backtest.seasonal_error, backtest.no_change_error,
            backtest.evaluation_samples, backtest.evaluation_coverage,
            source_version, source_revision,
        )
    return _available(
        ordered, values, backtest, geography_id, horizon_months,
        parent_observations, region_observations, source_version, source_revision,
    )


def evaluate_horizon(
    observations: Sequence[ForecastObservation],
    horizon_months: int,
    parent_observations: Sequence[ForecastObservation] = (),
    region_observations: Sequence[ForecastObservation] = (),
) -> HorizonBacktest:
    ordered = sorted(observations, key=lambda observation: observation.period)
    problem = _check_monthly(ordered)
    if problem is not None:
        return _unevaluated(horizon_months, problem)
    values = [observation.value for observation in ordered]
    periods = [observation.period for observation in ordered]
    origins = _origins(len(values), horizon_months)
    selection, calibration, evaluation = _split_periods(origins)
    if min(len(selection), len(calibration), len(evaluation)) < MIN_PERIOD_ORIGINS:
        return _unevaluated(horizon_months, "insufficient-evaluation")
    slopes = [_hierarchical_slope(values[:origin + 1], parent_observations, region_observations, periods[origin]) for origin in origins]
    selection_errors = _period_errors(values, horizon_months, slopes, origins, selection)
    model = min(CANDIDATE_MODELS, key=lambda name: selection_errors[name])
    spread = _calibration_spread(values, horizon_months, slopes, origins, calibration, model)
    evaluation_errors = _period_errors(values, horizon_months, slopes, origins, evaluation)
    coverage = _evaluation_coverage(values, horizon_months, slopes, origins, evaluation, model, spread)
    status = _gate(evaluation_errors[model], evaluation_errors["no-change"], evaluation_errors["seasonal-naive"], coverage)
    return HorizonBacktest(
        horizon_months, status, model if status == "available" else None, model,
        len(selection), len(calibration), len(evaluation),
        evaluation_errors[model], evaluation_errors["no-change"], evaluation_errors["seasonal-naive"],
        coverage, spread,
    )


def rolling_forecasts(
    values: Sequence[float],
    horizon_months: int,
    model: str,
    slopes: Sequence[float | None] | None = None,
) -> list[tuple[int, float]]:
    origins = _origins(len(values), horizon_months)
    forecasts = []
    for position, origin in enumerate(origins):
        slope = slopes[position] if slopes is not None else None
        forecasts.append((origin, _predict(values[:origin + 1], horizon_months, model, slope)))
    return forecasts


def build_backtest_report(
    geography_id: str,
    observations: Sequence[ForecastObservation],
    horizons: Sequence[int] = OFFERED_HORIZON_MONTHS,
    parent_observations: Sequence[ForecastObservation] = (),
    region_observations: Sequence[ForecastObservation] = (),
    carriers: Mapping[str, str] | None = None,
    as_of: str | None = None,
    source_version: str | None = None,
    source_revision: str | None = None,
) -> dict:
    return {
        "report_date": as_of or date.today().isoformat(),
        "geography_id": geography_id,
        "carriers": dict(carriers or {}),
        "source_version": source_version,
        "source_revision": source_revision,
        "horizons": {
            horizon: _backtest_entry(evaluate_horizon(observations, horizon, parent_observations, region_observations))
            for horizon in horizons
        },
    }


def _check_monthly(ordered: Sequence[ForecastObservation]) -> str | None:
    periods = [observation.period for observation in ordered]
    if len(set(periods)) != len(periods):
        return "duplicate-periods"
    for previous, current in zip(periods, periods[1:]):
        if _next_month(previous) != current:
            return "non-contiguous-history"
    return None


def _next_month(period: str) -> str:
    year, month = int(period[:4]), int(period[5:7])
    if month == 12:
        return f"{year + 1}-01"
    return f"{year}-{month + 1:02d}"


def _origins(count: int, horizon_months: int) -> list[int]:
    return list(range(MIN_TRAINING_MONTHS - 1, count - horizon_months))


def _split_periods(origins: Sequence[int]) -> tuple[list[int], list[int], list[int]]:
    count = len(origins)
    selection_end = count // 2
    calibration_end = selection_end + (count - selection_end) // 2
    return list(origins[:selection_end]), list(origins[selection_end:calibration_end]), list(origins[calibration_end:])


def _period_errors(values, horizon_months, slopes, origins, period) -> dict[str, float]:
    dated = rolling_forecasts(values, horizon_months, "no-change")
    actual, no_change = _aligned(dated, values, horizon_months, period)
    seasonal = [values[origin - 11] for origin in period]
    damped = [prediction for _, prediction in _damped_for(values, horizon_months, slopes, origins, period)]
    return {
        "no-change": _mean_absolute_error(actual, no_change),
        "damped-trend": _mean_absolute_error(actual, damped),
        "seasonal-naive": _mean_absolute_error(actual, seasonal),
    }


def _aligned(dated, values, horizon_months, period) -> tuple[list[float], list[float]]:
    wanted = set(period)
    actual, predicted = [], []
    for origin, estimate in dated:
        if origin in wanted:
            actual.append(values[origin + horizon_months])
            predicted.append(estimate)
    return actual, predicted


def _damped_for(values, horizon_months, slopes, origins, period) -> list[tuple[int, float]]:
    wanted = set(period)
    return [
        (origin, _predict(values[:origin + 1], horizon_months, "damped-trend", slopes[position]))
        for position, origin in enumerate(origins)
        if origin in wanted
    ]


def _calibration_spread(values, horizon_months, slopes, origins, calibration, model) -> float:
    if model == "no-change":
        dated = rolling_forecasts(values, horizon_months, model)
        actual, predicted = _aligned(dated, values, horizon_months, calibration)
    else:
        dated = _damped_for(values, horizon_months, slopes, origins, calibration)
        actual, predicted = [], []
        for origin, estimate in dated:
            actual.append(values[origin + horizon_months])
            predicted.append(estimate)
    residuals = [observed - estimate for observed, estimate in zip(actual, predicted, strict=True)]
    return _percentile(residuals, 0.9)


def _evaluation_coverage(values, horizon_months, slopes, origins, evaluation, model, spread) -> float:
    width_factor = sqrt(max(1, horizon_months / 12))
    if model == "no-change":
        dated = rolling_forecasts(values, horizon_months, model)
        scored = [(origin, estimate) for origin, estimate in dated if origin in set(evaluation)]
    else:
        scored = _damped_for(values, horizon_months, slopes, origins, evaluation)
    hits = 0
    for origin, estimate in scored:
        width = max(spread, estimate * 0.01) * width_factor
        if abs(values[origin + horizon_months] - estimate) <= width:
            hits += 1
    return hits / len(scored) if scored else 0


def _gate(model_error: float, no_change_error: float, seasonal_error: float, coverage: float) -> str:
    if model_error >= no_change_error or model_error >= seasonal_error:
        return "failed-backtest"
    if coverage < MIN_EVALUATION_COVERAGE:
        return "under-covered-intervals"
    return "available"


def _available(ordered, values, backtest, geography_id, horizon_months, parent, region, source_version, source_revision) -> PriceForecast:
    slope = _hierarchical_slope(values, parent, region, ordered[-1].period)
    middle = _predict(values, horizon_months, backtest.model or "no-change", slope)
    spread = max(backtest.spread or 0, middle * 0.01) * sqrt(max(1, horizon_months / 12))
    p10 = max(0, middle - spread)
    p20 = max(0, middle - spread * 0.66)
    p90 = middle + spread
    current = values[-1]
    return PriceForecast(
        geography_id, horizon_months, "available", p10, p20, middle, p90,
        _growth(p20, current), _growth(middle, current), _growth(p10, current),
        _growth(p90, current), backtest.model,
        backtest.selection_samples + backtest.calibration_samples + backtest.evaluation_samples,
        backtest.model_error, backtest.seasonal_error, backtest.evaluation_coverage,
        ordered[0].period, ordered[-1].period, backtest.no_change_error,
        backtest.evaluation_samples, backtest.evaluation_coverage,
        source_version, source_revision,
    )


def _unevaluated(horizon_months: int, status: str) -> HorizonBacktest:
    return HorizonBacktest(
        horizon_months, status, None, None, 0, 0, 0,
        None, None, None, None, None,
    )


def _backtest_entry(backtest: HorizonBacktest) -> dict:
    return {
        "status": backtest.status,
        "selection_model": backtest.selection_model,
        "model": backtest.model,
        "selection_samples": backtest.selection_samples,
        "calibration_samples": backtest.calibration_samples,
        "evaluation_samples": backtest.evaluation_samples,
        "model_error": backtest.model_error,
        "no_change_error": backtest.no_change_error,
        "seasonal_error": backtest.seasonal_error,
        "evaluation_coverage": backtest.evaluation_coverage,
        "spread": backtest.spread,
    }


def _predict(
    values: Sequence[float], horizon_months: int, model: str,
    trend_slope: float | None = None,
) -> float:
    if model == "no-change":
        return values[-1]
    recent_logs = [log(value) for value in values[-24:]]
    slope = trend_slope if trend_slope is not None else _linear_slope(recent_logs)
    damped_months = sum(0.95**month for month in range(horizon_months))
    return exp(recent_logs[-1] + slope * damped_months)


def _hierarchical_slope(
    local_values: Sequence[float],
    parent: Sequence[ForecastObservation],
    region: Sequence[ForecastObservation],
    training_end: str,
) -> float:
    # Trend weights: the area 0.6, its parent carrier 0.25, its region 0.15 (London's own
    # series for London areas, so London forecasts do not change).
    weighted = [(_linear_slope([log(value) for value in local_values[-24:]]), 0.6)]
    for observations, weight in ((parent, 0.25), (region, 0.15)):
        values = [item.value for item in sorted(observations, key=lambda item: item.period) if item.period <= training_end]
        if len(values) >= 24 and all(value > 0 for value in values):
            weighted.append((_linear_slope([log(value) for value in values[-24:]]), weight))
    total_weight = sum(weight for _, weight in weighted)
    return sum(slope * weight for slope, weight in weighted) / total_weight


def _linear_slope(values: Sequence[float]) -> float:
    centre = (len(values) - 1) / 2
    mean_value = fmean(values)
    numerator = sum((index - centre) * (value - mean_value) for index, value in enumerate(values))
    denominator = sum((index - centre) ** 2 for index in range(len(values)))
    return numerator / denominator if denominator else 0


def _mean_absolute_error(actual: Sequence[float], predicted: Sequence[float]) -> float:
    return fmean(abs(observed - estimate) for observed, estimate in zip(actual, predicted, strict=True))


def _percentile(values: Sequence[float], percentile: float) -> float:
    ordered = sorted(abs(value) for value in values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * percentile))]


def _growth(value: float, current: float) -> float:
    return (value / current - 1) * 100


def _suppressed(
    geography_id: str,
    horizon_months: int,
    status: str,
    baseline_error: float | None = None,
    no_change_error: float | None = None,
    evaluation_samples: int = 0,
    evaluation_coverage: float | None = None,
    source_version: str | None = None,
    source_revision: str | None = None,
) -> PriceForecast:
    return PriceForecast(
        geography_id, horizon_months, status, None, None, None, None,
        None, None, None, None, None, 0, None, baseline_error, None, None, None,
        no_change_error, evaluation_samples, evaluation_coverage,
        source_version, source_revision,
    )
