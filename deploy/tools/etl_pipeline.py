"""Development pipeline and growth areas (migration 085, open data wave A source 6).

  pipeline     London Development Database permissions with net new homes, from the Planning London
               Datahub guest search API (GLA, OGL v3; the client of area_analytics.location_layers).
               Kept: status Approved or Allowed (not started; dropped once its lapse date has passed),
               Commenced (under construction) and Completed in the last five years. Stored: the site's
               centroid, net homes, status, decision and completion dates. No applicant, address,
               description or conditions.
  opportunity  London Plan Opportunity Areas (shapefile with names and GLA pages) and GLA Housing Zones
               (GeoPackage), London Datastore, OGL v3.
Then rebuild_area_pipeline() fills area_pipeline and area_opportunity (every level a sum of its LSOAs)
and the `pipeline-homes-per-1000` map layer, and a product release is staged with the new sources.

  AE_WORK=~/data/aework/pipeline python3 etl_pipeline.py download
  AE_WORK=~/data/aework/pipeline python3 etl_pipeline.py load <database-url> [pipeline|opportunity]

Needs psycopg for load; download and parsing are stdlib only.
"""
from __future__ import annotations

import datetime
import gzip
import hashlib
import json
import os
import re
import sqlite3
import struct
import sys
import urllib.request
import zipfile
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from area_analytics.location_layers import (  # noqa: E402
    PAGE_LIMIT, PLANNING_PAGE, PLANNING_SEARCH, _post, gpkg_wkb, polygon_wkt, shapefile_rings,
)

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "pipeline"))
ETL_VERSION = "close-knit-pipeline-1"
COMPLETED_YEARS = 5
# Datahub status -> ours. Allowed is a permission granted on appeal.
STATUSES = {"Approved": "not-started", "Allowed": "not-started", "Commenced": "under-construction",
            "Completed": "completed"}
RESIDENTIAL = "application_details.residential_details"
FIELDS = ["status", "decision_date", "lapsed_date", "actual_completion_date", "centroid",
          f"{RESIDENTIAL}.total_no_proposed_residential_units", f"{RESIDENTIAL}.total_no_existing_residential_units"]
OA_URL = "https://data.london.gov.uk/download/epr7z/e2f069be-1ae6-491d-958a-d29d7155daa7/Opportunity_Areas.zip"
OA_PAGE = "https://data.london.gov.uk/dataset/opportunity-areas"
HZ_URL = "https://data.london.gov.uk/download/24yxz/3239c52f-0c34-41a3-bf18-1408ee53010f/Housing_Zones.gpkg"
HZ_PAGE = "https://data.london.gov.uk/dataset/housing-zones"
FILES = {"Opportunity_Areas.zip": OA_URL, "Housing_Zones.gpkg": HZ_URL}
PIPELINE_FILE = "development-pipeline.jsonl.gz"


def path(name: str) -> str:
    return os.path.join(WORK, name)


def _date(text: str | None) -> datetime.date | None:
    try:
        return datetime.datetime.strptime(text or "", "%d/%m/%Y").date()
    except ValueError:
        return None


def completed_since(today: datetime.date) -> datetime.date:
    """The same day five years earlier (28 February for a 29 February)."""
    try:
        return today.replace(year=today.year - COMPLETED_YEARS)
    except ValueError:
        return today.replace(year=today.year - COMPLETED_YEARS, day=28)


# --- Planning London Datahub ------------------------------------------------------------------

def pipeline_query(authority: str, status: str, since: datetime.date | None = None) -> dict:
    """One authority's permissions in one datahub status that propose homes, with only the fields we keep."""
    filters: list[dict] = [{"term": {"lpa_name.raw": authority}}, {"term": {"status.raw": status}},
                           {"range": {f"{RESIDENTIAL}.total_no_proposed_residential_units": {"gt": 0}}}]
    if since is not None:
        filters.append({"range": {"actual_completion_date": {"gte": since.strftime("%d/%m/%Y"), "format": "dd/MM/yyyy"}}})
    return {"size": PAGE_LIMIT, "track_total_hits": True, "_source": FIELDS, "sort": [{"_doc": "asc"}],
            "query": {"bool": {"filter": filters}}}


AUTHORITIES_QUERY = {"size": 0, "aggs": {"lpa": {"terms": {"field": "lpa_name.raw", "size": 100}}},
                     "query": {"bool": {"filter": [{"terms": {"status.raw": list(STATUSES)}}]}}}


def pipeline_record(hit: dict, today: datetime.date) -> dict | None:
    """One kept permission, or None: not a live permission, no net new homes, outside the completion
    window or without a usable centroid."""
    source = hit.get("_source") or {}
    status = STATUSES.get(source.get("status") or "")
    if status is None:
        return None
    residential = (source.get("application_details") or {}).get("residential_details") or {}
    try:
        net = int(residential.get("total_no_proposed_residential_units") or 0) - int(
            residential.get("total_no_existing_residential_units") or 0)
        centroid = source.get("centroid") or {}
        lat, lon = float(centroid["lat"]), float(centroid["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    # Some boroughs publish the grid origin (0, 0) for a missing location: far outside London.
    if net <= 0 or not (51.2 <= lat <= 51.8 and -0.6 <= lon <= 0.4):
        return None
    completed = _date(source.get("actual_completion_date"))
    if status == "not-started" and (lapsed := _date(source.get("lapsed_date"))) and lapsed < today:
        return None
    if status == "completed" and (completed is None or completed < completed_since(today)):
        return None
    permitted = _date(source.get("decision_date"))
    return {"id": hit["_id"], "status": status, "netHomes": net,
            "permittedOn": permitted.isoformat() if permitted else None,
            "completedOn": completed.isoformat() if status == "completed" else None, "lat": lat, "lon": lon}


def download_pipeline(today: datetime.date) -> None:
    since = completed_since(today)
    authorities = [bucket["key"] for bucket in _post(PLANNING_SEARCH, AUTHORITIES_QUERY)["aggregations"]["lpa"]["buckets"]]
    kept = 0
    with gzip.open(path(PIPELINE_FILE) + ".part", "wt") as out:
        out.write(json.dumps({"retrieved": today.isoformat(), "completedSince": since.isoformat()}) + "\n")
        for authority in authorities:
            for status in STATUSES:
                payload = _post(PLANNING_SEARCH, pipeline_query(authority, status, since if status == "Completed" else None))
                total = payload["hits"]["total"]["value"]
                if total >= PAGE_LIMIT:
                    raise SystemExit(f"pipeline: {total} {status} permissions in {authority}; split the query")
                for hit in payload["hits"]["hits"]:
                    if record := pipeline_record(hit, today):
                        out.write(json.dumps(record) + "\n")
                        kept += 1
    os.replace(path(PIPELINE_FILE) + ".part", path(PIPELINE_FILE))
    print(f"pipeline: {kept} permissions from {len(authorities)} authorities; sha256 {sha256(PIPELINE_FILE)}")


# --- Opportunity Areas and Housing Zones ------------------------------------------------------

def dbf_records(data: bytes) -> Iterator[dict]:
    """Rows of a dBase III table as {field: text}; deleted rows skipped."""
    count, header, length = struct.unpack("<IHH", data[4:12])
    fields = []
    for offset in range(32, header - 1, 32):
        descriptor = data[offset:offset + 32]
        fields.append((descriptor[:11].split(b"\0")[0].decode("ascii").lower(), descriptor[16]))
    for index in range(count):
        record = data[header + index * length:header + (index + 1) * length]
        if record[:1] == b"*":
            continue
        row, position = {}, 1
        for name, size in fields:
            row[name] = record[position:position + size].decode("utf-8", "replace").strip()
            position += size
        yield row


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _member(archive: zipfile.ZipFile, suffix: str) -> str:
    return next(name for name in archive.namelist() if name.lower().endswith(suffix))


def opportunity_rows(zip_path: str) -> Iterator[tuple[str, str, str, str, str]]:
    """(id, name, kind, page, wkt in BNG) for each live Opportunity Area in the GLA shapefile."""
    with zipfile.ZipFile(zip_path) as archive:
        shapes = shapefile_rings(archive.read(_member(archive, ".shp")))
        records = list(dbf_records(archive.read(_member(archive, ".dbf"))))
    seen: set[str] = set()
    for record, rings in zip(records, shapes):
        name = record.get("sitename", "").strip()
        if not name or record.get("removeddat") or (ident := f"oa:{_slug(name)}") in seen:
            continue
        seen.add(ident)
        page = record.get("source", "")
        yield ident, name, "opportunity-area", page if page.startswith("https://www.london.gov.uk/") else OA_PAGE, \
            polygon_wkt(rings)


def housing_zone_rows(gpkg_path: str) -> Iterator[tuple[str, str, str, str, bytes]]:
    """(id, name, kind, page, WKB in BNG) for each live Housing Zone in the GLA GeoPackage."""
    with closing(sqlite3.connect(gpkg_path)) as db:
        table = db.execute("SELECT table_name FROM gpkg_contents WHERE lower(table_name) = 'housing_zones'").fetchone()[0]
        for fid, name, geom in db.execute(
                f'SELECT fid, sitename, geom FROM "{table}" '
                "WHERE geom IS NOT NULL AND coalesce(removeddate, '') = '' ORDER BY fid"):
            if name:
                yield f"hz:{fid}", name.strip(), "housing-zone", HZ_PAGE, gpkg_wkb(geom)


def sha256(name: str) -> str:
    digest = hashlib.sha256()
    with open(path(name), "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def download(today: datetime.date | None = None) -> None:
    os.makedirs(WORK, exist_ok=True)
    for name, url in FILES.items():
        if not os.path.exists(path(name)):
            request = urllib.request.Request(url, headers={"User-Agent": "close-knit-etl"})
            with urllib.request.urlopen(request, timeout=300) as response, open(path(name) + ".tmp", "wb") as handle:
                while chunk := response.read(1 << 20):
                    handle.write(chunk)
            os.replace(path(name) + ".tmp", path(name))
        print(f"download: {name} sha256 {sha256(name)}", flush=True)
    download_pipeline(today or datetime.date.today())


# --- Load -------------------------------------------------------------------------------------

PIPELINE_ATTRIBUTION = ("London Development Database, Planning London Datahub, Greater London Authority, licensed "
                        "under the Open Government Licence v3.0.")
PIPELINE_CAVEATS = [
    "Permissions are not completions: start and finish dates slip, and some permissions lapse unbuilt.",
    "Net new homes are proposed minus existing units; each site counts at its centroid.",
    "Boroughs feed the datahub with varying completeness and delay.",
]
OPPORTUNITY_ATTRIBUTION = ("Opportunity Areas and Housing Zones, Greater London Authority (London Datastore), "
                           "licensed under the Open Government Licence v3.0. Contains OS data © Crown copyright "
                           "and database right.")
OPPORTUNITY_CAVEATS = ["Boundaries are approximate; the GLA does not define them, the boroughs' plans do.",
                       "A designation marks where growth is planned, not what will be built or when."]


def insert_release(cur, base: str, digest: str, url: str, released: str, attribution: str, caveats: list[str]) -> str:
    """Source releases are immutable: the id carries the content hash, so a new file is a new release."""
    release_id = f"{base}-{digest[:12]}"
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
             transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s) ON CONFLICT (id) DO NOTHING""",
        (release_id, url, released, digest, attribution, ETL_VERSION, caveats))
    return release_id


def load_pipeline(cur) -> str:
    with gzip.open(path(PIPELINE_FILE), "rt") as handle:
        header = json.loads(handle.readline())
        rows = [json.loads(line) for line in handle]
    release = insert_release(cur, "src-gla-ldd-pipeline", sha256(PIPELINE_FILE), PLANNING_PAGE, header["retrieved"],
                             PIPELINE_ATTRIBUTION, PIPELINE_CAVEATS)
    cur.execute("DELETE FROM development_pipeline")
    with cur.copy("COPY development_pipeline (id, status, net_homes, permitted_on, completed_on, lat, lon, "
                  "source_release_id) FROM STDIN") as copy:
        for row in {row["id"]: row for row in rows}.values():
            copy.write_row((row["id"], row["status"], row["netHomes"], row["permittedOn"], row["completedOn"],
                            row["lat"], row["lon"], release))
    print(f"pipeline: {len(rows)} permissions, release {release}")
    return release


def load_opportunity(cur) -> str:
    digest = hashlib.sha256((sha256("Opportunity_Areas.zip") + sha256("Housing_Zones.gpkg")).encode()).hexdigest()
    release = insert_release(cur, "src-gla-opportunity-areas", digest, OA_PAGE, datetime.date.today().isoformat(),
                             OPPORTUNITY_ATTRIBUTION, OPPORTUNITY_CAVEATS)
    areas = list(opportunity_rows(path("Opportunity_Areas.zip")))
    zones = list(housing_zone_rows(path("Housing_Zones.gpkg")))
    cur.execute("DELETE FROM opportunity_area")
    cur.executemany(
        """INSERT INTO opportunity_area (id, name, kind, url, geom, source_release_id)
           SELECT %s, %s, %s, %s, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromText(%s, 27700)), 3)), %s""",
        [(*row, release) for row in areas])
    # The Housing Zones GeoPackage declares a custom CRS that is British National Grid.
    cur.executemany(
        """INSERT INTO opportunity_area (id, name, kind, url, geom, source_release_id)
           SELECT %s, %s, %s, %s, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromWKB(%s, 27700)), 3)), %s""",
        [(*row, release) for row in zones])
    print(f"opportunity: {len(areas)} Opportunity Areas, {len(zones)} Housing Zones, release {release}")
    return release


PARTS = {"pipeline": load_pipeline, "opportunity": load_opportunity}


def load(url: str, parts: list[str]) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    in_use = ("SELECT DISTINCT source_release_id AS id FROM development_pipeline UNION "
              "SELECT DISTINCT source_release_id FROM opportunity_area")
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        before = {r["id"] for r in cur.execute(in_use)}
        for part in parts:
            PARTS[part](cur)
        after = {r["id"] for r in cur.execute(in_use)}
        pipeline_release = cur.execute("SELECT min(source_release_id) AS id FROM development_pipeline").fetchone()["id"]
        retrieved = cur.execute("SELECT release_date FROM source_release WHERE id = %s",
                                (pipeline_release,)).fetchone()["release_date"]
        areas = cur.execute("SELECT rebuild_area_pipeline(%s, %s) AS n",
                            (retrieved.replace(day=1), pipeline_release)).fetchone()["n"]
        release = stage_release.stage(cur, "development-pipeline", sorted(after), replace=tuple(sorted(before - after)))
        print(f"load: {areas} areas, product release {release}")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "load" and len(sys.argv) in (3, 4) and (len(sys.argv) == 3 or sys.argv[3] in PARTS):
        load(sys.argv[2], list(PARTS) if len(sys.argv) == 3 else [sys.argv[3]])
    else:
        sys.exit(__doc__)
