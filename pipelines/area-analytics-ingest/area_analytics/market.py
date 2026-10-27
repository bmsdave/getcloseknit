"""Local market by property type (HM Land Registry Price Paid, category A).

One row per area (LSOA, MSOA, borough), property type (the five Price Paid
types plus "all") and 12-month window. The latest window ends at the newest
sale month; ten earlier windows step back a year each, so the newest point of
the 10-year trend is the headline figure and every point covers 12 months.

Rules, applied here so the API only reads:
- standard sales only (PPD category A) of at least MIN_PRICE;
- a median, minimum and maximum need MIN_MEDIAN_SALES sales; percentiles
  (P5/P25/P75/P95) need MIN_PERCENTILE_SALES; a £/m² median needs
  MIN_MEDIAN_SALES sales with a plausible EPC floor area. Below that the
  value is None ("unknown"), never 0.
Percentiles interpolate linearly between ranks, like Postgres
percentile_cont, so the two never disagree.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, Mapping

PROPERTY_TYPES = ("D", "S", "T", "F", "O")
ALL_TYPES = "all"
WINDOWS = 11  # the latest 12 months and the ten 12-month windows before it
MIN_PRICE = 10_000
MIN_MEDIAN_SALES = 3
MIN_PERCENTILE_SALES = 5
QUANTILES = (0.05, 0.25, 0.5, 0.75, 0.95)


@dataclass(frozen=True)
class Sale:
    lsoa: str
    month: date  # first day of the completion month
    price: int
    property_type: str
    price_per_square_metre: float | None
    ppd_category: str = "A"


@dataclass(frozen=True)
class MarketRow:
    geography_id: str
    property_type: str
    window_end: date
    sales: int
    median_price: int | None
    p5: int | None
    p25: int | None
    p75: int | None
    p95: int | None
    min_price: int | None
    max_price: int | None
    ppm_sales: int
    median_ppm: float | None


def percentile(ordered: list[float], q: float) -> float:
    """Linear interpolation between ranks (percentile_cont); ``ordered`` sorted, non-empty."""
    if not ordered:
        raise ValueError("percentile of no values")
    position = q * (len(ordered) - 1)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def months_back(month: date, latest: date) -> int:
    return (latest.year - month.year) * 12 + latest.month - month.month


def window_index(month: date, latest: date) -> int | None:
    """0 for the latest 12 months, 1 for the 12 before them, ... None outside."""
    back = months_back(month, latest)
    if back < 0 or back >= WINDOWS * 12:
        return None
    return back // 12


def window_end(latest: date, index: int) -> date:
    return date(latest.year - index, latest.month, 1)


def counts(sale: Sale) -> bool:
    return (sale.ppd_category == "A" and sale.price >= MIN_PRICE
            and sale.property_type in PROPERTY_TYPES)


def summarise(geography_id: str, property_type: str, end: date,
              prices: list[int], ppms: list[float]) -> MarketRow:
    prices = sorted(prices)
    ppms = sorted(ppms)
    n = len(prices)
    has_median = n >= MIN_MEDIAN_SALES
    has_spread = n >= MIN_PERCENTILE_SALES
    p5, p25, p50, p75, p95 = (round(percentile(prices, q)) if prices else None for q in QUANTILES)
    return MarketRow(
        geography_id=geography_id, property_type=property_type, window_end=end, sales=n,
        median_price=p50 if has_median else None,
        p5=p5 if has_spread else None, p25=p25 if has_spread else None,
        p75=p75 if has_spread else None, p95=p95 if has_spread else None,
        min_price=prices[0] if has_median else None, max_price=prices[-1] if has_median else None,
        ppm_sales=len(ppms),
        median_ppm=round(percentile(ppms, 0.5), 2) if len(ppms) >= MIN_MEDIAN_SALES else None,
    )


def aggregate(sales: Iterable[Sale], parents: Mapping[str, tuple[str, ...]],
              latest: date) -> list[MarketRow]:
    """Rows for every LSOA and its ``parents`` (MSOA, borough) with sales in
    any window. Types with no sales in a window get no row: absent, not 0."""
    groups: dict[tuple[str, str, int], tuple[list[int], list[float]]] = {}
    for sale in sales:
        if not counts(sale):
            continue
        index = window_index(sale.month, latest)
        if index is None:
            continue
        for geography in (sale.lsoa, *parents.get(sale.lsoa, ())):
            for kind in (sale.property_type, ALL_TYPES):
                prices, ppms = groups.setdefault((geography, kind, index), ([], []))
                prices.append(sale.price)
                if sale.price_per_square_metre is not None:
                    ppms.append(sale.price_per_square_metre)
    return [summarise(geography, kind, window_end(latest, index), prices, ppms)
            for (geography, kind, index), (prices, ppms) in sorted(groups.items())]
