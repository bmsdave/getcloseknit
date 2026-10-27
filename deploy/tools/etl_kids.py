"""Kids layers (migration 062): nurseries, road casualties and cycle lanes, then area_kids.

Reads the downloaded files from one folder (sources and URLs in DATA-LICENCES.md):

  Management_information_-_childcare_providers_and_inspections_-_childcare_providers_data_as_at_*.csv
      Ofsted Early Years MI (OGL v3). "Childcare on non-domestic premises" in the coverage's regions
      on the Early Years Register; childminders are left out (Ofsted withholds their addresses).
  dft-road-casualty-statistics-collision-last-5-years.csv
  dft-road-casualty-statistics-casualty-last-5-years.csv
      DfT STATS19 (OGL v3). Casualties at collisions in the ETL coverage (CLOSE_KNIT_ETL_COVERAGE,
      default England: every English district code, including districts merged since; london: E09).
  cycle_lane_track.json, CycleRoutes.json
      TfL Cycling Infrastructure Database and Cycleways (TfL open data terms, based on OGL v2.0): London only.

Coverage: England unless CLOSE_KNIT_ETL_COVERAGE=london (area_coverage). Percentiles are within each
LSOA's region (London's stay as they were).

Each file becomes a source release; the tables are replaced, nurseries are matched to the
map's childcare places, rebuild_area_kids() derives the per-area figures and a product
release that drops the earlier Kids sources is staged and activated. Aggregates only:
area_kids never names a person, a vehicle or a home. The same run replaces the `road-collisions`
metric (migration-free: the definition is seeded here): pedestrians and cyclists hurt per LSOA, a year,
per 1,000 residents of area_population (the mid-2024 estimates the crime rate divides by).

  python3 etl_kids.py load <database-url> <data-folder>     (needs psycopg; about a minute)
  python3 etl_kids.py roads <database-url> <data-folder>    only STATS19: road_casualty, collision_casualty,
        area_kids and road-collisions, ranked within the region; nurseries and cycle lanes are left as they are
"""
from __future__ import annotations

import csv
import glob
import hashlib
import io
import json
import os
import re
import sys
from collections.abc import Iterable, Iterator, Mapping
from datetime import date

import area_coverage as coverage
import crime_rates as cr

COVERAGE = coverage.from_env()
# The coverage's region names as Ofsted's Early Years MI prints them ("Yorkshire and The Humber").
REGION_NAMES = frozenset(name.lower() for code, name in coverage.REGIONS.items() if code in COVERAGE.region_codes)

ETL_VERSION = "close-knit-kids-1"
NURSERY_TYPE = "Childcare on non-domestic premises"
OLD_GRADES = {"1": "Outstanding", "2": "Good", "3": "Requires improvement", "4": "Inadequate"}
# Report card areas, best first. Below "Expected standard" is not well rated.
CARD_GRADES = ("Exceptional", "Strong standard", "Expected standard", "Needs attention", "Urgent improvement")
CARD_AREAS = ("Inclusion", "Curriculum and teaching", "Achievement",
              "Behaviour, attitudes and establishing routines", "Children's welfare and wellbeing",
              "Leadership and governance")
CARD = "EYR REIF: Most recent: "
POSTCODE = re.compile(r"^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$")
PEDESTRIAN_CLASS = "3"
CYCLIST_TYPE = "1"
CHILD_MAX_AGE = 15
# STATS19 casualty_type -> the map's road user (e-scooters are flagged separately, escooter_flag = 1).
ROAD_USER = {"0": "pedestrian", "1": "cyclist", "2": "motorcycle", "3": "motorcycle", "4": "motorcycle",
             "5": "motorcycle", "23": "motorcycle", "97": "motorcycle", "8": "car", "9": "car", "10": "bus",
             "11": "bus", "19": "goods", "20": "goods", "21": "goods", "98": "goods"}
AGE_BAND = {"1": "0-5", "2": "6-10", "3": "11-15", "4": "16-20", "5": "21-25", "6": "26-35", "7": "36-45",
            "8": "46-55", "9": "56-65", "10": "66-75", "11": "75+"}
DAYLIGHT, DARK = {"1"}, {"4", "5", "6", "7"}  # light_conditions: daylight; darkness lit, unlit or unknown lighting

SOURCES = {
    "nursery": {
        "prefix": "src-ofsted-early-years",
        "url": "https://www.gov.uk/government/statistical-data-sets/childcare-providers-and-inspections-management-information",
        "licence": "OGL-UK-3.0",
        "attribution": "Ofsted, Childcare providers and inspections management information. "
                       "Open Government Licence v3.0.",
        "caveats": [("London" if COVERAGE is coverage.LONDON else "England") + " childcare on non-domestic premises"
                    " on the Early Years Register; childminders "
                    "are not included because Ofsted withholds their addresses.",
                    "Well rated: Good or Outstanding at the last full inspection, or a report card "
                    "(from November 2025) with safeguarding met and no area below Expected standard."],
    },
    "casualty": {
        "prefix": "src-dft-stats19",
        "url": "https://www.gov.uk/government/statistical-data-sets/road-safety-open-data",
        "licence": "OGL-UK-3.0",
        "attribution": "Department for Transport, Road Safety Data (STATS19). Open Government Licence v3.0.",
        "caveats": ["Pedestrian and cyclist casualties in police-reported injury collisions; "
                    "many slight injuries are never reported to the police.",
                    "Placed at the collision's recorded point."],
    },
    "lane": {
        "prefix": "src-tfl-cycle-infrastructure",
        "url": "https://cycling.data.tfl.gov.uk/",
        "licence": "TfL-Open-Data",
        "attribution": "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights.",
        "caveats": ["Cycle lanes and tracks from the TfL Cycling Infrastructure Database (surveyed "
                    "2017-2019, files of September 2021); newer lanes may be missing.",
                    "Protected: segregated or stepped track. Cycleways: TfL's open signed routes."],
    },
}


COLLISION_METRIC = "road-collisions"
COLLISION_PERIOD_MONTH = "-01-01"
LEGEND_COLOURS = ("#3a7d44", "#7ba05b", "#f4d35e", "#c96a3b", "#b23a48")  # as the crime legend, lowest first
# Pedestrians and cyclists hurt (any severity) per LSOA: point-in-polygon, so a person hurt on a boundary
# road counts once. Only road_user and the point are read: never a date, time or sex.
COLLISION_COUNT_SQL = """
WITH lsoa AS (
    SELECT id, ST_Transform(geometry, 27700) AS geom FROM area_geography WHERE kind = 'lsoa'
), hurt AS (
    SELECT l.id, count(*) AS n
    FROM lsoa l JOIN collision_casualty c ON ST_Contains(l.geom, c.location)
    WHERE c.road_user IN ('pedestrian', 'cyclist')
    GROUP BY l.id
)
SELECT l.id AS geography_id, coalesce(h.n, 0) AS hurt
FROM lsoa l LEFT JOIN hurt h ON h.id = l.id"""


def collision_rates(hurt: Mapping[str, int], residents: Mapping[str, int],
                    years: int, regions: Mapping[str, str | None] | None = None) -> dict[str, tuple[float, int, int] | None]:
    """{lsoa: (hurt per 1,000 residents a year, percentile 0-100 within the LSOA's region, hurt)} for every
    LSOA in `residents`; None when it has no residents (unknown, not zero). No casualties is an observed 0.0.
    Without `regions` every LSOA ranks together (London's old rule)."""
    rate = {gid: round(hurt.get(gid, 0) / years / people * 1000, 2) if people else None
            for gid, people in residents.items()}
    # One percentile per tie group (the lowest rank in it): LSOAs with the same rate, above all the many
    # at 0.0, share a standing (issue #221).
    percentile = coverage.regional_percentiles(rate, regions or {}, rank=cr.ascending_percentiles)
    return {gid: None if value is None else (value, percentile[gid], hurt.get(gid, 0))
            for gid, value in rate.items()}


def collision_legend(rates: Iterable[float]) -> list[dict]:
    """Quintile legend over the LSOA rates, one decimal (crime_rates.legend_stops rounds to whole numbers)."""
    ordered = sorted(rates)
    if not ordered:
        return []
    cuts = [ordered[int(len(ordered) * q)] for q in (0.2, 0.4, 0.6, 0.8)] + [ordered[-1]]
    return [{"value": cut, "colour": colour, "label": f"{cut:.1f}" + ("+" if i == 4 else "")}
            for i, (cut, colour) in enumerate(zip(cuts, LEGEND_COLOURS))]


def collision_definition(years: str, legend: list[dict]) -> dict:
    return {
        "label": "Road collisions (rate)", "shortLabel": "Road collisions",
        "description": (f"Pedestrians and cyclists hurt in police-reported road collisions ({years}), "
                        "a year, for every 1,000 residents of the neighbourhood."),
        "legend": legend,
        "sourceId": "dft-stats19", "sourceName": "DfT road safety data (STATS19)",
        "methodologyPath": "/guide/crime", "freshness": years,
        "caveats": ["Pedestrians and cyclists only, every severity, placed at the collision's recorded point.",
                    "Many slight injuries are never reported to the police.",
                    "Population denominator: ONS mid-2024 LSOA estimates. Busy centres with few residents "
                    "come out high."],
    }


def well_rated(row: Mapping[str, str]) -> tuple[str | None, str | None, bool | None, str | None]:
    """(framework, grade word, well rated, inspection date ISO) of one provider row.
    A report card wins over an older overall-effectiveness grade; neither: not yet rated."""
    grades = [row.get(CARD + area, "").strip() for area in CARD_AREAS]
    grades = [grade for grade in grades if grade in CARD_GRADES]
    safeguarding = row.get(CARD + "Safeguarding standards met?", "").strip()
    if grades:
        weakest = max(grades, key=CARD_GRADES.index)
        good = safeguarding != "Not met" and CARD_GRADES.index(weakest) <= CARD_GRADES.index("Expected standard")
        word = "Safeguarding not met" if safeguarding == "Not met" else weakest
        return "report-card", word, good, iso_date(row.get(CARD + "Inspection date", ""))
    old = row.get("EYR OEIF/CIF: Most recent: Overall effectiveness", "").strip()
    if old in OLD_GRADES:
        return ("overall-effectiveness", OLD_GRADES[old], old in ("1", "2"),
                iso_date(row.get("EYR OEIF: Most recent: Full inspection date", "")))
    return None, None, None, None


def iso_date(text: str) -> str | None:
    """'21/11/2016' -> '2016-11-21'; anything else None."""
    match = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", text.strip())
    return f"{match[3]}-{match[2]}-{match[1]}" if match else None


def postcode(text: str) -> str | None:
    compact = re.sub(r"\s+", "", text or "").upper()
    spaced = f"{compact[:-3]} {compact[-3:]}" if len(compact) >= 5 else compact
    return spaced if POSTCODE.match(spaced) else None


def collision_in_coverage(code: str) -> bool:
    """A STATS19 local_authority_ons_district in the module's coverage (in_scope)."""
    return in_scope(code, COVERAGE)


def nurseries(lines: Iterable[str]) -> Iterator[list]:
    """Rows (urn, name, postcode, places, framework, grade, date, well_rated) of non-domestic Early Years
    settings in the coverage's regions. The CSV has two title lines before its header."""
    rows = iter(lines)
    for line in rows:
        if line.startswith("Web link,"):
            break
    header = next(csv.reader([line]))
    for row in csv.DictReader(rows, fieldnames=header):
        if (row["Region"].strip().lower() not in REGION_NAMES or row["Provider type"] != NURSERY_TYPE
                or row["Provider status"] != "Active" or row["Provider Early Years Register flag"] != "Y"):
            continue
        code = postcode(row["Provider postcode"])
        if not code:
            continue
        framework, grade, good, inspected = well_rated(row)
        places = row.get("Places", "").strip()
        yield [row["Provider URN"].strip(), row["Provider name"].strip(), code,
               int(places) if places.isdigit() else None, framework, grade, inspected, good]


def in_scope(district: str, cov: coverage.Coverage) -> bool:
    """A STATS19 collision's ONS district is in the ETL coverage. England also keeps districts merged
    away since (e.g. Cumbria's six, abolished in 2023): any English district code (E06-E09)."""
    return cov.contains_lad(district) or (cov is coverage.ENGLAND and district[:3] in coverage.LAD_PREFIXES)


def casualties(collisions: Iterable[Mapping[str, str]], people: Iterable[Mapping[str, str]],
               cov: coverage.Coverage | None = None) -> Iterator[list]:
    """Rows (collision, casualty ref, year, severity, road user, child, longitude, latitude)
    of pedestrians and cyclists hurt in collisions in the coverage (CLOSE_KNIT_ETL_COVERAGE)."""
    where = {}
    for row in collisions:
        if in_scope(row["local_authority_ons_district"], cov or COVERAGE) and row["longitude"] not in ("", "NULL", "-1"):
            where[row["collision_index"]] = (int(row["collision_year"]), float(row["longitude"]), float(row["latitude"]))
    for row in people:
        found = where.get(row["collision_index"])
        if not found:
            continue
        if row["casualty_class"] == PEDESTRIAN_CLASS:
            user = "pedestrian"
        elif row["casualty_type"] == CYCLIST_TYPE:
            user = "cyclist"
        else:
            continue
        age = int(row["age_of_casualty"]) if row["age_of_casualty"].lstrip("-").isdigit() else -1
        year, lon, lat = found
        yield [row["collision_index"], int(row["casualty_reference"]), year, int(row["casualty_severity"]),
               user, 0 <= age <= CHILD_MAX_AGE, lon, lat]


def all_casualties(collisions: Iterable[Mapping[str, str]], people: Iterable[Mapping[str, str]],
                   cov: coverage.Coverage | None = None) -> Iterator[list]:
    """Rows (collision, casualty ref, year, severity, road user, child, age band, dark, longitude, latitude)
    of everyone hurt in a collision in the coverage. No date, time or sex leaves this function."""
    where = {}
    for row in collisions:
        if in_scope(row["local_authority_ons_district"], cov or COVERAGE) and row["longitude"] not in ("", "NULL", "-1"):
            light = row["light_conditions"]
            dark = True if light in DARK else False if light in DAYLIGHT else None
            where[row["collision_index"]] = (int(row["collision_year"]), dark, float(row["longitude"]), float(row["latitude"]))
    for row in people:
        found = where.get(row["collision_index"])
        if not found:
            continue
        if row["casualty_class"] == PEDESTRIAN_CLASS:
            user = "pedestrian"
        elif row.get("escooter_flag") == "1":
            user = "escooter"
        else:
            user = ROAD_USER.get(row["casualty_type"], "other")
        age = int(row["age_of_casualty"]) if row["age_of_casualty"].lstrip("-").isdigit() else -1
        year, dark, lon, lat = found
        yield [row["collision_index"], int(row["casualty_reference"]), year, int(row["casualty_severity"]), user,
               0 <= age <= CHILD_MAX_AGE, AGE_BAND.get(row["age_band_of_casualty"]), dark, lon, lat]


def lanes(cid: Mapping, routes: Mapping) -> Iterator[list]:
    """Rows (id, kind, name, GeoJSON geometry) for CID lanes and tracks and open Cycleways."""
    for feature in cid["features"]:
        props, geometry = feature["properties"], feature.get("geometry")
        if not geometry:
            continue
        protected = props.get("CLT_SEGREG") == "TRUE" or props.get("CLT_STEPP") == "TRUE"
        yield [props["FEATURE_ID"], "protected" if protected else "lane", None, json.dumps(geometry)]
    for feature in routes["features"]:
        props, geometry = feature["properties"], feature.get("geometry")
        if not geometry or props.get("Status") != "Open":
            continue
        yield [f"cycleway-{props['OBJECTID']}", "cycleway", props.get("Route_Name") or props.get("Label"),
               json.dumps(geometry)]


def sha256(paths: Iterable[str]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        with open(path, "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
    return digest.hexdigest()


def copy_rows(cur, table: str, columns: str, rows: Iterable[list]) -> int:
    buffer = io.StringIO()
    count = 0
    writer = csv.writer(buffer)
    for row in rows:
        writer.writerow(row)
        count += 1
    buffer.seek(0)
    with cur.copy(f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
        copy.write(buffer.read())
    return count


def add_source(cur, key: str, release: str, paths: list[str]) -> str:
    """Insert a source release `<prefix>-<YYYY-MM>[-rN]` for these files and return its id."""
    meta = SOURCES[key]
    base = f"{meta['prefix']}-{release[:7]}"
    taken = {row["id"] for row in cur.execute("SELECT id FROM source_release WHERE id LIKE %s", (base + "%",))}
    revision = 1
    while (base if revision == 1 else f"{base}-r{revision}") in taken:
        revision += 1
    source_id = base if revision == 1 else f"{base}-r{revision}"
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
             attribution, transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)""",
        (source_id, meta["url"], release, sha256(paths), meta["licence"], meta["attribution"],
         ETL_VERSION, meta["caveats"]))
    return source_id


def one(folder: str, pattern: str) -> str:
    found = sorted(glob.glob(os.path.join(folder, pattern)))
    if not found:
        raise SystemExit(f"missing {pattern} in {folder}")
    return found[-1]


def ofsted_date(path: str) -> str:
    """'..._as_at_30_June_2026.csv' -> '2026-06-30'."""
    match = re.search(r"as_at_(\d{1,2})_([A-Za-z]+)_(\d{4})", path)
    if not match:
        raise SystemExit(f"no 'as at' date in {path}")
    months = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
              "october", "november", "december"]
    return date(int(match[3]), months.index(match[2].lower()) + 1, int(match[1])).isoformat()


# Nurseries sit at the mean point of their postcode's addresses, else at the point on surface of the
# postcode's LSOA (ONS postcode directory); a postcode with neither is dropped.
NURSERY_SQL = """INSERT INTO nursery_setting
  (urn, name, postcode, places, framework, grade, inspection_date, well_rated, location, source_release_id)
SELECT DISTINCT ON (n.urn) n.urn, n.name, n.postcode, n.places, n.framework, n.grade, n.inspection_date,
  n.well_rated, coalesce(ST_Transform(ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326), 27700),
                         ST_Transform(ST_PointOnSurface(g.geometry), 27700)), %s
FROM kids_nursery n
LEFT JOIN (SELECT postcode, avg(longitude) AS lon, avg(latitude) AS lat FROM address
           WHERE longitude IS NOT NULL AND postcode = ANY(%s) GROUP BY postcode) p ON p.postcode = n.postcode
LEFT JOIN postcode_civic c ON c.postcode = n.postcode
LEFT JOIN area_geography g ON g.id = 'uk:lsoa:' || c.lsoa_code
WHERE p.postcode IS NOT NULL OR g.id IS NOT NULL
ORDER BY n.urn"""

# The map's childcare place within 100 m whose name is most alike (trigram similarity 0.4+).
PLACE_MATCH_SQL = """UPDATE nursery_setting n SET place_id = m.id FROM (
  SELECT DISTINCT ON (n2.urn) n2.urn, p.id
  FROM nursery_setting n2 JOIN place p
    ON p.category IN ('childcare', 'kindergarten')
   AND ST_DWithin(ST_Transform(p.location, 27700), n2.location, 100)
   AND similarity(lower(p.name), lower(n2.name)) >= 0.4
  ORDER BY n2.urn, similarity(lower(p.name), lower(n2.name)) DESC) m
WHERE m.urn = n.urn"""


def load_collision_metric(cur, source_id: str) -> int:
    """Replace the `road-collisions` metric (one value per LSOA with residents); returns how many."""
    first, last = cur.execute("SELECT min(year) AS a, max(year) AS b FROM collision_casualty").fetchone().values()
    hurt = {row["geography_id"]: row["hurt"] for row in cur.execute(COLLISION_COUNT_SQL)}
    residents = dict.fromkeys(hurt, 0)  # an LSOA with no population figure stays unknown
    residents.update({row["geography_id"]: row["population"] for row in cur.execute(
        "SELECT p.geography_id, p.population FROM area_population p JOIN area_geography g"
        " ON g.id = p.geography_id WHERE g.kind = 'lsoa'")})
    regions = {row["area_id"]: row["region_code"] for row in cur.execute(
        "SELECT area_id, region_code FROM area_region WHERE area_id LIKE 'uk:lsoa:%%'")}
    rates = collision_rates(hurt, residents, last - first + 1, regions)
    span = f"{first}-{last}"
    legend = collision_legend(r[0] for r in rates.values() if r is not None)
    cur.execute("DELETE FROM metric_value WHERE metric_id = %s", (COLLISION_METRIC,))
    cur.execute(
        """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
           VALUES (%s, 'lsoa', 'per-1000-residents-per-year', 'higher-is-more', %s, %s)
           ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, unit = EXCLUDED.unit,
             source_release_id = EXCLUDED.source_release_id""",
        (COLLISION_METRIC, json.dumps(collision_definition(span, legend)), source_id))
    period = f"{last}{COLLISION_PERIOD_MONTH}"
    rows = []
    for gid in sorted(residents):
        found = rates[gid]
        rows.append([gid, COLLISION_METRIC, period, "", "", "", "suppressed", source_id] if found is None
                    else [gid, COLLISION_METRIC, period, found[0], found[1], found[2], "observed", source_id])
    copy_rows(cur, "metric_value", "geography_id, metric_id, period, value, region_percentile, sample_count,"
              " quality, source_release_id", rows)
    return sum(1 for r in rates.values() if r is not None)


def load_casualties(cur, collision: str, casualty: str, source_id: str,
                    cov: coverage.Coverage) -> tuple[int, int]:
    """Fill road_casualty (pedestrians and cyclists) and collision_casualty (everyone hurt) from the
    STATS19 files for the coverage; returns (pedestrians and cyclists, everyone)."""
    cur.execute("""CREATE TEMP TABLE kids_casualty (collision_index text, casualty_reference integer,
                   year smallint, severity smallint, road_user text, child boolean, lon float8, lat float8)
                   ON COMMIT DROP""")
    with open(collision, newline="") as a, open(casualty, newline="") as b:
        hurt = copy_rows(cur, "kids_casualty", "collision_index, casualty_reference, year, severity, road_user,"
                         " child, lon, lat", casualties(csv.DictReader(a), csv.DictReader(b), cov))
    cur.execute("""INSERT INTO road_casualty SELECT collision_index, casualty_reference, year, severity,
                   road_user, child, ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 27700), %s
                   FROM kids_casualty""", (source_id,))

    cur.execute("""CREATE TEMP TABLE kids_collision (collision_index text, casualty_reference integer,
                   year smallint, severity smallint, road_user text, child boolean, age_band text, dark boolean,
                   lon float8, lat float8) ON COMMIT DROP""")
    with open(collision, newline="") as a, open(casualty, newline="") as b:
        everyone = copy_rows(cur, "kids_collision", "collision_index, casualty_reference, year, severity, road_user,"
                             " child, age_band, dark, lon, lat", all_casualties(csv.DictReader(a), csv.DictReader(b), cov))
    cur.execute("""INSERT INTO collision_casualty SELECT collision_index, casualty_reference, year, severity,
                   road_user, child, age_band, dark, ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 27700), %s
                   FROM kids_collision""", (source_id,))
    return hurt, everyone


def load(url: str, folder: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    ofsted = one(folder, "Management_information_-_childcare_providers*as_at_*.csv")
    collision = one(folder, "dft-road-casualty-statistics-collision-last-5-years.csv")
    casualty = one(folder, "dft-road-casualty-statistics-casualty-last-5-years.csv")
    cid, routes = one(folder, "cycle_lane_track.json"), one(folder, "CycleRoutes.json")
    with open(collision, newline="") as handle:
        stats19_year = max(int(row["collision_year"]) for row in csv.DictReader(handle))

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        old = cur.execute("SELECT DISTINCT unnest(source_release_ids) AS id FROM area_kids").fetchall()
        sources = {
            "nursery": add_source(cur, "nursery", ofsted_date(ofsted), [ofsted]),
            "casualty": add_source(cur, "casualty", f"{stats19_year}-12-31", [collision, casualty]),
            "lane": add_source(cur, "lane", "2021-09-19", [cid, routes]),
        }
        cur.execute("TRUNCATE nursery_setting, road_casualty, cycle_lane, collision_casualty")

        cur.execute("""CREATE TEMP TABLE kids_nursery (urn text, name text, postcode text, places integer,
                       framework text, grade text, inspection_date date, well_rated boolean) ON COMMIT DROP""")
        with open(ofsted, encoding="utf-8-sig", newline="") as handle:
            read = copy_rows(cur, "kids_nursery", "urn, name, postcode, places, framework, grade, inspection_date,"
                             " well_rated", nurseries(handle))
        codes = [row["postcode"] for row in cur.execute("SELECT DISTINCT postcode FROM kids_nursery")]
        placed = cur.execute(NURSERY_SQL, (sources["nursery"], codes)).rowcount
        matched = cur.execute(PLACE_MATCH_SQL).rowcount

        hurt, everyone = load_casualties(cur, collision, casualty, sources["casualty"], coverage.from_env())

        cur.execute("""CREATE TEMP TABLE kids_lane (id text, kind text, name text, geojson text) ON COMMIT DROP""")
        with open(cid) as a, open(routes) as b:
            lines = copy_rows(cur, "kids_lane", "id, kind, name, geojson", lanes(json.load(a), json.load(b)))
        cur.execute("""INSERT INTO cycle_lane SELECT DISTINCT ON (id) id, kind, name,
                       ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geojson), 4326), 27700), %s
                       FROM kids_lane ORDER BY id""", (sources["lane"],))

        areas = cur.execute("SELECT rebuild_area_kids() AS n").fetchone()["n"]
        scored = load_collision_metric(cur, sources["casualty"])
        print(json.dumps({"nurseries": read, "placed": placed, "matchedPlaces": matched,
                          "casualties": hurt, "allCasualties": everyone, "lanes": lines, "areas": areas,
                          "roadCollisionsLsoas": scored}), flush=True)
        stage_release.stage(cur, "kids", list(sources.values()),
                            replace=tuple(row["id"] for row in old if row["id"] not in sources.values()))


def load_roads(url: str, folder: str) -> None:
    """Only the STATS19 part of `load`: replace road_casualty, collision_casualty and the road-collisions
    metric for the coverage (default England), rebuild area_kids and stage a release that drops the earlier
    STATS19 build. Nurseries and cycle lanes stay as they are."""
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    collision = one(folder, "dft-road-casualty-statistics-collision-last-5-years.csv")
    casualty = one(folder, "dft-road-casualty-statistics-casualty-last-5-years.csv")
    with open(collision, newline="") as handle:
        stats19_year = max(int(row["collision_year"]) for row in csv.DictReader(handle))
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        old = {row["id"] for row in cur.execute(
            "SELECT DISTINCT source_release_id AS id FROM road_casualty UNION "
            "SELECT DISTINCT source_release_id FROM collision_casualty")}
        source_id = add_source(cur, "casualty", f"{stats19_year}-12-31", [collision, casualty])
        cur.execute("TRUNCATE road_casualty, collision_casualty")
        hurt, everyone = load_casualties(cur, collision, casualty, source_id, coverage.from_env())
        areas = cur.execute("SELECT rebuild_area_kids() AS n").fetchone()["n"]
        scored = load_collision_metric(cur, source_id)
        print(json.dumps({"source": source_id, "casualties": hurt, "allCasualties": everyone, "areas": areas,
                          "roadCollisionsLsoas": scored}), flush=True)
        stage_release.stage(cur, "roads", [source_id], replace=tuple(sorted(old - {source_id})))


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "load":
        load(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == "roads":
        load_roads(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
