"""Search brief (area-brief.v1): the evidence behind an agent's shortlist, laid out for the
/brief page — each recommended LSOA with its ring of touching neighbours, the price of homes
like the one wanted against the household's budget, nearby schools graded for the map, and the
nearest station.

Pure helpers here; `EvidenceReader.get_brief` runs the SQL. Sale prices never leave as rows:
only histogram counts, a median and the budget's percentile, each gated on a minimum sample.
"""
from __future__ import annotations

import bisect
import math
from typing import Any, Iterable, Mapping

from . import schools

PRICE_WINDOW_MONTHS = 36
# The selected area, the page of ten matches the map numbers and a liked one.
MAX_AREAS = 12
CAVEATS = [
    "Price context: standard sales in the area and its ring over the last 36 months, for homes of "
    "the floor-area band that usually means this many bedrooms (sales carry floor area, not "
    "bedrooms); 'matched' says when the band or property type had to be dropped for enough sales.",
    "estimatedPrice is the area's median £/m² × an assumed size: a ballpark, never a valuation.",
    "School colours summarise the latest Ofsted judgement (or the 2025 report-card grades); "
    "distance is from the area's centre, not an admission catchment.",
    "The ring is the neighbourhoods that touch each recommended one: context, not recommendations.",
]
MIN_SALES = 10
HISTOGRAM_BINS = 8
# Floor-area bands standing in for bedroom counts (sales carry an EPC floor area, not bedrooms).
FLOOR_BANDS = {0: (0, 45), 1: (45, 60), 2: (60, 80), 3: (80, 110), 4: (110, 150), 5: (150, 10_000)}
PROPERTY_TYPES = {"house": ("D", "S", "T"), "flat": ("F",), "any": ("D", "S", "T", "F", "O")}

# Touching neighbours; a 10 m tolerance absorbs boundary precision gaps between ONS polygons.
RING_SQL = """-- evidence:brief-ring
SELECT a.id AS area_id, b.id AS neighbour_id
FROM area_geography a
JOIN area_geography b ON b.kind = 'lsoa' AND b.id <> a.id
  AND ST_DWithin(a.geometry, b.geometry, 0.0001)
WHERE a.id = ANY(%s)
ORDER BY a.id, b.id"""

# Standard (category A) sales in the last PRICE_WINDOW_MONTHS of the release, read only to be
# aggregated. The window ends at the release's latest completion, not today.
PRICE_CONTEXT_SQL = """-- evidence:brief-price-context
SELECT a.geography_id, t.price, t.property_type, t.floor_area_square_metres AS floor,
  t.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN sale t ON t.source_release_id = member.source_release_id
JOIN address a ON a.id = t.address_id
WHERE a.geography_id = ANY(%s) AND t.ppd_category = 'A'
  AND t.completion_date > (SELECT max(completion_date) FROM sale) - make_interval(months => %s)
  AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling s WHERE s.address_id = a.id)"""

# Outlines for the brief map: the recommended areas and their ring only, lightly simplified.
GEOMETRY_TOLERANCE = 0.00005
BRIEF_GEOMETRY_SQL = """-- evidence:brief-geometry
SELECT g.id AS geography_id, ST_AsGeoJSON(ST_SimplifyPreserveTopology(g.geometry, %s), 6) AS geometry
FROM area_geography g
WHERE g.id = ANY(%s)"""

NEAREST_STATION_SQL = """-- evidence:brief-stations
SELECT DISTINCT ON (w.geography_id) w.geography_id, s.id AS station_id, s.name, s.modes,
  w.median_minutes, ST_X(s.geom) AS center_lon, ST_Y(s.geom) AS center_lat, fare.zone
FROM lsoa_station_walk w
JOIN station s ON s.id = w.station_id
LEFT JOIN LATERAL (SELECT ps.zone FROM place_station ps
  WHERE substr(s.id, 5) = ANY(ps.osm_ids) AND ps.zone IS NOT NULL LIMIT 1) fare ON true
JOIN product_release_member member ON member.source_release_id = w.source_release_id
WHERE member.release_id = (SELECT release_id FROM active_product_release)
  AND w.geography_id = ANY(%s)
ORDER BY w.geography_id, w.median_minutes"""


def price_context(rows: Iterable[Mapping[str, Any]], area_ids: set[str], bedrooms: int,
                  property_type: str, budget: tuple[int | None, int | None]) -> dict:
    """Histogram of standard sale prices in `area_ids` for homes like the one wanted.

    Homes of the bedroom-equivalent floor band and property type come first; when fewer than
    MIN_SALES match, the property type is dropped (size says more about price), then the size,
    then both — `matched` says which comparison the numbers describe."""
    types = PROPERTY_TYPES[property_type]
    low, high = FLOOR_BANDS.get(bedrooms, FLOOR_BANDS[5])
    scoped = [row for row in rows if row["geography_id"] in area_ids]
    sized = [r for r in scoped if r["floor"] is not None and low <= r["floor"] < high]
    attempts = [
        ("size-and-type", [r for r in sized if r["property_type"] in types]),
        ("size", sized),
        ("type", [r for r in scoped if r["property_type"] in types]),
        ("all", scoped),
    ]
    for matched, chosen in attempts:
        if len(chosen) >= MIN_SALES:
            return _histogram(sorted(r["price"] for r in chosen), matched, (low, high), budget)
    return {"available": False, "sales": len(scoped), "minimumSample": MIN_SALES,
            "windowMonths": PRICE_WINDOW_MONTHS, "floorBand": [low, high]}


def _histogram(prices: list[int], matched: str, band: tuple[int, int],
               budget: tuple[int | None, int | None]) -> dict:
    """Geometric bins (each about 1.1-1.6x the last, at round prices): sale prices are skewed,
    so equal-width bars would put a budget and most sales into one bar. The scale runs from the
    5th percentile to the 95th (stretched to show the budget, never past the dearest sale);
    dearer sales are counted in `above`, cheaper ones join the first bar."""
    budget_min, budget_max = budget
    reach = budget_max or budget_min or 0
    lo = max(_quantile(prices, 0.05), 1_000)
    hi = min(max(_quantile(prices, 0.95), reach * 1.15), max(prices[-1], reach * 1.05))
    ratio = min(max((hi / lo) ** (1 / HISTOGRAM_BINS), 1.1), 1.6) if hi > lo else 1.1
    edges = [_round_price(lo)]
    while edges[-1] < hi and len(edges) <= 2 * HISTOGRAM_BINS:
        nxt = _round_price(edges[-1] * ratio)
        edges.append(nxt if nxt > edges[-1] else edges[-1] + _round_price(edges[-1] * 0.1))
    if len(edges) < 2:
        edges.append(_round_price(edges[0] * ratio))
    counts = [0] * (len(edges) - 1)
    above = 0
    for price in prices:
        if price >= edges[-1]:
            above += 1
            continue
        counts[max(bisect.bisect_right(edges, price) - 1, 0)] += 1
    bins = [{"from": edges[i], "to": edges[i + 1], "count": counts[i]} for i in range(len(counts))]
    return {
        "available": True, "sales": len(prices), "windowMonths": PRICE_WINDOW_MONTHS,
        "minimumSample": MIN_SALES, "matched": matched, "floorBand": list(band),
        "above": above, "median": int(round(_quantile(prices, 0.5), -3)),
        "p25": int(round(_quantile(prices, 0.25), -3)), "p75": int(round(_quantile(prices, 0.75), -3)),
        "bins": bins,
        "budgetMinPercentile": _share_at_or_below(prices, budget_min),
        "budgetMaxPercentile": _share_at_or_below(prices, budget_max),
    }


def _round_price(value: float) -> int:
    """Two significant figures, so bar edges read as prices people quote (£620k, £1.2m)."""
    magnitude = 10 ** (math.floor(math.log10(max(value, 1))) - 1)
    return int(round(value / magnitude) * magnitude)


def _quantile(values: list[int], q: float) -> float:
    position = (len(values) - 1) * q
    lower = math.floor(position)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def _share_at_or_below(prices: list[int], budget: int | None) -> int | None:
    if not budget:
        return None
    return round(100 * sum(price <= budget for price in prices) / len(prices))


LEGACY_TIERS = (("outstanding", "outstanding"), ("good", "good"),
                ("requires improvement", "requires-improvement"), ("inadequate", "inadequate"))


def school_grade(observations: list[Mapping[str, Any]], standing: Mapping[str, Any] | None = None) -> dict:
    """One tier per school for the map: the standing inspection first (the pack's school_inspection row,
    the map's rule — an ungraded "Standards maintained" leaves the earlier grade in place; without the
    row, the school's own observations, newest framework first): a report card is summarised from its
    graded areas, a legacy overall judgement (or the ungraded outcome that kept it) is the grade word.
    Report-card and legacy grades are never blended into one value, and an older legacy grade
    never outranks a newer report card (#226)."""
    if not standing:
        # The newest framework in the school's own observations (the ETL writes the report card first).
        derived = schools.standing_from_observations(observations)
        standing = derived if derived and derived.get("framework") == "report-card" else None
    if standing and standing.get("framework") == "report-card":
        return _report_card_grade(observations, standing.get("year"))
    if standing and standing.get("framework") == "legacy-overall" and standing.get("grade"):
        grade = str(standing["grade"])
        tier = next((tier for needle, tier in LEGACY_TIERS if needle == grade.lower()), "unknown")
        if tier != "unknown":
            return {"tier": tier, "label": f"Ofsted: {grade}", "year": standing.get("year")}
    legacy = [o for o in observations if o.get("kind") == "inspection-legacy"]
    for measure in ("Overall effectiveness", "Ungraded inspection", "Quality of education"):
        for observation in legacy:
            if observation.get("measure") == measure:
                text = str(observation.get("value", ""))
                for needle, tier in LEGACY_TIERS:
                    if needle in text.lower():
                        return {"tier": tier, "label": f"Ofsted: {text}",
                                "year": observation.get("academicYear")}
    if any(o.get("kind") == "inspection-current" for o in observations):
        return _report_card_grade(observations, None)
    return {"tier": "unknown", "label": "No inspection published", "year": None}


def _report_card_grade(observations: list[Mapping[str, Any]], year: str | None) -> dict:
    """A report card's tier for the map from its graded areas (safeguarding aside); the label counts
    the areas by grade, as the card has no single grade."""
    card = schools.report_card(observations)
    if not card or not card["areas"]:
        return {"tier": "unknown", "label": "Ofsted report card (areas not loaded)", "year": year}
    current = [str(area["grade"] or "").lower() for area in card["areas"]]
    counts = {grade: sum(grade in value for value in current)
              for grade in ("exceptional", "strong", "expected", "needs attention", "urgent")}
    if counts["urgent"]:
        tier = "inadequate"
    elif counts["needs attention"]:
        tier = "requires-improvement"
    elif counts["exceptional"] and counts["exceptional"] + counts["strong"] >= len(current) / 2:
        tier = "outstanding"
    else:
        tier = "good"
    parts = [f"{n} {grade}" for grade, n in counts.items() if n]
    return {"tier": tier, "label": "Ofsted report card: " + ", ".join(parts), "year": card["year"] or year}


def attainment8(observations: list[Mapping[str, Any]]) -> float | None:
    for observation in observations:
        if observation.get("measure") == "Attainment 8" and not observation.get("suppressed"):
            return observation.get("value")
    return None


def progress8(observations: list[Mapping[str, Any]]) -> dict | None:
    """Latest published Progress 8 (secondaries; none for 2024/25): {value, year}."""
    found = [o for o in observations if o.get("measure") == "Progress 8" and not o.get("suppressed")
             and isinstance(o.get("value"), (int, float))]
    if not found:
        return None
    latest = max(found, key=lambda o: o.get("academicYear") or "")
    return {"value": latest["value"], "year": latest.get("academicYear")}


def school_marker(summary: Mapping[str, Any], near_area: str) -> dict:
    observations = summary.get("observations", [])
    return {"urn": summary["urn"], "name": summary["name"], "phase": summary["phase"],
            "latitude": summary["latitude"], "longitude": summary["longitude"],
            "distanceMetres": summary.get("distanceMetres"),
            "grade": school_grade(observations, summary.get("standingInspection")),
            "attainment8": attainment8(observations), "progress8": progress8(observations),
            "selectivity": summary.get("selectivity"),
            "nearAreas": [near_area], "sourceVersion": summary.get("sourceVersion")}


def merge_schools(markers: Iterable[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for marker in markers:
        known = merged.get(marker["urn"])
        if known is None:
            merged[marker["urn"]] = marker
            continue
        known["nearAreas"] = sorted(set(known["nearAreas"]) | set(marker["nearAreas"]))
        if (marker["distanceMetres"] or 10**9) < (known["distanceMetres"] or 10**9):
            known["distanceMetres"] = marker["distanceMetres"]
    order = {"outstanding": 0, "good": 1, "requires-improvement": 2, "inadequate": 3, "unknown": 4}
    return sorted(merged.values(), key=lambda s: (order[s["grade"]["tier"]], s["distanceMetres"] or 10**9))


def station_entry(row: Mapping[str, Any] | None) -> dict | None:
    if row is None:
        return None
    return {"stationId": row["station_id"], "name": row["name"], "modes": list(row["modes"]),
            "walkMinutes": round(float(row["median_minutes"]), 1),
            "center": [row["center_lon"], row["center_lat"]],
            **({"zone": row["zone"]} if row.get("zone") else {})}
