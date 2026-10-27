"""The map's area tiles as static PMTiles files (migration 127; docs/review-2026-10/review.md #8).

    python3 deploy/tools/area_pmtiles.py OUT_DIR [--url postgresql://…] [--shapes]

Packs the tiles of the coverage-simplified shapes (migration 119's area_shape_zoom, zoom 5-12; the map overzooms 12)
into one PMTiles v3 archive per kind of area, `areas-<release>-<kind>.pmtiles` with kind lsoa, msoa or borough (the
layer is named as the kind, as in ids and tile URLs), for every area and again for London's alone (the London map:
CLOSE_KNIT_ENGLAND off). A release is a hash of the three files' bytes, so new shapes make new file names even when the
area ids stay the same; a browser keeps a file for good (Caddy serves them immutable, with Range requests). Records
each release in area_pmtiles, where the API finds the newest (api/area_api/map_tiles.py), and deletes the files and
rows of all but the two newest releases of each scope (a page still holding the previous coverage keeps working).

One archive per kind, not one with three layers: the map draws one kind at a time at most zooms, and an LSOA layer is
four times an MSOA one, so a three-layer tile would send every kind's bytes for the one drawn.

--shapes rebuilds area_shape and area_shape_zoom first (new boundaries; ~5 min for England). The database URL defaults
to CLOSE_KNIT_DATABASE_URL. Production: deploy/ship.sh builds into /srv/close-knit-tiles when the database records
none; RELEASE-CHECKLIST.md has the command for a rebuild.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

KINDS = ("lsoa", "msoa", "borough")
MIN_ZOOM, MAX_ZOOM = 5, 12
LONDON = "E12000007"
SCOPES = (None, LONDON)  # every area, then London's alone
KEEP = 2  # releases kept per scope

# --- PMTiles v3 (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md) ---------------------------------

HEADER_BYTES = 127
ROOT_BYTES = 16384 - HEADER_BYTES  # the header and root directory are read in one request of 16 KiB
GZIP, MVT = 2, 1


def tile_id(z: int, x: int, y: int) -> int:
    """The tile's position on the archive's Hilbert curve: the tiles of the zooms above it, then its place in zoom z."""
    position, xy = 0, [x, y]
    s = 1 << z
    while s > 1:
        s >>= 1
        rx, ry = int(xy[0] & s > 0), int(xy[1] & s > 0)
        position += s * s * ((3 * rx) ^ ry)
        if ry == 0:
            if rx == 1:
                xy = [s - 1 - xy[0], s - 1 - xy[1]]
            xy = [xy[1], xy[0]]
    return ((1 << 2 * z) - 1) // 3 + position


def _varint(value: int, out: bytearray) -> None:
    while value > 0x7F:
        out.append(value & 0x7F | 0x80)
        value >>= 7
    out.append(value)


def _read_varint(data: bytes, i: int) -> tuple[int, int]:
    shift = value = 0
    while True:
        byte = data[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, i
        shift += 7


def _gzip(data: bytes) -> bytes:
    return gzip.compress(data, compresslevel=9, mtime=0)  # no timestamp: the same tiles, the same bytes


Entry = tuple[int, int, int, int]  # tile id, offset, length, run length (0: a leaf directory)


def directory(entries: list[Entry]) -> bytes:
    out = bytearray()
    _varint(len(entries), out)
    last = 0
    for tid, _, _, _ in entries:
        _varint(tid - last, out)
        last = tid
    for _, _, _, run in entries:
        _varint(run, out)
    for _, _, length, _ in entries:
        _varint(length, out)
    for i, (_, offset, _, _) in enumerate(entries):
        previous = entries[i - 1] if i else None
        _varint(0 if previous and offset == previous[1] + previous[2] else offset + 1, out)
    return _gzip(bytes(out))


def read_directory(data: bytes) -> list[Entry]:
    data = gzip.decompress(data)
    count, i = _read_varint(data, 0)
    columns = []
    for _ in range(4):
        column = []
        for _ in range(count):
            value, i = _read_varint(data, i)
            column.append(value)
        columns.append(column)
    entries: list[Entry] = []
    tid = 0
    for n in range(count):
        tid += columns[0][n]
        offset = columns[3][n] - 1 if columns[3][n] else entries[-1][1] + entries[-1][2]
        entries.append((tid, offset, columns[2][n], columns[1][n]))
    return entries


def _directories(entries: list[Entry]) -> tuple[bytes, bytes]:
    """The root directory, and the leaf directories when every entry does not fit in the root."""
    root = directory(entries)
    size = 4096
    while len(root) > ROOT_BYTES:
        leaves = bytearray()
        roots = []
        for start in range(0, len(entries), size):
            leaf = directory(entries[start:start + size])
            roots.append((entries[start][0], len(leaves), len(leaf), 0))
            leaves += leaf
        root = directory(roots)
        if len(root) <= ROOT_BYTES:
            return root, bytes(leaves)
        size *= 2
    return root, b""


def write(tiles: dict[tuple[int, int, int], bytes], layer: str, bounds: tuple[float, float, float, float]) -> bytes:
    """A PMTiles archive of vector tiles ({(z, x, y): MVT bytes}, empty ones left out), each gzipped, in tile id order."""
    ordered = sorted((tile_id(*zxy), _gzip(tile)) for zxy, tile in tiles.items() if tile)
    entries: list[Entry] = []
    data = bytearray()
    for tid, tile in ordered:
        entries.append((tid, len(data), len(tile), 1))
        data += tile
    root, leaves = _directories(entries)
    zooms = [z for z, _, _ in tiles] or [MIN_ZOOM]
    metadata = _gzip(json.dumps({"vector_layers": [{"id": layer, "fields": {}, "minzoom": min(zooms), "maxzoom": max(zooms)}]},
                                sort_keys=True, separators=(",", ":")).encode())
    west, south, east, north = bounds
    e7 = lambda degrees: round(degrees * 10_000_000)  # noqa: E731
    offsets = [HEADER_BYTES, len(root), HEADER_BYTES + len(root), len(metadata),
               HEADER_BYTES + len(root) + len(metadata), len(leaves),
               HEADER_BYTES + len(root) + len(metadata) + len(leaves), len(data),
               len(entries), len(entries), len(entries)]
    header = (b"PMTiles" + struct.pack("<B11QBBBBBBiiiiBii", 3, *offsets, 1, GZIP, GZIP, MVT, min(zooms), max(zooms),
                                       e7(west), e7(south), e7(east), e7(north), min(zooms),
                                       e7((west + east) / 2), e7((south + north) / 2)))
    assert len(header) == HEADER_BYTES
    return header + root + metadata + leaves + bytes(data)


def read_header(archive: bytes) -> dict:
    if archive[:7] != b"PMTiles" or archive[7] != 3:
        raise ValueError("not a PMTiles v3 archive")
    values = struct.unpack("<11QBBBBBBiiiiBii", archive[8:HEADER_BYTES])
    names = ("root_offset", "root_length", "metadata_offset", "metadata_length", "leaf_offset", "leaf_length",
             "data_offset", "data_length", "addressed_tiles", "tile_entries", "tile_contents", "clustered",
             "internal_compression", "tile_compression", "tile_type", "min_zoom", "max_zoom", "min_lon_e7",
             "min_lat_e7", "max_lon_e7", "max_lat_e7", "center_zoom", "center_lon_e7", "center_lat_e7")
    return dict(zip(names, values))


def read_tile(archive: bytes, z: int, x: int, y: int) -> bytes:
    """One tile's MVT bytes from an archive write() made, b"" when it holds none."""
    header = read_header(archive)
    tid = tile_id(z, x, y)
    start, length = header["root_offset"], header["root_length"]
    for _ in range(4):  # the root, then at most a few levels of leaves
        entries = read_directory(archive[start:start + length])
        found = None
        for entry in entries:  # the last entry at or before the tile
            if entry[0] > tid:
                break
            found = entry
        if found is None:
            return b""
        entry_id, offset, size, run = found
        if run == 0:
            start, length = header["leaf_offset"] + offset, size
            continue
        if tid >= entry_id + run:
            return b""
        tile = archive[header["data_offset"] + offset:header["data_offset"] + offset + size]
        return gzip.decompress(tile) if header["tile_compression"] == GZIP else tile
    raise ValueError("leaf directories nested too deep")


# --- the build ----------------------------------------------------------------------------------------------------

# The tiles each LAD's box touches at a zoom (LSOAs and MSOAs nest in LADs), as build_area_tiles did; with a region,
# only its LADs'.
TILES_SQL = """
SELECT c.x, c.y, area_region_tile_mvt(%(kind)s, %(z)s, c.x, c.y, %(region)s) AS tile
FROM (
    SELECT DISTINCT tx AS x, ty AS y
    FROM area_shape b,
         LATERAL (SELECT 2 ^ %(z)s AS n) size,
         LATERAL generate_series(floor((ST_XMin(b.geometry) + 180) / 360 * size.n)::integer,
                                 floor((ST_XMax(b.geometry) + 180) / 360 * size.n)::integer) tx,
         LATERAL generate_series(
             floor((1 - ln(tan(radians(ST_YMax(b.geometry))) + 1 / cos(radians(ST_YMax(b.geometry)))) / pi()) / 2 * size.n)::integer,
             floor((1 - ln(tan(radians(ST_YMin(b.geometry))) + 1 / cos(radians(ST_YMin(b.geometry)))) / pi()) / 2 * size.n)::integer) ty
    WHERE b.kind = 'borough' AND (%(region)s::text IS NULL OR b.parent_id = 'uk:region:' || %(region)s)
) c
OFFSET 0"""

BOUNDS_SQL = """
SELECT ST_XMin(e) AS west, ST_YMin(e) AS south, ST_XMax(e) AS east, ST_YMax(e) AS north
FROM (SELECT ST_Extent(geometry)::geometry AS e FROM area_shape
      WHERE kind = 'borough' AND (%(region)s::text IS NULL OR parent_id = 'uk:region:' || %(region)s)) b"""


def file_name(release: str, kind: str) -> str:
    return f"areas-{release}-{kind}.pmtiles"


def archives(connection, region: str | None) -> dict[str, tuple[bytes, int]]:
    """{kind: (archive bytes, tiles)} of every area, or of one region's alone."""
    bounds = connection.execute(BOUNDS_SQL, {"region": region}).fetchone()
    if bounds is None or bounds[0] is None:
        raise SystemExit("area_pmtiles: no area shapes (run with --shapes, or build_area_shapes() first)")
    built = {}
    for kind in KINDS:
        tiles = {}
        for z in range(MIN_ZOOM, MAX_ZOOM + 1):
            for x, y, tile in connection.execute(TILES_SQL, {"kind": kind, "z": z, "region": region}):
                if tile:
                    tiles[(z, x, y)] = bytes(tile)
        built[kind] = (write(tiles, kind, tuple(bounds)), len(tiles))
    return built


def release_of(built: dict[str, tuple[bytes, int]]) -> str:
    digest = hashlib.sha256()
    for kind in KINDS:
        digest.update(kind.encode() + b"\0" + built[kind][0])
    return digest.hexdigest()[:12]


def build(connection, out: Path, region: str | None) -> dict:
    """Writes one scope's archives into `out` and records the release (the caller commits)."""
    built = archives(connection, region)
    release = release_of(built)
    out.mkdir(parents=True, exist_ok=True)
    for kind, (archive, _) in built.items():
        path = out / file_name(release, kind)
        if not path.exists():  # the same name holds the same bytes
            partial = path.with_suffix(".partial")
            partial.write_bytes(archive)
            os.replace(partial, path)
    tiles = sum(count for _, count in built.values())
    size = sum(len(archive) for archive, _ in built.values())
    connection.execute("INSERT INTO area_pmtiles (release, region_code, tiles, bytes) VALUES (%s, %s, %s, %s) "
                       "ON CONFLICT (release) DO UPDATE SET built_at = now()", (release, region, tiles, size))
    return {"release": release, "region": region, "tiles": tiles, "bytes": size}


def prune(connection, out: Path) -> list[str]:
    """Deletes the rows and files of all but the KEEP newest releases of each scope; returns the files deleted."""
    kept = {row[0] for row in connection.execute(
        "SELECT release FROM (SELECT release, row_number() OVER (PARTITION BY region_code ORDER BY built_at DESC) AS n "
        "FROM area_pmtiles) r WHERE n <= %s", (KEEP,))}
    connection.execute("DELETE FROM area_pmtiles WHERE NOT (release = ANY(%s))", (sorted(kept),))
    deleted = []
    for path in sorted(out.glob("areas-*.pmtiles")):
        if path.name.split("-")[1] not in kept:
            path.unlink()
            deleted.append(path.name)
    return deleted


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out", type=Path, help="the directory the files are served from")
    parser.add_argument("--url", default=os.environ.get("CLOSE_KNIT_DATABASE_URL"))
    parser.add_argument("--shapes", action="store_true", help="rebuild area_shape and area_shape_zoom first")
    args = parser.parse_args(argv)
    if not args.url:
        parser.error("no database: pass --url or set CLOSE_KNIT_DATABASE_URL")
    import psycopg

    if args.shapes:
        with psycopg.connect(args.url, autocommit=True) as connection:  # each step its own transaction
            print(f"area shapes: {connection.execute('SELECT build_area_shapes()').fetchone()[0]}", flush=True)
            for z in range(MIN_ZOOM, MAX_ZOOM + 1):
                print(f"zoom {z}: {connection.execute('SELECT build_area_shape_zoom(%s)', (z,)).fetchone()[0]}", flush=True)
    with psycopg.connect(args.url) as connection:
        for region in SCOPES:
            result = build(connection, args.out, region)
            print(f"{result['region'] or 'every area'}: release {result['release']}, {result['tiles']} tiles, "
                  f"{result['bytes'] / 1e6:.1f} MB", flush=True)
        for name in prune(connection, args.out):
            print(f"deleted {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
