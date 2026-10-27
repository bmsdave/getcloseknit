"""Foursquare Open Source Places in the coverage, England or Greater London (migration 033).

Source: Foursquare OS Places (Apache 2.0), the GeoParquet copy partitioned by Fused on
Source Cooperative (https://data.source.coop/fused/fsq-os-places/<release>/places/*.parquet).
The current release on Hugging Face is gated; this public copy is a dated snapshot
(default 2025-02-06), so some places have closed since and others are missing. Set
FSQ_RELEASE (and FSQ_BASE for another mirror) to load a fresher copy: the release id,
folder and source_release row all follow it, and a reload replaces that release's rows.
The current release comes from Hugging Face once the dataset's terms are accepted and a read
token is saved (`hf auth login`): FSQ_BASE=hf://datasets/foursquare/fsq-os-places FSQ_RELEASE=2026-09-15.

Kept per place: Foursquare id, name, category ids and labels, date created / refreshed /
closed and a point. Addresses, phone numbers, websites and social handles are not read
(data minimisation). The extract has no chain field.

Stages (raw files go to ~/data/foursquare/<release>, work files to $AE_WORK, default
~/data/aework/fsq/<release>):
  extract     read only the needed columns of the row groups whose footer stats touch the
              coverage bbox, over HTTP, into <coverage>_bbox.parquet (+ extract.json with bytes)
  build       <coverage>_bbox.parquet -> fsq_place.tsv and sources.json
  load URL    load the TSV, keeping places inside a local authority (area_geography 'borough')
              of the coverage (psycopg)

The coverage is CLOSE_KNIT_ETL_COVERAGE (england by default, or london; area_analytics.coverage).
An England build is its own source release (`src-fsq-os-places-<release>-england`) and replaces
the London one; FSQ_RAW_DIR and AE_WORK move its files (England: ~/data/england-2026-10/places).

  uv run --with duckdb python -m area_analytics.fsq_places extract
  uv run --with duckdb python -m area_analytics.fsq_places build
  uv run --with 'psycopg[binary]' python -m area_analytics.fsq_places load postgresql://...

extract and build need duckdb; the row helpers are pure and dependency-free.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.parse
import urllib.request

from . import coverage, workfiles

COVERAGE = coverage.from_env()
DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
RELEASE = os.environ.get("FSQ_RELEASE", "2025-02-06")
BASE = os.environ.get("FSQ_BASE", "https://data.source.coop/fused/fsq-os-places")
RAW_DIR = os.environ.get("FSQ_RAW_DIR", os.path.join(DATA, "foursquare", RELEASE))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "fsq", RELEASE))
# London keeps its historical id; any wider coverage is a release of its own.
SUFFIX = "" if COVERAGE.name == "london" else f"-{COVERAGE.name}"
SOURCE_ID = f"src-fsq-os-places-{RELEASE}{SUFFIX}"
ETL_VERSION = "close-knit-fsq-1"
ATTRIBUTION = "Places: Foursquare Open Source Places, licensed under the Apache License 2.0."
# Greater London with a margin (the London build's own box); the load clips to the coverage's LADs.
LONDON_BBOX = (-0.52, 51.28, 0.34, 51.70)  # west, south, east, north
BBOX = LONDON_BBOX if COVERAGE.name == "london" else COVERAGE.bbox_wgs84
EXTRACT_FILE = f"{COVERAGE.name}_bbox.parquet"
MAX_BYTES = 4 * 10**9
READ_COLUMNS = ("fsq_place_id", "name", "latitude", "longitude", "date_created", "date_refreshed",
                "date_closed", "fsq_category_ids", "fsq_category_labels")
COLUMNS = ("fsq_place_id", "name", "category_ids", "category_labels", "date_created", "date_refreshed",
           "date_closed", "location")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


HF_PREFIX = "hf://datasets/"


def _hf_token() -> str:
    """The read token `hf auth login` saved (or HF_TOKEN); never printed."""
    token = os.environ.get("HF_TOKEN")
    if token:
        return token
    with open(os.path.expanduser("~/.cache/huggingface/token")) as handle:
        return handle.read().strip()


def _hf_files(base: str, release: str) -> list[str]:
    """hf:// URLs of a Hugging Face release's places parquet (release/dt=<release>/places/parquet)."""
    repo = base[len(HF_PREFIX):]
    folder = f"release/dt={release}/places/parquet"
    request = urllib.request.Request(f"https://huggingface.co/api/datasets/{repo}/tree/main/{folder}",
                                     headers={"Authorization": f"Bearer {_hf_token()}",
                                              "User-Agent": "close-knit-ingest"})
    with urllib.request.urlopen(request) as response:
        entries = json.load(response)
    return sorted(f"{base}/{entry['path']}" for entry in entries if entry["path"].endswith(".parquet"))


def list_files(base: str = BASE, release: str = RELEASE) -> list[str]:
    """URLs of every places/*.parquet of a release: Hugging Face (hf://) or an S3-style mirror."""
    if base.startswith(HF_PREFIX):
        return _hf_files(base, release)
    bucket, prefix = base.rsplit("/", 1)
    keys, token = [], None
    while True:
        query = {"list-type": "2", "prefix": f"{release}/places/"}
        if token:
            query["continuation-token"] = token
        request = urllib.request.Request(f"{bucket}/{prefix}?{urllib.parse.urlencode(query)}",
                                         headers={"User-Agent": "close-knit-ingest"})  # default UA gets 403
        with urllib.request.urlopen(request) as response:
            body = response.read().decode()
        keys += re.findall(r"<Key>([^<]+\.parquet)</Key>", body)
        token = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", body)
        if not token:
            break
        token = token.group(1)
    return [f"{bucket}/{key}" for key in sorted(keys)]


def overlaps(lat_min: float, lat_max: float, lon_min: float, lon_max: float, bbox=BBOX) -> bool:
    """Whether a row group's latitude/longitude range can hold a point in the bbox."""
    west, south, east, north = bbox
    return lat_max >= south and lat_min <= north and lon_max >= west and lon_min <= east


def _http_bytes(con) -> int:
    return con.sql("SELECT coalesce(sum(TRY_CAST(response.headers['Content-Length'] AS BIGINT)), 0) "
                   "FROM duckdb_logs_parsed('HTTP') WHERE request.type = 'GET'").fetchone()[0]


def extract() -> None:
    import duckdb

    os.makedirs(RAW_DIR, exist_ok=True)
    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs; CALL enable_logging('HTTP')")
    if BASE.startswith(HF_PREFIX):  # the gated dataset: DuckDB reads the saved token itself
        con.sql("CREATE SECRET hf (TYPE huggingface, PROVIDER credential_chain)")
    urls = list_files()
    stats = con.sql(
        f"""SELECT file_name, row_group_id,
                 max(TRY_CAST(stats_min AS DOUBLE)) FILTER (WHERE path_in_schema = 'latitude'),
                 max(TRY_CAST(stats_max AS DOUBLE)) FILTER (WHERE path_in_schema = 'latitude'),
                 max(TRY_CAST(stats_min AS DOUBLE)) FILTER (WHERE path_in_schema = 'longitude'),
                 max(TRY_CAST(stats_max AS DOUBLE)) FILTER (WHERE path_in_schema = 'longitude'),
                 sum(total_compressed_size) FILTER (WHERE split_part(path_in_schema, ',', 1)
                                                    IN {READ_COLUMNS})
            FROM parquet_metadata({urls}) GROUP BY ALL""").fetchall()
    footer_bytes = _http_bytes(con)
    hits = [row for row in stats if None in row[2:6] or overlaps(*row[2:6])]
    files = sorted({row[0] for row in hits})
    planned = sum(row[6] or 0 for row in hits)
    print(f"extract: {len(urls)} files, {len(stats)} row groups; {len(hits)} touch the bbox in "
          f"{len(files)} files, ~{planned / 1e6:.0f} MB of needed columns; footers {footer_bytes / 1e6:.1f} MB")
    if planned + footer_bytes > MAX_BYTES:
        raise SystemExit(f"would read ~{(planned + footer_bytes) / 1e9:.1f} GB (> 4 GB): stopping")
    west, south, east, north = BBOX
    out = os.path.join(RAW_DIR, EXTRACT_FILE)
    con.sql(f"""COPY (SELECT {', '.join(READ_COLUMNS)} FROM read_parquet({files})
                     WHERE latitude BETWEEN {south} AND {north} AND longitude BETWEEN {west} AND {east}
                     ORDER BY fsq_place_id)
                TO '{out}' (FORMAT parquet, COMPRESSION zstd)""")
    rows = con.sql(f"SELECT count(*) FROM '{out}'").fetchone()[0]
    transferred = _http_bytes(con)
    with open(os.path.join(RAW_DIR, "extract.json"), "w") as handle:
        json.dump({"release": RELEASE, "base": BASE, "bbox": BBOX, "files": files, "row_groups": len(hits),
                   "rows": rows, "bytes_transferred": transferred, "footer_bytes": footer_bytes,
                   "columns": READ_COLUMNS}, handle, indent=1)
    print(f"extract: {rows} places in the bbox -> {out}; {transferred / 1e6:.1f} MB transferred")


def pg_array(values) -> str | None:
    """A Postgres text[] literal (before COPY escaping); None for a missing list."""
    if values is None:
        return None
    items = []
    for value in values:
        if value is None:
            items.append("NULL")
        else:
            items.append('"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"')
    return "{" + ",".join(items) + "}"


def _date(value) -> str | None:
    text = str(value)[:10] if value is not None else ""
    return text if _DATE.match(text) else None


def place_row(record: dict) -> dict | None:
    """One kept place from an extract record, or None without an id or a usable point."""
    lat, lon = record.get("latitude"), record.get("longitude")
    if not record.get("fsq_place_id") or lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {"fsq_place_id": record["fsq_place_id"], "name": record.get("name"),
            "category_ids": pg_array(record.get("fsq_category_ids")),
            "category_labels": pg_array(record.get("fsq_category_labels")),
            "date_created": _date(record.get("date_created")),
            "date_refreshed": _date(record.get("date_refreshed")),
            "date_closed": _date(record.get("date_closed")),
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


def build() -> None:
    import duckdb

    source = os.path.join(RAW_DIR, EXTRACT_FILE)
    os.makedirs(WORK, exist_ok=True)
    cursor = duckdb.connect().execute(f"SELECT {', '.join(READ_COLUMNS)} FROM '{source}' ORDER BY fsq_place_id")
    kept = skipped = closed = 0
    latest = None
    with workfiles.open_text(workfiles.name(WORK, "fsq_place.tsv", COVERAGE), "w") as handle:
        while batch := cursor.fetchmany(50_000):
            for values in batch:
                row = place_row(dict(zip(READ_COLUMNS, values)))
                if row is None:
                    skipped += 1
                    continue
                kept += 1
                closed += row["date_closed"] is not None
                if row["date_refreshed"] and (latest is None or row["date_refreshed"] > latest):
                    latest = row["date_refreshed"]
                handle.write(tsv_line(row) + "\n")
    with open(os.path.join(RAW_DIR, "extract.json")) as handle:
        extracted = json.load(handle)
    with open(os.path.join(WORK, "sources.json"), "w") as handle:
        json.dump({"release": RELEASE, "coverage": COVERAGE.name, "base": BASE, "sha256": file_sha256(source), "rows": kept,
                   "skipped": skipped, "closed": closed, "latest_refresh": latest,
                   "bytes_transferred": extracted.get("bytes_transferred")}, handle, indent=1)
    print(f"build: {kept} rows ({closed} with date_closed), skipped {skipped}, latest refresh {latest}")


def source_release(sources: dict) -> tuple:
    """(id, url, release_date, sha256, licence, attribution, caveats) for the loaded snapshot."""
    release = sources["release"]
    scope = sources.get("coverage", "london")
    suffix = "" if scope == "london" else f"-{scope}"
    where = "a London borough" if scope == "london" else "an English local authority"
    extract = "London" if scope == "london" else "England"
    return (f"src-fsq-os-places-{release}{suffix}", f"{sources['base']}/{release}/places/", release, sources["sha256"],
            "Apache-2.0", ATTRIBUTION,
            [f"Foursquare Open Source Places snapshot of {release} (the public Source Cooperative copy; "
             "the current release on Hugging Face is gated). It is dated: places opened since are "
             "missing and many listed places have closed.",
             f"date_closed is set for {sources['closed']} of {sources['rows']} places in the "
             f"{extract} extract; a place without it may still have closed, and an old date_refreshed "
             "means Foursquare has not confirmed it recently.",
             "Crowd-sourced and machine-merged: duplicates, misplaced points and wrong categories occur.",
             f"Only places inside {where} are kept; addresses, phone numbers, websites and "
             "social handles are not stored."])


def load(url: str) -> None:
    import psycopg

    with open(os.path.join(WORK, "sources.json")) as handle:
        sources = json.load(handle)
    source_id, source_url, released, sha, licence, attribution, caveats = source_release(sources)
    with workfiles.open_text(workfiles.name(WORK, "fsq_place.tsv", COVERAGE)) as handle:
        body = handle.read()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO UPDATE SET sha256 = EXCLUDED.sha256, caveats = EXCLUDED.caveats,
                 retrieved_at = EXCLUDED.retrieved_at""",
            (source_id, source_url, released, sha, licence, attribution, ETL_VERSION, caveats))
        cur.execute(f"CREATE TEMP TABLE fsq_stage ON COMMIT DROP AS SELECT {', '.join(COLUMNS)} "
                    "FROM fsq_place WITH NO DATA")
        with cur.copy(f"COPY fsq_stage ({', '.join(COLUMNS)}) FROM STDIN WITH (FORMAT text, NULL '')") as copy:
            copy.write(body)
        cur.execute("DELETE FROM fsq_place WHERE source_release_id = %s", (source_id,))
        cur.execute(
            f"""INSERT INTO fsq_place ({', '.join(COLUMNS)}, source_release_id)
                SELECT {', '.join('s.' + c for c in COLUMNS)}, %s FROM fsq_stage s
                WHERE EXISTS (SELECT 1 FROM area_geography g
                              WHERE g.kind = 'lad' AND g.id = ANY(%s)
                                AND ST_Intersects(g.geometry, s.location))""",
            (source_id, [coverage.borough_id(code) for code in sorted(COVERAGE.lad_codes)]))
        inside = cur.rowcount
        staged = cur.execute("SELECT count(*) FROM fsq_stage").fetchone()[0]
        print(f"load: {inside} of {staged} bbox places inside a borough ({staged - inside} clipped) "
              f"as {source_id}")


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    if stage == "extract":
        extract()
    elif stage == "build":
        build()
    elif stage == "load" and len(argv) == 3:
        load(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
