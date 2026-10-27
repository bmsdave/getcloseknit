"""England home points for area-level environment metrics (local ETL input, never loaded to production).

London reads its homes from `property` (dwellings with an EPC-derived UPRN at their OS Open UPRN
point). England has no `property` rows (per-home data stays London-only), so the environment ETLs
read the same kind of points from a local file built here:

  every UPRN that appears in the domestic EPC register (~/Downloads/domestic-csv.zip, England and
  Wales, all years), placed at its OS Open UPRN point and given the English LSOA that contains it
  (area_geography in the ETL database). Points outside England's LSOAs are dropped.

  python3 england_homes.py build <database-url> [<epc.zip or folder>] [<osopenuprn.zip>]

writes $AE_ENGLAND/environment/homes-england.npz with arrays uprn (int64), east/north (int32,
decimetres, British National Grid), lsoa (int32 index into `codes`) and codes (LSOA21 codes). The
file is about 300 MB; only area aggregates computed from it go anywhere else.

Needs numpy and shapely.
"""
from __future__ import annotations

import csv
import io
import os
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor

import numpy as np

import epc_bulk

ENGLAND = os.environ.get("AE_ENGLAND", os.path.expanduser("~/data/england-2026-10"))
WORK = os.path.join(ENGLAND, "environment")
EPC_ZIP = epc_bulk.source()  # the zip or its unzipped folder
UPRN_ZIP = os.path.join(WORK, "uprn", "osopenuprn_202609_csv.zip")
UPRN_RELEASE = "OS Open UPRN 2026-09"
HOMES = os.path.join(WORK, "homes-england.npz")
EPC_UPRNS = os.path.join(WORK, "epc-uprns.npy")


def _member_uprns(args: tuple[str, str]) -> np.ndarray:
    archive, member = args
    found: set[int] = set()
    with epc_bulk.open_text(archive, member) as handle:
        reader = csv.reader(handle)
        header = [name.strip().lower() for name in next(reader)]
        column = header.index("uprn")
        for row in reader:
            if len(row) > column:
                text = row[column].strip()
                if text.isdigit():
                    found.add(int(text))
    print(f"epc: {member} {len(found)} UPRNs", flush=True)
    return np.fromiter(found, dtype=np.int64, count=len(found))


def epc_uprns(archive: str = EPC_ZIP) -> np.ndarray:
    """Sorted unique UPRNs of every domestic EPC certificate (cached next to the homes file)."""
    if os.path.exists(EPC_UPRNS):
        return np.load(EPC_UPRNS)
    members = epc_bulk.members(archive)
    with ProcessPoolExecutor(max_workers=8) as pool:
        parts = list(pool.map(_member_uprns, [(archive, m) for m in members]))
    uprns = np.unique(np.concatenate(parts))
    os.makedirs(WORK, exist_ok=True)
    np.save(EPC_UPRNS, uprns)
    print(f"epc: {len(uprns)} distinct UPRNs", flush=True)
    return uprns


def uprn_points(archive: str, keep: np.ndarray, chunk: int = 2_000_000):
    """Yield (uprn, east, north) float arrays for OS Open UPRN rows whose UPRN is in `keep` (sorted)."""
    with zipfile.ZipFile(archive) as zf:
        member = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        with zf.open(member) as raw:
            lines = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            next(lines)
            ids, xs, ys = [], [], []
            for line in lines:
                parts = line.split(",", 3)
                ids.append(int(parts[0]))
                xs.append(float(parts[1]))
                ys.append(float(parts[2]))
                if len(ids) >= chunk:
                    yield _keep(ids, xs, ys, keep)
                    ids, xs, ys = [], [], []
            if ids:
                yield _keep(ids, xs, ys, keep)


def _keep(ids, xs, ys, keep):
    uprn = np.asarray(ids, dtype=np.int64)
    pos = np.searchsorted(keep, uprn).clip(0, len(keep) - 1)
    mask = keep[pos] == uprn
    return uprn[mask], np.asarray(xs)[mask], np.asarray(ys)[mask]


def lsoa_polygons(url: str):
    """(codes, shapely geometries in British National Grid) of every English LSOA."""
    import psycopg
    import shapely

    with psycopg.connect(url) as conn:
        rows = conn.execute(
            "SELECT official_code, ST_AsBinary(ST_Transform(geometry, 27700)) FROM area_geography "
            "WHERE kind = 'lsoa' ORDER BY official_code").fetchall()
    codes = [r[0] for r in rows]
    geoms = shapely.from_wkb([bytes(r[1]) for r in rows])
    return codes, geoms


def build(url: str, epc: str = EPC_ZIP, uprn_zip: str = UPRN_ZIP) -> None:
    import shapely

    keep = epc_uprns(epc)
    codes, geoms = lsoa_polygons(url)
    tree = shapely.STRtree(geoms)
    out_uprn, out_e, out_n, out_l = [], [], [], []
    seen = 0
    for uprn, xs, ys in uprn_points(uprn_zip, keep):
        seen += len(uprn)
        points = shapely.points(xs, ys)
        point_idx, poly_idx = tree.query(points, predicate="intersects")
        # A point on a shared edge may hit two LSOAs: keep the first.
        point_idx, first = np.unique(point_idx, return_index=True)
        out_uprn.append(uprn[point_idx])
        out_e.append(np.round(xs[point_idx] * 10).astype(np.int32))
        out_n.append(np.round(ys[point_idx] * 10).astype(np.int32))
        out_l.append(poly_idx[first].astype(np.int32))
        print(f"homes: {seen} EPC UPRN points read, {sum(map(len, out_uprn))} in England", flush=True)
    np.savez(HOMES, uprn=np.concatenate(out_uprn), east=np.concatenate(out_e), north=np.concatenate(out_n),
             lsoa=np.concatenate(out_l), codes=np.asarray(codes), release=np.asarray(UPRN_RELEASE))
    print(f"homes: wrote {HOMES}", flush=True)


def load(path: str = HOMES) -> dict:
    """The homes file as a dict of arrays; east/north back in metres (float64)."""
    data = np.load(path)
    return {"uprn": data["uprn"], "east": data["east"] / 10.0, "north": data["north"] / 10.0,
            "lsoa": data["lsoa"], "codes": data["codes"]}


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "build":
        build(*sys.argv[2:])
    else:
        sys.exit(__doc__)
