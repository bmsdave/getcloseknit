"""Area price bands for a home's page: "Prices in this area today" (migration 040).

The site never states what one home is worth. It shows, for the home's
property type and area:

- the range most sales fall in today (the middle half, 25th-75th percentile,
  of standard sales since 1 January three years back, each adjusted to the
  latest index month by its LSOA price index), with sample size and period;
- the coarse band its last recorded sale fell in against same-type sales in
  the same area that year ("top 10%" ... "bottom 10%"), never a percentile;
- the bridge, worded about the area: today's prices of that same band.

Safety rules: a range needs at least MIN_SALES same-type sales, a position at
least MIN_SALES sales in its year's area set; otherwise neither is shown. The
geography is the first of LSOA, MSOA, borough with ENOUGH_SALES (else the
largest with MIN_SALES). Every amount is rounded to ROUND_TO pounds.
Nothing here reads a floor area.
"""
from __future__ import annotations

from typing import Any, Mapping, Sequence

MIN_SALES = 5
ENOUGH_SALES = 20
ROUND_TO = 5_000
LEVELS = ("lsoa", "msoa", "borough")
QUANTILES = ("p10", "p25", "p50", "p75", "p90")

# Coarse positions, low to high: (id, words, lower quantile, upper quantile).
BANDS = (
    ("bottom-10", "bottom 10%", None, "p10"),
    ("bottom-quarter", "bottom quarter", "p10", "p25"),
    ("lower-middle", "lower middle", "p25", "p50"),
    ("upper-middle", "upper middle", "p50", "p75"),
    ("top-quarter", "top quarter", "p75", "p90"),
    ("top-10", "top 10%", "p90", None),
)
BAND_WORDS = {band: words for band, words, _, _ in BANDS}

TYPE_LABELS = {"F": "Flat or maisonette", "T": "Terraced", "S": "Semi-detached", "D": "Detached"}
AREA_DISCLAIMER = ("About this area's sales, not a valuation of this home. "
                   "It can't see condition or improvements.")
NOT_ENOUGH = "Not enough sales of this type nearby to show a range."


def round_price(value: float | None) -> int | None:
    """Pounds rounded to the nearest £5,000 (never below £5,000); None stays None."""
    if value is None:
        return None
    return max(ROUND_TO, int(float(value) / ROUND_TO + 0.5) * ROUND_TO)  # half up, not banker's


def pick_level(sales_by_level: Mapping[str, int | None]) -> str | None:
    """The first level (LSOA, MSOA, borough) with ENOUGH_SALES; else the largest with
    MIN_SALES; else None (too few anywhere: show nothing)."""
    present = [level for level in LEVELS if sales_by_level.get(level)]
    for level in present:
        if sales_by_level[level] >= ENOUGH_SALES:
            return level
    for level in reversed(present):
        if sales_by_level[level] >= MIN_SALES:
            return level
    return None


def position_band(price: float, quantiles: Mapping[str, float]) -> str:
    """The coarse band of `price` against a year's quantiles. A price exactly on a
    boundary belongs to the band above it (p90 itself is "top 10%")."""
    for band, _, lower, upper in reversed(BANDS):
        if lower is None or price >= quantiles[lower]:
            return band
    return BANDS[0][0]  # pragma: no cover - the loop always returns


def bridge(band: str, quantiles: Mapping[str, float]) -> dict:
    """Today's prices of one band, rounded: {"from", "to"}; open at the ends
    (the top 10% has no upper bound, the bottom 10% no lower one)."""
    _, _, lower, upper = next(b for b in BANDS if b[0] == band)
    return {"from": round_price(quantiles[lower]) if lower else None,
            "to": round_price(quantiles[upper]) if upper else None}


def _range(row: Mapping[str, Any], level: str, area: Mapping[str, Any]) -> dict:
    return {
        "level": level, "areaId": area["id"], "areaName": area.get("displayName") or area.get("name"),
        "sales": int(row["sales"]), "since": row["window_start"], "adjustedTo": row["period"],
        **{key: round_price(row[key]) for key in QUANTILES},
    }


def area_prices(type_code: str | None, areas: Sequence[tuple[str, Mapping[str, Any]]],
                bands: Mapping[str, Mapping[str, Any]], years: Mapping[str, Mapping[str, Any]],
                last_sale: Mapping[str, Any] | None) -> dict:
    """The card's payload.

    type_code: the home's Price Paid type (F/T/S/D; anything else has no range).
    areas: [(level, {"id", "name"})] from LSOA up to borough.
    bands: today's adjusted quantiles by geography id (this type only).
    years: the last sale's year quantiles by geography id (this type only).
    last_sale: {"date", "price", "standard"} of the home's last recorded sale, or None.
    """
    base = {"propertyType": TYPE_LABELS.get(type_code or ""), "minimumSales": MIN_SALES,
            "range": None, "position": None, "note": NOT_ENOUGH, "disclaimer": AREA_DISCLAIMER}
    if type_code not in TYPE_LABELS:
        return base
    by_level = {level: area for level, area in areas if area and area.get("id")}

    def sales(table: Mapping[str, Mapping[str, Any]], level: str) -> int:
        row = table.get(by_level[level]["id"]) if level in by_level else None
        return int(row["sales"]) if row else 0

    range_level = pick_level({level: sales(bands, level) for level in by_level})
    if range_level is None:
        return base
    standard = bool(last_sale and last_sale.get("standard") and last_sale.get("price"))
    # One geography for range, position and bridge: the first level from the range's up
    # whose range has ENOUGH_SALES (or is the range's own) and whose year set has MIN_SALES.
    position_level = None
    if standard:
        start = LEVELS.index(range_level)
        for level in LEVELS[start:]:
            if level in by_level and sales(years, level) >= MIN_SALES and (
                    level == range_level or sales(bands, level) >= ENOUGH_SALES):
                position_level = level
                break
    level = position_level or range_level
    area = by_level[level]
    payload = {**base, "note": None, "range": _range(bands[area["id"]], level, area)}
    if position_level is not None:
        year_row = years[area["id"]]
        band = position_band(float(last_sale["price"]), year_row)
        payload["position"] = {
            "saleDate": last_sale["date"], "year": int(last_sale["date"][:4]),
            "band": band, "bandWords": BAND_WORDS[band], "yearSales": int(year_row["sales"]),
            "today": bridge(band, bands[area["id"]]),
        }
    return payload
