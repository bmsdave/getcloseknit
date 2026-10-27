"""People and homes for one area (migration 015-people.sql).

Residents and density from ONS mid-year estimates, and Census 2021 counts by
ethnic group, religion, qualifications, occupation, economic activity, tenure,
accommodation type, residents' age, household type and country of birth by world region (TS004), each
with the share of the same category in the area's region (area_region, migration 103; London for London,
so the payload's ``regionShare`` and ``regionDensityPerKm2`` keep their names). Detailed country of birth (TS012) is loaded for boroughs only
and is a map layer, not part of this payload. A
topic with no rows is returned with ``total: None`` so the page says
"unknown", never zero.
"""

from typing import Any, Callable, Mapping

from . import evidence

# Mirrors PEOPLE_TOPIC_IDS in web/src/lib/people-profile.ts.
TOPIC_IDS = ("ethnicity", "religion", "qualification", "occupation", "economic-activity", "tenure",
             "accommodation", "age", "household-type", "country-of-birth")

AREA_SQL = """-- people:area
SELECT id, name, kind::text AS kind FROM area_geography WHERE id = %s"""

# The comparison is the area's region (migration 103's area_region): its boroughs' density and its
# census_region_count (migration 107). London's region is London, so London's figures are unchanged.
POPULATION_SQL = """-- people:population
SELECT p.population, p.population_year, p.area_km2, p.source_release_id,
  (SELECT sum(b.population)::float8 / sum(b.area_km2)
     FROM area_population b JOIN area_geography g ON g.id = b.geography_id AND g.kind = 'lad'
     JOIN area_region r ON r.area_id = g.id
    WHERE r.region_code = (SELECT region_code FROM area_region WHERE area_id = p.geography_id))
     AS london_density
FROM area_population p WHERE p.geography_id = %s"""

CENSUS_SQL = """-- people:census
SELECT k.topic, k.category, k.label, rc.count AS london_count, c.count, c.source_release_id
FROM census_category k
LEFT JOIN census_region_count rc ON rc.topic = k.topic AND rc.category = k.category
  AND rc.region_code = (SELECT region_code FROM area_region WHERE area_id = %(area)s)
LEFT JOIN area_census_count c ON c.topic = k.topic AND c.category = k.category AND c.geography_id = %(area)s
ORDER BY k.topic, k.position"""

SOURCES_SQL = """-- people:sources
SELECT id, attribution, caveats FROM source_release WHERE id = ANY(%s) ORDER BY id"""


def _share(part: int | None, whole: int | None) -> float | None:
    if part is None or not whole:
        return None
    return round(part / whole, 4)


def population_payload(row: Mapping[str, Any] | None) -> dict | None:
    if row is None:
        return None
    area = float(row["area_km2"])
    london = row["london_density"]
    return {
        "residents": int(row["population"]),
        "year": int(row["population_year"]),
        "areaKm2": round(area, 3),
        "densityPerKm2": round(row["population"] / area) if area > 0 else None,
        "regionDensityPerKm2": None if london is None else round(float(london)),
        "sourceVersion": row["source_release_id"],
    }


def topics_payload(rows: list[Mapping[str, Any]]) -> list[dict]:
    """One entry per topic in TOPIC_IDS order; categories keep the loader's order."""
    by_topic: dict[str, list[Mapping[str, Any]]] = {topic: [] for topic in TOPIC_IDS}
    for row in rows:
        if row["topic"] in by_topic:
            by_topic[row["topic"]].append(row)
    topics = []
    for topic, members in by_topic.items():
        available = bool(members) and all(member["count"] is not None for member in members)
        total = sum(member["count"] for member in members) if available else None
        london_total = sum(member["london_count"] or 0 for member in members) or None
        topics.append({
            "id": topic,
            "total": total,
            "categories": [{
                "id": member["category"],
                "label": member["label"],
                "count": member["count"] if available else None,
                "share": _share(member["count"], total) if available else None,
                "regionShare": _share(member["london_count"], london_total),
            } for member in members],
        })
    return topics


def area_people(connect: Callable[[], Any], area_id: str,
                cancel: Callable[[], bool] | None = None) -> dict:
    """The People and homes payload (``area-people.v1``) for an LSOA, MSOA or borough."""
    evidence._check_cancelled(cancel)
    evidence._validate_geography_id(area_id)
    with connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        area = list(connection.execute(AREA_SQL, (area_id,)))
        if not area:
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        evidence._check_cancelled(cancel)
        population = list(connection.execute(POPULATION_SQL, (area_id,)))
        census = list(connection.execute(CENSUS_SQL, {"area": area_id}))
        source_ids = sorted({row["source_release_id"] for row in population + census if row["source_release_id"]})
        sources = list(connection.execute(SOURCES_SQL, (source_ids,))) if source_ids else []
    return {
        "schemaVersion": "area-people.v1",
        "productReleaseId": release_id,
        "geographyId": area_id,
        "name": area[0]["name"],
        "kind": area[0]["kind"],
        "population": population_payload(population[0] if population else None),
        "censusYear": 2021,
        "topics": topics_payload(census),
        "sources": [{"id": row["id"], "attribution": row["attribution"], "caveats": list(row["caveats"] or [])}
                    for row in sources],
    }
