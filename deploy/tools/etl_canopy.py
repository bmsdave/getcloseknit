"""Canopy on the map (migration 066): the Sentinel-2 summer NDVI mosaic of etl_nature.py as map tiles.

Each 10 m cell whose highest clear summer NDVI is 0.4 or more is green (trees, gardens, grass, parks;
private gardens included), in four shades by how green: 0.4, 0.5, 0.6 and 0.7+. Cells below 0.4 or
without a clear view are left clear. Web Mercator PNG tiles, 256 px, zoom 11 to 14; the map stretches
zoom 14 further in.

Zoomed out (zoom 8 to 10, v4 Task 6) a pixel covers 100 m to 400 m: there each pixel shows the share of
its 10 m cells that are green, in the same four shades (SHARE_LIMITS), so the green belt, big parks and
leafy suburbs read from far. Zoom 10 averages each 2 x 2 block of zoom 11's shares (themselves the mean of
4 x 4 samples per pixel), zoom 9 averages zoom 10, zoom 8 zoom 9: shares are averaged, never colours.

Source: Sentinel-2 L2A, 19 June and 11 July 2025 (Copernicus, free and open), as mosaicked by etl_nature.py
(its ndvi.npy: British National Grid, 10 m cells, row 0 at the northern edge).

Stages:
  tiles <out-dir>                    PNG tiles as <out-dir>/<z>/<x>/<y>.png, to look at
  pyramid <out.sql.gz> [source-id]  only zoom 8-10 (v4 Task 6), as one SQL file that replaces those zooms and
                                     leaves zoom 11-14 as loaded
  bundle <out.sql.gz> [source-id]   every zoom, 8-14, as one SQL file for production (after migration 066):
                                     gunzip -c out.sql.gz | psql <database-url>. The tiles cite the Sentinel-2
                                     release etl_nature.py registered (default src-sentinel2-ndvi-2025); the
                                     file stops before writing anything if the database lacks it

  AE_WORK=~/data/aework/nature python3 etl_canopy.py bundle canopy.sql.gz
  AE_WORK=~/data/aework/nature python3 etl_canopy.py pyramid canopy-pyramid.sql.gz   (zoom 8-10 only)

Needs numpy only. The British National Grid is computed here (the OSGB36 Helmert and the National Grid's
transverse Mercator, as PostGIS does without the OSTN15 grid; the NDVI mosaic was made the same way).
"""
from __future__ import annotations

import gzip
import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import etl_nature  # noqa: E402  (where the NDVI mosaic lives)

DETAIL_ZOOMS = (11, 12, 13, 14)
# Built from zoom 11's shares, each from the one below (v4 Task 6).
PYRAMID_ZOOMS = (10, 9, 8)
ZOOMS = (8, 9, 10, *DETAIL_ZOOMS)
TILE = 256
# Samples per pixel side for zoom 11's share of green (a pixel there is ~47 m, about 5 cells).
SAMPLES = 4
# Share of green 10 m cells for the four shades zoomed out; under a fifth is left clear. Most of London is
# green at 10 m (gardens, verges): these limits keep the city centre, the suburbs and the green belt apart.
SHARE_LIMITS = (0.2, 0.4, 0.6, 0.8)
# NDVI class limits: 0.4 is green (etl_nature.GREEN_NDVI), then 0.5, 0.6 and 0.7+.
LIMITS = (0.4, 0.5, 0.6, 0.7)
# Leaf green (DESIGN.md --yarn-leaf) at four strengths; index 0 is clear.
LEAF = (0x2F, 0x8F, 0x73)
ALPHAS = (0, 70, 120, 170, 215)


# --- British National Grid ---------------------------------------------------------------------

def to_bng(lon, lat):
    """WGS84 longitude and latitude (degrees, numpy arrays) to British National Grid easting and northing.
    Helmert to OSGB36 then the National Grid's transverse Mercator (OS 'A guide to coordinate systems')."""
    import numpy as np

    phi, lam = np.radians(lat), np.radians(lon)
    # WGS84 (GRS80) geodetic to cartesian.
    a, b = 6378137.0, 6356752.3141
    e2 = 1 - (b * b) / (a * a)
    nu = a / np.sqrt(1 - e2 * np.sin(phi) ** 2)
    x = nu * np.cos(phi) * np.cos(lam)
    y = nu * np.cos(phi) * np.sin(lam)
    z = (1 - e2) * nu * np.sin(phi)
    # Helmert WGS84 -> OSGB36.
    tx, ty, tz, s = -446.448, 125.157, -542.060, 20.4894e-6
    rx, ry, rz = (np.radians(value / 3600) for value in (-0.1502, -0.2470, -0.8421))
    x2 = tx + (1 + s) * x - rz * y + ry * z
    y2 = ty + rz * x + (1 + s) * y - rx * z
    z2 = tz - ry * x + rx * y + (1 + s) * z
    # Cartesian to geodetic on Airy 1830.
    a, b = 6377563.396, 6356256.909
    e2 = 1 - (b * b) / (a * a)
    p = np.sqrt(x2 * x2 + y2 * y2)
    phi = np.arctan2(z2, p * (1 - e2))
    for _ in range(4):
        nu = a / np.sqrt(1 - e2 * np.sin(phi) ** 2)
        phi = np.arctan2(z2 + e2 * nu * np.sin(phi), p)
    lam = np.arctan2(y2, x2)
    # National Grid transverse Mercator.
    f0, phi0, lam0, n0, e0 = 0.9996012717, np.radians(49), np.radians(-2), -100000.0, 400000.0
    n = (a - b) / (a + b)
    sin, cos = np.sin(phi), np.cos(phi)
    nu = a * f0 / np.sqrt(1 - e2 * sin ** 2)
    rho = a * f0 * (1 - e2) / (1 - e2 * sin ** 2) ** 1.5
    eta2 = nu / rho - 1
    dp, sp = phi - phi0, phi + phi0
    m = b * f0 * ((1 + n + 1.25 * n ** 2 + 1.25 * n ** 3) * dp
                  - (3 * n + 3 * n ** 2 + 21 / 8 * n ** 3) * np.sin(dp) * np.cos(sp)
                  + (15 / 8 * n ** 2 + 15 / 8 * n ** 3) * np.sin(2 * dp) * np.cos(2 * sp)
                  - 35 / 24 * n ** 3 * np.sin(3 * dp) * np.cos(3 * sp))
    tan2 = np.tan(phi) ** 2
    i = m + n0
    ii = nu / 2 * sin * cos
    iii = nu / 24 * sin * cos ** 3 * (5 - tan2 + 9 * eta2)
    iiia = nu / 720 * sin * cos ** 5 * (61 - 58 * tan2 + tan2 ** 2)
    iv = nu * cos
    v = nu / 6 * cos ** 3 * (nu / rho - tan2)
    vi = nu / 120 * cos ** 5 * (5 - 18 * tan2 + tan2 ** 2 + 14 * eta2 - 58 * tan2 * eta2)
    dl = lam - lam0
    north = i + ii * dl ** 2 + iii * dl ** 4 + iiia * dl ** 6
    east = e0 + iv * dl + v * dl ** 3 + vi * dl ** 5
    return east, north


# --- tiles ------------------------------------------------------------------------------------

def tile_range(zoom: int) -> tuple[range, range]:
    """Tile columns and rows covering the mosaic (etl_nature.EXTENT is in BNG; LONDON_BBOX holds it)."""
    west, south, east, north = etl_nature.LONDON_BBOX
    n = 2 ** zoom
    column = lambda lon: int((lon + 180) / 360 * n)
    row = lambda lat: int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return range(column(west), column(east) + 1), range(row(north), row(south) + 1)


def pixel_lonlat(z: int, x: int, y: int):
    """Longitude and latitude of each pixel's middle in tile z/x/y (TILE x TILE arrays)."""
    import numpy as np

    n = 2 ** z
    offsets = (np.arange(TILE) + 0.5) / TILE
    lon = (x + offsets) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + offsets) / n))))
    return np.meshgrid(lon, lat)


def classes(ndvi):
    """0 clear (below 0.4 or no clear view), then 1-4 by LIMITS."""
    import numpy as np

    value = np.nan_to_num(ndvi, nan=-1.0)
    return np.digitize(value, LIMITS).astype(np.uint8)


def tile_classes(grid, z: int, x: int, y: int):
    """Each pixel's class from the 10 m cell under it (nearest), 0 outside the mosaic."""
    import numpy as np

    lon, lat = pixel_lonlat(z, x, y)
    east, north = to_bng(lon, lat)
    rows, cols = etl_nature.cell_of(east, north)
    inside = (rows >= 0) & (cols >= 0) & (rows < grid.shape[0]) & (cols < grid.shape[1])
    out = np.zeros((TILE, TILE), dtype=np.uint8)
    out[inside] = grid[rows[inside], cols[inside]]
    return out


def tile_share(green, z: int, x: int, y: int, samples: int = SAMPLES):
    """Each pixel's share of green 10 m cells (0-1): the mean of samples x samples points spread over the
    pixel, each the cell under it (nearest); 0 outside the mosaic. `green` is a boolean cell grid."""
    import numpy as np

    size = TILE * samples
    n = 2 ** z
    offsets = (np.arange(size) + 0.5) / size
    lon = (x + offsets) / n * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + offsets) / n))))
    east, north = to_bng(*np.meshgrid(lon, lat))
    rows, cols = etl_nature.cell_of(east, north)
    inside = (rows >= 0) & (cols >= 0) & (rows < green.shape[0]) & (cols < green.shape[1])
    hits = np.zeros((size, size), dtype=np.float32)
    hits[inside] = green[rows[inside], cols[inside]]
    return hits.reshape(TILE, samples, TILE, samples).mean(axis=(1, 3))


def parent_share(children):
    """A tile's shares from its four children's ({(dx, dy): array}, dx and dy 0 or 1; a missing child has no
    green): each pixel is the mean of a 2 x 2 block of the children's pixels."""
    import numpy as np

    whole = np.zeros((TILE * 2, TILE * 2), dtype=np.float32)
    for (dx, dy), share in children.items():
        whole[dy * TILE:(dy + 1) * TILE, dx * TILE:(dx + 1) * TILE] = share
    return whole.reshape(TILE, 2, TILE, 2).mean(axis=(1, 3))


def share_classes(share):
    """0 clear (under SHARE_LIMITS[0]), then 1-4: the same four shades as the 10 m tiles."""
    import numpy as np

    return np.digitize(share, SHARE_LIMITS).astype(np.uint8)


def pyramid_shares(green):
    """{z: {(x, y): shares}} for zoom 10, 9 and 8: zoom 11's shares over the mosaic, then 2 x 2 averages."""
    columns, rows = tile_range(DETAIL_ZOOMS[0])
    level = {(x, y): tile_share(green, DETAIL_ZOOMS[0], x, y) for x in columns for y in rows}
    out = {}
    for z in PYRAMID_ZOOMS:
        parents = {(x // 2, y // 2) for x, y in level}
        level = {(px, py): parent_share({(dx, dy): level[(px * 2 + dx, py * 2 + dy)]
                                         for dx in (0, 1) for dy in (0, 1) if (px * 2 + dx, py * 2 + dy) in level})
                 for px, py in parents}
        out[z] = level
    return out


def png(pixels) -> bytes:
    """A palette PNG of class indexes 0-4: leaf green at ALPHAS, index 0 clear."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    height, width = pixels.shape
    raw = b"".join(b"\x00" + pixels[row].tobytes() for row in range(height))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 3, 0, 0, 0))
            + chunk(b"PLTE", bytes(LEAF) * len(ALPHAS))
            + chunk(b"tRNS", bytes(ALPHAS))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def tiles(zooms=ZOOMS):
    """(z, x, y, png bytes) for every tile with some green in it, zoomed out first."""
    import numpy as np

    ndvi = etl_nature.mosaic()
    if any(z in PYRAMID_ZOOMS for z in zooms):
        shares = pyramid_shares(np.nan_to_num(ndvi, nan=-1.0) >= LIMITS[0])
        for z in sorted(z for z in zooms if z in PYRAMID_ZOOMS):
            made = 0
            for (x, y), share in sorted(shares[z].items()):
                pixels = share_classes(share)
                if np.any(pixels):
                    made += 1
                    yield z, x, y, png(pixels)
            print(f"canopy: zoom {z}, {made} tiles (share of green)", flush=True)
    grid = classes(ndvi)
    for z in (z for z in zooms if z in DETAIL_ZOOMS):
        columns, rows = tile_range(z)
        made = 0
        for x in columns:
            for y in rows:
                pixels = tile_classes(grid, z, x, y)
                if np.any(pixels):
                    made += 1
                    yield z, x, y, png(pixels)
        print(f"canopy: zoom {z}, {made} tiles", flush=True)


def write_tiles(out: str, zooms=ZOOMS) -> None:
    for z, x, y, body in tiles(zooms):
        os.makedirs(os.path.join(out, str(z), str(x)), exist_ok=True)
        with open(os.path.join(out, str(z), str(x), f"{y}.png"), "wb") as handle:
            handle.write(body)


BUNDLE_HEAD = """-- Close Knit: Canopy map tiles (migration 066), built by deploy/tools/etl_canopy.py bundle from the
-- Sentinel-2 NDVI mosaic of etl_nature.py. Apply deploy/migrations/066-street-trees.sql first, then
--   gunzip -c canopy.sql.gz | psql -v ON_ERROR_STOP=1 <database-url>
\\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
    IF to_regclass('public.canopy_tile') IS NULL THEN
        RAISE EXCEPTION 'apply deploy/migrations/066-street-trees.sql first';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM source_release WHERE id = '{source}') THEN
        RAISE EXCEPTION 'source release {source} (Sentinel-2 NDVI, etl_nature.py) is missing';
    END IF;
END $$;
{delete};
COPY canopy_tile (z, x, y, png, source_release_id) FROM STDIN WITH (FORMAT text);
"""

BUNDLE_TAIL = """\\.
COMMIT;
ANALYZE canopy_tile;
"""


SOURCE = "src-sentinel2-ndvi-2025"


def bundle_head(source: str, zooms=ZOOMS) -> str:
    """The bundle's guard and the rows it replaces: every tile, or only the zooms it carries."""
    delete = "DELETE FROM canopy_tile" if set(zooms) == set(ZOOMS) else \
        f"DELETE FROM canopy_tile WHERE z IN ({', '.join(str(z) for z in sorted(zooms))})"
    return BUNDLE_HEAD.replace("{source}", source).replace("{delete}", delete)


def bundle(path: str, source: str = SOURCE, zooms=ZOOMS) -> None:
    count = size = 0
    with gzip.open(path + ".tmp", "wb", compresslevel=9) as out:
        out.write(bundle_head(source, zooms).encode())
        for z, x, y, body in tiles(zooms):
            out.write(f"{z}\t{x}\t{y}\t\\\\x{body.hex()}\t{source}\n".encode())
            count += 1
            size += len(body)
        out.write(BUNDLE_TAIL.encode())
    os.replace(path + ".tmp", path)
    print(f"bundle: {path} {os.path.getsize(path) // 1024} KiB, {count} tiles, {size // 1024} KiB of PNG, source {source}")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "tiles" and len(sys.argv) == 3:
        write_tiles(sys.argv[2])
    elif stage == "bundle" and len(sys.argv) in (3, 4):
        bundle(*sys.argv[2:])
    elif stage == "pyramid" and len(sys.argv) in (3, 4):
        bundle(sys.argv[2], *(sys.argv[3:] or [SOURCE]), zooms=PYRAMID_ZOOMS)
    else:
        sys.exit(__doc__)
