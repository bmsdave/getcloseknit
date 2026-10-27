"""Future transport: new stations from a curated list, the nearest one to every area, and the map layer
`future-station-distance` (km to the nearest station under construction or consented).

The list is deploy/tools/future_transport.yaml: each scheme (new line, extension or new station) with its
mode, status (under construction, consented, funded, proposed), the expected year only where the official
page publishes one, a TfL, GLA or DfT source URL and its stations as points placed from that page.
This script:
  download  fetches every scheme's source page into $AE_WORK (default ~/data/aework/future-transport),
            prints the sha256 of each and of the list, and writes manifest.json; a dead page fails
  load      loads (migration 088) as a new source release, then stages and activates a product release:
              future_transport       the stations
              area_future_transport  per LSOA, MSOA and borough: the nearest station of any status from
                                     the middle of each LSOA (an MSOA or borough: its closest LSOA)
              metric_value           future-station-distance: km from the LSOA's middle to the nearest
                                     station under construction or consented; MSOAs and boroughs are
                                     home-weighted means of their LSOAs (sample = homes)
              metric_definition      the layer's definition (upserted: it points at this release)

  AE_WORK=~/data/aework/future-transport python3 etl_future_transport.py download
  python3 etl_future_transport.py load <database-url>

Stdlib only (plus psycopg for load). Plans change: a proposed scheme is loaded and shown as proposed.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import re
import sys
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import crime_rates as cr

SCHEMES = Path(__file__).resolve().parent / "future_transport.yaml"
WORK = os.environ.get("AE_WORK", os.path.join(os.path.expanduser("~/data"), "aework", "future-transport"))
METRIC_ID = "future-station-distance"
SOURCE_PREFIX = "src-future-transport-2026-10"
SOURCE_URL = "https://tfl.gov.uk/travel-information/improvements-and-projects/"
ETL_VERSION = "close-knit-future-transport-1"
PERIOD = "2026-10-01"  # the month the list was checked against its sources
RELEASE_DATE = "2026-10-18"

STATUSES = ("under construction", "consented", "funded", "proposed")
COUNTED = ("under construction", "consented")  # the map layer counts only these
MODES = ("tube", "rail", "elizabeth-line", "overground", "dlr", "tram")
# TfL, the GLA (and OPDC), DfT and HS2 Ltd (DfT's delivery body for HS2)
OFFICIAL_HOSTS = ("tfl.gov.uk", "london.gov.uk", "gov.uk", "hs2.org.uk")
LONDON = (51.28, 51.70, -0.52, 0.34)  # south, north, west, east
SLUG = re.compile(r"^[a-z0-9-]+$")
# Close green to far red (lower is closer), fixed so a reload never moves the scale.
LEGEND = [
    {"value": 0.5, "colour": "#3a7d44", "label": "500 m"},
    {"value": 1, "colour": "#7ba05b", "label": "1 km"},
    {"value": 2, "colour": "#f4d35e", "label": "2 km"},
    {"value": 4, "colour": "#c96a3b", "label": "4 km"},
    {"value": 8, "colour": "#b23a48", "label": "8 km+"},
]
CAVEATS = [
    "Plans change: a proposed scheme is shown as proposed, never as coming; dates are the promoter's own.",
    "Straight-line distance from the middle of each LSOA to a station point placed from the official page (to about 200 m).",
    "The map layer counts stations under construction or consented only; funded and proposed ones are left out.",
]


# --- the list ----------------------------------------------------------------------------------------

def _strip_comment(line: str) -> str:
    quote = None
    for i, char in enumerate(line):
        if char in "\"'" and quote in (None, char):
            quote = None if quote else char
        elif char == "#" and quote is None and (i == 0 or line[i - 1] in " \t"):
            return line[:i].rstrip()
    return line.rstrip()


def _scalar(text: str):
    text = text.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    if text in ("null", "~", ""):
        return None
    if text in ("true", "false"):
        return text == "true"
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+\.\d*", text):
        return float(text)
    return text


def parse_yaml(text: str):
    """The block YAML subset the list uses: nested mappings, lists of mappings or scalars, quoted or
    plain scalars, null, integers, decimals and # comments. Anything else raises ValueError."""
    lines = []
    for raw in text.splitlines():
        if "\t" in raw[: len(raw) - len(raw.lstrip())]:
            raise ValueError(f"tab indentation: {raw!r}")
        content = _strip_comment(raw)
        if content.strip():
            lines.append([len(content) - len(content.lstrip()), content.strip()])

    def block(i: int, indent: int):
        if lines[i][1].startswith("- ") or lines[i][1] == "-":
            items = []
            while i < len(lines) and lines[i][0] == indent and lines[i][1].startswith("-"):
                rest = lines[i][1][1:].strip()
                if not rest:
                    value, i = block(i + 1, lines[i + 1][0])
                elif re.match(r"^[A-Za-z_][\w-]*:(\s|$)", rest):
                    lines[i] = [indent + 2, rest]  # the item's first key, then its siblings at the same depth
                    value, i = block(i, indent + 2)
                else:
                    value, i = _scalar(rest), i + 1
                items.append(value)
            return items, i
        mapping = {}
        while i < len(lines) and lines[i][0] == indent:
            match = re.match(r"^([A-Za-z_][\w-]*):(?:\s+(.*))?$", lines[i][1])
            if not match:
                raise ValueError(f"not a key: {lines[i][1]!r}")
            key, rest = match.group(1), match.group(2)
            if key in mapping:
                raise ValueError(f"duplicate key: {key}")
            if rest is None or rest == "":
                if i + 1 < len(lines) and (lines[i + 1][0] > indent
                                           or (lines[i + 1][0] == indent and lines[i + 1][1].startswith("-"))):
                    mapping[key], i = block(i + 1, lines[i + 1][0])
                else:
                    mapping[key], i = None, i + 1
            else:
                mapping[key], i = _scalar(rest), i + 1
        return mapping, i

    if not lines:
        return {}
    value, end = block(0, lines[0][0])
    if end != len(lines):
        raise ValueError(f"unexpected indentation at: {lines[end][1]!r}")
    return value


@dataclass(frozen=True)
class Station:
    id: str
    scheme: str
    mode: str
    station: str
    lat: float
    lon: float
    status: str
    expected_year: int | None
    source_url: str

    @property
    def counted(self) -> bool:
        return self.status in COUNTED


def official(url: str) -> bool:
    """A TfL, GLA or DfT (gov.uk, HS2 Ltd) page over https."""
    parts = urlparse(url or "")
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(host == h or host.endswith("." + h) for h in OFFICIAL_HOSTS)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def stations(doc) -> list[Station]:
    """Every station of every scheme, validated; ValueError names the first bad entry."""
    out, seen = [], set()
    for scheme in (doc or {}).get("schemes") or []:
        sid = scheme.get("id")
        if not isinstance(sid, str) or not SLUG.match(sid):
            raise ValueError(f"scheme id must be a slug: {sid!r}")
        for key in ("scheme", "mode", "status", "source_url"):
            if not isinstance(scheme.get(key), str) or not scheme[key].strip():
                raise ValueError(f"{sid}: {key} is missing")
        if scheme["status"] not in STATUSES:
            raise ValueError(f"{sid}: status {scheme['status']!r} is not one of {STATUSES}")
        if scheme["mode"] not in MODES:
            raise ValueError(f"{sid}: mode {scheme['mode']!r} is not one of {MODES}")
        if not official(scheme["source_url"]):
            raise ValueError(f"{sid}: source_url must be an https TfL, GLA or DfT page: {scheme['source_url']}")
        year = scheme.get("expected_year")
        if year is not None and (not isinstance(year, int) or isinstance(year, bool) or not 2025 <= year <= 2100):
            raise ValueError(f"{sid}: expected_year {year!r}")
        if not scheme.get("stations"):
            raise ValueError(f"{sid}: no stations")
        for point in scheme["stations"]:
            name, lat, lon = point.get("name"), point.get("lat"), point.get("lon")
            if not isinstance(name, str) or not name.strip() or not point.get("placed"):
                raise ValueError(f"{sid}: a station needs a name and how it was placed")
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lat, lon)) \
                    or not (LONDON[0] <= lat <= LONDON[1] and LONDON[2] <= lon <= LONDON[3]):
                raise ValueError(f"{sid}: {name} is not inside Greater London: {lat}, {lon}")
            station_id = f"{sid}/{_slug(name)}"
            if station_id in seen:
                raise ValueError(f"duplicate station: {station_id}")
            seen.add(station_id)
            out.append(Station(station_id, scheme["scheme"].strip(), scheme["mode"], name.strip(), float(lat),
                               float(lon), scheme["status"], year, scheme["source_url"]))
    return out


# --- areas -------------------------------------------------------------------------------------------

def aggregate(points: dict[str, tuple[float, float]], homes: dict[str, int], parents: dict[str, str],
              placed: list[tuple[Station, float, float]]) -> tuple[list[list], list[list]]:
    """area_future_transport rows [geography, station id, metres, status, year] and metric_value rows
    [geography, metric, period, km, London percentile, homes, quality] from LSOA middles and station
    points, both in British National Grid metres. MSOAs and boroughs: the closest of their LSOAs for the
    nearest station, a home-weighted mean of their LSOAs for the metric."""
    nearest: dict[str, tuple[float, Station]] = {}
    counted: dict[str, float] = {}
    for gid, (x, y) in points.items():
        ranked = sorted((math.hypot(x - sx, y - sy), s.id, s) for s, sx, sy in placed)
        if not ranked:
            continue
        nearest[gid] = (ranked[0][0], ranked[0][2])
        built = [d for d, _, s in ranked if s.counted]
        if built:
            counted[gid] = built[0] / 1000
    members: dict[str, list[str]] = defaultdict(list)
    for lsoa in points:
        msoa = parents.get(lsoa)
        borough = parents.get(msoa) if msoa else None
        for gid in (lsoa, msoa, borough):
            if gid:
                members[gid].append(lsoa)
    order = {"lsoa": 0, "msoa": 1, "lad": 2}  # the id segments (uk:lad: since step R2)
    gids = sorted(members, key=lambda gid: (order[gid.split(":")[1]], gid))

    areas = []
    for gid in gids:
        found = [(nearest[lsoa][0], nearest[lsoa][1].id, nearest[lsoa][1]) for lsoa in members[gid] if lsoa in nearest]
        if found:
            metres, _, station = min(found)
            areas.append([gid, station.id, round(metres), station.status, station.expected_year])

    if not counted:
        return areas, []
    km: dict[str, float] = {}
    for gid in gids:
        pairs = [(counted[lsoa], homes.get(lsoa, 0)) for lsoa in members[gid] if lsoa in counted]
        if not pairs:
            continue
        weight = sum(w for _, w in pairs)
        mean = sum(v * w for v, w in pairs) / weight if weight else sum(v for v, _ in pairs) / len(pairs)
        km[gid] = round(mean, 2)
    values = []
    for kind in order:
        level = {gid: value for gid, value in km.items() if gid.split(":")[1] == kind}
        pct = cr.ascending_percentiles(level)
        for gid in sorted(level):
            values.append([gid, METRIC_ID, PERIOD, level[gid], pct[gid],
                           sum(homes.get(lsoa, 0) for lsoa in members[gid]), "observed"])
    return areas, values


def definition() -> dict:
    return {
        "label": "Distance to a new station", "shortLabel": "New station",
        "description": ("Straight-line km from the middle of the area to the nearest new rail, Tube, DLR, "
                        "Overground or tram station under construction or consented (TfL, GLA and DfT pages)."),
        "legend": LEGEND,
        "sourceId": "future-transport", "sourceName": "TfL, GLA and DfT scheme pages (curated list)",
        "methodologyPath": "/guide/getting-around", "freshness": PERIOD[:7],
        "caveats": CAVEATS,
    }


# --- pipeline ----------------------------------------------------------------------------------------

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def download() -> None:
    os.makedirs(os.path.join(WORK, "pages"), exist_ok=True)
    listed = SCHEMES.read_bytes()
    manifest = {"list": {"path": str(SCHEMES), "sha256": sha256(listed)}, "pages": {}}
    print(f"download: {SCHEMES.name} sha256 {manifest['list']['sha256']}")
    failed = []
    for url in sorted({s.source_url for s in stations(parse_yaml(listed.decode()))}):
        name = sha256(url.encode())[:16] + ".html"
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "close-knit-etl/1 (+https://closeknit.london)"})
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
        except Exception as error:  # noqa: BLE001 - report every dead page, then fail
            failed.append(url)
            print(f"download: FAILED {url}: {error}")
            continue
        Path(WORK, "pages", name).write_bytes(body)
        digest = sha256(body)
        manifest["pages"][url] = {"file": name, "sha256": digest, "bytes": len(body),
                                  "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        print(f"download: {url} sha256 {digest} ({len(body)} bytes)")
    Path(WORK, "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if failed:
        sys.exit(f"download: {len(failed)} source page(s) did not load; check the list")


def copy_rows(cur, table: str, columns: str, rows) -> None:
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    buffer.seek(0)
    with cur.copy(f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
        copy.write(buffer.read())


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    listed = SCHEMES.read_bytes()
    found = stations(parse_yaml(listed.decode()))
    print(f"load: {SCHEMES.name} sha256 {sha256(listed)}: {len(found)} stations, "
          f"{sum(s.counted for s in found)} under construction or consented", flush=True)
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        taken = {row["id"] for row in cur.execute(
            "SELECT id FROM source_release WHERE id LIKE %s", (SOURCE_PREFIX + "%",))}
        revision = 1
        while (SOURCE_PREFIX if revision == 1 else f"{SOURCE_PREFIX}-r{revision}") in taken:
            revision += 1
        source_id = SOURCE_PREFIX if revision == 1 else f"{SOURCE_PREFIX}-r{revision}"
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)""",
            (source_id, SOURCE_URL, RELEASE_DATE, sha256(listed),
             "Close Knit's list of new stations, from TfL, GLA and DfT scheme pages (each station cites its "
             "page). Contains public sector information licensed under the Open Government Licence v3.0.",
             ETL_VERSION, CAVEATS))
        old = [row["source_release_id"] for row in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = %s", (METRIC_ID,))]
        cur.execute("DELETE FROM area_future_transport")
        cur.execute("DELETE FROM future_transport")
        cur.execute("DELETE FROM metric_value WHERE metric_id = %s", (METRIC_ID,))
        copy_rows(cur, "future_transport",
                  "id, scheme, mode, station, point, status, expected_year, source_url, source_release_id",
                  [[s.id, s.scheme, s.mode, s.station, f"SRID=4326;POINT({s.lon:.6f} {s.lat:.6f})", s.status,
                    "" if s.expected_year is None else s.expected_year, s.source_url, source_id] for s in found])
        by_id = {s.id: s for s in found}
        placed = [(by_id[row["id"]], row["x"], row["y"]) for row in cur.execute(
            "SELECT id, ST_X(p) AS x, ST_Y(p) AS y FROM (SELECT id, ST_Transform(point, 27700) AS p "
            "FROM future_transport) t")]
        points = {row["id"]: (row["x"], row["y"]) for row in cur.execute(
            "SELECT id, ST_X(p) AS x, ST_Y(p) AS y FROM (SELECT id, ST_Transform(ST_PointOnSurface(geometry), 27700)"
            " AS p FROM area_geography WHERE kind = 'lsoa') t")}
        homes = {row["geography_id"]: row["n"] for row in cur.execute(
            "SELECT geography_id, count(*)::integer AS n FROM property GROUP BY geography_id")}
        parents = {row["id"]: row["parent_id"] for row in cur.execute(
            "SELECT id, parent_id FROM area_geography WHERE parent_id IS NOT NULL")}
        areas, values = aggregate(points, homes, parents, placed)
        if not values:
            raise SystemExit("load: no station under construction or consented; the layer would be empty")
        copy_rows(cur, "area_future_transport",
                  "geography_id, station_id, distance_m, status, expected_year, nearest_station, source_release_id",
                  [[*row[:4], "" if row[4] is None else row[4], by_id[row[1]].station, source_id] for row in areas])
        cur.execute(
            """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
               VALUES (%s, 'lsoa', 'km', 'higher-is-more', %s, %s)
               ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,
                 source_release_id = EXCLUDED.source_release_id""",
            (METRIC_ID, json.dumps(definition()), source_id))
        copy_rows(cur, "metric_value",
                  "geography_id, metric_id, period, value, region_percentile, sample_count, quality,"
                  " source_release_id", [row + [source_id] for row in values])
        stage_release.stage(cur, "future-transport", [source_id], replace=tuple(old))
        lsoa_km = sorted(row[3] for row in values if row[0].startswith("uk:lsoa:"))
        print(f"load: {source_id}: {len(found)} stations, {len(areas)} areas, {len(values)} values "
              f"(median LSOA {lsoa_km[len(lsoa_km) // 2]} km)")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "load" and len(sys.argv) in (3, 4):
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
