"""Places in the coverage (England, or Greater London) from Overture Maps (migration 032).

Source: Overture Maps Foundation, places theme, release 2026-09-23.1
(s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/, public bucket,
CDLA-Permissive-2.0). Read with DuckDB over httpfs: the bbox column filter lets the parquet
reader skip every row group outside the coverage box, so only those row groups are fetched.
Points are then clipped to the coverage's local authorities (area_geography kind='lad': the
33 London boroughs, or all 296 English LADs). CLOSE_KNIT_ETL_COVERAGE picks the coverage (england by
default, or london; area_analytics.coverage); an England build is its own source release
(`src-overture-places-<release>-england`). OVERTURE_RAW_DIR and AE_WORK move its files.
Kept per place: Overture id, primary name, primary and alternate categories, basic category,
brand, confidence, operating status, source datasets and a point. Addresses, phones, emails
and socials are dropped, and so are websites except for estate agents (agent directory,
migration 051): data minimisation.

Stages (raw files go to ~/data/overture/2026-09-23.1, work files to $AE_WORK, default
~/data/aework/overture):
  extract URL  fetch the bbox from S3 into places_bbox.parquet, clip it to the boroughs read
               from the database at URL into places_<coverage>.parquet (duckdb and psycopg needed)
  build        places_<coverage>.parquet -> overture_place.tsv and sources.json (duckdb needed)
  load URL     load the TSV into the migration 032 table (psycopg needed)

  uv run --with duckdb --with 'psycopg[binary]' python -m area_analytics.overture_places extract postgresql://...
  uv run --with duckdb python -m area_analytics.overture_places build
  uv run --with 'psycopg[binary]' python -m area_analytics.overture_places load postgresql://...

The row shaping (place_row, tsv_line, source_release) is pure and dependency-free.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import sys
from collections import Counter

from . import coverage, workfiles

COVERAGE = coverage.from_env()
DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
RELEASE = "2026-09-23.1"
RAW = os.environ.get("OVERTURE_RAW_DIR", os.path.join(DATA, "overture", RELEASE))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "overture"))
S3_PATH = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*.parquet"
LONDON_BBOX = (-0.52, 51.28, 0.34, 51.70)  # xmin, ymin, xmax, ymax around Greater London
BBOX = LONDON_BBOX if COVERAGE.name == "london" else COVERAGE.bbox_wgs84
CLIPPED_FILE = f"places_{COVERAGE.name}.parquet"
OVERTURE_URL = "https://docs.overturemaps.org/guides/places/"


def source_id(scope: str = COVERAGE.name) -> str:
    """London keeps its historical id; any wider coverage is a release of its own."""
    return f"src-overture-places-{RELEASE}" + ("" if scope == "london" else f"-{scope}")


OVERTURE_SOURCE = source_id()
ETL_VERSION = "close-knit-overture-places-2"
AGENT_CATEGORIES = frozenset({"real_estate_agent", "real_estate_service"})
OVERTURE_ATTRIBUTION = "© Overture Maps Foundation (overturemaps.org), places theme, CDLA-Permissive-2.0."
COLUMNS = ("id", "name", "category", "alternate_categories", "basic_category", "brand", "brand_wikidata",
           "confidence", "operating_status", "datasets", "website", "location")
# Only these columns are read from S3; everything else (addresses, phones, emails, socials) is never fetched,
# and websites[1] is read only for estate agents, so no other place's website leaves S3.
SELECT = """id, names.primary AS name, taxonomy.primary AS category, taxonomy.alternates AS alternate_categories,
  basic_category, brand.names.primary AS brand, brand.wikidata AS brand_wikidata, confidence, operating_status,
  list_distinct([s.dataset FOR s IN sources]) AS datasets, list_distinct([s.license FOR s IN sources]) AS licences,
  CASE WHEN taxonomy.primary IN ('real_estate_agent','real_estate_service')
            OR basic_category IN ('real_estate_agent','real_estate_service') THEN websites[1] END AS website,
  bbox.xmin AS lon, bbox.ymin AS lat"""


def _clean(value) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _array(values) -> str | None:
    """A Postgres text[] literal: every element double-quoted, quotes and backslashes escaped."""
    items = [v for v in (_clean(v) for v in values or ()) if v]
    if not items:
        return None
    return "{" + ",".join('"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"' for v in items) + "}"


def place_row(record: dict) -> dict | None:
    """One table row from an extracted record, or None when it has no id or no usable point."""
    place_id, lon, lat = _clean(record.get("id")), record.get("lon"), record.get("lat")
    if place_id is None or lon is None or lat is None or not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    confidence = record.get("confidence")
    category, basic_category = _clean(record.get("category")), _clean(record.get("basic_category"))
    return {
        "id": place_id, "name": _clean(record.get("name")), "category": category,
        "alternate_categories": _array(record.get("alternate_categories")),
        "basic_category": basic_category, "brand": _clean(record.get("brand")),
        "brand_wikidata": _clean(record.get("brand_wikidata")),
        "confidence": round(float(confidence), 4) if confidence is not None else None,
        "operating_status": _clean(record.get("operating_status")),
        "datasets": _array(sorted(record.get("datasets") or ())),
        "website": _clean(record.get("website")) if {category, basic_category} & AGENT_CATEGORIES else None,
        "location": f"SRID=4326;POINT({lon} {lat})"}


def _escape(value) -> str:
    """One COPY text-format field (NULL is the empty string)."""
    if value is None:
        return ""
    text = str(value)
    return (text.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r"))


def tsv_line(row: dict) -> str:
    return "\t".join(_escape(row[column]) for column in COLUMNS)


def file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _duckdb():
    import duckdb

    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2'")
    return con


def _http_bytes(con) -> int | None:
    """Response bytes DuckDB logged for its HTTP requests, when this DuckDB can log them."""
    try:
        return con.sql("""SELECT sum(coalesce(TRY_CAST(response.headers['Content-Length'] AS BIGINT), 0))
                          FROM duckdb_logs_parsed('HTTP') WHERE request.type = 'GET'""").fetchone()[0]
    except Exception:  # older DuckDB without HTTP logging
        return None


def extract(url: str) -> None:
    import psycopg

    os.makedirs(RAW, exist_ok=True)
    bbox_path, clipped_path = os.path.join(RAW, "places_bbox.parquet"), os.path.join(RAW, CLIPPED_FILE)
    con = _duckdb()
    try:
        con.sql("CALL enable_logging('HTTP')")
    except Exception:
        pass
    xmin, ymin, xmax, ymax = BBOX
    con.sql(f"""COPY (SELECT {SELECT} FROM read_parquet('{S3_PATH}')
                 WHERE bbox.xmin <= {xmax} AND bbox.xmax >= {xmin} AND bbox.ymin <= {ymax} AND bbox.ymax >= {ymin})
               TO '{bbox_path}' (FORMAT parquet, COMPRESSION zstd)""")
    fetched = _http_bytes(con)
    with psycopg.connect(url) as conn:
        boroughs = conn.execute(
            "SELECT id, ST_AsText(geometry) FROM area_geography WHERE kind = 'lad' AND id = ANY(%s)",
            ([coverage.borough_id(code) for code in sorted(COVERAGE.lad_codes)],)).fetchall()
    # One row per local authority (a spatial join), not their union: the same points, far faster for England.
    con.execute("CREATE TABLE borough (id VARCHAR, wkt VARCHAR)")
    con.executemany("INSERT INTO borough VALUES (?, ?)", boroughs)
    con.sql("CREATE TABLE coverage AS SELECT id, ST_GeomFromText(wkt) AS geom FROM borough")
    con.sql(f"""COPY (SELECT p.* FROM '{bbox_path}' p JOIN coverage c ON ST_Intersects(c.geom, ST_Point(p.lon, p.lat))
                 QUALIFY row_number() OVER (PARTITION BY p.id ORDER BY c.id) = 1 ORDER BY p.id)
               TO '{clipped_path}' (FORMAT parquet, COMPRESSION zstd)""")
    in_bbox = con.sql(f"SELECT count(*) FROM '{bbox_path}'").fetchone()[0]
    in_boroughs = con.sql(f"SELECT count(*) FROM '{clipped_path}'").fetchone()[0]
    manifest = {"release": RELEASE, "coverage": COVERAGE.name, "source": S3_PATH, "bbox": BBOX,
                "http_bytes": fetched, "rows_in_bbox": in_bbox, "rows_in_boroughs": in_boroughs,
                "sha256": file_sha256(clipped_path), "retrieved": datetime.date.today().isoformat()}
    with open(os.path.join(RAW, "manifest.json"), "w") as handle:
        json.dump(manifest, handle, indent=1)
    print("extract:", manifest)


def build() -> None:
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(RAW, "manifest.json")) as handle:
        manifest = json.load(handle)
    con = _duckdb()
    result = con.sql(f"SELECT * FROM '{os.path.join(RAW, CLIPPED_FILE)}'")
    names = result.columns
    rows, skipped, statuses, licences = 0, Counter(), Counter(), Counter()
    with workfiles.open_text(workfiles.name(WORK, "overture_place.tsv", COVERAGE), "w") as handle:
        while batch := result.fetchmany(50000):
            for values in batch:
                record = dict(zip(names, values))
                row = place_row(record)
                if row is None:
                    skipped["no id or point"] += 1
                    continue
                licences.update(record.get("licences") or ())
                statuses[row["operating_status"]] += 1
                handle.write(tsv_line(row) + "\n")
                rows += 1
    with open(os.path.join(WORK, "sources.json"), "w") as handle:
        json.dump({**manifest, "rows": rows, "skipped": dict(skipped), "operating_status": dict(statuses),
                   "licences": dict(licences)}, handle, indent=1)
    print(f"build: {rows} rows, skipped {dict(skipped)}, status {dict(statuses)}, licences {dict(licences)}")


def source_release(sources: dict) -> tuple:
    """(id, url, release_date, sha256, licence, attribution, caveats) for the loaded extract."""
    licences = ", ".join(sorted(sources.get("licences") or {})) or "CDLA-Permissive-2.0"
    scope = sources.get("coverage", "london")
    clip = ("Greater London bbox clipped to the 33 boroughs" if scope == "london"
            else "England bbox clipped to the 296 English local authorities")
    return (source_id(scope), OVERTURE_URL, RELEASE[:10], sources["sha256"], "CDLA-Permissive-2.0",
            OVERTURE_ATTRIBUTION,
            [f"Overture Maps places release {RELEASE}, {clip}, "
             f"retrieved {sources['retrieved']}; upstream source licences: {licences}.",
             "Overture places are merged from commercial and open sources; a place can be closed or moved without the release noticing, and confidence is "
             "Overture's own match score, not a check on the ground.",
             "Categories follow Overture's taxonomy and can be broad or wrong for a single place."])


def load(url: str) -> None:
    import psycopg

    with open(os.path.join(WORK, "sources.json")) as handle:
        sources = json.load(handle)
    source_id, source_url, released, sha, licence, attribution, caveats = source_release(sources)
    with workfiles.open_text(workfiles.name(WORK, "overture_place.tsv", COVERAGE)) as handle:
        body = "".join(f"{line}\t{source_id}\n" for line in handle.read().splitlines())
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, source_url, released, sha, licence, attribution, ETL_VERSION, caveats))
        cur.execute("DELETE FROM overture_place WHERE source_release_id = %s", (source_id,))
        with cur.copy(f"COPY overture_place ({', '.join(COLUMNS)}, source_release_id) FROM STDIN "
                      "WITH (FORMAT text, NULL '')") as copy:
            copy.write(body)
        print("load:", cur.execute("SELECT count(*) FROM overture_place").fetchone()[0], "rows")


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    if stage == "extract" and len(argv) == 3:
        extract(argv[2])
    elif stage == "build":
        build()
    elif stage == "load" and len(argv) == 3:
        load(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
