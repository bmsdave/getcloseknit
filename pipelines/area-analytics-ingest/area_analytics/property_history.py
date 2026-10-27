from dataclasses import dataclass


@dataclass(frozen=True)
class HistoricalPriceComparison:
    nominal_price: int
    inflation_adjusted_price: int
    local_market_adjusted_price: int | None


@dataclass(frozen=True)
class SeparatedHistoryPoint:
    nominal: float | None
    inflation_adjusted: int | None
    market_adjusted: int | None


def compare_historical_price(
    nominal_price: int,
    cpih_at_sale: float,
    cpih_latest: float,
    local_price_per_square_metre_at_sale: float | None,
    local_price_per_square_metre_latest: float | None,
) -> HistoricalPriceComparison:
    if cpih_at_sale <= 0 or cpih_latest <= 0:
        raise ValueError("CPIH values must be positive")
    inflation_adjusted = adjust_by_index(
        nominal_price, cpih_at_sale, cpih_latest)
    market_adjusted = _market_adjusted(
        nominal_price,
        local_price_per_square_metre_at_sale,
        local_price_per_square_metre_latest,
    )
    return HistoricalPriceComparison(nominal_price, inflation_adjusted, market_adjusted)


def separated_history_point(
    nominal: float | None,
    cpih_at_sale: float | None,
    cpih_latest: float | None,
    local_at_sale: float | None,
    local_latest: float | None,
) -> SeparatedHistoryPoint:
    return SeparatedHistoryPoint(
        nominal,
        _optional_adjusted(nominal, cpih_at_sale, cpih_latest),
        _optional_adjusted(nominal, local_at_sale, local_latest),
    )


def adjust_by_index(nominal: float, at_sale: float, latest: float) -> int:
    return round(nominal * latest / at_sale)


def price_per_square_metre(price: int, floor_area_sqm: float | None) -> float | None:
    if floor_area_sqm is None or floor_area_sqm <= 0:
        return None
    return price / floor_area_sqm


def _optional_adjusted(nominal, at_sale, latest) -> int | None:
    if nominal is None or at_sale is None or latest is None:
        return None
    if at_sale <= 0 or latest <= 0:
        return None
    return adjust_by_index(nominal, at_sale, latest)


def _market_adjusted(
    nominal_price: int, at_sale: float | None, latest: float | None
) -> int | None:
    if at_sale is None or latest is None or at_sale <= 0:
        return None
    return adjust_by_index(nominal_price, at_sale, latest)
