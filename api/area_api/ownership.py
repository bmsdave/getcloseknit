"""Company and overseas ownership (migration 083, deploy/tools/etl_ownership.py), area-ownership.v1.

  company   land titles held by UK companies (HM Land Registry CCOD) per home in the area
  overseas  land titles held by overseas companies (OCOD) per home

Each share comes with its place among London areas of the same kind (percent_rank 0-100, lowest = 0,
areas with 10+ homes only) and London's own share from the boroughs' sums. Counts only: never a
proprietor, a title or an address. Behind CLOSE_KNIT_OWNERSHIP (FLAGS.md) until the owner has loaded the
files under their HMLR account and confirmed the licence allows showing aggregates.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import envelope, evidence, feature_flags, kinds, schools

SCHEMA_VERSION = "area-ownership.v1"
MIN_HOMES = 10
# At or above this London percentile (either share) the card says "High company ownership".
HIGH_PERCENTILE = 75
CAVEATS = [
    "Counts land titles, not homes: one title can hold a whole block, and a home can sit on more than one title.",
    "Includes commercial titles whose address looks residential.",
    "Titles are placed by the postcode in their address; titles with none are counted on the borough only.",
    f"Areas with fewer than {MIN_HOMES} homes show no share.",
]
OFF_CAVEATS = ["Company and overseas ownership is not shown yet: HM Land Registry's files are not loaded."]

ROW_SQL = """-- evidence:area-ownership-row
SELECT * FROM (
  SELECT o.*, g.kind,
    CASE WHEN o.homes >= 10 THEN o.titles_company::float8 / o.homes END AS company_share,
    CASE WHEN o.homes >= 10 THEN o.titles_overseas::float8 / o.homes END AS overseas_share,
    CASE WHEN o.homes >= 10 THEN round(100 * percent_rank() OVER (
      PARTITION BY rr.region_code, g.kind, o.homes >= 10 ORDER BY o.titles_company::float8 / nullif(o.homes, 0)))::int END AS company_percentile,
    CASE WHEN o.homes >= 10 THEN round(100 * percent_rank() OVER (
      PARTITION BY rr.region_code, g.kind, o.homes >= 10 ORDER BY o.titles_overseas::float8 / nullif(o.homes, 0)))::int END AS overseas_percentile,
    sum(o.titles_company) FILTER (WHERE g.kind = 'lad') OVER (PARTITION BY rr.region_code)::float8
      / nullif(sum(o.homes) FILTER (WHERE g.kind = 'lad') OVER (PARTITION BY rr.region_code), 0) AS london_company_share,
    sum(o.titles_overseas) FILTER (WHERE g.kind = 'lad') OVER (PARTITION BY rr.region_code)::float8
      / nullif(sum(o.homes) FILTER (WHERE g.kind = 'lad') OVER (PARTITION BY rr.region_code), 0) AS london_overseas_share
  FROM area_ownership o JOIN area_geography g ON g.id = o.geography_id
  LEFT JOIN area_region rr ON rr.area_id = g.id) x
WHERE geography_id = %s"""

SOURCES_SQL = """-- evidence:area-ownership-sources
SELECT s.id, s.source_url, s.licence, s.attribution FROM source_release s WHERE s.id = ANY(%s) ORDER BY s.id"""


def _share(value: Any) -> float | None:
    return None if value is None else round(min(1.0, max(0.0, float(value))), 4)


def _per_100(share: float | None) -> str:
    if share is None:
        return "unknown"
    per = share * 100
    return f"{per:.1f}".rstrip("0").rstrip(".") if per < 1 else f"{round(per)}"


def _block(row: Mapping[str, Any], kind: str) -> dict:
    return {"titles": row[f"titles_{kind}"], "share": _share(row[f"{kind}_share"]),
            "regionPercentile": row[f"{kind}_percentile"], "regionShare": _share(row[f"london_{kind}_share"])}


def words(company: Mapping[str, Any], overseas: Mapping[str, Any]) -> str | None:
    """The card's one line from the London percentiles; None when the area has too few homes."""
    ranks = [block["regionPercentile"] for block in (company, overseas) if block["regionPercentile"] is not None]
    if not ranks:
        return None
    return "High company ownership" if max(ranks) >= HIGH_PERCENTILE else "Mostly owner/tenant homes"


def card_notes(value: Mapping[str, Any], kind: str, unmatched: int) -> list[str]:
    notes = []
    for key, label in (("company", "company"), ("overseas", "overseas-company")):
        block = value[key]
        if block["share"] is not None:
            notes.append(f"{_per_100(block['share'])} {label} titles per 100 homes (London {_per_100(block['regionShare'])})")
    if kind == kinds.LAD and unmatched:
        notes.append(f"{unmatched:,} titles with no usable postcode are counted for the borough only")
    return notes


def ownership_value(connection: Any, area_id: str) -> dict | None:
    """The ownership block for one area, or None before migration 083 or before a load. A savepoint
    keeps a missing table from poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return _ownership_value(connection, area_id)
        return _ownership_value(connection, area_id)
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return None


def _ownership_value(connection: Any, area_id: str) -> dict | None:
    rows = list(connection.execute(ROW_SQL, (area_id,)))
    if not rows:
        return None
    row = rows[0]
    value = {"available": True, "company": _block(row, "company"), "overseas": _block(row, "overseas"),
             "homes": row["homes"], "unmatched": row["unmatched"] if row["kind"] == kinds.LAD else None}
    value["words"] = words(value["company"], value["overseas"])
    value["notes"] = card_notes(value, row["kind"], row["unmatched"])
    value["sourceVersions"] = [row["source_release_id"]]
    return value


def _evidence(area_id: str, value: Mapping[str, Any]) -> list[dict]:
    return [{"kind": "metric-observation", "geographyId": area_id, "metricId": f"ownership-{key}-share",
             "value": None if value[key]["share"] is None else round(100 * value[key]["share"], 1),
             "quality": "observed" if value[key]["share"] is not None else "suppressed",
             "sampleCount": value["homes"], "regionPercentile": value[key]["regionPercentile"],
             "sourceVersion": value["sourceVersions"][0]}
            for key in ("company", "overseas")]


def area_ownership(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-ownership.v1 envelope for one LSOA, MSOA or borough; value.available=false while the flag is
    off or nothing is loaded."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        if not feature_flags.ownership():
            return envelope.wrap({"available": False, "reason": "flag-off"}, schema_version=SCHEMA_VERSION,
                                 release_id=release_id, caveats=OFF_CAVEATS)
        value = ownership_value(connection, area_id)
        if value is None:
            return envelope.wrap({"available": False, "reason": "not-loaded"}, schema_version=SCHEMA_VERSION,
                                 release_id=release_id, caveats=OFF_CAVEATS)
        sources = [{"sourceId": "hmlr-ccod-ocod", "sourceName": "HM Land Registry CCOD and OCOD",
                    "release": row["id"], "sourceUrl": row["source_url"], "licence": row["licence"],
                    "attribution": row["attribution"]}
                   for row in connection.execute(SOURCES_SQL, (value["sourceVersions"],))]
    confidence = "high" if value["company"]["share"] is not None else "none"
    return envelope.wrap(value, schema_version=SCHEMA_VERSION, release_id=release_id, confidence=confidence,
                         evidence=_evidence(area_id, value), sources=sources, caveats=CAVEATS)
