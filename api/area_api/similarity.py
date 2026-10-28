"""Similar areas (wave 1 / feature 2).

LSOAs whose percentiles (within each area's region) for crime, deprivation, household income,
price level (market-level) and walk to a station sit closest to one area's.
The vectors are the match evidence rows (EVIDENCE_SQL), so a similar area is
judged on exactly the utilities the personal match scores. Demographic
composition is never compared; social renting joins only on request.
"""
import math
from typing import Any, Iterable, Mapping

from .repository import EVIDENCE_SQL

SIMILARITY_FACTORS = ("crime", "deprivation", "income", "market-level", "station-access")
OPTIONAL_FACTORS = ("social-renting",)
MAX_RESULTS = 10
MIN_SHARED_FACTORS = 3
PRICE_FACTOR = "market-level"

SIMILAR_SQL = "-- evidence:similar-utilities" + EVIDENCE_SQL

CAVEATS = (
    "Similarity compares percentiles within each area's region of crime, deprivation, household income, price per m² "
    "and walk to a station. It never compares who lives in an area.",
    "Similar evidence is not a recommendation: check each area's own evidence before relying on it.",
)
CHEAPER_CAVEAT = ("Cheaper means a lower median price per m² of recorded sales (market level), "
                  "not a lower price for any particular home.")
ZONES_CAVEAT = "Areas inside your zones are left out."


def factors_for(social_renting: bool) -> tuple[str, ...]:
    return SIMILARITY_FACTORS + (OPTIONAL_FACTORS if social_renting else ())


def area_vectors(rows: Iterable[Mapping[str, Any]]) -> dict[str, dict]:
    """First row per area and factor; EVIDENCE_SQL orders the latest period first."""
    areas: dict[str, dict] = {}
    for row in rows:
        area = areas.setdefault(row["geography_id"], {"name": row["name"], "factors": {}})
        area["factors"].setdefault(row["factor_id"], {
            "rawValue": row["raw_value"], "utility": float(row["utility"]), "unit": row["unit"],
        })
    return areas


def similar_areas(target_id: str, areas: Mapping[str, dict], factors: Iterable[str], *,
                  cheaper: bool = False, exclude: Iterable[str] = (),
                  limit: int = MAX_RESULTS, candidates: dict | None = None) -> list[dict]:
    """Nearest areas by root-mean-square percentile distance over shared factors.

    A candidate must share all but one of the target's factors (and at least
    three); ``cheaper`` keeps only a lower market-level raw value. ``candidates``,
    when given, receives how many areas were similar and how many of those were
    cheaper, so an empty answer can say which filter emptied it (#242).
    """
    counts = candidates if candidates is not None else {}
    counts["similar"] = counts["cheaper"] = 0
    target = areas.get(target_id)
    if target is None:
        return []
    wanted = [factor for factor in factors if factor in target["factors"]]
    needed = max(MIN_SHARED_FACTORS, len(wanted) - 1)
    if len(wanted) < MIN_SHARED_FACTORS:
        return []
    price = target["factors"].get(PRICE_FACTOR, {}).get("rawValue")
    skip = set(exclude) | {target_id}
    matches = []
    for area_id, area in areas.items():
        if area_id in skip:
            continue
        shared = [factor for factor in wanted if factor in area["factors"]]
        if len(shared) < needed:
            continue
        counts["similar"] += 1
        if price is None or not _cheaper(area, price):
            if cheaper:
                continue
        else:
            counts["cheaper"] += 1
        matches.append(_match(area_id, area, target, shared))
    matches.sort(key=lambda item: (-item["similarity"], item["geographyId"]))
    return matches[:limit]


def _cheaper(area: Mapping[str, Any], price: float) -> bool:
    candidate = area["factors"].get(PRICE_FACTOR, {}).get("rawValue")
    return candidate is not None and candidate < price


def _match(area_id: str, area: Mapping[str, Any], target: Mapping[str, Any], shared: list[str]) -> dict:
    components = []
    for factor in shared:
        mine, theirs = area["factors"][factor], target["factors"][factor]
        components.append({
            "factorId": factor, "rawValue": mine["rawValue"], "unit": mine["unit"],
            "utility": mine["utility"], "targetUtility": theirs["utility"],
            "targetRawValue": theirs["rawValue"],
        })
    distance = math.sqrt(sum((item["utility"] - item["targetUtility"]) ** 2 for item in components)
                         / len(components))
    return {"geographyId": area_id, "name": area["name"],
            "similarity": round(max(0.0, 100 - distance), 1), "components": components}


def similar_payload(release_id: str, geography: Mapping[str, Any], factors: Iterable[str],
                    values: list[dict], *, cheaper: bool, outside_zones: bool,
                    candidates: Mapping[str, int] | None = None) -> dict:
    caveats = list(CAVEATS)
    if cheaper:
        caveats.append(CHEAPER_CAVEAT)
    if outside_zones:
        caveats.append(ZONES_CAVEAT)
    return {
        "schemaVersion": "similar-areas.v1", "productReleaseId": release_id,
        "geographyId": geography["id"], "name": geography["name"], "factors": list(factors),
        "cheaper": cheaper, "outsideZones": outside_zones, "values": values, "caveats": caveats,
        "candidates": dict(candidates or {"similar": len(values), "cheaper": len(values)}),
    }
