"""Nature for one area (migration 064-nature.sql, loaded by deploy/tools/etl_nature.py).

Green share of the land (Sentinel-2 NDVI), street trees per hectare and the commonest kinds,
the nearest Local Nature Reserve or SSSI, a nature score (the three London percentiles
combined), and for a chosen home the green share and street trees within about 100 m.
Wildlife is what observers recorded within 1 km over five years: species seen, never
absences, with the number of records behind it so a thin count reads as "few records".
Missing tables or rows give ``None``, never zero.
"""

from typing import Any, Callable, Mapping

from . import evidence, schools

# Fewer open records than this within 1 km: species counts are shown as "few records nearby".
ENOUGH_RECORDS = 200

TABLES_SQL = """-- nature:tables
SELECT to_regclass('area_nature') IS NOT NULL AS nature, to_regclass('area_wildlife') IS NOT NULL AS wildlife"""

AREA_SQL = """-- nature:area
SELECT id FROM area_geography WHERE id = %s"""

NATURE_SQL = """-- nature:area-nature
SELECT green_share, green_percentile, street_trees, trees_per_hectare, trees_percentile, top_trees,
  site_name, site_kind, site_metres, site_percentile, nature_percentile, ranked, source_release_ids
FROM area_nature WHERE geography_id = %s"""

HOME_SQL = """-- nature:dwelling
SELECT n.green_share, n.street_trees FROM dwelling_nature n
WHERE n.uprn = %s AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d WHERE d.uprn = n.uprn)"""

WILDLIFE_SQL = """-- nature:wildlife
SELECT radius_metres, first_year, last_year, records, bird_species, mammal_species, amphibian_species,
  notable, source_release_id
FROM area_wildlife WHERE geography_id = %s"""

SOURCES_SQL = """-- nature:sources
SELECT id, licence, attribution, caveats FROM source_release WHERE id = ANY(%s) ORDER BY id"""


def _share(value: Any) -> float | None:
    return None if value is None else round(float(value), 3)


def nature_payload(row: Mapping[str, Any] | None) -> dict:
    """The area's green, trees, nearest site and score blocks (each None when unknown)."""
    if row is None:
        return {"green": None, "trees": None, "site": None, "score": None, "ranked": None}
    return {
        "green": ({"share": _share(row["green_share"]), "percentile": row["green_percentile"]}
                  if row["green_share"] is not None else None),
        # Street trees are a London-only source (GLA): elsewhere the count is unknown, not zero.
        "trees": ({"count": row["street_trees"], "perHectare": round(float(row["trees_per_hectare"]), 1),
                   "percentile": row["trees_percentile"],
                   "top": [{"name": t["name"], "count": t["count"]} for t in (row["top_trees"] or [])]}
                  if row["street_trees"] is not None else None),
        "site": ({"name": row["site_name"], "kind": row["site_kind"], "metres": row["site_metres"],
                  "percentile": row["site_percentile"]} if row["site_name"] else None),
        "score": {"percentile": row["nature_percentile"]} if row["nature_percentile"] is not None else None,
        "ranked": row["ranked"],
    }


def wildlife_payload(row: Mapping[str, Any] | None) -> dict | None:
    if row is None:
        return None
    return {"radiusMetres": row["radius_metres"], "firstYear": row["first_year"], "lastYear": row["last_year"],
            "records": row["records"], "enough": row["records"] >= ENOUGH_RECORDS,
            "birds": row["bird_species"], "mammals": row["mammal_species"], "amphibians": row["amphibian_species"],
            "notable": list(row["notable"] or [])}


def area_nature(connect: Callable[[], Any], area_id: str, uprn: str | None = None,
                cancel: Callable[[], bool] | None = None) -> dict:
    """The Nature payload (``area-nature.v1``) for an LSOA, MSOA or borough, and one home."""
    evidence._check_cancelled(cancel)
    evidence._validate_geography_id(area_id)
    if uprn is not None and not schools.UPRN_PATTERN.match(uprn):
        raise evidence.MalformedQuery(f"invalid UPRN: {uprn}")
    with connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(AREA_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        tables = list(connection.execute(TABLES_SQL))[0]
        evidence._check_cancelled(cancel)
        rows = list(connection.execute(NATURE_SQL, (area_id,))) if tables["nature"] else []
        home = list(connection.execute(HOME_SQL, (uprn,))) if uprn and tables["nature"] else []
        wild = list(connection.execute(WILDLIFE_SQL, (area_id,))) if tables["wildlife"] else []
        source_ids = sorted({*(rows[0]["source_release_ids"] if rows else []),
                             *([wild[0]["source_release_id"]] if wild else [])})
        sources = list(connection.execute(SOURCES_SQL, (source_ids,))) if source_ids else []
    return {
        "schemaVersion": "area-nature.v1",
        "productReleaseId": release_id,
        "geographyId": area_id,
        "available": bool(rows or wild),
        **nature_payload(rows[0] if rows else None),
        "home": ({"uprn": uprn, "greenShare": _share(home[0]["green_share"]), "streetTrees": home[0]["street_trees"]}
                 if home else None),
        "wildlife": wildlife_payload(wild[0] if wild else None),
        "sources": [{"id": s["id"], "licence": s["licence"], "attribution": s["attribution"],
                     "caveats": list(s["caveats"] or [])} for s in sources],
    }
