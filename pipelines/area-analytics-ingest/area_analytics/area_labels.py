"""Friendly area names and map label points (migration 023).

Sources (licences recorded in each source_release row and DATA-LICENCES.md):
  HoC Library  MSOA Names 2.3 (Open Parliament Licence v3): a neighbourhood
               name for every 2021 MSOA, e.g. E02000107 "Alperton East".
  ONSPD        ONS Postcode Directory, August 2026 (OGL v3), read from the zip
               (~/data/civic/ONSPD_AUG_2026.zip, AE_ONSPD_ZIP), the coverage's postcodes
               only (England by default, CLOSE_KNIT_ETL_COVERAGE=london; area_analytics.coverage).
  Boundaries   ONS borough (LAD) boundaries (OGL v3): London's 2021 file in ~/data/boundaries
               first (London's label points stay as they were), then the England LAD file
               (AE_LAD_BOUNDARIES, boundaries.py's geom-lad.json) for the other districts.

What it makes:
  area_label   every LSOA and MSOA with the HoC name of its MSOA and the postcode
               district (outward code) holding most of its live postcodes; every
               borough with its own name. The panel shows "Alperton East · NW10".
  map_label    one point per borough (pole of inaccessibility: the interior point
               farthest from the edge) and one per postcode district (the live
               postcode nearest the mean of its live postcodes, so the point sits
               inside the district), labelled "NW10 · Harlesden" with the short
               HoC name of the MSOA holding most of the district's postcodes.

  python3 -m area_analytics.area_labels download
  python3 -m area_analytics.area_labels build
  uv run --with 'psycopg[binary]' python -m area_analytics.area_labels load postgresql://...

Everything except download and load is pure and dependency-free.
"""
from __future__ import annotations

import csv
import hashlib
import heapq
import io
import json
import math
import os
import re
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from typing import Iterable, Iterator, Mapping, Sequence

from . import coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "labels"))
ONSPD_ZIP = os.environ.get("AE_ONSPD_ZIP", os.path.join(DATA, "civic", "ONSPD_AUG_2026.zip"))
BOROUGHS = os.path.join(DATA, "boundaries", "borough-2021-london.geojson")
LAD_BOUNDARIES = os.environ.get("AE_LAD_BOUNDARIES", os.path.join(DATA, "boundaries", "geom-lad.json"))
ONSPD_FIELDS = ("pcds", "doterm", "usrtypind", "lat", "long", "lsoa21cd", "msoa21cd")
MSOA_NAMES_FILE = "MSOA-Names-2.3.csv"
MSOA_NAMES_URL = "https://houseofcommonslibrary.github.io/msoanames/MSOA-Names-2.3.csv"
ETL_VERSION = "close-knit-labels-1"

NAMES_SOURCE = "src-hocl-msoa-names-2-3"
ONSPD_SOURCE = "src-onspd-2026-08"              # loaded by civic.py
BOUNDARY_SOURCE = "src-ons-boundaries-2021-bgc"  # loaded with the area geography
NAMES_ATTRIBUTION = ("Contains Parliamentary information licensed under the Open Parliament Licence v3.0. "
                     "MSOA names: House of Commons Library.")

# A district needs this many live postcodes in the coverage for a map label: a sliver
# of an outside district (one or two postcodes over the boundary) would put its
# label on the edge of the coverage.
MIN_DISTRICT_POSTCODES = 25
# Longest neighbourhood name a district label keeps; longer ones show the code alone.
MAX_LABEL_NAME = 16
_DIRECTIONS = re.compile(r"(\s+(North|South|East|West|Central|Upper|Lower))+$")


# --- Pure rules ----------------------------------------------------------------

def outward(postcode: str) -> str:
    """"BR6 7AB" -> "BR6"; ONSPD pcds always has one space."""
    return postcode.strip().split(" ", 1)[0].upper()


def majority(counts: Mapping[str, int]) -> str | None:
    """The key with the most items; ties go to the alphabetically first key."""
    if not counts:
        return None
    return min(counts, key=lambda key: (-counts[key], key))


def live_postcodes(rows: Iterable[Mapping[str, str]]) -> Iterator[dict]:
    """Live small-user ONSPD rows with a usable location, as {postcode, district,
    lsoa, msoa, lon, lat}. Large-user postcodes (PO boxes, firms with their own
    postcode) sit at sorting offices and make up the non-geographic districts
    (EC1P, E98, ...), so they would pull centres and majorities off the homes."""
    for row in rows:
        if (row.get("doterm") or "").strip() or (row.get("usrtypind") or "0").strip() != "0":
            continue
        try:
            lat, lon = float(row["lat"]), float(row["long"])
        except (TypeError, ValueError):
            continue
        if not -90 <= lat <= 90:  # 99.999999 marks a postcode with no grid reference
            continue
        yield {"postcode": row["pcds"], "district": outward(row["pcds"]),
               "lsoa": row.get("lsoa21cd") or None, "msoa": row.get("msoa21cd") or None,
               "lon": lon, "lat": lat}


def majority_district(postcodes: Iterable[Mapping], key: str) -> dict[str, str]:
    """Area code (``key`` = "lsoa" or "msoa") -> the district holding most of its postcodes."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for row in postcodes:
        if row[key]:
            counts[row[key]][row["district"]] += 1
    return {area: majority(counter) for area, counter in counts.items()}


def district_centres(postcodes: Iterable[Mapping]) -> dict[str, dict]:
    """District -> {lon, lat, postcodes, msoa}: the live postcode nearest the mean
    of the district's live postcodes (so the point is inside the district even
    when it is crescent-shaped) and the MSOA holding most of them."""
    groups: dict[str, list[Mapping]] = defaultdict(list)
    for row in postcodes:
        groups[row["district"]].append(row)
    centres = {}
    for district, rows in groups.items():
        mean_lon = sum(r["lon"] for r in rows) / len(rows)
        mean_lat = sum(r["lat"] for r in rows) / len(rows)
        scale = math.cos(math.radians(mean_lat))
        nearest = min(rows, key=lambda r: (((r["lon"] - mean_lon) * scale) ** 2 + (r["lat"] - mean_lat) ** 2,
                                           r["postcode"]))
        msoas = Counter(r["msoa"] for r in rows if r["msoa"])
        centres[district] = {"lon": nearest["lon"], "lat": nearest["lat"], "postcodes": len(rows),
                             "msoa": majority(msoas)}
    return centres


def short_name(name: str | None, limit: int = MAX_LABEL_NAME) -> str | None:
    """A map-label form of a HoC neighbourhood name, or None when it would clutter:
    the first of "A & B" or "A, B", without a trailing compass word ("Orpington Central" ->
    "Orpington"), dropped when still longer than ``limit``."""
    if not name:
        return None
    first = re.split(r" & |, ", name, maxsplit=1)[0].strip()
    trimmed = _DIRECTIONS.sub("", first).strip()
    if not trimmed or trimmed.split()[-1].lower() in {"the", "of", "in"}:
        trimmed = first  # "St George in the East" keeps its last word
    return trimmed if len(trimmed) <= limit else None


def district_label(district: str, name: str | None) -> str:
    short = short_name(name)
    return f"{district} · {short}" if short else district


def friendly_title(friendly_name: str | None, district: str | None) -> str | None:
    """The panel title: "Alperton East · NW10"."""
    if not friendly_name:
        return None
    return f"{friendly_name} · {district}" if district else friendly_name


# --- Interior point (polylabel) -------------------------------------------------

def _ring_area(ring: Sequence[Sequence[float]]) -> float:
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / 2


def _point_to_segment(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    if dx or dy:
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        ax, ay = ax + t * dx, ay + t * dy
    return math.hypot(px - ax, py - ay)


def _signed_distance(x: float, y: float, polygon: Sequence[Sequence[Sequence[float]]]) -> float:
    inside, best = False, math.inf
    for ring in polygon:
        for (ax, ay), (bx, by) in zip(ring, ring[1:]):
            if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
                inside = not inside
            best = min(best, _point_to_segment(x, y, ax, ay, bx, by))
    return best if inside else -best


def polylabel(polygon: Sequence[Sequence[Sequence[float]]], precision: float = 1e-4) -> tuple[float, float]:
    """Pole of inaccessibility of a polygon (outer ring first, then holes) in
    planar coordinates: the interior point farthest from any edge."""
    xs = [p[0] for p in polygon[0]]
    ys = [p[1] for p in polygon[0]]
    min_x, min_y, max_x, max_y = min(xs), min(ys), max(xs), max(ys)
    size = min(max_x - min_x, max_y - min_y)
    if size == 0:
        return min_x, min_y
    half = size / 2
    queue: list[tuple[float, float, float, float, float]] = []

    def push(x: float, y: float, h: float) -> None:
        d = _signed_distance(x, y, polygon)
        heapq.heappush(queue, (-(d + h * math.sqrt(2)), d, x, y, h))

    x = min_x
    while x < max_x:
        y = min_y
        while y < max_y:
            push(x + half, y + half, half)
            y += size
        x += size
    # Start from the area centroid of the outer ring, as polylabel does.
    ring = polygon[0]
    area = _ring_area(ring) or 1e-12
    cx = sum((x1 + x2) * (x1 * y2 - x2 * y1) for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / (6 * area)
    cy = sum((y1 + y2) * (x1 * y2 - x2 * y1) for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / (6 * area)
    best = (_signed_distance(cx, cy, polygon), cx, cy)
    while queue:
        bound, d, x, y, h = heapq.heappop(queue)
        if d > best[0]:
            best = (d, x, y)
        if -bound - best[0] <= precision:
            continue
        h /= 2
        for ox in (-h, h):
            for oy in (-h, h):
                push(x + ox, y + oy, h)
    return best[1], best[2]


def interior_point(geometry: Mapping) -> tuple[float, float]:
    """Label point (lon, lat) of a GeoJSON Polygon or MultiPolygon in degrees: the
    pole of inaccessibility of its largest part, measured with longitude scaled
    by cos(latitude) so distances are roughly true on the ground."""
    parts = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    part = max(parts, key=lambda polygon: abs(_ring_area(polygon[0])))
    lat0 = sum(p[1] for p in part[0]) / len(part[0])
    scale = math.cos(math.radians(lat0))
    planar = [[(lon * scale, lat) for lon, lat, *_ in ring] for ring in part]
    x, y = polylabel(planar, precision=1e-5)
    return round(x / scale, 6), round(y, 6)


# --- Assembly ----------------------------------------------------------------------

def onspd_rows(lines: Iterable[str], cov: coverage.Coverage) -> Iterator[dict]:
    """The coverage's ONSPD rows (by region, rgn26cd) with the fields the labels need."""
    for row in csv.DictReader(lines):
        if cov.contains_region(row["rgn26cd"]):
            yield {field: row[field] for field in ONSPD_FIELDS}


def read_onspd(path: str, cov: coverage.Coverage) -> list[dict]:
    with zipfile.ZipFile(path) as archive:
        name = next(n for n in archive.namelist() if re.fullmatch(r"Data/ONSPD_[A-Z]{3}_[0-9]{4}_UK\.csv", n))
        with archive.open(name) as raw:
            return list(onspd_rows(io.TextIOWrapper(raw, encoding="utf-8", newline=""), cov))


def borough_features(paths: Sequence[str], cov: coverage.Coverage) -> list[dict]:
    """One feature per covered LAD, the first file holding a code winning; properties become
    {"code", "name"} whatever the vintage's keys (LAD21CD/LAD21NM, LAD26CD/LAD26NM)."""
    found: dict[str, dict] = {}
    for path in paths:
        if not os.path.exists(path):
            continue
        with open(path) as handle:
            for feature in json.load(handle)["features"]:
                props = feature["properties"]
                code = next(v for k, v in props.items() if re.fullmatch(r"LAD[0-9]{2}CD", k))
                name = next(v for k, v in props.items() if re.fullmatch(r"LAD[0-9]{2}NM", k))
                if cov.contains_lad(code) and code not in found:
                    found[code] = {"type": "Feature", "geometry": feature["geometry"],
                                   "properties": {"code": code, "name": name}}
    return [found[code] for code in sorted(found)]


def read_msoa_names(lines: Iterable[str]) -> dict[str, str]:
    """msoa21cd -> HoC name (msoa21hclnm), from the MSOA-Names CSV."""
    return {row["msoa21cd"]: row["msoa21hclnm"].strip()
            for row in csv.DictReader(lines) if row.get("msoa21cd") and (row.get("msoa21hclnm") or "").strip()}


def area_labels(postcodes: list[Mapping], names: Mapping[str, str], lsoa_msoa: Mapping[str, str],
                boroughs: Mapping[str, str]) -> list[dict]:
    """area_label rows for every LSOA (via its MSOA), MSOA and borough."""
    lsoa_district = majority_district(postcodes, "lsoa")
    msoa_district = majority_district(postcodes, "msoa")
    rows = []
    for lsoa, msoa in sorted(lsoa_msoa.items()):
        rows.append({"geography_id": f"uk:lsoa:{lsoa}", "friendly_name": names.get(msoa),
                     "postcode_district": lsoa_district.get(lsoa)})
    for msoa in sorted(set(lsoa_msoa.values())):
        rows.append({"geography_id": f"uk:msoa:{msoa}", "friendly_name": names.get(msoa),
                     "postcode_district": msoa_district.get(msoa)})
    for code, name in sorted(boroughs.items()):
        rows.append({"geography_id": f"uk:lad:{code}", "friendly_name": name, "postcode_district": None})
    return rows


def map_labels(postcodes: list[Mapping], names: Mapping[str, str], borough_features: Iterable[Mapping]) -> list[dict]:
    """One map_label row per borough and per district with enough postcodes in the coverage."""
    rows = []
    for feature in borough_features:
        lon, lat = interior_point(feature["geometry"])
        props = feature["properties"]
        code = props.get("code") or props["LAD21CD"]
        name = props.get("name") or props["LAD21NM"]
        rows.append({"kind": "borough", "code": code, "label": name,
                     "name": name, "postcodes": None, "lon": lon, "lat": lat})
    for district, centre in sorted(district_centres(postcodes).items()):
        if centre["postcodes"] < MIN_DISTRICT_POSTCODES:
            continue
        name = names.get(centre["msoa"]) if centre["msoa"] else None
        rows.append({"kind": "district", "code": district, "label": district_label(district, name),
                     "name": short_name(name), "postcodes": centre["postcodes"],
                     "lon": round(centre["lon"], 6), "lat": round(centre["lat"], 6)})
    return rows


# --- Stages ---------------------------------------------------------------------------

AREA_COLUMNS = ("geography_id", "friendly_name", "postcode_district")
MAP_COLUMNS = ("kind", "code", "label", "name", "postcodes", "lon", "lat")


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    path = os.path.join(WORK, MSOA_NAMES_FILE)
    with urllib.request.urlopen(MSOA_NAMES_URL, timeout=120) as response, open(path + ".tmp", "wb") as out:
        out.write(response.read())
    os.replace(path + ".tmp", path)
    print(f"download: {path} sha256 {_sha256(path)}")


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _write_tsv(name: str, columns: Iterable[str], rows: Iterable[Mapping]) -> int:
    count = 0
    with open(os.path.join(WORK, name), "w", newline="") as handle:
        for row in rows:
            handle.write("\t".join("" if row[c] is None else str(row[c]) for c in columns) + "\n")
            count += 1
    return count


def build() -> None:
    with open(os.path.join(WORK, MSOA_NAMES_FILE), encoding="utf-8-sig") as handle:
        names = read_msoa_names(handle)
    cov = coverage.from_env()
    rows = read_onspd(ONSPD_ZIP, cov)
    postcodes = list(live_postcodes(rows))
    lsoa_msoa = {row["lsoa21cd"]: row["msoa21cd"] for row in rows if row.get("lsoa21cd") and row.get("msoa21cd")}
    del rows
    features = borough_features([BOROUGHS, LAD_BOUNDARIES], cov)
    boroughs = {f["properties"]["code"]: f["properties"]["name"] for f in features}
    if set(boroughs) != set(cov.lad_codes):
        raise SystemExit(f"build: boundaries for {len(set(cov.lad_codes) - set(boroughs))} LADs missing "
                         f"(AE_LAD_BOUNDARIES={LAD_BOUNDARIES})")
    areas = area_labels(postcodes, names, lsoa_msoa, boroughs)
    labels = map_labels(postcodes, names, features)
    counts = {"area_label": _write_tsv("area_label.tsv", AREA_COLUMNS, areas),
              "map_label": _write_tsv("map_label.tsv", MAP_COLUMNS, labels)}
    unnamed = sum(1 for row in areas if not row["friendly_name"])
    no_district = sum(1 for row in areas if row["geography_id"].startswith("uk:lsoa:") and not row["postcode_district"])
    with open(os.path.join(WORK, "sources.json"), "w") as handle:
        json.dump({"msoaNamesSha256": _sha256(os.path.join(WORK, MSOA_NAMES_FILE)), "counts": counts}, handle)
    print(f"build: {counts}; areas without a name {unnamed}, LSOAs without a district {no_district}")


def load(url: str) -> None:
    import psycopg

    with open(os.path.join(WORK, "sources.json")) as handle:
        sources = json.load(handle)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        # A new source row only; the ONSPD and boundary rows belong to their own loaders.
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), '2026-02-13', %s, 'OPL-3.0', %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (NAMES_SOURCE, MSOA_NAMES_URL, sources["msoaNamesSha256"], NAMES_ATTRIBUTION, ETL_VERSION,
             ["Names describe a neighbourhood (MSOA); every smaller area inside it shares the name.",
              "The postcode district is the one holding most of the area's live postcodes."]))
        cur.execute("DELETE FROM area_label")
        cur.execute("DELETE FROM map_label")
        _copy(cur, "area_label", AREA_COLUMNS, "name_source_release_id, district_source_release_id",
              (NAMES_SOURCE, ONSPD_SOURCE), "area_label.tsv")
        _copy(cur, "map_label", MAP_COLUMNS, "source_release_id", (None,), "map_label.tsv")
        cur.execute("UPDATE map_label SET source_release_id = CASE kind WHEN 'borough' THEN %s ELSE %s END",
                    (BOUNDARY_SOURCE, ONSPD_SOURCE))
        print("load:", {table: cur.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                        for table in ("area_label", "map_label")})


def _copy(cur, table: str, columns: tuple, extra: str, values: tuple, name: str) -> None:
    with open(os.path.join(WORK, name)) as handle:
        body = handle.read()
    # map_label rows get their source after the copy; a placeholder keeps NOT NULL happy.
    tags = "\t".join(value or ONSPD_SOURCE for value in values)
    body = "".join(f"{line}\t{tags}\n" for line in body.splitlines())
    with cur.copy(f"COPY {table} ({', '.join(columns)}, {extra}) FROM STDIN WITH (FORMAT text, NULL '')") as copy:
        copy.write(body)


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "build":
        build()
    elif stage == "load" and len(argv) == 3:
        load(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
