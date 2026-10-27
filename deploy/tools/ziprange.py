"""Range-fetch per-force street CSVs from police.uk monthly archive zips.

Full month zips are ~1.6GB; we fetch only the street-crime members we need via
HTTP Range requests: tail -> EOCD -> central directory -> member ranges -> raw
deflate. Coverage follows CLOSE_KNIT_ETL_COVERAGE (area_coverage.from_env):
england (default) takes every force's street file except British Transport
Police (excluded by policy; LSOAs outside the coverage are dropped later by
etl_crime_release.py), london takes the Metropolitan and City of London files.
Each archive holds the previous 36 months, so one archive serves a whole
rolling window. Per LSOA it records `n` (offences excluding anti-social
behaviour), `asb` (anti-social behaviour), `cats` (offences by category) and
`f` (the same three per force: etl_crime_release.py keeps the forces of the
area's region and checks missing force-months); `force_rows` holds
each force's row count for the month. Stdlib plus area_coverage (stdlib only). Usage:
  python3 ziprange.py 2026-07 [archive]         one month
  python3 ziprange.py WINDOW 2026-08 [months]   the months a rolling window
                                                ending 2026-08 needs (default 23),
                                                all from the 2026-08 archive
Output directory: $AE_WORK (default /tmp/aedata).
"""
import csv
import io
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib
from functools import lru_cache

import area_coverage as coverage

BASE = "https://policeuk-data.s3.amazonaws.com/archive/{m}.zip"
OUT = os.environ.get("AE_WORK", "/tmp/aedata")
LONDON_FORCES = ("metropolitan", "city-of-london")
EXCLUDED_FORCES = ("british-transport-police", "btp")  # police.uk used both names
MONTHS = [f"2025-{m:02d}" for m in range(8, 13)] + [f"2026-{m:02d}" for m in range(1, 8)]


def months_ending(end, count):
    """The `count` calendar months ending with `end` (YYYY-MM), oldest first."""
    year, month = (int(part) for part in end.split("-"))
    out = []
    for _ in range(count):
        out.append(f"{year:04d}-{month:02d}")
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return out[::-1]


def fetch(url, a, b, attempts=4):
    """Bytes a..b of url; a timed-out or dropped read is retried (England reads ~900 ranges)."""
    for attempt in range(attempts):
        req = urllib.request.Request(url, headers={"Range": f"bytes={a}-{b}"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                if r.status != 206:
                    raise RuntimeError(f"range failed: {r.status}")
                return r.read()
        except (TimeoutError, ConnectionError, urllib.error.URLError) as error:
            if attempt == attempts - 1:
                raise
            print(f"retry {a}-{b} after {error!r}", flush=True)
            time.sleep(5 * (attempt + 1))


def file_size(url):
    data = fetch(url, 0, 0)
    req = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        cr = r.headers.get("Content-Range", "")
    # Content-Range: bytes 0-0/1699999999
    return int(cr.rsplit("/", 1)[1])


@lru_cache(maxsize=2)
def central_dir(url):
    size = file_size(url)
    tail = fetch(url, max(0, size - 131072), size - 1)
    eocd = tail.rfind(b"PK\x05\x06")
    if eocd < 0:
        raise RuntimeError("EOCD not found")
    # EOCD: sig(4) disk(2) cd_disk(2) disk_entries(2) total(2) size(4) off(4) comment_len(2)
    _, _, _, total, cd_size, cd_off, _ = struct.unpack("<HHHHIIH", tail[eocd + 4 : eocd + 22])
    cd = fetch(url, cd_off, cd_off + cd_size - 1)
    members = {}
    pos = 0
    for _ in range(total):
        assert cd[pos : pos + 4] == b"PK\x01\x02", (pos, total)
        method = struct.unpack("<H", cd[pos + 10 : pos + 12])[0]
        comp_size = struct.unpack("<I", cd[pos + 20 : pos + 24])[0]
        uncomp_size = struct.unpack("<I", cd[pos + 24 : pos + 28])[0]
        fn_len, extra_len, com_len = struct.unpack("<HHH", cd[pos + 28 : pos + 34])
        local_off = struct.unpack("<I", cd[pos + 42 : pos + 46])[0]
        name = cd[pos + 46 : pos + 46 + fn_len].decode("utf-8")
        members[name] = (method, comp_size, uncomp_size, local_off)
        pos += 46 + fn_len + extra_len + com_len
    return members


def member_bytes(url, method, comp_size, local_off):
    lhdr = fetch(url, local_off, local_off + 45)
    assert lhdr[:4] == b"PK\x03\x04"
    fn_len, extra_len = struct.unpack("<HH", lhdr[26:30])
    start = local_off + 30 + fn_len + extra_len
    raw = fetch(url, start, start + comp_size - 1)
    if method == 8:
        return zlib.decompressobj(-15).decompress(raw)
    if method == 0:
        return raw
    raise RuntimeError(f"unsupported method {method}")


def street_forces(members, month):
    """Forces with a street-crime file for `month` in an archive's member names, sorted."""
    suffix, prefix = "-street.csv", f"{month}-"
    return sorted({name.rsplit("/", 1)[-1][len(prefix):-len(suffix)] for name in members
                   if name.rsplit("/", 1)[-1].startswith(prefix) and name.endswith(suffix)})


def wanted_forces(members, month, cov=None):
    """The forces to fetch: London's two in a London run, else every force but the excluded ones.
    A London force missing from the archive is still listed, so the run logs it as MISSING."""
    cov = cov or coverage.from_env()
    if cov.name == "london":
        return list(LONDON_FORCES)
    return [force for force in street_forces(members, month) if force not in EXCLUDED_FORCES]


def process_month(month, archive=None):
    url = BASE.format(m=archive or month)
    out_path = os.path.join(OUT, f"crime-{month}.json")
    if os.path.exists(out_path):
        print(f"{month}: cached", flush=True)
        return out_path
    members = central_dir(url)
    agg = {}
    forces_found = []
    force_rows = {}
    cols = None
    for force in wanted_forces(members, month):
        matches = [n for n in members if f"{month}-{force}-street.csv" in n]
        if not matches:
            print(f"{month}: MISSING {force}", flush=True)
            continue
        forces_found.append(force)
        name = matches[0]
        method, comp_size, _, local_off = members[name]
        print(f"{month}: {name} ({comp_size/1e6:.1f}MB)", flush=True)
        data = member_bytes(url, method, comp_size, local_off)
        reader = csv.DictReader(io.StringIO(data.decode("utf-8", "replace")))
        if cols is None:
            cols = reader.fieldnames
        n = 0
        for row in reader:
            n += 1
            code = (row.get("LSOA code") or "").strip()
            cat = (row.get("Crime type") or "").strip()
            if not code or not cat:
                continue
            cell = agg.setdefault(code, {"n": 0, "asb": 0, "cats": {}, "f": {}})
            own = cell["f"].setdefault(force, {"n": 0, "asb": 0, "cats": {}})
            # Anti-social behaviour is an incident log, not a recorded crime;
            # it never enters the headline count `n`.
            if cat == "Anti-social behaviour":
                cell["asb"] += 1
                own["asb"] += 1
            else:
                cell["n"] += 1
                cell["cats"][cat] = cell["cats"].get(cat, 0) + 1
                own["n"] += 1
                own["cats"][cat] = own["cats"].get(cat, 0) + 1
        force_rows[force] = n
        print(f"{month}: {force} rows={n}", flush=True)
    with open(out_path, "w") as f:
        json.dump({"month": month, "forces": forces_found, "force_rows": force_rows, "columns": cols,
                   "areas": agg}, f)
    print(f"{month}: areas={len(agg)} written", flush=True)
    return out_path


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "ALL"
    if arg == "WINDOW":
        end = sys.argv[2]
        count = int(sys.argv[3]) if len(sys.argv) > 3 else 23
        os.makedirs(OUT, exist_ok=True)
        for m in months_ending(end, count):
            process_month(m, end)
        sys.exit(0)
    archive = sys.argv[2] if len(sys.argv) > 2 else None
    months = MONTHS if arg == "ALL" else [arg]
    for m in months:
        process_month(m, archive)
