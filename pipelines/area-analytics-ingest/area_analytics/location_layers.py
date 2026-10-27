"""Location layers (stream G3, migration 030; England: migration 113).

Open sources, each its own source release:
  conservation   Conservation Areas, Greater London Authority (London Datastore
                 dataset emqwg, GeoPackage, OGL v3; indicative boundaries from
                 the boroughs, OS "presumption to publish").
  conservation   Outside London (coverage England, the default; area_analytics.coverage):
  (England)      planning.data.gov.uk conservation-area (OGL v3), as councils, national
                 parks and Historic England publish them. Councils that publish none stay
                 unknown (migration 113: no conservation release for their areas).
  charge-zones   Ultra Low Emission Zone (29 August 2023 boundary) and Central
                 London Congestion Charging Scheme (v8, 26 May 2019) boundaries,
                 Transport for London open data (shapefiles, TfL terms based on
                 OGL v2.0).
  planning       Planning applications validated in the last 24 months, Planning
                 London Datahub (GLA, guest search API, OGL v3). Conditions,
                 amendments, tree works, adverts and certificates for existing
                 uses are left out: the count is new proposals, not paperwork.

  python3 -m area_analytics.location_layers download            # files into $AE_DATA/location
  python3 -m area_analytics.location_layers load <database-url>  # needs psycopg

The England files (conservation-area.csv, organisation.csv) are read from $AE_PLANNING_DATA
(default: the work folder); `download` fetches them there when they are missing.
ULEZ, the Congestion Charge and the Planning London Datahub stay London-only.

The load fills `conservation_area`, `charge_zone` and `planning_application`,
then `rebuild_area_location(...)` (migration 030) fills `area_location`: each
LSOA, MSOA and borough's land in a conservation area, in the ULEZ and in the
Congestion Charge zone, and its planning applications in the window.
"""
from __future__ import annotations

import csv
import datetime
import gzip
import hashlib
import json
import os
import sqlite3
import struct
import sys
import urllib.request
import zipfile

from . import coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "location"))
PLANNING_DATA = os.environ.get("AE_PLANNING_DATA", WORK)
NATIONAL_CONSERVATION_URL = "https://files.planning.data.gov.uk/dataset/conservation-area.csv"
NATIONAL_CONSERVATION_PAGE = "https://www.planning.data.gov.uk/dataset/conservation-area"
ORGANISATIONS_URL = "https://files.planning.data.gov.uk/organisation-collection/dataset/organisation.csv"
ETL_VERSION = "close-knit-location-1"

CONSERVATION_URL = ("https://data.london.gov.uk/download/emqwg/b38eae6d-10db-4c79-afdd-dd97ae367b8b/"
                    "Conservation_Areas.gpkg")
CONSERVATION_PAGE = "https://data.london.gov.uk/dataset/conservation-areas"
ZONE_FILES = {
    "ulez": ("https://s3.eu-west-1.amazonaws.com/roads.data.tfl.gov.uk/Boundaries/"
             "ULEZ_Boundary_20230829_Shape+Files.zip", "ULEZ_Boundary_20230829_Shape_Files.zip", "LEZ.shp"),
    "congestion-charge": ("https://s3-eu-west-1.amazonaws.com/roads.data.tfl.gov.uk/boundaries/"
                          "CC_Boundary_v8_20190526_tab_shape.zip", "CC_Boundary_v8_20190526_tab_shape.zip",
                          "CLoCCS_Boundary_v8.shp"),
}
ZONES_PAGE = "https://tfl.gov.uk/info-for/open-data-users/our-open-data"
PLANNING_SEARCH = "https://planningdata.london.gov.uk/api-guest/applications/_search"
PLANNING_PAGE = "https://www.london.gov.uk/programmes-strategies/planning/digital-planning/planning-london-datahub"
PLANNING_MONTHS = 24
PAGE_LIMIT = 10_000  # the search API returns at most this many hits per query

# application_type_full values that are paperwork on an existing proposal, not a new one.
PLANNING_EXCLUDED = (
    "Approval of details reserved by a condition (discharge)", "Non-Material Amendment",
    "Removal/Variation of a condition", "S73 Minor Material Amendment",
    "Tree works: Trees in conservation areas/subject to TPOs", "Consent to display an advertisement",
    "Lawful development: Existing use",
)


def planning_category(application_type: str) -> str:
    """householder, full (full, outline and reserved matters), prior-approval or other."""
    text = application_type.lower()
    if text.startswith("householder"):
        return "householder"
    if text.startswith(("full planning", "outline planning", "approval of reserved matters")):
        return "full"
    if text.startswith("prior approval"):
        return "prior-approval"
    return "other"


def window(today: datetime.date, months: int = PLANNING_MONTHS) -> tuple[datetime.date, datetime.date]:
    """The planning window: the same day `months` earlier (clamped to month end) up to today."""
    year, month = divmod(today.year * 12 + today.month - 1 - months, 12)
    month += 1
    day = today.day
    while True:
        try:
            return datetime.date(year, month, day), today
        except ValueError:
            day -= 1


def weeks(start: datetime.date, end: datetime.date):
    """[start, end) seven-day slices covering start..end inclusive."""
    day = start
    while day <= end:
        yield day, min(day + datetime.timedelta(days=7), end + datetime.timedelta(days=1))
        day += datetime.timedelta(days=7)


def planning_query(start: datetime.date, stop: datetime.date) -> dict:
    """Applications validated in [start, stop), excluding paperwork, with only the fields we keep."""
    return {
        "size": PAGE_LIMIT, "track_total_hits": True,
        "_source": ["valid_date", "application_type_full", "centroid"],
        "sort": [{"_doc": "asc"}],
        "query": {"bool": {
            "filter": [{"range": {"valid_date": {"gte": start.strftime("%d/%m/%Y"), "lt": stop.strftime("%d/%m/%Y"),
                                                 "format": "dd/MM/yyyy"}}}],
            "must_not": [{"terms": {"application_type_full.raw": list(PLANNING_EXCLUDED)}}],
        }},
    }


def planning_record(hit: dict) -> dict | None:
    """One kept application, or None without a date, a type or a usable centroid."""
    source = hit.get("_source") or {}
    centroid = source.get("centroid") or {}
    try:
        valid = datetime.datetime.strptime(source.get("valid_date") or "", "%d/%m/%Y").date()
        lat, lon = float(centroid["lat"]), float(centroid["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    kind = source.get("application_type_full")
    # Some boroughs publish the grid origin (0, 0) for a missing location: far outside London.
    if not kind or not (51.2 <= lat <= 51.8 and -0.6 <= lon <= 0.4):
        return None
    return {"id": hit["_id"], "validDate": valid.isoformat(), "type": kind, "category": planning_category(kind),
            "lat": lat, "lon": lon}


def _post(url: str, body: dict) -> dict:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "close-knit-etl"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def _fetch(url: str, path: str) -> None:
    if os.path.exists(path):
        return
    urllib.request.urlretrieve(url, path + ".part")
    os.replace(path + ".part", path)


def planning_path() -> str:
    return os.path.join(WORK, "planning-applications.jsonl.gz")


def download(today: datetime.date | None = None) -> None:
    os.makedirs(WORK, exist_ok=True)
    _fetch(CONSERVATION_URL, os.path.join(WORK, "Conservation_Areas.gpkg"))
    if coverage.from_env().name != "london":
        os.makedirs(PLANNING_DATA, exist_ok=True)
        _fetch(NATIONAL_CONSERVATION_URL, os.path.join(PLANNING_DATA, "conservation-area.csv"))
        _fetch(ORGANISATIONS_URL, os.path.join(PLANNING_DATA, "organisation.csv"))
    for url, name, _ in ZONE_FILES.values():
        _fetch(url, os.path.join(WORK, name))
    start, end = window(today or datetime.date.today())
    kept = 0
    with gzip.open(planning_path() + ".part", "wt") as out:
        out.write(json.dumps({"windowStart": start.isoformat(), "windowEnd": end.isoformat()}) + "\n")
        for low, high in weeks(start, end):
            payload = _post(PLANNING_SEARCH, planning_query(low, high))
            total = payload["hits"]["total"]["value"]
            if total >= PAGE_LIMIT:
                raise SystemExit(f"planning: {total} applications in the week from {low}; split the window")
            for hit in payload["hits"]["hits"]:
                record = planning_record(hit)
                if record:
                    out.write(json.dumps(record) + "\n")
                    kept += 1
    os.replace(planning_path() + ".part", planning_path())
    print(f"planning: {kept} applications from {start} to {end}")


# ---- readers ---------------------------------------------------------------------------------

def gpkg_wkb(blob: bytes) -> bytes:
    """The WKB inside a GeoPackage geometry blob (header 'GP', version, flags, srs id, envelope)."""
    if blob[:2] != b"GP":
        raise ValueError("not a GeoPackage geometry")
    envelope = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(blob[3] >> 1) & 0x07]
    return blob[8 + envelope:]


def conservation_rows(path: str):
    """(id, name, borough, wkb) for every conservation area polygon in the GLA GeoPackage (BNG). The id is
    the feature id: one area can be published as several features under one site reference."""
    with sqlite3.connect(path) as db:
        for fid, name, borough, geom in db.execute(
                "SELECT fid, sitename, borough, geom FROM conservation_areas "
                "WHERE geom IS NOT NULL AND coalesce(removeddate, '') = ''"):
            yield f"gla:{fid}", (name or "Conservation area").strip(), borough, gpkg_wkb(geom)


def shapefile_rings(data: bytes) -> list[list[list[tuple[float, float]]]]:
    """Each polygon record of a .shp file (types 5 Polygon, 15 PolygonZ, 25 PolygonM) as its rings of
    (x, y); Z and M values are skipped."""
    records = []
    offset = 100
    while offset + 8 <= len(data):
        length = struct.unpack(">i", data[offset + 4:offset + 8])[0] * 2
        body = data[offset + 8:offset + 8 + length]
        offset += 8 + length
        shape = struct.unpack("<i", body[:4])[0]
        if shape == 0:
            continue
        if shape not in (5, 15, 25):
            raise ValueError(f"not a polygon shapefile (shape type {shape})")
        parts, points = struct.unpack("<2i", body[36:44])
        starts = list(struct.unpack(f"<{parts}i", body[44:44 + 4 * parts])) + [points]
        base = 44 + 4 * parts
        xy = [struct.unpack("<2d", body[base + 16 * i:base + 16 * i + 16]) for i in range(points)]
        records.append([xy[starts[i]:starts[i + 1]] for i in range(parts)])
    return records


def signed_area(ring: list[tuple[float, float]]) -> float:
    """Shoelace area: negative for a clockwise ring (a shapefile outer ring), positive for a hole."""
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1])) / 2


def polygon_wkt(rings: list[list[tuple[float, float]]]) -> str:
    """A MULTIPOLYGON for one shapefile record: each clockwise ring starts a polygon and the
    counter-clockwise rings after it are its holes (the shapefile convention)."""
    polygons: list[list[list[tuple[float, float]]]] = []
    for ring in rings:
        if signed_area(ring) <= 0 or not polygons:
            polygons.append([ring])
        else:
            polygons[-1].append(ring)
    return "MULTIPOLYGON(" + ",".join(
        "(" + ",".join("(" + ",".join(f"{x} {y}" for x, y in ring) + ")" for ring in polygon) + ")"
        for polygon in polygons) + ")"


def zone_wkts(zone: str) -> list[str]:
    _, name, member = ZONE_FILES[zone]
    with zipfile.ZipFile(os.path.join(WORK, name)) as archive:
        return [polygon_wkt(rings) for rings in shapefile_rings(archive.read(member))]


def national_conservation_rows(rows, organisations, cov: coverage.Coverage | None = None):
    """(id, name, LAD or publisher name, WKT in WGS84) for live conservation areas from planning.data.gov.uk,
    leaving out London councils' own (the GLA's set covers London) and anything outside the coverage's
    councils. Areas from a publisher that is not a council (national parks, Historic England) are kept;
    the load drops those inside London and those another council already published."""
    cov = cov or coverage.from_env()
    publishers = {row["entity"]: row for row in organisations}
    for row in rows:
        if row.get("end-date") or not row.get("geometry"):
            continue
        publisher = publishers.get(row.get("organisation-entity", ""), {})
        lad = publisher.get("statistical-geography", "")
        if publisher.get("dataset") == "local-authority":  # a pre-2023 code (Barnsley, Sheffield): by name
            lad = coverage.current_lad(lad, publisher.get("name", ""), publisher.get("region")) or lad
        if lad[:3] in coverage.LAD_PREFIXES:
            if not cov.contains_lad(lad) or coverage.region_of_lad(lad) == coverage.LONDON_REGION:
                continue
            borough, prefix = coverage.lad_name(lad), "pd"
        elif lad and not lad.startswith("E"):  # a Welsh or Scottish publisher
            continue
        else:
            borough, prefix = publisher.get("name") or None, "pdo"
        yield (f"{prefix}:{row['entity']}", (row.get("name") or "Conservation area").strip(), borough,
               row["geometry"])


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---- load ------------------------------------------------------------------------------------

CONSERVATION_ATTRIBUTION = (
    "Conservation Areas, Greater London Authority (London Datastore), licensed under the Open Government "
    "Licence v3.0. Contains OS data © Crown copyright and database right.")
CONSERVATION_CAVEATS = [
    "Boundaries are indicative; the borough's own conservation area map is the authority.",
    "Extra planning controls apply inside a conservation area (demolition, some extensions, trees); "
    "Article 4 directions and listed buildings are separate and not shown.",
]
ZONES_ATTRIBUTION = "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights."
ZONES_CAVEATS = [
    "Boundaries as TfL publishes them (ULEZ 29 August 2023; Congestion Charge zone v8, 2019).",
    "Charges, hours and exemptions change; check TfL before relying on them.",
]
PLANNING_ATTRIBUTION = (
    "Planning London Datahub, Greater London Authority, licensed under the Open Government Licence v3.0.")
PLANNING_CAVEATS = [
    "Applications validated in the window, by the site's centroid; conditions, amendments, tree works, "
    "adverts and certificates for existing uses are not counted.",
    "An application is a proposal, not a permission or a building; boroughs feed the datahub with "
    "varying completeness.",
]

NATIONAL_CONSERVATION_ATTRIBUTION = (
    "Conservation areas, planning.data.gov.uk (Ministry of Housing, Communities and Local Government, from "
    "local planning authorities and Historic England), licensed under the Open Government Licence v3.0. "
    "Contains OS data © Crown copyright and database right.")
NATIONAL_CONSERVATION_CAVEATS = [
    "Outside London: boundaries as councils, national parks and Historic England publish them to "
    "planning.data.gov.uk; the council's own conservation area map is the authority.",
    "Councils that publish none are unknown here, not free of conservation areas.",
]

# planning.data.gov.uk areas inside London go (the GLA's set covers it), then areas from a publisher
# that is not a council (pdo:) when a council's own area covers most of them (Historic England's copies).
NATIONAL_LONDON_SQL = """DELETE FROM conservation_area c USING area_geography b, area_region r
WHERE r.area_id = b.id AND b.kind = 'lad' AND r.region_code = %s AND c.id ~ '^pdo?:'
  AND ST_Intersects(ST_Transform(b.geometry, 27700), ST_PointOnSurface(c.geom))"""
# What is left of them is cut back to outside London (London's LSOAs, which the rebuilds intersect, plus
# half a metre for the boundary's rounding): a neighbour's area drawn over the boundary would otherwise
# add slivers to London's figures, which stay the GLA's.
NATIONAL_CLIP_SQL = """WITH london AS (
  SELECT l.geometry FROM area_geography l JOIN area_region r ON r.area_id = l.id
  WHERE l.kind = 'lsoa' AND r.region_code = %s
), box AS (SELECT ST_Transform(ST_SetSRID(ST_Extent(geometry)::geometry, 4326), 27700) AS geom FROM london),
cut AS (
  SELECT c.id, ST_Buffer(ST_Union(ST_Transform(l.geometry, 27700)), 0.5) AS geom
  FROM conservation_area c JOIN box ON c.geom && box.geom
  JOIN london l ON ST_Intersects(ST_Transform(l.geometry, 27700), c.geom)
  WHERE c.id ~ '^pdo?:' GROUP BY c.id)
UPDATE conservation_area c SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference(c.geom, cut.geom)), 3))
FROM cut WHERE cut.id = c.id"""
NATIONAL_EMPTY_SQL = "DELETE FROM conservation_area WHERE id ~ '^pdo?:' AND (ST_IsEmpty(geom) OR ST_Area(geom) = 0)"
NATIONAL_DUPLICATE_SQL = """DELETE FROM conservation_area o
WHERE o.id LIKE 'pdo:%' AND EXISTS (
  SELECT 1 FROM conservation_area c WHERE c.id NOT LIKE 'pdo:%' AND ST_Intersects(o.geom, c.geom)
    AND ST_Area(ST_Intersection(o.geom, c.geom)) > 0.5 * ST_Area(o.geom))"""

RELEASE_SQL = """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
  attribution, transformation_version, geography_vintage, validation_status, caveats)
VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
ON CONFLICT (id) DO NOTHING"""


def load(url: str) -> None:
    import psycopg

    gpkg = os.path.join(WORK, "Conservation_Areas.gpkg")
    conservation_digest = sha256(gpkg)
    zones_digest = hashlib.sha256("".join(sha256(os.path.join(WORK, name))
                                          for _, name, _ in ZONE_FILES.values()).encode()).hexdigest()
    planning_digest = sha256(planning_path())
    with gzip.open(planning_path(), "rt") as handle:
        header = json.loads(handle.readline())
        applications = [json.loads(line) for line in handle]
    releases = {
        "conservation": ("src-gla-conservation-areas-" + conservation_digest[:12], CONSERVATION_PAGE,
                         datetime.date.today().isoformat(), conservation_digest, "OGL-3.0",
                         CONSERVATION_ATTRIBUTION, CONSERVATION_CAVEATS),
        "zones": ("src-tfl-charge-zones-" + zones_digest[:12], ZONES_PAGE, "2023-08-29", zones_digest,
                  "TfL-open-data (OGL-2.0 based)", ZONES_ATTRIBUTION, ZONES_CAVEATS),
        "planning": ("src-pld-planning-applications-" + planning_digest[:12], PLANNING_PAGE, header["windowEnd"],
                     planning_digest, "OGL-3.0", PLANNING_ATTRIBUTION, PLANNING_CAVEATS),
    }
    cov = coverage.from_env()
    national = os.path.join(PLANNING_DATA, "conservation-area.csv")
    if cov.name != "london":
        national_digest = hashlib.sha256((sha256(national) + sha256(os.path.join(PLANNING_DATA, "organisation.csv")))
                                         .encode()).hexdigest()
        releases["national-conservation"] = (
            "src-planning-data-conservation-areas-" + national_digest[:12], NATIONAL_CONSERVATION_PAGE,
            datetime.date.fromtimestamp(os.path.getmtime(national)).isoformat(), national_digest, "OGL-3.0",
            NATIONAL_CONSERVATION_ATTRIBUTION, NATIONAL_CONSERVATION_CAVEATS)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        for release_id, page, released, digest, licence, attribution, caveats in releases.values():
            cur.execute(RELEASE_SQL, (release_id, page, released, digest, licence, attribution, ETL_VERSION, caveats))
        cur.execute("DELETE FROM conservation_area")
        cur.executemany(
            """INSERT INTO conservation_area (id, name, borough, geom, source_release_id)
               SELECT %s, %s, %s, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromWKB(%s, 27700)), 3)), %s""",
            [(ref, name, borough, wkb, releases["conservation"][0])
             for ref, name, borough, wkb in conservation_rows(gpkg)])
        if cov.name != "london":
            csv.field_size_limit(1 << 30)
            with open(os.path.join(PLANNING_DATA, "organisation.csv"), newline="", encoding="utf-8") as handle:
                organisations = list(csv.DictReader(handle))
            cur.execute("CREATE TEMP TABLE stage_conservation (id text, name text, borough text, wkt text) "
                        "ON COMMIT DROP")
            with open(national, newline="", encoding="utf-8") as handle, \
                    cur.copy("COPY stage_conservation FROM STDIN") as copy:
                for row in national_conservation_rows(csv.DictReader(handle), organisations, cov):
                    copy.write_row(row)
            cur.execute(
                """INSERT INTO conservation_area (id, name, borough, geom, source_release_id)
                   SELECT id, name, borough, geom, %s FROM (
                     SELECT DISTINCT ON (id) id, name, borough, ST_Multi(ST_CollectionExtract(ST_MakeValid(
                       ST_Transform(ST_SetSRID(ST_GeomFromText(wkt), 4326), 27700)), 3)) AS geom
                     FROM stage_conservation ORDER BY id) s
                   WHERE NOT ST_IsEmpty(geom)""", (releases["national-conservation"][0],))
            cur.execute(NATIONAL_LONDON_SQL, (coverage.LONDON_REGION,))
            cur.execute(NATIONAL_CLIP_SQL, (coverage.LONDON_REGION,))
            cur.execute(NATIONAL_EMPTY_SQL)
            cur.execute(NATIONAL_DUPLICATE_SQL)
            print("conservation:", cur.execute(
                "SELECT count(*) FILTER (WHERE id LIKE 'gla:%'), count(*) FILTER (WHERE id LIKE 'pd:%'), "
                "count(*) FILTER (WHERE id LIKE 'pdo:%') FROM conservation_area").fetchone(), "(GLA, councils, other)")
        cur.execute("DELETE FROM charge_zone")
        for zone in ZONE_FILES:
            cur.execute(
                """INSERT INTO charge_zone (zone, geom, source_release_id)
                   SELECT %s, ST_Multi(ST_CollectionExtract(ST_Union(
                     ST_MakeValid(ST_GeomFromText(wkt, 27700))), 3)), %s
                   FROM unnest(%s::text[]) AS wkt""",
                (zone, releases["zones"][0], zone_wkts(zone)))
        cur.execute("DELETE FROM planning_application")
        with cur.copy("COPY planning_application (id, valid_date, application_type, category, lat, lon, "
                      "source_release_id) FROM STDIN") as copy:
            for row in applications:
                copy.write_row((row["id"], row["validDate"], row["type"], row["category"], row["lat"], row["lon"],
                                releases["planning"][0]))
        cur.execute("ANALYZE conservation_area")
        cur.execute("ANALYZE planning_application")
        areas = cur.execute("SELECT rebuild_area_location(%s, %s)",
                            (header["windowStart"], header["windowEnd"])).fetchone()[0]
        print(f"load: {len(applications)} planning applications, {areas} areas")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
