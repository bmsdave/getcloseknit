"""Do the map's areas fit together? Overlaps and gaps of the area shapes (migration 119) and of their tiles.

    python3 deploy/tools/area_topology.py postgresql://postgres@localhost:5434/area_explorer [--tiles stored|live|DIR]
                                         [--release a1-…] [--quick] [--export web/e2e/area-tiles]

Prints one line per check and exits 1 when one fails. The checks:

- coverage   ST_CoverageInvalidEdges per kind of area_shape and per kind and zoom of area_shape_zoom: 0 edges
             (a neighbour's edge that overlaps or does not match exactly).
- nesting    each MSOA, borough and region of area_shape is the union of its LSOAs (symmetric difference 0), and at
             every zoom an MSOA's and a borough's area is the sum of their LSOAs'.
- labels     every borough label point (map_label) lies in its borough's shape.
- tiles      sample tiles z5-12 of each kind (London/Essex, incl. 9/256/169, and Manchester), decoded here:
             overlap = the summed area of every pairwise intersection inside the tile (tile units²; 4096 a tile
             side, 8192 at the top zoom), gap = holes in the union of the tile's areas that the full-detail
             coverage clipped to the same box does not have. Below zoom 8 only a 1024-unit square around the
             sample point (WINDOW).

--tiles stored reads area_tile of the built release (or --release), live calls area_tile_mvt, a directory reads the
newest build's archives there (area_pmtiles.py; or --release's), as the map does.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from typing import Iterable

import area_pmtiles

KINDS = ("lsoa", "msoa", "borough")
# London/Essex border (Dagenham/Thurrock) and central Manchester: dense LSOAs, a borough border, the Thames.
SAMPLE_POINTS = ((0.15, 51.55), (-2.24, 53.48))
EXTRA_TILES = ((9, 256, 169),)


def tile_of(lon: float, lat: float, z: int) -> tuple[int, int, int]:
    n = 2 ** z
    rad = math.radians(lat)
    return z, int((lon + 180) / 360 * n), int((1 - math.log(math.tan(rad) + 1 / math.cos(rad)) / math.pi) / 2 * n)


def sample_tiles() -> list[tuple[int, int, int]]:
    tiles = {tile_of(lon, lat, z) for lon, lat in SAMPLE_POINTS for z in range(5, 13)} | set(EXTRA_TILES)
    return sorted(tiles)


# Below zoom 8 a tile holds thousands of areas (all of England's LSOAs in three at zoom 5): the checks read a
# square of this many units around the sample point there, the whole tile elsewhere.
WINDOW = 1024


def sample_window(z: int, x: int, y: int, extent: int) -> tuple[float, float, float, float]:
    """The part of a sample tile the checks read, in tile units."""
    for lon, lat in SAMPLE_POINTS:
        if z < 8 and tile_of(lon, lat, z) == (z, x, y):
            n = 2 ** z
            rad = math.radians(lat)
            px = ((lon + 180) / 360 * n - x) * extent
            py = ((1 - math.log(math.tan(rad) + 1 / math.cos(rad)) / math.pi) / 2 * n - y) * extent
            west, north = min(max(px - WINDOW / 2, 0), extent - WINDOW), min(max(py - WINDOW / 2, 0), extent - WINDOW)
            return west, north, west + WINDOW, north + WINDOW
    return 0, 0, extent, extent


# --- Mapbox Vector Tile decoding (polygons only), enough for the area tiles -------------------------------------

def _varint(data: bytes, i: int) -> tuple[int, int]:
    shift = result = 0
    while True:
        byte = data[i]
        i += 1
        result |= (byte & 0x7F) << shift
        if byte < 0x80:
            return result, i
        shift += 7


def _fields(data: bytes) -> Iterable[tuple[int, int, object]]:
    i = 0
    while i < len(data):
        key, i = _varint(data, i)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, i = _varint(data, i)
        elif wire == 2:
            length, i = _varint(data, i)
            value, i = data[i:i + length], i + length
        elif wire == 5:
            value, i = data[i:i + 4], i + 4
        elif wire == 1:
            value, i = data[i:i + 8], i + 8
        else:
            raise ValueError(f"wire type {wire}")
        yield number, wire, value


def _packed(data: bytes) -> list[int]:
    values, i = [], 0
    while i < len(data):
        value, i = _varint(data, i)
        values.append(value)
    return values


def _rings(commands: list[int]) -> list[list[tuple[int, int]]]:
    rings, ring, x, y, i = [], [], 0, 0, 0
    while i < len(commands):
        command, count = commands[i] & 7, commands[i] >> 3
        i += 1
        if command == 7:  # ClosePath
            if ring:
                rings.append(ring + [ring[0]])
            ring = []
            continue
        for _ in range(count):
            dx, dy = commands[i], commands[i + 1]
            i += 2
            x += (dx >> 1) ^ -(dx & 1)
            y += (dy >> 1) ^ -(dy & 1)
            if command == 1:
                ring = [(x, y)]
            else:
                ring.append((x, y))
    return rings


def _signed_area(ring: list[tuple[int, int]]) -> float:
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:])) / 2


def decode(tile: bytes) -> dict[str, tuple[int, list[tuple[int, str, tuple[int, int, int, int]]]]]:
    """{layer: (extent, [(feature id, WKT multipolygon in tile units, its box)])}. A positive ring starts a polygon
    (the MVT spec's exterior, y down), negative ones are its holes."""
    layers = {}
    for number, _, layer in _fields(tile):
        if number != 3:
            continue
        name, extent, features = "", 4096, []
        for field, _, value in _fields(layer):
            if field == 1:
                name = value.decode()
            elif field == 5:
                extent = value
            elif field == 2:
                fid, commands = 0, []
                for f, _, v in _fields(value):
                    if f == 1:
                        fid = v
                    elif f == 4:
                        commands = _packed(v)
                polygons: list[list[list[tuple[int, int]]]] = []
                for ring in _rings(commands):
                    if len(ring) < 4 or _signed_area(ring) == 0:
                        continue
                    if _signed_area(ring) > 0 or not polygons:
                        polygons.append([ring])
                    else:
                        polygons[-1].append(ring)
                if polygons:
                    wkt = "MULTIPOLYGON(" + ",".join(
                        "(" + ",".join("(" + ",".join(f"{px} {py}" for px, py in r) + ")" for r in p) + ")"
                        for p in polygons) + ")"
                    xs = [px for p in polygons for r in p for px, _ in r]
                    ys = [py for p in polygons for r in p for _, py in r]
                    features.append((fid, wkt, (min(xs), min(ys), max(xs), max(ys))))
        layers[name] = (extent, features)
    return layers


# --- checks -------------------------------------------------------------------------------------------------------

COVERAGE_SQL = """
SELECT 'area_shape ' || kind AS level, count(e) AS bad FROM (
  SELECT kind, ST_CoverageInvalidEdges(geometry) OVER (PARTITION BY kind) e FROM area_shape) s GROUP BY kind
UNION ALL
SELECT 'zoom ' || z || ' ' || kind, count(e) + count(*) FILTER (WHERE NOT valid) FROM (
  SELECT kind, z, ST_IsValid(geom) AS valid, ST_CoverageInvalidEdges(geom) OVER (PARTITION BY kind, z) e
  FROM area_shape_zoom) s GROUP BY kind, z
ORDER BY 1"""

NESTING_SQL = """
WITH children AS (
  SELECT c.parent_id AS id, ST_CoverageUnion(c.geometry) AS g FROM area_shape c
  WHERE c.kind IN ('lsoa', 'msoa', 'borough') AND c.parent_id IS NOT NULL GROUP BY c.parent_id)
SELECT p.kind AS level, count(*) FILTER (WHERE ST_Area(ST_SymDifference(p.geometry, ST_SetSRID(c.g, 4326))) > 0) AS bad
FROM area_shape p JOIN children c ON c.id = p.id GROUP BY p.kind
UNION ALL
SELECT 'zoom ' || p.z || ' ' || p.kind, count(*) FILTER (WHERE abs(ST_Area(p.geom) - c.area) > 1e-6 * ST_Area(p.geom))
FROM area_shape_zoom p
JOIN (SELECT a.parent_id, z.z, sum(ST_Area(z.geom)) AS area FROM area_shape_zoom z JOIN area_shape a ON a.id = z.id
      WHERE z.kind IN ('lsoa', 'msoa') GROUP BY a.parent_id, z.z) c ON c.parent_id = p.id AND c.z = p.z
GROUP BY p.z, p.kind
ORDER BY 1"""

LABELS_SQL = """
SELECT count(*) AS bad FROM map_label l JOIN area_shape s ON s.kind = 'borough' AND s.official_code = l.code
WHERE l.kind = 'borough' AND NOT ST_Intersects(s.geometry, ST_SetSRID(ST_MakePoint(l.lon, l.lat), 4326))"""

TILE_TABLE_SQL = """
CREATE TEMP TABLE IF NOT EXISTS topology_tile_feature (kind text, z int, x int, y int, extent int, fid bigint,
                                                       g geometry, win geometry);
TRUNCATE topology_tile_feature"""

# Per sample tile: overlap = the areas' summed area minus the area of their union (inside the window), gap = holes
# of that union the full-detail coverage cut to the same box does not have. One union a tile, not a pairwise test.
TILE_SQL = """
WITH t AS (SELECT kind, z, x, y, max(extent) AS extent, (array_agg(win))[1] AS win,
                  sum(ST_Area(ST_Intersection(g, win))) AS total, ST_Union(g) AS u
           FROM topology_tile_feature GROUP BY 1, 2, 3, 4),
holes AS (
  SELECT t.kind, t.z, t.x, t.y, t.extent, h.h, ST_Area(ST_Intersection(h.h, t.win)) AS area
  FROM t, ST_Dump(t.u) d, generate_series(1, ST_NumInteriorRings(d.geom)) n,
       LATERAL (SELECT ST_MakePolygon(ST_InteriorRingN(d.geom, n)) AS h) h),
-- Only where the tile has holes: the full-detail coverage (regions) cut to the same box, and its own holes there
-- (a bay whose mouth lies outside the box).
ref AS (
  SELECT k.*, (SELECT ST_SetSRID(ST_AsMVTGeom(ST_Transform(ST_Union(ST_ClipByBox2D(s.geometry, b.box)), 3857),
                                              ST_TileEnvelope(k.z, k.x, k.y), k.extent, k.extent / 64, true), 0)
               FROM area_shape s,
                    LATERAL (SELECT ST_Transform(ST_TileEnvelope(k.z, k.x, k.y, margin => 0.1), 4326)::box2d AS box) b
               WHERE s.kind = 'region' AND s.geometry && b.box) AS r
  FROM (SELECT DISTINCT kind, z, x, y, extent FROM holes WHERE area > 0) k),
ref_holes AS (
  SELECT ref.kind, ref.z, ref.x, ref.y, ST_Collect(ST_MakePolygon(ST_InteriorRingN(d.geom, n))) AS rh
  FROM ref, ST_Dump(ref.r) d, generate_series(1, ST_NumInteriorRings(d.geom)) n GROUP BY 1, 2, 3, 4),
gaps AS (
  SELECT h.kind, h.z, h.x, h.y, count(*) AS holes, sum(h.area) AS area
  FROM holes h LEFT JOIN ref_holes r USING (kind, z, x, y)
  WHERE h.area > 0 AND (r.rh IS NULL OR NOT ST_Intersects(h.h, r.rh))
  GROUP BY 1, 2, 3, 4)
SELECT t.kind, t.z, t.x, t.y, greatest(t.total - ST_Area(ST_Intersection(t.u, t.win)), 0) AS overlap,
       coalesce(g.holes, 0) AS holes, coalesce(g.area, 0) AS gap
FROM t LEFT JOIN gaps g USING (kind, z, x, y)"""

# Where a tile overlaps: how many pairs of areas do.
PAIRS_SQL = """
SELECT count(*) FROM topology_tile_feature a
JOIN topology_tile_feature b ON (b.kind, b.z, b.x, b.y) = (a.kind, a.z, a.x, a.y) AND a.fid < b.fid AND a.g && b.g
WHERE (a.kind, a.z, a.x, a.y) = (%s, %s, %s, %s) AND ST_Relate(a.g, b.g, '2********')"""


def check(url: str, tiles: str = "stored", release: str | None = None, quick: bool = False,
          log=lambda message: None) -> list[tuple[str, str, float]]:
    """[(check, what, bad)]: every result line; bad is 0 when it passes. `log` hears how long each step took."""
    import time

    import psycopg

    results: list[tuple[str, str, float]] = []
    started = time.monotonic()

    def step(name: str) -> None:
        nonlocal started
        log(f"{name}: {time.monotonic() - started:.1f} s")
        started = time.monotonic()

    with psycopg.connect(url, autocommit=True) as connection:
        if not quick:
            for level, bad in connection.execute(COVERAGE_SQL):
                results.append(("coverage", level, bad))
            step("coverage")
            for level, bad in connection.execute(NESTING_SQL):
                results.append(("nesting", level, bad))
            step("nesting")
            results.append(("labels", "borough points outside their borough", connection.execute(LABELS_SQL).fetchone()[0]))
        if tiles == "stored" and release is None:
            row = connection.execute("SELECT release FROM area_tile_build ORDER BY built_at DESC LIMIT 1").fetchone()
            release = row[0] if row else None
        archives = {}
        if tiles not in ("stored", "live"):  # a directory of archives: the newest build of every area's, or --release
            if release is None:
                row = connection.execute("SELECT release FROM area_pmtiles WHERE region_code IS NULL "
                                         "ORDER BY built_at DESC LIMIT 1").fetchone()
                release = row[0] if row else None
            archives = {kind: Path(tiles, area_pmtiles.file_name(release, kind)).read_bytes() for kind in KINDS}
        connection.execute(TILE_TABLE_SQL)
        rows = []
        for kind in KINDS:
            for z, x, y in sample_tiles():
                if archives:
                    found = (area_pmtiles.read_tile(archives[kind], z, x, y),)
                elif tiles == "stored":
                    found = connection.execute("SELECT tile FROM area_tile WHERE release = %s AND kind = %s AND z = %s "
                                               "AND x = %s AND y = %s", (release, kind, z, x, y)).fetchone()
                else:
                    found = connection.execute("SELECT area_tile_mvt(%s, %s, %s, %s)", (kind, z, x, y)).fetchone()
                for name, (extent, features) in decode(bytes(found[0]) if found and found[0] else b"").items():
                    west, north, east, south = sample_window(z, x, y, extent)
                    window = f"POLYGON(({west} {north},{east} {north},{east} {south},{west} {south},{west} {north}))"
                    rows += [(name, z, x, y, extent, fid, wkt, window) for fid, wkt, (x0, y0, x1, y1) in features
                             if x0 <= east and x1 >= west and y0 <= south and y1 >= north]
        step(f"tiles read ({len(rows)} features)")
        with connection.cursor() as cursor:
            cursor.executemany("INSERT INTO topology_tile_feature VALUES (%s, %s, %s, %s, %s, %s, "
                               "ST_MakeValid(ST_GeomFromText(%s)), ST_GeomFromText(%s))", rows)
        connection.execute("CREATE INDEX ON topology_tile_feature USING gist (g)")
        connection.execute("ANALYZE topology_tile_feature")
        step("tiles stored")
        found = {(k, z, x, y): (overlap, holes, gap) for k, z, x, y, overlap, holes, gap in connection.execute(TILE_SQL)}
        step("unions")
        for kind in KINDS:
            for z, x, y in sample_tiles():
                area, holes, gap = found.get((kind, z, x, y), (0, 0, 0))
                # areas are whole or half units: anything under a hundredth is the float sum's noise
                area = area if area > 0.01 else 0
                pairs = connection.execute(PAIRS_SQL, (kind, z, x, y)).fetchone()[0] if area else 0
                where = f"{kind} {z}/{x}/{y}"
                results.append(("tile overlap", f"{where} ({pairs} pairs, units²)", round(area, 1)))
                results.append(("tile gap", f"{where} ({holes} holes, units²)", round(gap or 0, 1)))
    return results


# The e2e test's real tiles (web/e2e/area-topology.spec.ts): around a point of the border of Redbridge (London) and
# Epping Forest (Essex), MSOAs at zooms 6 to 9 and LSOAs at 6 to 9 and 12, each box (± degrees) a little wider than
# what the test reads there.
E2E_CENTRE = (0.0768, 51.6063)
# Both kinds either side of zoom 9, MSOAs to LSOAs (web/src/lib/map-coverage.ts WIDE_ZOOM): the kind drawn keeps
# drawing past it until the other's colours land (area-levels).
E2E_TILES = (("msoa", 6, 0.07, 0.045), ("msoa", 7, 0.07, 0.045), ("msoa", 8, 0.05, 0.03), ("msoa", 9, 0.04, 0.025),
             ("lsoa", 6, 0.07, 0.045), ("lsoa", 7, 0.07, 0.045), ("lsoa", 8, 0.05, 0.03), ("lsoa", 9, 0.04, 0.025),
             ("lsoa", 12, 0.005, 0.003))


def e2e_tiles() -> list[tuple[str, int, int, int]]:
    lon, lat = E2E_CENTRE
    tiles = []
    for kind, z, dlon, dlat in E2E_TILES:
        _, west, north = tile_of(lon - dlon, lat + dlat, z)
        _, east, south = tile_of(lon + dlon, lat - dlat, z)
        tiles += [(kind, z, x, y) for x in range(west, east + 1) for y in range(north, south + 1)]
    return tiles


# The e2e archives' release (web/e2e/real-area-tiles.ts): the same tiles as static files read with Range requests.
E2E_RELEASE = "0e2e0e2e0e2e"


def export(url: str, directory: str) -> list[str]:
    """Writes the e2e tiles of the newest build as one archive per kind (area_pmtiles.py)."""
    import pathlib

    import psycopg

    out = pathlib.Path(directory)
    out.mkdir(parents=True, exist_ok=True)
    written = []
    archives: dict[str, dict] = {}
    with psycopg.connect(url) as connection:
        release = connection.execute("SELECT release FROM area_tile_build ORDER BY built_at DESC LIMIT 1").fetchone()[0]
        for kind, z, x, y in e2e_tiles():
            row = connection.execute("SELECT tile FROM area_tile WHERE release = %s AND kind = %s AND z = %s AND x = %s "
                                     "AND y = %s", (release, kind, z, x, y)).fetchone()
            if row:
                archives.setdefault(kind, {})[(z, x, y)] = bytes(row[0])
    lon, lat = E2E_CENTRE
    for kind, tiles in sorted(archives.items()):
        path = out / area_pmtiles.file_name(E2E_RELEASE, kind)
        path.write_bytes(area_pmtiles.write(tiles, kind, (lon - 0.1, lat - 0.05, lon + 0.1, lat + 0.05)))
        written.append(path.name)
    return written


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("url")
    parser.add_argument("--tiles", default="stored", help="stored, live, or a directory of archives (area_pmtiles.py)")
    parser.add_argument("--release")
    parser.add_argument("--quick", action="store_true", help="tiles only (the shape checks need migration 119)")
    parser.add_argument("--export", metavar="DIR", help="write the e2e test's tiles there instead of checking")
    parser.add_argument("--verbose", action="store_true", help="how long each step took, on stderr")
    args = parser.parse_args(argv)
    if args.export:
        print("\n".join(export(args.url, args.export)))
        return 0
    results = check(args.url, args.tiles, args.release, args.quick,
                    log=(lambda message: print(message, file=sys.stderr)) if args.verbose else (lambda message: None))
    for name, what, bad in results:
        print(f"{'ok  ' if not bad else 'FAIL'} {name:12} {what}: {bad}")
    totals = {}
    for name, _, bad in results:
        totals[name] = totals.get(name, 0) + bad
    print("totals: " + ", ".join(f"{name} {round(value, 1)}" for name, value in totals.items()))
    return 1 if any(bad for _, _, bad in results) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
