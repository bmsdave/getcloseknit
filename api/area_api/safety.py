"""Safety for the area page (area-safety.v1): recorded crime per 1,000 residents a year,
the top offence types beside the region's rate for each, and whether the rate moved over three years.

Rates are police.uk street-level crime over 12 months (metric_value_breakdown, counted where it
happens) over the ONS mid-year population (area_population). The region's rate per type (London's
for London; area_region, migration 103) is the region's offences of that type over the residents of
its neighbourhoods with a figure, so the tick on each row is one region-wide figure. The fields keep
their London names (regionRate, regionPercentile); rankScope names the region. The trend
compares the newest 12-month window with the one about three years earlier (or the oldest loaded):
a change under 15% either way reads "stable" and the page draws no line (owner decision).

A wider neighbourhood (MSOA) reads its own crime series (the figure its Safety tile ranks), and its
offence types and residents are its neighbourhoods' summed, so its section is never "unknown" under a ranked chip.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from . import coverage, evidence, release_store, schools

SCHEMA_VERSION = "area-safety.v1"
TOP_TYPES = 5
TREND_MONTHS = 36
STABLE_CHANGE = 0.15

SERIES_SQL = """-- safety:series
SELECT to_char(period, 'YYYY-MM') AS period, value, region_percentile, sample_count, source_release_id
FROM metric_value WHERE geography_id = %s AND metric_id = 'crime' AND value IS NOT NULL
ORDER BY period"""

# An area's neighbourhoods (LSOAs): itself for a neighbourhood, the LSOAs inside it for an MSOA (never the
# MSOA's own row as well, so nothing counts twice).
MEMBERS = """(SELECT id FROM area_geography WHERE kind = 'lsoa' AND (id = %(area)s OR parent_id = %(area)s))"""

TYPES_SQL = f"""-- safety:types
SELECT category, sum(offence_count)::int AS offence_count FROM metric_value_breakdown
WHERE geography_id IN {MEMBERS} AND metric_id = 'crime' AND period = to_date(%(period)s, 'YYYY-MM')
GROUP BY category"""

POPULATION_SQL = f"""-- safety:population
SELECT sum(population) AS population FROM area_population WHERE geography_id IN {MEMBERS}"""

REGION_SQL = """-- safety:region
SELECT region_code FROM area_region WHERE area_id = %s"""

LONDON_TYPES_SQL = """-- safety:london-types
SELECT b.category, sum(b.offence_count)::float AS offences
FROM metric_value_breakdown b
JOIN area_region r ON r.area_id = b.geography_id AND r.region_code = %s
WHERE b.metric_id = 'crime' AND b.period = to_date(%s, 'YYYY-MM') AND b.geography_id LIKE 'uk:lsoa:%%'
GROUP BY b.category"""

LONDON_POPULATION_SQL = """-- safety:london-population
SELECT sum(p.population)::float AS residents FROM area_population p
JOIN area_region r ON r.area_id = p.geography_id AND r.region_code = %s
WHERE p.geography_id LIKE 'uk:lsoa:%%'
  AND EXISTS (SELECT 1 FROM metric_value m WHERE m.geography_id = p.geography_id AND m.metric_id = 'crime'
              AND m.period = to_date(%s, 'YYYY-MM') AND m.value IS NOT NULL)"""

SOURCE_SQL = """-- safety:source
SELECT attribution, licence, source_url FROM source_release WHERE id = %s"""

CAVEATS = [
    "Crime is counted where it happens, so busy shopping and night-life streets score high.",
    "Rates are per 1,000 residents over 12 months; places with few residents and many visitors read high.",
]


def area_safety(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-safety.v1 for one neighbourhood or MSOA; available=false when no crime figure is loaded for it."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or "") or not area_id.startswith(("uk:lsoa:", "uk:msoa:")):
        raise evidence.MalformedQuery(f"safety rows are for neighbourhoods (uk:lsoa:…) and MSOAs: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        series = list(connection.execute(SERIES_SQL, (area_id,)))
        if not series:
            return {"schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id, "geographyId": area_id,
                    "available": False, "rate": None, "types": [], "trend": None, "source": None, "caveats": CAVEATS}
        latest = series[-1]
        types = {row["category"]: row["offence_count"]
                 for row in connection.execute(TYPES_SQL, {"area": area_id, "period": latest["period"]})}
        population = list(connection.execute(POPULATION_SQL, {"area": area_id}))
        region_rows = list(connection.execute(REGION_SQL, (area_id,)))
        region = region_rows[0]["region_code"] if region_rows else coverage.LONDON_REGION
        london = release_store.cached(connection, release_id, ("safety", latest["period"], region),
                                      lambda: _london(connection, latest["period"], region))
        source = list(connection.execute(SOURCE_SQL, (latest["source_release_id"],)))
    residents = population[0]["population"] if population else None
    return {
        "schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id, "geographyId": area_id, "available": True,
        "period": latest["period"],
        "rate": round(float(latest["value"]), 1), "regionPercentile": latest["region_percentile"],
        "regionRate": london["rate"],
        "rankScope": coverage.rank_scope(region),
        "offences": latest["sample_count"],
        "types": top_types(types, residents, london),
        "trend": trend(series),
        "source": ({"attribution": source[0]["attribution"], "licence": source[0]["licence"], "url": source[0]["source_url"]}
                   if source else None),
        "caveats": CAVEATS,
    }


def _london(connection: Any, period: str, region: str = coverage.LONDON_REGION) -> dict:
    """The region's rate and per-type rates (London's for London)."""
    residents = list(connection.execute(LONDON_POPULATION_SQL, (region, period)))[0]["residents"] or 0
    offences = {row["category"]: row["offences"] for row in connection.execute(LONDON_TYPES_SQL, (region, period))}
    if residents <= 0:
        return {"rate": None, "types": {}}
    return {"rate": round(sum(offences.values()) / residents * 1000, 1),
            "types": {category: count / residents * 1000 for category, count in offences.items()}}


def top_types(counts: dict[str, int], residents: int | None, london: dict) -> list[dict]:
    """The commonest offence types here (at most five), each per 1,000 residents with the region's rate."""
    ranked = sorted(((count, category) for category, count in counts.items() if count > 0), key=lambda item: (-item[0], item[1]))
    return [{"category": category, "offences": count,
             "rate": None if not residents else round(count / residents * 1000, 1),
             "regionRate": None if category not in london["types"] else round(london["types"][category], 1)}
            for count, category in ranked[:TOP_TYPES]]


def trend(series: list[dict]) -> dict | None:
    """The newest 12-month rate against the one TREND_MONTHS earlier (or the oldest loaded)."""
    if len(series) < 2:
        return None
    window = series[-(TREND_MONTHS + 1):]
    first, last = window[0], window[-1]
    start, end = float(first["value"]), float(last["value"])
    months = _months(first["period"], last["period"])
    change = None if start <= 0 else (end - start) / start
    return {"from": first["period"], "to": last["period"], "months": months,
            "changePercent": None if change is None else round(change * 100, 1),
            "stable": change is not None and abs(change) < STABLE_CHANGE,
            "points": [{"period": row["period"], "rate": round(float(row["value"]), 1)} for row in window]}


def _months(start: str, end: str) -> int:
    (y1, m1), (y2, m2) = (map(int, start.split("-")), map(int, end.split("-")))
    return (y2 - y1) * 12 + (m2 - m1)
