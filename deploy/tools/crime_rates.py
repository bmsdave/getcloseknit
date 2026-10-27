"""Recorded-crime rates as police.uk and the ONS publish them.

Headline: offences in the 12 months ending a period, per 1,000 residents.
Anti-social behaviour (an incident log, not a recorded crime) never enters the
headline count. Stored factor utility is the ascending value percentile
(high crime -> high utility); the match direction ("lower") applies at query
time, like every other factor.

Pure functions over the per-month JSON written by ziprange.py:
  {"areas": {lsoa: {"n": offences_excl_asb, "asb": asb, "cats": {category: n}}}}
"""
from __future__ import annotations

import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

# The repo's area_api, not an installed copy: the ETL host has none and a venv's may be stale.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "api"))
from area_api.percentiles import competition_percentiles  # noqa: E402

import area_coverage as coverage  # noqa: E402

WINDOW_MONTHS = 12


def month_list(end: str, count: int) -> list[str]:
    """The `count` calendar months ending with `end` (YYYY-MM), oldest first."""
    year, month = (int(part) for part in end.split("-"))
    out = []
    for _ in range(count):
        out.append(f"{year:04d}-{month:02d}")
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return out[::-1]


def window_cell(monthly: Mapping[str, Mapping[str, dict]], window: Iterable[str],
                lsoas: Iterable[str]) -> dict:
    """Sum offences, ASB and categories for `lsoas` over the `window` months."""
    count = asb = 0
    cats: dict[str, int] = {}
    for month in window:
        areas = monthly[month]
        for code in lsoas:
            cell = areas.get(code)
            if not cell:
                continue
            count += cell["n"]
            asb += cell["asb"]
            for category, n in cell["cats"].items():
                cats[category] = cats.get(category, 0) + n
    return {"count": count, "asb": asb, "cats": cats}


def annual_rate(count: int, population: int | None) -> float | None:
    """Offences per 1,000 residents over a 12-month window."""
    if not population:
        return None
    return round(count / population * 1000, 2)


def ascending_percentiles(rates: Mapping[str, float | None],
                          regions: Mapping[str, str] | None = None) -> dict[str, int]:
    """Percentile by rate (0 = lowest, 100 = highest) within each area's region (`regions`: area id ->
    region code; None ranks all together, as London did); areas without a rate get none.
    Tied rates share one percentile (area_api.percentiles, issue #221); every ETL ranks this way."""
    if regions is None:
        return competition_percentiles(rates)
    return coverage.regional_percentiles(rates, regions, competition_percentiles)


def legend_stops(rates: Iterable[float]) -> list[dict]:
    """Quintile legend over LSOA rates, matching the other choropleths."""
    ordered = sorted(rates)
    if not ordered:
        return []
    colours = ("#3a7d44", "#7ba05b", "#f4d35e", "#c96a3b", "#b23a48")
    cuts = [ordered[int(len(ordered) * q)] for q in (0.2, 0.4, 0.6, 0.8)] + [ordered[-1]]
    return [{"value": round(v), "colour": c, "label": f"{round(v)}" + ("+" if i == 4 else "")}
            for i, (v, c) in enumerate(zip(cuts, colours))]


SNAP_GAP_SHARE = 0.1
# An LSOA with this many offences of its own clearly has snap points; only
# near-empty counts are a real snap gap. Twenty offences in 12 months is under
# two a month; a genuine gap (no snap point of its own) shows about zero.
SNAP_GAP_MAX_COUNT = 20


def snap_gap(count: int, population: int | None, parent_rate: float | None) -> bool:
    """True when an LSOA's count is implausibly low for its MSOA.

    police.uk moves every crime to an anonymous "snap point"; an LSOA with no
    snap point of its own receives none of its crimes, which land in its
    neighbours. An LSOA with fewer than SNAP_GAP_MAX_COUNT offences in 12
    months AND under a tenth of the offences the MSOA rate predicts is treated
    as such a gap, and the area falls back to its MSOA rate. An LSOA with
    hundreds of offences of its own keeps its own rate even in a hotspot MSOA,
    where the pooled rate alone would otherwise drag it under the threshold.
    """
    if not population or parent_rate is None:
        return False
    if count >= SNAP_GAP_MAX_COUNT:
        return False
    expected = parent_rate * population / 1000
    return expected >= 20 and count < SNAP_GAP_SHARE * expected


# "Visible disorder" (My match factor `disorder`): what people notice on the street rather
# than thefts. Anti-social behaviour is an incident log, so it stays out of the crime rate
# but is counted here.
DISORDER_CATEGORIES = ("Criminal damage and arson", "Public order")


def disorder_count(cell: Mapping[str, Any]) -> int:
    return cell["asb"] + sum(cell["cats"].get(category, 0) for category in DISORDER_CATEGORIES)


def disorder_utilities(lsoas: Mapping[str, tuple[str, str]], monthly: Mapping[str, Mapping[str, dict]],
                       population: Mapping[str, int], end: str,
                       regions: Mapping[str, str] | None = None) -> list[list]:
    """factor_utility rows (without the source release) for `disorder` over the 12 months to `end`.

    `lsoas` maps an LSOA geography id to (official code, parent MSOA id). Rates are per 1,000
    residents; utility is the ascending percentile within the region (`regions`), like crime. An LSOA whose crimes
    land in its neighbours (snap_gap on the headline count) carries its MSOA's disorder rate.
    """
    window = month_list(end, WINDOW_MONTHS)
    members: dict[str, list[str]] = {}
    for code, msoa in lsoas.values():
        members.setdefault(msoa, []).append(code)
    parents = {}
    for msoa, codes in members.items():
        cell = window_cell(monthly, window, codes)
        pop = sum(population.get(code, 0) for code in codes) or None
        parents[msoa] = (annual_rate(cell["count"], pop), annual_rate(disorder_count(cell), pop))
    rates: dict[str, float | None] = {}
    carrier: dict[str, str] = {}
    for gid, (code, msoa) in lsoas.items():
        cell = window_cell(monthly, window, [code])
        pop = population.get(code)
        crime_rate, disorder_rate = parents.get(msoa, (None, None))
        if snap_gap(cell["count"], pop, crime_rate):
            rates[gid], carrier[gid] = disorder_rate, msoa
        else:
            rates[gid], carrier[gid] = annual_rate(disorder_count(cell), pop), gid
    pct = ascending_percentiles(rates, regions)
    day = f"{end}-01"
    return [[gid, "disorder", day, pct[gid], rates[gid], "per 1,000", carrier[gid],
             "observed" if carrier[gid] == gid else "fallback"]
            for gid in sorted(rates) if rates[gid] is not None]
