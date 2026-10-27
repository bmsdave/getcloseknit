"""Geograph Britain and Ireland photos in London (migration 043).

Source: the Geograph gridimage_base dump (CC BY-SA 2.0), one row per accepted
photo with its photographer, title, date taken and WGS84 point. Postcode pages
list the photos nearest the postcode as credited links. The dump has no image
file addresses, and Geograph asks that its images are not hotlinked without
permission, so no image is fetched or shown from it.

Stages (work files go to $AE_WORK, default ~/data/aework/geograph):
  build       read the dump (downloaded by hand into ~/data/geograph; see DATA-LICENCES.md),
              keep photos inside London's bounding box and write photo.tsv and sources.json
  load URL    load the TSV into the migration 043 table, keeping photos inside a London LSOA
              (psycopg needed)

  curl -o ~/data/geograph/gridimage_base.tsv.gz https://data.geograph.org.uk/dumps/gridimage_base.tsv.gz
  python3 -m area_analytics.geograph build
  uv run --with 'psycopg[binary]' python -m area_analytics.geograph load postgresql://...

Everything except load is pure and dependency-free.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sys
from typing import Iterable, Iterator

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "geograph"))
DUMP = os.environ.get("AE_GEOGRAPH_DUMP", os.path.join(DATA, "geograph", "gridimage_base.tsv.gz"))
DUMP_URL = "https://data.geograph.org.uk/dumps/gridimage_base.tsv.gz"
SOURCE = os.environ.get("AE_GEOGRAPH_SOURCE", "src-geograph-2026-10")
ETL_VERSION = "close-knit-geograph-1"
ATTRIBUTION = "Photos © their Geograph Britain and Ireland contributors, CC BY-SA 2.0."
# gridimage_base columns, in dump order (https://data.geograph.org.uk/dumps/gridimage_base.schema).
HEADER = ("gridimage_id", "user_id", "realname", "title", "moderation_status", "imagetaken",
          "grid_reference", "x", "y", "wgs84_lat", "wgs84_long", "reference_index")
ACCEPTED = {"accepted", "geograph"}
# Greater London with a margin; load keeps only points inside a London LSOA.
SOUTH, NORTH, WEST, EAST = 51.28, 51.70, -0.52, 0.34
COLUMNS = ("id", "title", "photographer", "user_id", "taken", "lat", "lon")


def _unescape(value: str) -> str:
    """The dump writes tabs and newlines inside a field as \\t and \\n."""
    return value.replace("\\t", " ").replace("\\n", " ").replace("\\\\", "\\").strip()


def _taken(value: str) -> str | None:
    """'2014-05-28' stays; MySQL's '0000-00-00' and partial dates like '2014-05-00' become None."""
    parts = value.split("-")
    if len(parts) != 3 or not all(part.isdigit() for part in parts) or "00" in (parts[1], parts[2]):
        return None
    return value if parts[0] != "0000" else None


def photo_rows(rows: Iterable[list[str]], header: tuple[str, ...] = HEADER) -> list[dict]:
    """Accepted photos inside London's bounding box with a credit and a title, sorted by id."""
    at = {name: index for index, name in enumerate(header)}
    found = {}
    for row in rows:
        if len(row) < len(header) or row[at["moderation_status"]] not in ACCEPTED:
            continue
        try:
            id_, user_id = int(row[at["gridimage_id"]]), int(row[at["user_id"]])
            lat, lon = float(row[at["wgs84_lat"]]), float(row[at["wgs84_long"]])
        except ValueError:
            continue
        if not (SOUTH <= lat <= NORTH and WEST <= lon <= EAST):
            continue
        title, photographer = _unescape(row[at["title"]]), _unescape(row[at["realname"]])
        if not title or not photographer:
            continue
        found[id_] = {"id": id_, "title": title, "photographer": photographer, "user_id": user_id,
                      "taken": _taken(row[at["imagetaken"]]), "lat": lat, "lon": lon}
    return [found[key] for key in sorted(found)]


def dump_rows(path: str) -> tuple[tuple[str, ...], Iterator[list[str]]]:
    """(header, data rows) from the gzipped TSV; a first line naming the columns is used as the header."""
    handle = gzip.open(path, "rt", encoding="utf-8", errors="replace", newline="\n")
    first = handle.readline().rstrip("\n").split("\t")
    header = tuple(first) if first and first[0] == "gridimage_id" else HEADER

    def rows() -> Iterator[list[str]]:
        if header is HEADER:
            yield first
        for line in handle:
            yield line.rstrip("\n").split("\t")
    return header, rows()


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _tsv(value) -> str:
    return "" if value is None else str(value).replace("\\", "\\\\").replace("\t", " ").replace("\n", " ")


def build() -> None:
    os.makedirs(WORK, exist_ok=True)
    header, rows = dump_rows(DUMP)
    photos = photo_rows(rows, header)
    if not photos:
        raise SystemExit("build: no London photos in the dump")
    with open(os.path.join(WORK, "photo.tsv"), "w", newline="") as handle:
        for photo in photos:
            handle.write("\t".join(_tsv(photo[c]) for c in COLUMNS) + "\n")
    with open(os.path.join(WORK, "sources.json"), "w") as handle:
        json.dump({"sha256": _sha256(DUMP), "rows": len(photos)}, handle)
    print(f"build: {len(photos)} photos in London's bounding box")


def source_release(sources: dict) -> tuple:
    """(id, url, sha256, licence, attribution, caveats) for the loaded dump."""
    return (SOURCE, DUMP_URL, sources["sha256"], "CC-BY-SA-2.0", ATTRIBUTION,
            ["Photos are placed where the photographer put them; the nearest may not show the street itself.",
             "Titles, credits and points only: images stay on Geograph and are linked, never copied."])


# Each point goes to the LSOA containing it; points outside London are dropped.
PLACE_SQL = """INSERT INTO geograph_photo (id, title, photographer, user_id, taken, location,
                                           geography_id, source_release_id)
SELECT p.id, p.title, p.photographer, p.user_id, p.taken, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326),
       lsoa.id, %s
FROM staging_geograph_photo p
JOIN area_geography lsoa ON lsoa.kind = 'lsoa'
 AND ST_Contains(lsoa.geometry, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326))
ON CONFLICT (id) DO NOTHING"""


def load(url: str) -> None:
    import psycopg

    with open(os.path.join(WORK, "sources.json")) as handle:
        sources = json.load(handle)
    source_id, source_url, sha, licence, attribution, caveats = source_release(sources)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), current_date, %s, %s, %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, source_url, sha, licence, attribution, ETL_VERSION, caveats))
        cur.execute("""CREATE TEMP TABLE staging_geograph_photo (id integer, title text, photographer text,
                       user_id integer, taken date, lat double precision, lon double precision)""")
        with open(os.path.join(WORK, "photo.tsv")) as handle, cur.copy(
                "COPY staging_geograph_photo FROM STDIN WITH (FORMAT text, NULL '')") as copy:
            while chunk := handle.read(1 << 20):
                copy.write(chunk)
        cur.execute("DELETE FROM geograph_photo WHERE source_release_id = %s", (source_id,))
        cur.execute(PLACE_SQL, (source_id,))
        staged = cur.execute("SELECT count(*) FROM staging_geograph_photo").fetchone()[0]
        placed = cur.execute("SELECT count(*) FROM geograph_photo WHERE source_release_id = %s",
                             (source_id,)).fetchone()[0]
        print(f"load: {placed} of {staged} photos placed in a London LSOA")


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    if stage == "build":
        build()
    elif stage == "load" and len(argv) == 3:
        load(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
