"""Rolling 12-month median achieved price per m², with carrier fallback.

Which sales count (the same gates UKHPI and the stock value use):
  * PPD category A only — category B (repossessions, buy-to-let mortgages,
    company and other non-standard transfers) is excluded;
  * property type D/S/T/F — "O" (other) is excluded;
  * floor area 15–1,000 m², price at least £20,000, £500–£40,000 per m².
An LSOA with at least 20 qualifying sales in the window is observed; otherwise
it shows its MSOA median, then its borough's (quality "fallback").
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections.abc import Mapping
from statistics import median

import crime_rates as cr

MINIMUM_SAMPLE = 20
WINDOW_MONTHS = 12


def qualifies(category: str, property_type: str, price: int, floor: float | None) -> bool:
    if category != "A" or property_type == "O" or not floor:
        return False
    if not 15 <= floor <= 1000 or price < 20_000:
        return False
    return 500 <= price / floor <= 40_000


def month_index(month: str) -> int:
    year, mon = (int(part) for part in month[:7].split("-"))
    return year * 12 + mon - 1


def index_month(index: int) -> str:
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


class Series:
    """Sales of one area sorted by month, for repeated window medians."""

    def __init__(self, sales: list[tuple[int, float]]):
        sales.sort()
        self.months = [m for m, _ in sales]
        self.values = [v for _, v in sales]

    def window(self, end: int) -> list[float]:
        lo = bisect_left(self.months, end - WINDOW_MONTHS + 1)
        hi = bisect_right(self.months, end)
        return self.values[lo:hi]


def carrier_value(own: list[float], parents: list[tuple[str, list[float]]]
                  ) -> tuple[float | None, int, str, str | None, int | None]:
    """(value, own sample count, quality, carrier id, carrier sample count) for one area and period.

    The carrier is the area the value actually comes from (#163): None for observed rows (the
    value is the area's own), the MSOA or borough id for fallback rows.
    """
    if len(own) >= MINIMUM_SAMPLE:
        return round(median(own), 2), len(own), "observed", None, None
    for carrier_id, sample in parents:
        if len(sample) >= MINIMUM_SAMPLE:
            return round(median(sample), 2), len(own), "fallback", carrier_id, len(sample)
    return None, len(own), "suppressed", None, None


def ascending_percentiles(values: Mapping[str, float | None]) -> dict[str, int]:
    """London percentile of £/m² (0 = cheapest); tied values share one (crime_rates, issue #221)."""
    return cr.ascending_percentiles(values)
