"""Stock value of one dwelling: its last achieved £/m² restated by the change
in its area's rolling median £/m² since the sale (AE property map).

This is the existing local-market adjustment (`adjust_by_index`) applied per
dwelling, with a confidence band that only depends on how old the sale is and
how coarse the index carrier had to be. It is a restated sale, never a
valuation: no condition, layout or tenure information enters the number.
"""
from dataclasses import dataclass

from .property_history import adjust_by_index

HIGH_MAX_YEARS = 3
MEDIUM_MAX_YEARS = 8
CARRIER_RANK = {"lsoa": 0, "msoa": 1, "borough": 2}


@dataclass(frozen=True)
class StockValue:
    price_per_square_metre: float
    value: int
    ratio: float
    confidence: str
    index_carrier: str
    sale_period: str
    latest_period: str


def index_period_for(sale_period: str, first_index_period: str) -> str:
    """Sales older than the index are anchored to its first period."""
    return sale_period if sale_period >= first_index_period else first_index_period


def confidence_band(sale_period: str, latest_period: str, index_carrier: str) -> str:
    years = _years_between(sale_period, latest_period)
    rank = CARRIER_RANK.get(index_carrier, 2)
    if years <= HIGH_MAX_YEARS and rank == 0:
        return "high"
    if years <= MEDIUM_MAX_YEARS and rank <= 1:
        return "medium"
    return "low"


def restate_stock_value(
    *, nominal_price: int, floor_area_sqm: float | None, sale_period: str,
    index_at_sale: float | None, index_latest: float | None, index_carrier: str,
    latest_period: str,
) -> StockValue | None:
    if floor_area_sqm is None or floor_area_sqm <= 0:
        return None
    if index_at_sale is None or index_latest is None or index_at_sale <= 0 or index_latest <= 0:
        return None
    value = adjust_by_index(nominal_price, index_at_sale, index_latest)
    return StockValue(
        price_per_square_metre=round(value / floor_area_sqm, 2),
        value=value,
        ratio=round(index_latest / index_at_sale, 4),
        confidence=confidence_band(sale_period, latest_period, index_carrier),
        index_carrier=index_carrier,
        sale_period=sale_period,
        latest_period=latest_period,
    )


def _years_between(earlier: str, later: str) -> float:
    (y1, m1), (y2, m2) = (int(p) for p in earlier.split("-")), (int(p) for p in later.split("-"))
    return ((y2 - y1) * 12 + (m2 - m1)) / 12
