"""Load stations, parks and amenities (migration 017) and raw-tag places (027) from OSM and TfL.

  AE_WORK=~/data/aework/places python3 -m area_analytics.places_load extract
  python3 -m area_analytics.places_load load <database-url> [--no-poi]   # needs psycopg
  python3 -m area_analytics.places_load load-poi <database-url>          # place_poi only

The coverage is CLOSE_KNIT_ETL_COVERAGE (area_analytics.coverage): ``london`` reads the Geofabrik
Greater London extract (release src-osm-places-2026-09-09, plain work files in ~/data/aework/places);
``england`` (the default) reads Geofabrik's England extract (PLACES_PBF, default
~/data/england-2026-10/places/osm/england-261020.osm.pbf; release src-osm-places-england-2026-10-20)
and writes gzipped exports to AE_WORK (default ~/data/england-2026-10/places/work/osm). Fare zones and
lines stay TfL's, so stations outside London have none. ``--no-poi`` keeps place_poi as it is (England's
raw tags are ~1.5 GB in the database; places_unified reads them from the export instead).

``extract`` filters the Geofabrik extract with ``osmium``
(tags-filter, then export to GeoJSON lines). ``load`` classifies every
feature (``places.classify``), attaches TfL zones and lines from the StopPoint
files in ~/data/tfl, registers two source releases (OSM, TfL) and replaces the
rows of place_station, place_park and place_amenity in one transaction. Park
areas are measured by PostGIS on the WGS84 spheroid. A second, broad extract
(``POI_FILTERS``) fills place_poi with every place's raw tags for custom
criteria; ``load`` replaces it in the same transaction, ``load-poi`` alone.
"""
from __future__ import annotations

import glob
import hashlib
import io
import json
import os
import subprocess
import sys

from . import coverage, workfiles
from .places import build_stations, classify, poi, tfl_stations

COVERAGE = coverage.from_env()
DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
GEOFABRIK = "https://download.geofabrik.de/europe/united-kingdom/england"
if COVERAGE.name == "london":
    WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "places"))
    PBF = os.path.join(DATA, "osm", "greater-london-latest.osm.pbf")
    OSM_RELEASE, OSM_DATE, OSM_URL = ("src-osm-places-2026-09-09", "2026-09-09",
                                      f"{GEOFABRIK}/greater-london-latest.osm.pbf")
else:  # England: Geofabrik's dated extract of 2026-10-20 (the one the transport group reads too)
    WORK = os.environ.get("AE_WORK", os.path.join(DATA, "england-2026-10", "places", "work", "osm"))
    PBF = os.environ.get("PLACES_PBF", os.path.join(DATA, "england-2026-10", "places", "osm",
                                                    "england-261020.osm.pbf"))
    OSM_RELEASE, OSM_DATE, OSM_URL = ("src-osm-places-england-2026-10-20", "2026-10-20",
                                      f"{GEOFABRIK}-261020.osm.pbf")
TFL_FILES = sorted(glob.glob(os.path.join(DATA, "tfl", "stoppoints-*.json")))
EXPORT = workfiles.name(WORK, "places.geojsonseq", COVERAGE)
POI_EXPORT = workfiles.name(WORK, "poi.geojsonseq", COVERAGE)
ETL_VERSION = "close-knit-places-1"
TFL_RELEASE = "src-tfl-stoppoints-2026-10-05"
FILTERS = (
    "nwr/railway=station,halt,tram_stop", "nwr/public_transport=station",
    "nwr/leisure=park,garden,nature_reserve,common", "nwr/landuse=recreation_ground,village_green",
    "nwr/shop=supermarket,convenience", "nwr/amenity=pub,bar,cafe,restaurant,pharmacy,doctors",
    "nwr/healthcare=pharmacy,doctor",
    "nwr/leisure=fitness_centre,swimming_pool,water_park,sports_centre", "nwr/club=sport",
)
# Custom criteria count any of these places by their raw tags (migration 027, places.poi).
POI_FILTERS = tuple(f"nwr/{key}" for key in ("amenity", "shop", "leisure", "tourism", "craft", "healthcare",
                                              "office", "club"))
OSM_ATTRIBUTION = "© OpenStreetMap contributors, available under the Open Database Licence (ODbL)."
TFL_ATTRIBUTION = ("Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016 "
                   "and Geomni UK Map data © and database rights [2019].")
CAVEATS = [
    "Places come from OpenStreetMap, which volunteers keep up to date; a new shop or a closed pub may be missing.",
    "Distances are straight lines from the area's centre or the home, not walking routes.",
    "Fare zones and lines are TfL's; stations TfL does not list show them as unknown.",
]


def _export(filtered: str, out: str) -> None:
    """osmium export to GeoJSON lines; a .gz target is written through gzip (England's run to GBs)."""
    args = ["osmium", "export", filtered, "-O", "-f", "geojsonseq", "--geometry-types=point,polygon",
            "-a", "type,id"]
    if not out.endswith(".gz"):
        subprocess.run([*args, "-o", out], check=True)
        return
    with open(out, "wb") as handle:
        osmium = subprocess.Popen([*args, "-o", "-"], stdout=subprocess.PIPE)
        subprocess.run(["gzip", "-6"], stdin=osmium.stdout, stdout=handle, check=True)
        osmium.stdout.close()
        if osmium.wait():
            raise subprocess.CalledProcessError(osmium.returncode, args)


def extract() -> None:
    os.makedirs(WORK, exist_ok=True)
    filtered = os.path.join(WORK, "places.osm.pbf")
    subprocess.run(["osmium", "tags-filter", PBF, *FILTERS, "-O", "-o", filtered], check=True)
    _export(filtered, EXPORT)
    print(f"extract: {EXPORT}")
    poi_filtered = os.path.join(WORK, "poi.osm.pbf")
    subprocess.run(["osmium", "tags-filter", PBF, *POI_FILTERS, "-O", "-o", poi_filtered], check=True)
    _export(poi_filtered, POI_EXPORT)
    print(f"extract: {POI_EXPORT}")


def read_features(path: str = EXPORT):
    with workfiles.open_text(path) as handle:
        for line in handle:
            line = line.strip().lstrip("\x1e")
            if line:
                yield json.loads(line)


def sha256(paths: list[str]) -> str:
    digest = hashlib.sha256()
    for path in paths:
        with open(path, "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
    return digest.hexdigest()


def _tsv(*values) -> str:
    def cell(value):
        if value is None:
            return r"\N"
        return str(value).replace("\\", "\\\\").replace("\t", " ").replace("\n", " ")
    return "\t".join(cell(value) for value in values) + "\n"


def load(url: str, with_poi: bool = True) -> None:
    import psycopg

    features, places = {}, []
    for feature in read_features():
        place = classify(feature)
        if place is None or place.osm_id in features:
            continue
        features[place.osm_id] = feature
        places.append(place)
    tfl = tfl_stations(json.load(open(path, encoding="utf-8")) for path in TFL_FILES)
    stations = build_stations(places, tfl)
    parks = [p for p in places if p.category == "park"]
    amenities = [p for p in places if p.category == "amenity"]

    station_rows = io.StringIO()
    for s in stations:
        station_rows.write(_tsv(
            s.osm_ids[0], "{" + ",".join(s.osm_ids) + "}", s.name, "{" + ",".join(s.modes) + "}",
            s.zone, json.dumps(s.lines), "{" + ",".join(s.tfl_ids) + "}",
            f"SRID=4326;POINT({s.lon} {s.lat})", OSM_RELEASE, TFL_RELEASE if s.tfl_ids else None))
    park_rows = io.StringIO()
    for p in parks:
        park_rows.write(_tsv(p.osm_id, p.name, p.kind, json.dumps(features[p.osm_id]["geometry"])))
    amenity_rows = io.StringIO()
    for a in amenities:
        amenity_rows.write(_tsv(a.osm_id, a.name, a.group, a.kind, a.brand, a.sport, f"SRID=4326;POINT({a.lon} {a.lat})", OSM_RELEASE))

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        _release(cur, OSM_RELEASE, OSM_URL, OSM_DATE, sha256([PBF]), "ODbL-1.0", OSM_ATTRIBUTION)
        _release(cur, TFL_RELEASE, "https://api.tfl.gov.uk/StopPoint/Mode/{mode}",
                 "2026-10-05", sha256(TFL_FILES), "TfL-open-data (OGL-2.0 based)", TFL_ATTRIBUTION)
        cur.execute("DELETE FROM place_station; DELETE FROM place_park; DELETE FROM place_amenity")
        _copy(cur, "place_station (id, osm_ids, name, modes, zone, lines, tfl_ids, location, source_release_id, "
                   "tfl_source_release_id)", station_rows)
        cur.execute("CREATE TEMP TABLE park_stage (id text, name text, kind text, geojson text) ON COMMIT DROP")
        _copy(cur, "park_stage (id, name, kind, geojson)", park_rows)
        cur.execute(
            """INSERT INTO place_park (id, name, kind, area_hectares, geometry, source_release_id)
               SELECT id, name, kind, round((ST_Area(geom::geography) / 10000)::numeric, 2), geom, %s
               FROM (SELECT id, name, kind,
                       ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(geojson), 4326)), 3)) AS geom
                     FROM park_stage) s
               WHERE NOT ST_IsEmpty(geom)""", (OSM_RELEASE,))
        # Overview London ranks (migration 054) derive park distance from place_park: refresh them here.
        if cur.execute("SELECT to_regproc('public.rebuild_area_rank') IS NOT NULL").fetchone()[0]:
            cur.execute("SELECT rebuild_area_rank()")
        _copy(cur, "place_amenity (id, name, amenity_group, kind, brand, sport, location, source_release_id)", amenity_rows)
        if with_poi and os.path.exists(POI_EXPORT):
            _load_poi(cur)
        counts = cur.execute("SELECT (SELECT count(*) FROM place_station), (SELECT count(*) FROM place_park), "
                             "(SELECT count(*) FROM place_amenity)").fetchone()
    matched = sum(1 for s in stations if s.tfl_ids)
    print(f"load: {counts[0]} stations ({matched} with TfL zone/lines), {counts[1]} parks, {counts[2]} amenities")


def poi_rows(features) -> io.StringIO:
    """TSV rows for place_poi, one per OSM object (the first copy wins)."""
    rows, seen = io.StringIO(), set()
    for feature in features:
        place = poi(feature)
        if place is None or place[0] in seen:
            continue
        osm_id, tags, lon, lat = place
        seen.add(osm_id)
        rows.write(_tsv(osm_id, json.dumps(tags, ensure_ascii=False), f"SRID=4326;POINT({lon} {lat})", OSM_RELEASE))
    return rows


# Each place's LSOA (migration 038): custom criteria count the places inside each area's boundary with a
# GROUP BY instead of a point-in-polygon join per request. A place on a shared boundary goes to one of the
# two areas; one outside the database's LSOAs keeps NULL.
LSOA_SQL = """UPDATE {table} p SET lsoa_id = g.id
FROM area_geography g
WHERE g.kind = 'lsoa' AND ST_Intersects(g.geometry, p.location)"""


def assign_lsoa(cur, table: str) -> None:
    """Fills lsoa_id for every row of a place table (place, place_poi or a staging copy of one)."""
    cur.execute(LSOA_SQL.format(table=table))


def _load_poi(cur) -> int:
    cur.execute("DELETE FROM place_poi")
    _copy(cur, "place_poi (id, tags, location, source_release_id)", poi_rows(read_features(POI_EXPORT)))
    assign_lsoa(cur, "place_poi")
    count = cur.execute("SELECT count(*) FROM place_poi").fetchone()[0]
    print(f"load: {count} places with raw tags")
    return count


def load_poi(url: str) -> None:
    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        _release(cur, OSM_RELEASE, OSM_URL, OSM_DATE, sha256([PBF]), "ODbL-1.0", OSM_ATTRIBUTION)
        _load_poi(cur)


def _copy(cur, target: str, rows: io.StringIO) -> None:
    rows.seek(0)
    with cur.copy(f"COPY {target} FROM STDIN") as copy:
        copy.write(rows.read())


def _release(cur, release_id: str, source_url: str, release_date: str, digest: str, licence: str,
             attribution: str) -> None:
    # source_release rows are immutable: a re-run with the same inputs reuses
    # the row; changed inputs need a new release id.
    row = cur.execute("SELECT sha256 FROM source_release WHERE id = %s", (release_id,)).fetchone()
    if row:
        if row[0] != digest:
            raise SystemExit(f"{release_id} exists with other inputs; bump the release id")
        return
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
             transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)""",
        (release_id, source_url, release_date, digest, licence, attribution, ETL_VERSION, CAVEATS))


def main(argv: list[str]) -> None:
    if argv[:1] == ["extract"]:
        extract()
    elif argv[:1] == ["load"] and len(argv) in (2, 3) and argv[2:] in ([], ["--no-poi"]):
        load(argv[1], with_poi=argv[2:] != ["--no-poi"])
    elif argv[:1] == ["load-poi"] and len(argv) == 2:
        load_poi(argv[1])
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
