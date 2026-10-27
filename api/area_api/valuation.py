"""A home's indicative model estimate (behind CLOSE_KNIT_PER_HOME_VALUATION) and the
annualised change since its last sale (unflagged: recorded prices and the borough index only).

The borough same-type index (controller ruling R5) is the borough's market-by-type
10-year median trend for the home's type (``market.area_market`` on the borough id):
a sale maps to the point of its year, "now" is the newest point. A type with no
trend, or a point with no median, gives None for the method that needs it.

The estimate is computed only when the flag is on (property_profile, tools); a
hidden home never reaches this module.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Mapping

from . import feature_flags
from .price_bands import round_price as round_value

__all__ = ["annualised_change", "estimate", "round_value", "type_index", "WORDING"]

WORDING = "An indicative model estimate, not a valuation."


def type_index(market: Mapping[str, Any] | None, type_code: str | None) -> Mapping[str, Any] | None:
    """The trend series of one property type in an area_market payload, or None."""
    for series in (market or {}).get("trend") or ():
        if series.get("propertyType") == type_code:
            return series
    return None


def _point(index: Mapping[str, Any] | None, year: int | None = None) -> tuple[int, float] | None:
    """(year, median) of the point for `year`, or of the newest point; None without a median."""
    points = (index or {}).get("points") or []
    if not points:
        return None
    point = points[-1] if year is None else next(
        (p for p in points if int(p["windowEnd"][:4]) == year), None)
    if point is None or not point.get("medianPrice"):
        return None
    return int(point["windowEnd"][:4]), float(point["medianPrice"])


def _yearly(start: float, end: float, years: float) -> float | None:
    """Compound yearly % change, one decimal; None under a year."""
    if years < 1 or start <= 0 or end <= 0:
        return None
    return round(((end / start) ** (1 / years) - 1) * 100, 1)


def _year(day: str) -> int:
    return int(day[:4])


def annualised_change(last_sale: Mapping[str, Any] | None,
                      borough_type_index: Mapping[str, Any] | None) -> dict | None:
    """Yearly % change of the home and of the borough's same type, from `since` to `until`.

    last_sale: {"date", "price", "standard", "previous": {"date", "price", "standard"} | None}.
    Only standard sales (Price Paid category A) count. With an earlier sale, both cover
    the same span (previous sale → last sale) and the home's figure compares its own
    two recorded prices. With a single sale only the borough's change since it is
    given (to the newest point): the home has no figure today.
    """
    if not last_sale or not _standard(last_sale):
        return None
    previous = last_sale.get("previous")
    if previous and _standard(previous):
        days = (date.fromisoformat(last_sale["date"][:10]) - date.fromisoformat(previous["date"][:10])).days
        home = _yearly(float(previous["price"]), float(last_sale["price"]), days / 365.25)
        start, end = _point(borough_type_index, _year(previous["date"])), _point(borough_type_index,
                                                                                 _year(last_sale["date"]))
        since, until = _year(previous["date"]), _year(last_sale["date"])
    else:
        home = None
        start, end = _point(borough_type_index, _year(last_sale["date"])), _point(borough_type_index)
        since, until = _year(last_sale["date"]), end[0] if end else None
    borough = _yearly(start[1], end[1], end[0] - start[0]) if start and end else None
    if home is None and borough is None:
        return None
    return {"home": home, "borough": borough, "since": since, "until": until}


def _standard(sale: Mapping[str, Any]) -> bool:
    """A standard market sale (category A); a sale without the field counts as one."""
    return sale.get("standard", True) is not False


def _percent(value: float, reference: float | None) -> float | None:
    return round((value / reference - 1) * 100, 1) if reference else None


def estimate(home: Mapping[str, Any], area_type_market: Mapping[str, Any] | None,
             borough_type_index: Mapping[str, Any] | None) -> dict | None:
    """An indicative model estimate with a range, or None when neither method has inputs.

    home: {"floorAreaSquareMetres", "lastSale": {"date", "price", "standard"} | None}; only a
      standard sale (category A) is indexed.
    area_type_market: the local same-type sales {"medianPrice", "p25", "p75",
      "medianPricePerSquareMetre", "p25PricePerSquareMetre", "p75PricePerSquareMetre"}.
    borough_type_index: the borough's same-type trend series (see the module doc).
    """
    local = area_type_market or {}
    median = local.get("medianPrice")
    if not median:
        return None
    floor = home.get("floorAreaSquareMetres") if feature_flags.epc_per_home() else None
    per_m2 = [local.get(f"{q}PricePerSquareMetre") for q in ("median", "p25", "p75")]
    # The home's own £/m², independent of the estimate: its last standard sale
    # indexed to today by the borough same-type trend (B14). Comparing the estimate
    # itself with the median it was built from could only show the £5k rounding.
    sale = home.get("lastSale")
    sale = sale if sale and _standard(sale) else None
    at_sale = _point(borough_type_index, _year(sale["date"])) if sale else None
    now = _point(borough_type_index)
    indexed = float(sale["price"]) * now[1] / at_sale[1] if sale and at_sale and now else None
    if floor and all(per_m2):
        raw, low, high = (float(floor) * float(ppm) for ppm in per_m2)
        method = "floor-area"
    else:
        if not (at_sale and now and local.get("p25") and local.get("p75")):
            return None
        raw = indexed
        low, high = raw * float(local["p25"]) / float(median), raw * float(local["p75"]) / float(median)
        method = "indexed-sale"
    value = round_value(raw)
    home_per_m2 = indexed / float(floor) if indexed and floor else None
    return {
        "value": value, "low": round_value(low), "high": round_value(high), "method": method,
        "vsLocalMedianPerSqm": _percent(home_per_m2, per_m2[0]) if home_per_m2 and per_m2[0] else None,
        "vsLocalTypeMedian": _percent(value, float(median)),
    }
