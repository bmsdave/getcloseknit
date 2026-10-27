"""Street trees and Green streets on the map (migration 066).

Sources (all open; see DATA-LICENCES.md):
  GLA public realm trees, Nov 2025 (London Datastore, OGL v3): the file etl_nature.py loads into
          street_tree, read again for each tree's height, canopy spread, trunk girth and age
  OS Open Roads (Ordnance Survey, OGL v3), Shapefile: road centre lines of the TQ and TL squares,
          which hold all of Greater London

Stages (files under $AE_WORK, default ~/data/aework/green-streets):
  download                       the trees CSV and OS Open Roads (the GB zip, ~600 MB, checked against
                                 its published md5; only the TQ and TL road links are kept)
  load <db-url>                  migration 066, tree sizes onto street_tree, road_link inside Greater
                                 London, then rebuild_green_streets(); committed
  bundle <db-url> <out.sql.gz>   the same inside a transaction that is rolled back, so a read-only copy
                                 of the production data will do, written as one SQL file for production
                                 (after migration 066): gunzip -c out.sql.gz | psql <database-url>

  AE_WORK=~/data/aework/green-streets python3 etl_green_streets.py download
  AE_WORK=~/data/aework/green-streets python3 etl_green_streets.py bundle <database-url> load.sql.gz

Needs psycopg for load and bundle; the rest is the standard library.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import math
import os
import struct
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import etl_nature  # noqa: E402  (the tree list, its ids and how sizes are read)

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "green-streets"))
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "066-street-trees.sql"

ETL_VERSION = "close-knit-green-streets-1"
ROADS_PRODUCT = "https://api.os.uk/downloads/v1/products/OpenRoads"
ROADS_FORMAT = "ESRI® Shapefile"
ROADS_SQUARES = ("TQ", "TL")  # 100 km squares: TQ holds London, TL its northern edge (Enfield)
# Greater London in British National Grid metres, with a margin; the borough outlines clip it exactly.
LONDON_BNG = (500_000, 153_000, 565_000, 205_000)
# Streets people live on and travel along. Left out: motorways, slip roads and busways (no street trees
# of their own), tunnels, and service lanes behind houses ("Secondary Access Road").
KEEP_FUNCTIONS = {"A Road", "B Road", "Minor Road", "Local Road", "Local Access Road", "Restricted Local Access Road"}
SKIP_FORMS = {"Slip Road", "Guided Busway"}
SKIP_STRUCTURES = {"Road In Tunnel"}


# --- download ---------------------------------------------------------------------------------

def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    etl_nature.download_file(etl_nature.TREES_URL, os.path.join(WORK, "trees.csv"))
    product = json.loads(etl_nature.fetch(ROADS_PRODUCT))
    listing = json.loads(etl_nature.fetch(f"{ROADS_PRODUCT}/downloads"))
    item = next(entry for entry in listing if entry["format"] == ROADS_FORMAT and entry["area"] == "GB")
    zipped = os.path.join(WORK, item["fileName"])
    etl_nature.download_file(item["url"], zipped)
    if md5(zipped) != item["md5"]:
        os.remove(zipped)
        sys.exit(f"download: {item['fileName']} does not match its published md5; removed, run again")
    with zipfile.ZipFile(zipped) as archive:
        for name in archive.namelist():
            base = os.path.basename(name)
            if any(base.startswith(f"{square}_RoadLink.") for square in ROADS_SQUARES):
                etl_nature.save(os.path.join(WORK, base), archive.read(name))
    etl_nature.save(os.path.join(WORK, "roads.json"), json.dumps(
        {"version": product["version"], "md5": item["md5"], "fileName": item["fileName"]}).encode())
    os.remove(zipped)
    print(f"download: OS Open Roads {product['version']}, {', '.join(ROADS_SQUARES)} road links", flush=True)


def md5(path: str) -> str:
    digest = hashlib.md5()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# --- read -------------------------------------------------------------------------------------

def dbf_rows(path: str):
    """Each record of a dBASE file as a dict of stripped strings."""
    with open(path, "rb") as handle:
        count, header_length, record_length = struct.unpack("<IHH", handle.read(12)[4:12])
        handle.seek(32)
        fields = []
        while True:
            descriptor = handle.read(32)
            if descriptor[0] == 0x0D:
                break
            fields.append((descriptor[:11].split(b"\0")[0].decode("ascii"), descriptor[16]))
        handle.seek(header_length)
        for _ in range(count):
            record = handle.read(record_length)
            row, offset = {}, 1  # byte 0 is the deletion flag
            for name, size in fields:
                row[name] = record[offset:offset + size].decode("utf-8", "replace").strip()
                offset += size
            yield row


def shp_lines(path: str):
    """Each record of a PolyLine / PolyLineZ / PolyLineM shapefile: (bbox, [parts of (x, y)])."""
    with open(path, "rb") as handle:
        handle.seek(100)
        while header := handle.read(8):
            _, words = struct.unpack(">ii", header)
            content = handle.read(words * 2)
            shape = struct.unpack("<i", content[:4])[0]
            if shape == 0:
                yield None, []
                continue
            if shape not in (3, 13, 23):
                raise ValueError(f"{path}: shape type {shape} is not a polyline")
            box = struct.unpack("<4d", content[4:36])
            parts_count, points_count = struct.unpack("<2i", content[36:44])
            starts = list(struct.unpack(f"<{parts_count}i", content[44:44 + 4 * parts_count])) + [points_count]
            flat = struct.unpack(f"<{2 * points_count}d", content[44 + 4 * parts_count:44 + 4 * parts_count + 16 * points_count])
            points = list(zip(flat[0::2], flat[1::2]))
            yield box, [points[starts[i]:starts[i + 1]] for i in range(parts_count)]


def keep(row: dict) -> bool:
    return (row.get("function") in KEEP_FUNCTIONS and row.get("formOfWay") not in SKIP_FORMS
            and row.get("structure") not in SKIP_STRUCTURES)


def overlaps(box, frame=LONDON_BNG) -> bool:
    return box[0] <= frame[2] and box[2] >= frame[0] and box[1] <= frame[3] and box[3] >= frame[1]


def length(points) -> float:
    return sum(math.dist(a, b) for a, b in zip(points, points[1:]))


def road_links(paths: list[str]):
    """(id, name, road function, length in m, EWKT) for each kept link near London; a link in several
    parts is one row per part ("<id>-2", ...). A link crossing two squares is in both files: read once."""
    seen: set[str] = set()
    for shp in paths:
        dbf = shp[:-4] + ".dbf"
        for (box, parts), row in zip(shp_lines(shp), dbf_rows(dbf)):
            if box is None or not keep(row) or not overlaps(box) or row["identifier"] in seen:
                continue
            seen.add(row["identifier"])
            for index, points in enumerate(parts):
                if len(points) < 2 or length(points) < 1:  # junction stubs
                    continue
                link = row["identifier"] if index == 0 else f"{row['identifier']}-{index + 1}"
                ewkt = "SRID=27700;LINESTRING(" + ",".join(f"{x:.1f} {y:.1f}" for x, y in points) + ")"
                yield link, row.get("name1") or None, row["function"], round(length(points), 1), ewkt


# --- load -------------------------------------------------------------------------------------

def clean(value) -> str:
    """One COPY text field ('' is NULL)."""
    return "" if value is None else str(value).replace("\\", "/").replace("\t", " ").replace("\n", " ")


def tree_sizes(path: str):
    """(id, height, canopy, girth, canopy_m, age) for every tree with something recorded."""
    for key, _, _, row in etl_nature.tree_records(path):
        size = etl_nature.tree_size(row)
        if any(value is not None for value in size):
            yield (key, *size)


def copy_rows(cur, statement: str, rows) -> int:
    count = 0
    with cur.copy(statement) as copy:
        for row in rows:
            copy.write("\t".join(clean(value) for value in row) + "\n")
            count += 1
    return count


def roads_source(cur) -> str:
    meta = json.loads(Path(WORK, "roads.json").read_text())
    shapes = sorted(str(path) for square in ROADS_SQUARES for path in Path(WORK).glob(f"{square}_RoadLink.*"))
    return etl_nature.register(
        cur, f"src-os-open-roads-{meta['version']}", ROADS_PRODUCT, f"{meta['version']}-01",
        etl_nature.sha256(*shapes), "OGL-3.0",
        f"Contains OS data © Crown copyright and database right {meta['version'][:4]}.",
        ["Road centre lines only: footpaths, alleys and service lanes are not streets here.",
         "Trees are the GLA's council, TfL and Royal Parks list: a street of private or garden trees reads as bare."], version=ETL_VERSION)


def build(cur) -> dict:
    """Migration 066, tree sizes, road links and their trees, in the open transaction."""
    cur.execute(MIGRATION.read_text())
    cur.execute("CREATE TEMP TABLE tree_size (id text PRIMARY KEY, height text, canopy text, girth text, "
                "canopy_m real, age text) ON COMMIT DROP")
    sized = copy_rows(cur, "COPY tree_size FROM STDIN WITH (FORMAT text, NULL '')", tree_sizes(os.path.join(WORK, "trees.csv")))
    cur.execute("""UPDATE street_tree t SET height = s.height, canopy = s.canopy, girth = s.girth, canopy_m = s.canopy_m, age = s.age
                   FROM tree_size s WHERE s.id = t.id""")
    matched = cur.rowcount
    if matched < 0.99 * sized:
        raise SystemExit(f"load: only {matched} of {sized} sized trees are in street_tree: load the same trees file first "
                         "(etl_nature.py load)")
    source_id = roads_source(cur)
    cur.execute("DELETE FROM road_link")
    shapes = [os.path.join(WORK, f"{square}_RoadLink.shp") for square in ROADS_SQUARES]
    read = copy_rows(cur, "COPY road_link (id, name, road_function, length_m, geometry, source_release_id) FROM STDIN "
                          "WITH (FORMAT text, NULL '')", ((*link, source_id) for link in road_links(shapes)))
    cur.execute("""WITH london AS (SELECT ST_Transform(ST_Union(geometry), 27700) AS g FROM area_geography WHERE kind = 'lad')
                   DELETE FROM road_link r USING london WHERE NOT ST_Intersects(r.geometry, london.g)""")
    outside = cur.rowcount
    counted = cur.execute("SELECT rebuild_green_streets()").fetchone()[0]
    links = cur.execute("SELECT count(*), count(*) FILTER (WHERE trees > 0) FROM road_link").fetchone()
    stats = {"trees_sized": sized, "trees_matched": matched, "links_read": read, "links_outside": outside,
             "links": links[0], "links_with_trees": links[1], "trees_on_links": counted, "source": source_id}
    print(f"load: {json.dumps(stats)}", flush=True)
    return stats


def load(url: str) -> None:
    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        build(cur)


BUNDLE_HEAD = """-- Close Knit: street tree sizes and Green streets (migration 066), built by
-- deploy/tools/etl_green_streets.py bundle. Apply deploy/migrations/066-street-trees.sql first, then
--   gunzip -c load.sql.gz | psql -v ON_ERROR_STOP=1 <database-url>
-- One transaction: any error leaves the database as it was.
\\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
    IF to_regclass('public.road_link') IS NULL OR to_regprocedure('public.green_street_tile(integer,integer,integer)') IS NULL THEN
        RAISE EXCEPTION 'apply deploy/migrations/066-street-trees.sql first';
    END IF;
END $$;
"""

BUNDLE_TREES = """CREATE TEMP TABLE tree_size (id text PRIMARY KEY, height text, canopy text, girth text, canopy_m real, age text) ON COMMIT DROP;
COPY tree_size FROM STDIN WITH (FORMAT text, NULL '');
"""

BUNDLE_TREES_APPLY = """\\.
DO $$ DECLARE sized integer; matched integer; BEGIN
    SELECT count(*) INTO sized FROM tree_size;
    UPDATE street_tree t SET height = s.height, canopy = s.canopy, girth = s.girth, canopy_m = s.canopy_m, age = s.age
    FROM tree_size s WHERE s.id = t.id;
    GET DIAGNOSTICS matched = ROW_COUNT;
    IF matched < 0.99 * sized THEN
        RAISE EXCEPTION 'only % of % sized trees are in street_tree: this bundle is for the Nov 2025 GLA tree list', matched, sized;
    END IF;
    RAISE NOTICE 'street_tree: % trees sized', matched;
END $$;
DELETE FROM road_link;
COPY road_link (id, name, road_function, length_m, trees, canopy_trees, canopy_sum_m, geometry, source_release_id) FROM STDIN WITH (FORMAT text, NULL '');
"""

BUNDLE_TAIL = """\\.
COMMIT;
ANALYZE street_tree;
ANALYZE road_link;
"""


def write_copy(cur, statement: str, out) -> None:
    with cur.copy(statement) as copy:
        for block in copy:
            out.write(bytes(block))


def bundle(url: str, path: str) -> None:
    """Builds in a transaction that is rolled back, writing what production needs as one SQL file."""
    import psycopg

    with psycopg.connect(url) as conn:
        try:
            with conn.cursor() as cur:
                stats = build(cur)
                source = cur.execute("SELECT * FROM source_release WHERE id = %s", (stats["source"],)).fetchone()
                columns = [column.name for column in cur.description]
                with gzip.open(path + ".tmp", "wb", compresslevel=9) as out:
                    out.write(BUNDLE_HEAD.encode())
                    values = ", ".join(sql_literal(value) for value in source)
                    out.write(f"INSERT INTO source_release ({', '.join(columns)}) VALUES ({values}) ON CONFLICT (id) DO NOTHING;\n".encode())
                    out.write(BUNDLE_TREES.encode())
                    write_copy(cur, "COPY (SELECT s.id, s.height, s.canopy, s.girth, s.canopy_m, s.age FROM tree_size s "
                                    "JOIN street_tree t USING (id) ORDER BY s.id) TO STDOUT WITH (FORMAT text, NULL '')", out)
                    out.write(BUNDLE_TREES_APPLY.encode())
                    write_copy(cur, "COPY (SELECT id, name, road_function, length_m, trees, canopy_trees, canopy_sum_m, "
                                    "ST_AsEWKT(geometry, 1), source_release_id FROM road_link ORDER BY id) TO STDOUT "
                                    "WITH (FORMAT text, NULL '')", out)
                    out.write(BUNDLE_TAIL.encode())
                os.replace(path + ".tmp", path)
        finally:
            conn.rollback()
    print(f"bundle: {path} {os.path.getsize(path) // 1024} KiB, {json.dumps(stats)}", flush=True)


def sql_literal(value) -> str:
    """A source_release value as SQL: text, dates, timestamps and text arrays."""
    if value is None:
        return "NULL"
    if isinstance(value, (list, tuple)):
        return "ARRAY[" + ", ".join(sql_literal(item) for item in value) + "]::text[]" if value else "'{}'::text[]"
    text = value.isoformat() if hasattr(value, "isoformat") else str(value)
    return "'" + text.replace("'", "''") + "'"


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    elif stage == "bundle" and len(sys.argv) == 4:
        bundle(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
