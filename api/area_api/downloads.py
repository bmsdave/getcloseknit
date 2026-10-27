"""Bulk download of the unified places database (GET /api/v2/downloads/places.csv).

`place` (migration 034) merges OpenStreetMap with the FSA register, Overture and Foursquare, so as a
database it is a derivative of OSM under ODbL 1.0; the place tiles and /areas/{id}/places nearby lists
are produced works from it. ODbL 4.6 asks that the derivative database be offered under ODbL, so this
serves every row (religion never stored, and refused here as in place_tile) with the columns the API
derives and serves (group, brand, importance score, specialty score, LSOA) and each source's ids.

The CSV is built once per place release into CLOSE_KNIT_DOWNLOAD_DIR (one COPY, a pool slot for
seconds, not for the client's whole download) and served from disk; a new release replaces the file.
"""
import os
import re
import tempfile
import threading
from datetime import date
from pathlib import Path
from typing import Any, Callable

from .evidence import ReleaseUnavailable, _check_cancelled

ODBL_URL = "https://opendatacommons.org/licenses/odbl/1-0/"
CACHE_CONTROL = "public, max-age=86400"
BUILD_TIMEOUT = "300s"  # SET LOCAL for the one COPY; the pool default (20 s) is for request queries

PLACES_RELEASE_SQL = """-- downloads:places-release
SELECT s.id, s.licence, s.attribution, s.release_date::text AS release_date
FROM source_release s
WHERE s.id = (SELECT source_release_id FROM place LIMIT 1)"""

PLACES_COPY_SQL = """COPY (
SELECT p.id, p.name, p.category, place_group(p.category) AS "group", p.tags->>'brand' AS brand,
  array_to_string(p.sources, ';') AS sources, round(p.confidence::numeric, 3) AS confidence,
  place_importance(p.category, p.confidence, p.sources, p.tags->>'brand', p.hygiene_rating) AS score,
  round(p.specialty_score::numeric, 2) AS specialty_score, p.hygiene_rating, p.lsoa_id,
  round(ST_X(p.location)::numeric, 6) AS lon, round(ST_Y(p.location)::numeric, 6) AS lat,
  p.osm_id, p.fhrs_id, p.overture_id, p.fsq_id, p.tags::text AS tags, p.source_release_id
FROM place p
WHERE p.category NOT IN ('place_of_worship', 'monastery', 'religion')
  AND NOT (p.tags ? 'religion')
  AND coalesce(p.tags->>'amenity', '') NOT IN ('place_of_worship', 'monastery')
  AND coalesce(p.tags->>'shop', '') <> 'religion'
  AND coalesce(p.tags->>'office', '') <> 'religion'
ORDER BY p.id
) TO STDOUT WITH (FORMAT csv, HEADER true)"""

_build_lock = threading.Lock()


def cache_dir() -> Path:
    return Path(os.environ.get("CLOSE_KNIT_DOWNLOAD_DIR") or Path(tempfile.gettempdir()) / "close-knit-downloads")


def notice(release: dict, today: str) -> str:
    """'#' lines ahead of the CSV header: the ODbL notice and the sources' attribution."""
    lines = [
        f"Close Knit unified places database, release {release['id']} ({release['release_date']}), "
        f"exported {today}.",
        f"This database is made available under the Open Database License (ODbL) 1.0: {ODBL_URL}",
        "Contains OpenStreetMap data (c) OpenStreetMap contributors, https://www.openstreetmap.org/copyright",
        f"Sources and their licences: {release['attribution']}",
        "Keep this notice with any copy. A public use of this database or of a database adapted from it "
        "must keep it under ODbL 1.0 (share-alike) and attribute the sources above.",
        "Rows merge records from several sources: confidence is source agreement, not a check on the "
        "ground. Places of worship and religion are not included.",
    ]
    return "".join(f"# {line}\n" for line in lines)


def places_csv(connect: Callable[[], Any], cancel: Callable[[], bool] | None = None) -> dict:
    """Path and download name of the current release's CSV, building it on first use."""
    _check_cancelled(cancel)
    with connect() as connection:
        rows = list(connection.execute(PLACES_RELEASE_SQL))
        if not rows:
            raise ReleaseUnavailable("no places release is loaded")
        release = dict(rows[0])
        name = re.sub(r"[^A-Za-z0-9._-]", "_", release["id"])
        target = cache_dir() / f"places-{name}.csv"
        with _build_lock:
            if not target.exists():
                _check_cancelled(cancel)
                _build(connection, release, target)
    return {"path": str(target), "filename": f"close-knit-places-{name}.csv", "release": release["id"]}


def _build(connection: Any, release: dict, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".partial")
    connection.execute(f"SET LOCAL statement_timeout = '{BUILD_TIMEOUT}'")
    with open(partial, "wb") as out:
        out.write(notice(release, date.today().isoformat()).encode())
        with connection.cursor().copy(PLACES_COPY_SQL) as copy:
            for chunk in copy:
                out.write(chunk)
    os.replace(partial, target)
    for old in target.parent.glob("places-*.csv"):
        if old != target:
            old.unlink(missing_ok=True)
