"""My match factors read straight from tables the release already holds (migration 028).

`disorder` needs nothing here: its rows sit in factor_utility next to crime (crime ETL). The
others are one SQL each, LSOA rows in the match-evidence shape with the London percentile of
the raw value as utility (ascending, like crime; the household's direction applies later):

  noise            share of homes at 55 dB Lden or more from road, rail or aircraft (Defra round 4)
  epc-share        share of homes with an EPC rated A-C (area_epc_rating, from property_epc)
  leasehold-share  share of the last 12 months' sales that were leasehold (area_market_depth);
                   an LSOA with under 10 sales of known tenure carries its MSOA's share

Each row carries `detail`, the figures the selected-area card shows next to the fit.
"""
from __future__ import annotations

import threading
from typing import Any, Iterable

from .percentiles import competition_percentiles, regional_percentiles
from .scope import Scope

QUICK_FACTORS = ("noise", "epc-share", "leasehold-share")
LEASEHOLD_MIN_SALES = 10

_ACTIVE = """FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id"""

NOISE_SQL = f"""-- evidence:quick-noise
SELECT n.geography_id, g.name, round((n.any_55_share * 100)::numeric, 1)::float AS raw_value,
  n.road_55_share, n.rail_55_share, n.air_55_share, n.dwellings, n.geography_id AS carrier_geography_id,
  n.source_release_id
{_ACTIVE}
JOIN area_noise n ON n.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = n.geography_id AND g.kind = 'lsoa'
WHERE n.any_55_share IS NOT NULL"""

EPC_SQL = f"""-- evidence:quick-epc
SELECT e.geography_id, g.name, round((e.share_a_to_c * 100)::numeric, 1)::float AS raw_value,
  e.homes_rated, e.rated_a_to_c, e.geography_id AS carrier_geography_id, e.source_release_id
{_ACTIVE}
JOIN area_epc_rating e ON e.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = e.geography_id AND g.kind = 'lsoa'
WHERE e.share_a_to_c IS NOT NULL"""

LEASEHOLD_SQL = f"""-- evidence:quick-leasehold
SELECT g.id AS geography_id, g.name,
  CASE WHEN own.tenure_known_12m >= %(min)s THEN own.leasehold_share_of_sales
       ELSE parent.leasehold_share_of_sales END AS share,
  CASE WHEN own.tenure_known_12m >= %(min)s THEN own.tenure_known_12m ELSE parent.tenure_known_12m END AS sales,
  CASE WHEN own.tenure_known_12m >= %(min)s THEN g.id ELSE g.parent_id END AS carrier_geography_id,
  CASE WHEN own.tenure_known_12m >= %(min)s THEN own.source_release_id ELSE parent.source_release_id END AS source_release_id
FROM area_geography g
LEFT JOIN (SELECT d.* {_ACTIVE} JOIN area_market_depth d ON d.source_release_id = member.source_release_id) own
  ON own.geography_id = g.id
LEFT JOIN (SELECT d.* {_ACTIVE} JOIN area_market_depth d ON d.source_release_id = member.source_release_id) parent
  ON parent.geography_id = g.parent_id
WHERE g.kind = 'lsoa'"""

_CACHE: dict[tuple, list[dict]] = {}
_LOCK = threading.Lock()


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()


def percentiles(values: dict[str, float], region_of: dict[str, str] | None = None) -> dict[str, int]:
    """Ascending percentile within each area's region (0 lowest, 100 highest; London's areas among London's);
    ties share one (area_api.percentiles, #221)."""
    return regional_percentiles(values, region_of, competition_percentiles)


def _row(source: dict, factor_id: str, raw_value: float, unit: str, quality: str, detail: dict) -> dict:
    return {"geography_id": source["geography_id"], "name": source["name"], "factor_id": factor_id,
            "raw_value": raw_value, "utility": None, "unit": unit,
            "carrier_geography_id": source["carrier_geography_id"], "quality": quality,
            "source_release_id": source["source_release_id"], "detail": detail}


def noise_rows(found: Iterable[dict]) -> list[dict]:
    return [_row(r, "noise", r["raw_value"], "% of homes ≥55 dB", "observed", {
        "road": _percent(r["road_55_share"]), "rail": _percent(r["rail_55_share"]),
        "air": _percent(r["air_55_share"]), "homes": r["dwellings"]}) for r in found]


def epc_rows(found: Iterable[dict]) -> list[dict]:
    return [_row(r, "epc-share", r["raw_value"], "% of homes rated A-C", "observed", {
        "homesRated": r["homes_rated"], "ratedAToC": r["rated_a_to_c"]}) for r in found]


def leasehold_rows(found: Iterable[dict]) -> list[dict]:
    return [_row(r, "leasehold-share", _percent(r["share"]), "% of sales leasehold",
                 "observed" if r["carrier_geography_id"] == r["geography_id"] else "fallback",
                 {"sales": r["sales"]})
            for r in found if r["share"] is not None and r["source_release_id"]]


def _percent(share: float | None) -> float | None:
    return None if share is None else round(share * 100, 1)


def _with_utility(rows: list[dict], region_of: dict[str, str] | None = None) -> list[dict]:
    ranks = percentiles({row["geography_id"]: row["raw_value"] for row in rows}, region_of)
    return [{**row, "utility": ranks[row["geography_id"]]} for row in rows]


def _load(connection: Any, factor_id: str, served: Scope) -> list[dict]:
    if factor_id == "noise":
        return noise_rows(connection.execute(served.rows(NOISE_SQL)))
    if factor_id == "epc-share":
        return epc_rows(connection.execute(served.rows(EPC_SQL)))
    return leasehold_rows(connection.execute(served.rows(LEASEHOLD_SQL), {"min": LEASEHOLD_MIN_SALES}))


def match_rows(connection: Any, release_id: str, factor_ids: Iterable[str], served: Scope) -> list[dict]:
    """Evidence rows for the quick factors the profile weighs, for the areas of the scope, cached per product
    release and scope."""
    rows: list[dict] = []
    for factor_id in dict.fromkeys(factor_ids):
        if factor_id not in QUICK_FACTORS:
            continue
        key = (release_id, factor_id, served)
        with _LOCK:
            cached = _CACHE.get(key)
        if cached is None:
            from . import regions
            cached = _with_utility(_load(connection, factor_id, served), regions.area_regions_on(connection))
            with _LOCK:
                _CACHE[key] = cached
        rows += cached
    return rows
