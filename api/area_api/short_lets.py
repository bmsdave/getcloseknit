"""Short lets (migration 084): Airbnb listings per 1,000 homes, how many are entire homes and how many
had a review in the last 12 months, each against London (Inside Airbnb, CC BY 4.0).

The rate is ranked among London areas of the same kind (percent_rank 0-100, fewest = 0); London's own
figures are the boroughs' sums. Counts of listings in an area, never a listing, a host or a home.
Short card notes come with the payload so the site and the agent tools say the same thing.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import envelope, evidence, schools

SCHEMA_VERSION = "area-short-lets.v1"
MIN_HOMES = 50  # as deploy/tools/etl_short_lets.py: fewer households than this, no rate on the map
CAVEATS = [
    "Airbnb moves each listing's point by up to about 150 m, so a listing near a boundary can count in the next "
    "area.",
    "Airbnb only: other platforms and agents' short lets are not counted.",
    "A snapshot of listings on one day; a listing is not a night let, and some are rarely booked.",
    "Homes are Census 2021 households, so empty homes are not in the count.",
    "Inside Airbnb, insideairbnb.com, CC BY 4.0.",
]

SHORT_LETS_SQL = """-- evidence:area-short-lets
SELECT x.*, to_char(r.release_date, 'YYYY-MM-DD') AS snapshot FROM (
  SELECT s.*, g.kind,
    CASE WHEN s.per_1000_homes IS NOT NULL THEN round(100 * percent_rank() OVER (
      PARTITION BY g.kind, s.per_1000_homes IS NULL ORDER BY s.per_1000_homes))::int END AS region_percentile,
    sum(s.listings) FILTER (WHERE g.kind = 'lad') OVER () AS london_listings,
    sum(s.entire_home) FILTER (WHERE g.kind = 'lad') OVER () AS london_entire_home,
    sum(s.active_12m) FILTER (WHERE g.kind = 'lad') OVER () AS london_active_12m,
    sum(s.homes) FILTER (WHERE g.kind = 'lad') OVER () AS london_homes
  FROM area_short_let s JOIN area_geography g ON g.id = s.geography_id) x
JOIN source_release r ON r.id = x.source_release_id
WHERE x.geography_id = %s"""

SOURCES_SQL = """-- evidence:area-short-lets-sources
SELECT s.id, s.source_url, s.licence, s.attribution FROM source_release s WHERE s.id = %s"""


def _share(part: Any, whole: Any) -> float | None:
    return round(float(part) / float(whole), 4) if whole else None


def _rate(listings: Any, homes: Any) -> float | None:
    return round(1000 * float(listings) / float(homes), 1) if homes else None


def _pct(share: float | None) -> str:
    return "unknown" if share is None else f"{round(share * 100)}%"


def card_notes(value: Mapping[str, Any]) -> list[str]:
    """Short lines for the card: the rate against London, then entire homes and activity."""
    london = value["regionPer1000Homes"]
    london_words = "" if london is None else f"London {round(london):,}"
    if value["listings"] == 0:
        return [f"No Airbnb listings in this snapshot ({london_words} per 1,000 homes)" if london_words
                else "No Airbnb listings in this snapshot"]
    if value["per1000Homes"] is None:
        notes = [f"{value['listings']:,} Airbnb listings; no Census homes to compare with"]
    else:
        notes = [f"{round(value['per1000Homes']):,} Airbnb listings per 1,000 homes" + (f" ({london_words})" if london_words else "")]
    notes.append(f"{_pct(value['entireHomeShare'])} entire homes (London {_pct(value['regionEntireHomeShare'])})")
    notes.append(f"{_pct(value['activeShare'])} reviewed in the last 12 months (London {_pct(value['regionActiveShare'])})")
    return notes


def short_lets_value(connection: Any, area_id: str) -> dict | None:
    """The short-lets block for one area, or None when migration 084 is not loaded or nothing is loaded yet.
    A savepoint keeps a missing table from poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return _short_lets_value(connection, area_id)
        return _short_lets_value(connection, area_id)
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return None


def _short_lets_value(connection: Any, area_id: str) -> dict | None:
    rows = list(connection.execute(SHORT_LETS_SQL, (area_id,)))
    if not rows:
        return None
    row = rows[0]
    per_1000 = row["per_1000_homes"]
    value = {
        "listings": row["listings"], "entireHome": row["entire_home"], "active12m": row["active_12m"],
        "homes": row["homes"],
        "per1000Homes": None if per_1000 is None else round(float(per_1000), 1),
        "regionPercentile": row["region_percentile"],
        "regionPer1000Homes": _rate(row["london_listings"], row["london_homes"]),
        "entireHomeShare": _share(row["entire_home"], row["listings"]),
        "regionEntireHomeShare": _share(row["london_entire_home"], row["london_listings"]),
        "activeShare": _share(row["active_12m"], row["listings"]),
        "regionActiveShare": _share(row["london_active_12m"], row["london_listings"]),
        "snapshot": row["snapshot"],
        "sourceVersion": row["source_release_id"],
    }
    value["notes"] = card_notes(value)
    return value


def area_short_lets(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-short-lets.v1 for one LSOA, MSOA or borough; value.available is false before the layer is loaded."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        value = short_lets_value(connection, area_id)
        sources = [{"release": row["id"], "sourceUrl": row["source_url"], "licence": row["licence"],
                    "attribution": row["attribution"]}
                   for row in connection.execute(SOURCES_SQL, (value["sourceVersion"],))] if value else []
    if value is None:
        return envelope.wrap({"available": False, "notes": []}, schema_version=SCHEMA_VERSION, release_id=release_id,
                             caveats=CAVEATS)
    observed = value["per1000Homes"] is not None and value["homes"] >= MIN_HOMES
    row = {"kind": "short-let-count", "geographyId": area_id, "metricId": "short-lets-per-1000",
           "period": value["snapshot"], "value": value["per1000Homes"], "quality": "observed" if observed else "suppressed",
           "sampleCount": value["homes"], "regionPercentile": value["regionPercentile"],
           "sourceVersion": value["sourceVersion"]}
    return envelope.wrap({"available": True, **value}, schema_version=SCHEMA_VERSION, release_id=release_id,
                         confidence="high" if observed else "low", evidence=[row], sources=sources, caveats=CAVEATS)
