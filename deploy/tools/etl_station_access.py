"""Walking minutes from every home to its nearest rail, Underground, metro, DLR or tram station.

Coverage follows area_coverage.from_env(): England by default (Geofabrik England extract),
CLOSE_KNIT_ETL_COVERAGE=london keeps the Greater London extract. OpenStreetMap, ODbL. Stages:
  download  fetches the extract into $AE_DATA/osm when it is missing ($AE_OSM_PBF overrides the
            path) and cuts walkable ways, stations and entrances out of it with the osmium CLI into
            $AE_WORK/walk.osm.pbf (default ~/data/aework/stations)
  homes     (England) one point per home outside the per-home spine: every English UPRN with a
            domestic EPC certificate ($AE_EPC_ZIP), placed at its OS Open UPRN point ($AE_UPRN_ZIP) and
            given the LSOA of its certificate's postcode (postcode_civic) -> $AE_WORK/homes/<region>.csv.gz
  load      region by region (area_region, migration 103): cuts the region plus a BUFFER_METRES
            margin out of walk.osm.pbf, builds the walking graph, runs a multi-source Dijkstra from
            every station entrance (or the station itself when no entrance is mapped) at 4.8 km/h,
            snaps each home to the nearest reached graph node, and loads (migration 012):
              station              the merged station list
              lsoa_station_walk    stations within 20 minutes of each LSOA
              metric_value         station-access: median minutes (sample = homes),
                                   percentile within the area's region
              metric_value_breakdown  within-10-min: homes within 10 minutes
              factor_utility       ascending percentile of the median (within the region)
            as a new source release, then stages and activates a product release.
            Homes are the property table's dwellings (OS Open UPRN points of London's per-home
            spine) and, in LSOAs without any, the EPC homes from the homes stage.
  bundle    the loaded release as one psql script for production (release_bundle.py)
  naptan-check  compares the loaded stations with NaPTAN's rail and metro/tram stations (DfT, OGL)
            per region; prints the counts, stores nothing

  AE_WORK=~/data/aework/stations python3 etl_station_access.py download
  AE_WORK=~/data/aework/stations python3 etl_station_access.py homes <database-url>
  AE_WORK=~/data/aework/stations python3 etl_station_access.py load <database-url>
  AE_WORK=~/data/aework/stations python3 etl_station_access.py bundle <database-url> <out.sql.gz>
  python3 etl_station_access.py naptan-check <database-url>

Stdlib only (plus psycopg for the database stages); needs `osmium` (osmium-tool) on PATH or $OSMIUM.
Set AE_RELEASE_LOCK to a directory path to serialise the write step with other loaders (mkdir lock).
ODbL: only the station list and area aggregates leave this script; no OSM geometry is stored.
EPC and UPRN data stay in the work files; only area aggregates are stored.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import heapq
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile
from array import array
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone

import area_coverage as coverage
import crime_rates as cr
import epc_bulk

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "stations"))
COVERAGE = coverage.from_env()
# Per coverage: extract file and URL, the extract's month and build date, and the source release.
SCOPES = {
    "london": {
        "pbf": "greater-london-latest.osm.pbf",
        "url": "https://download.geofabrik.de/europe/united-kingdom/england/greater-london-latest.osm.pbf",
        "period": "2026-09-01", "release_date": "2026-09-10", "source": "src-osm-station-access-2026-09",
        "extract": "Geofabrik Greater London extract",
    },
    "england": {
        "pbf": "england-261020.osm.pbf",
        "url": "https://download.geofabrik.de/europe/united-kingdom/england-261020.osm.pbf",
        "period": "2026-10-01", "release_date": "2026-10-20",
        "source": "src-osm-station-access-england-2026-10", "extract": "Geofabrik England extract",
    },
}
SCOPE = SCOPES[COVERAGE.name]
PBF = os.environ.get("AE_OSM_PBF") or os.path.join(DATA, "osm", SCOPE["pbf"])
PBF_URL = SCOPE["url"]
WALK_PBF = os.path.join(WORK, "walk.osm.pbf")
PBF_DIGEST = os.path.join(WORK, "extract.sha256")  # the source release's sha256, written by download
HOMES_DIR = os.path.join(WORK, "homes")
EPC_ZIP = epc_bulk.source()  # domestic-csv.zip or its unzipped folder
UPRN_ZIP = os.environ.get("AE_UPRN_ZIP", os.path.join(DATA, "property", "osopenuprn_2026-08_csv.zip"))
EPC_URL = "https://get-energy-performance-data.communities.gov.uk/"
UPRN_URL = "https://api.os.uk/downloads/v1/products/OpenUPRN/downloads?area=GB&format=CSV"
NAPTAN_URL = "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv"
OSMIUM = os.environ.get("OSMIUM") or shutil.which("osmium") or "/opt/homebrew/bin/osmium"
ETL_VERSION = "close-knit-station-access-2"
METRIC_ID = "station-access"
PERIOD = SCOPE["period"]
RELEASE_DATE = SCOPE["release_date"]
SOURCE_PREFIX = "src-osm-station-access"  # every build of this metric; a new one replaces the others

METRES_PER_MINUTE = 4800 / 60  # 4.8 km/h, the walking speed of journeys.ts
NEAR_MINUTES = 20  # lsoa_station_walk keeps stations within this many minutes
WITHIN_MINUTES = 10  # breakdown: dwellings within this many minutes
SNAP_METRES = 400  # a dwelling or station further than this from the network is unplaced
ENTRANCE_METRES = 250  # an unattached subway entrance joins the nearest station this close
MERGE_METRES = 500  # same-named station features this close are one station
MIN_COMPONENT = 500  # stations attach only to network pieces with at least this many vertices
MIN_DWELLINGS = 10  # areas with fewer placed dwellings are suppressed
BUFFER_METRES = 10_000  # each region's graph reaches this far past its edge (stations next door count)

# Equirectangular metres around a reference latitude: 51.5 N for London (under 0.5% error across
# Greater London); set_latitude() moves it to each region's centre (about 1-2% at a region's edge).
X_SCALE = 111_320 * math.cos(math.radians(51.5))
Y_SCALE = 110_574


def set_latitude(lat: float) -> None:
    global X_SCALE
    X_SCALE = 111_320 * math.cos(math.radians(lat))

WALKABLE = {
    "footway", "path", "pedestrian", "steps", "living_street", "residential", "service",
    "unclassified", "tertiary", "tertiary_link", "secondary", "secondary_link", "primary",
    "primary_link", "track", "cycleway", "bridleway", "corridor", "road", "trunk", "trunk_link",
    "motorway", "motorway_link", "elevator",
}
NEEDS_FOOT_ACCESS = {"trunk", "trunk_link", "motorway", "motorway_link"}
FOOT_YES = {"yes", "designated", "permissive", "official"}
NO_ACCESS = {"no", "private"}
RAIL_MODES = {"subway": "underground", "light_rail": "light_rail", "train": "rail", "tram": "tram"}

ESCAPE = re.compile(r"%([0-9a-fA-F]+)%")


def unescape(value: str) -> str:
    return ESCAPE.sub(lambda m: chr(int(m.group(1), 16)), value)


def parse_tags(field: str) -> dict[str, str]:
    """OPL tag field (without the leading T): k=v pairs separated by commas, %xx% escapes."""
    tags = {}
    if field:
        for pair in field.split(","):
            key, _, value = pair.partition("=")
            tags[unescape(key)] = unescape(value)
    return tags


def is_walkable(tags: dict[str, str]) -> bool:
    highway = tags.get("highway")
    if highway not in WALKABLE:
        return False
    foot = tags.get("foot", "")
    if foot in FOOT_YES:
        return True
    if foot == "no" or tags.get("access") in NO_ACCESS:
        return False
    if highway in NEEDS_FOOT_ACCESS:
        sidewalk = tags.get("sidewalk", tags.get("sidewalk:both", ""))
        return highway.startswith("trunk") and sidewalk in ("both", "left", "right", "yes")
    return True


def station_modes(tags: dict[str, str]) -> list[str] | None:
    """Modes of a station feature, or None when it is not a rail/Tube/DLR/tram station."""
    railway, transport, kind = tags.get("railway"), tags.get("public_transport"), tags.get("station", "")
    if kind == "miniature" or tags.get("usage") == "tourism" or any(
            key in tags for key in ("construction", "proposed", "disused", "abandoned")):
        return None
    modes = {mode for key, mode in RAIL_MODES.items() if tags.get(key) == "yes" or kind == key}
    if railway == "tram_stop":
        modes.add("tram")
    if railway in ("station", "halt") and not modes:
        modes.add("rail")
    if railway not in ("station", "halt", "tram_stop") and not (transport == "station" and modes):
        return None
    return sorted(modes) or None


def normalise_name(name: str) -> str:
    name = re.sub(r"\([^)]*\)", " ", name.lower()).replace("&", " and ").replace("st.", "st")
    words = re.sub(r"[^a-z0-9 ]", " ", name).split()
    return " ".join(w for w in words if w not in {"station", "underground", "tube", "dlr", "rail", "tram", "stop"})


def project(lon: float, lat: float) -> tuple[float, float]:
    return lon * X_SCALE, lat * Y_SCALE


def unproject(x: float, y: float) -> tuple[float, float]:
    return x / X_SCALE, y / Y_SCALE


class Graph:
    """Undirected walking graph over OSM nodes; coordinates in local metres."""

    def __init__(self) -> None:
        self.index: dict[int, int] = {}
        self.xs = array("d")
        self.ys = array("d")
        self.adj: list[list[tuple[int, float]]] = []

    def vertex(self, osm_id: int, x: float, y: float) -> int:
        found = self.index.get(osm_id)
        if found is None:
            found = self.index[osm_id] = len(self.xs)
            self.xs.append(x)
            self.ys.append(y)
            self.adj.append([])
        return found

    def connect(self, a: int, b: int) -> None:
        length = math.hypot(self.xs[a] - self.xs[b], self.ys[a] - self.ys[b])
        self.adj[a].append((b, length))
        self.adj[b].append((a, length))


def dijkstra(graph: Graph, sources: list[tuple[int, float, int]], limit: float = math.inf):
    """Multi-source shortest paths: sources are (vertex, start metres, label).

    Returns (distance, label) arrays; unreached vertices keep inf and -1.
    """
    n = len(graph.xs)
    dist = array("d", [math.inf]) * n
    label = array("i", [-1]) * n
    heap = []
    for vertex, start, tag in sources:
        if start < dist[vertex]:
            dist[vertex], label[vertex] = start, tag
            heap.append((start, vertex))
    heapq.heapify(heap)
    adj = graph.adj
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        tag = label[u]
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v] and nd <= limit:
                dist[v], label[v] = nd, tag
                heapq.heappush(heap, (nd, v))
    return dist, label


def bounded_reach(graph: Graph, sources: list[tuple[int, float]], limit: float) -> dict[int, float]:
    """Shortest distance to every vertex within `limit` metres of the sources."""
    best: dict[int, float] = {}
    heap = [(start, vertex) for vertex, start in sources if start <= limit]
    heapq.heapify(heap)
    adj = graph.adj
    while heap:
        d, u = heapq.heappop(heap)
        if u in best:
            continue
        best[u] = d
        for v, w in adj[u]:
            nd = d + w
            if nd <= limit and v not in best:
                heapq.heappush(heap, (nd, v))
    return best


def components(graph: Graph) -> array:
    """Size of the connected component each vertex belongs to."""
    n = len(graph.xs)
    comp = array("i", [-1]) * n
    sizes = []
    for start in range(n):
        if comp[start] >= 0:
            continue
        label, stack, size = len(sizes), [start], 0
        comp[start] = label
        while stack:
            u = stack.pop()
            size += 1
            for v, _ in graph.adj[u]:
                if comp[v] < 0:
                    comp[v] = label
                    stack.append(v)
        sizes.append(size)
    return array("i", (sizes[c] for c in comp))


class GridIndex:
    """Nearest-vertex lookup over a square grid of `cell` metres."""

    def __init__(self, graph: Graph, vertices, cell: float = 50.0) -> None:
        self.graph, self.cell = graph, cell
        self.cells: dict[tuple[int, int], list[int]] = defaultdict(list)
        for v in vertices:
            self.cells[(int(graph.xs[v] // cell), int(graph.ys[v] // cell))].append(v)

    def nearest(self, x: float, y: float, radius: float = SNAP_METRES) -> tuple[int, float] | None:
        cx, cy = int(x // self.cell), int(y // self.cell)
        xs, ys, cells = self.graph.xs, self.graph.ys, self.cells
        best, best_d = -1, math.inf
        rings = int(radius // self.cell) + 1
        for ring in range(rings + 1):
            for gx in range(cx - ring, cx + ring + 1):
                edge = gx in (cx - ring, cx + ring)
                for gy in (range(cy - ring, cy + ring + 1) if edge else (cy - ring, cy + ring)):
                    for v in cells.get((gx, gy), ()):
                        d = math.hypot(xs[v] - x, ys[v] - y)
                        if d < best_d:
                            best, best_d = v, d
            # Every vertex outside ring `ring` is at least ring * cell away.
            if best_d <= ring * self.cell:
                break
        return (best, best_d) if best >= 0 and best_d <= radius else None


class Station:
    def __init__(self, osm_id: str, name: str, modes: list[str], points: list[tuple[float, float]]):
        self.id, self.name, self.modes = osm_id, name, set(modes)
        self.points = list(points)  # projected positions of the station features
        self.entrances: list[tuple[float, float]] = []

    @property
    def centre(self) -> tuple[float, float]:
        return (sum(p[0] for p in self.points) / len(self.points),
                sum(p[1] for p in self.points) / len(self.points))


def read_opl(source):
    """Walking graph, station features and subway entrances from an osmium OPL file (a path or
    an open text stream, such as `osmium cat -o -` output)."""
    coords: dict[int, tuple[float, float]] = {}
    node_tags: dict[int, dict[str, str]] = {}
    graph = Graph()
    features, entrances = [], []
    with (open(source, encoding="utf-8") if isinstance(source, str) else source) as handle:
        for line in handle:
            kind = line[0]
            if kind == "n":
                fields = line.rstrip("\n").split(" ")
                osm_id = int(fields[0][1:])
                tags = lon = lat = None
                for field in fields[1:]:
                    if field[0] == "T":
                        tags = field[1:]
                    elif field[0] == "x":
                        lon = float(field[1:])
                    elif field[0] == "y":
                        lat = float(field[1:])
                if lon is None or lat is None:
                    continue
                coords[osm_id] = project(lon, lat)
                if tags and ("railway=" in tags or "public_transport=" in tags or "entrance=" in tags):
                    parsed = parse_tags(tags)
                    node_tags[osm_id] = parsed
                    if parsed.get("railway") == "subway_entrance":
                        entrances.append(coords[osm_id])
                    modes = station_modes(parsed)
                    if modes and parsed.get("name"):
                        features.append((f"n{osm_id}", parsed["name"], modes, [coords[osm_id]], []))
            elif kind == "w":
                tags, refs = "", ""
                fields = line.rstrip("\n").split(" ")
                for field in fields[1:]:
                    if field[0] == "T":
                        tags = field[1:]
                    elif field[0] == "N":
                        refs = field[1:]
                parsed = parse_tags(tags)
                nodes = [int(ref[1:]) for ref in refs.split(",") if ref]
                nodes = [ref for ref in nodes if ref in coords]
                if is_walkable(parsed):
                    previous = None
                    for ref in nodes:
                        vertex = graph.vertex(ref, *coords[ref])
                        if previous is not None and previous != vertex:
                            graph.connect(previous, vertex)
                        previous = vertex
                modes = station_modes(parsed)
                if modes and parsed.get("name") and nodes:
                    points = [coords[ref] for ref in nodes]
                    centre = (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))
                    doors = [coords[ref] for ref in nodes
                             if "entrance" in node_tags.get(ref, {})
                             or node_tags.get(ref, {}).get("railway") == "subway_entrance"]
                    features.append((f"w{fields[0][1:]}", parsed["name"], modes, [centre], doors))
    return graph, features, entrances


def merge_stations(features, entrances) -> list[Station]:
    """One station per name within MERGE_METRES; loose subway entrances join the nearest."""
    stations: list[Station] = []
    by_name: dict[str, list[Station]] = defaultdict(list)
    for osm_id, name, modes, points, doors in sorted(features, key=lambda f: (f[0][0] != "n", int(f[0][1:]))):
        key = normalise_name(name)
        point = points[0]
        target = next((s for s in by_name[key]
                       if math.hypot(s.centre[0] - point[0], s.centre[1] - point[1]) <= MERGE_METRES), None)
        if target is None:
            target = Station(f"osm:{osm_id}", name, modes, points)
            by_name[key].append(target)
            stations.append(target)
        else:
            target.modes.update(modes)
            target.points.extend(points)
        target.entrances.extend(doors)
    for door in entrances:
        nearest = min(stations, key=lambda s: math.hypot(s.centre[0] - door[0], s.centre[1] - door[1]),
                      default=None)
        if nearest and math.hypot(nearest.centre[0] - door[0], nearest.centre[1] - door[1]) <= ENTRANCE_METRES:
            nearest.entrances.append(door)
    for station in stations:
        station.entrances = sorted(set(station.entrances))
    return stations


def station_sources(stations: list[Station], index: GridIndex) -> tuple[list[list[tuple[int, float]]], int]:
    """Graph start points of each station: its entrances, else its feature positions."""
    out, unplaced = [], 0
    for station in stations:
        starts = []
        for x, y in station.entrances or station.points:
            hit = index.nearest(x, y)
            if hit:
                starts.append(hit)
        unplaced += not starts
        out.append(starts)
    return out, unplaced


def median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def padded_median(reached: list[float], total: int) -> float:
    """Median over `total` dwellings when only `reached` have a value (the rest are further)."""
    if len(reached) * 2 <= total:
        return math.inf
    return median(reached + [math.inf] * (total - len(reached)))


def access(graph: Graph, stations: list[Station], homes: list[tuple[str, float, float]]):
    """Minutes to the nearest station per home, and per-LSOA medians to each near station.

    homes: (lsoa id, x, y). Returns (minutes list aligned with homes, None when unplaced;
    {(lsoa, station index): median minutes} for medians within NEAR_MINUTES).
    """
    # Stations start only on the main network, never on an isolated platform or corridor stub.
    size = components(graph)
    main = GridIndex(graph, (v for v in range(len(size)) if size[v] >= MIN_COMPONENT))
    sources, _ = station_sources(stations, main)
    seeds = [(vertex, offset, i) for i, starts in enumerate(sources) for vertex, offset in starts]
    dist, _ = dijkstra(graph, seeds)
    reached = GridIndex(graph, (v for v in range(len(dist)) if dist[v] < math.inf))

    minutes: list[float | None] = []
    at_vertex: dict[int, list[tuple[int, float]]] = defaultdict(list)  # vertex -> (home, snap metres)
    snapped: dict[tuple[float, float], tuple[int, float] | None] = {}
    for i, (_, x, y) in enumerate(homes):
        key = (round(x, 1), round(y, 1))
        if key not in snapped:
            snapped[key] = reached.nearest(x, y)
        hit = snapped[key]
        if hit is None:
            minutes.append(None)
            continue
        vertex, offset = hit
        minutes.append((dist[vertex] + offset) / METRES_PER_MINUTE)
        at_vertex[vertex].append((i, offset))

    placed_in: dict[str, int] = defaultdict(int)
    for (lsoa, _, _), value in zip(homes, minutes):
        if value is not None:
            placed_in[lsoa] += 1
    limit = NEAR_MINUTES * METRES_PER_MINUTE
    near: dict[tuple[str, int], float] = {}
    for s, starts in enumerate(sources):
        reach = bounded_reach(graph, starts, limit)
        by_lsoa: dict[str, list[float]] = defaultdict(list)
        for vertex, d in reach.items():
            for home, offset in at_vertex.get(vertex, ()):
                if d + offset <= limit:
                    by_lsoa[homes[home][0]].append((d + offset) / METRES_PER_MINUTE)
        for lsoa, values in by_lsoa.items():
            value = padded_median(values, placed_in[lsoa])
            if value <= NEAR_MINUTES:
                near[(lsoa, s)] = round(value, 1)
    return minutes, near


def aggregate(homes, minutes, parents: dict[str, str]):
    """metric_value, breakdown and factor_utility rows for LSOAs, MSOAs and boroughs."""
    groups: dict[str, list[float]] = defaultdict(list)
    kinds: dict[str, str] = {}
    for (lsoa, _, _), value in zip(homes, minutes):
        if value is None:
            continue
        msoa = parents.get(lsoa)
        borough = parents.get(msoa) if msoa else None
        for gid in (lsoa, msoa, borough):
            if gid:
                groups[gid].append(value)
                kinds[gid] = gid.split(":")[1]
    medians = {gid: round(median(values), 1) for gid, values in groups.items() if len(values) >= MIN_DWELLINGS}
    values, breakdown, utility = [], [], []
    for kind in ("lsoa", "msoa", "lad"):
        members = {gid: medians.get(gid) for gid in groups if kinds[gid] == kind}
        pct = cr.ascending_percentiles(members)
        for gid in sorted(members):
            n, value = len(groups[gid]), members[gid]
            if value is None:
                values.append([gid, METRIC_ID, PERIOD, "", "", n, "suppressed"])
                continue
            values.append([gid, METRIC_ID, PERIOD, value, pct[gid], n, "observed"])
            breakdown.append([gid, METRIC_ID, PERIOD, f"within-{WITHIN_MINUTES}-min",
                              sum(v <= WITHIN_MINUTES for v in groups[gid])])
            utility.append([gid, METRIC_ID, PERIOD, pct[gid], value, "minutes", gid, "observed"])
    return values, breakdown, utility


def legend(lsoa_minutes: list[float]) -> list[dict]:
    stops = cr.legend_stops(lsoa_minutes)
    return [{**stop, "label": f"{stop['label']} min"} for stop in stops]




def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    if not os.path.exists(PBF):
        os.makedirs(os.path.dirname(PBF), exist_ok=True)
        urllib.request.urlretrieve(PBF_URL, PBF + ".tmp")
        os.replace(PBF + ".tmp", PBF)
    subprocess.run([OSMIUM, "tags-filter", PBF, "w/highway",
                    "nwr/railway=station,halt,tram_stop,subway_entrance", "nwr/public_transport=station",
                    "-o", WALK_PBF, "--overwrite"], check=True)
    with open(PBF, "rb") as handle, open(PBF_DIGEST, "w") as out:
        out.write(hashlib.file_digest(handle, "sha256").hexdigest() + "\n")
    print(f"download: {WALK_PBF} {os.path.getsize(WALK_PBF) // 2**20} MiB (the extract can go now)")


# --- homes outside the per-home spine: EPC-certified UPRNs at their OS Open UPRN points -------------

def norm_postcode(value: str | None) -> str | None:
    """'rg218xg ' -> 'RG21 8XG' (postcode_civic's form); None when it cannot be one."""
    compact = re.sub(r"\s+", "", value or "").upper()
    return f"{compact[:-3]} {compact[-3:]}" if 5 <= len(compact) <= 7 else None


def epc_uprns(reader, postcodes: dict[str, str], found: dict[int, str]) -> int:
    """Add {UPRN: LSOA code} from one certificates CSV (header row first) for certificates whose
    postcode `postcodes` maps to an LSOA; a later row wins (files are read oldest first).
    Returns the rows kept."""
    header = [name.strip().lower() for name in next(reader)]
    at_uprn, at_postcode = header.index("uprn"), header.index("postcode")
    width, kept = max(at_uprn, at_postcode), 0
    for row in reader:
        if len(row) <= width:
            continue
        uprn = row[at_uprn].strip()
        lsoa = postcodes.get(norm_postcode(row[at_postcode])) if uprn.isdigit() else None
        if lsoa:
            found[int(uprn)] = lsoa
            kept += 1
    return kept


def uprn_points(lines, found: dict[int, str]):
    """(LSOA code, longitude, latitude) for each OS Open UPRN row whose UPRN is in `found`."""
    for line in lines:
        uprn, _, rest = line.partition(",")
        if uprn.isdigit() and int(uprn) in found:
            _x, _y, lat, lon = rest.rstrip("\r\n").split(",")
            yield found[int(uprn)], lon, lat


def homes(url: str) -> None:
    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        postcodes = dict(cur.execute(
            "SELECT postcode, lsoa_code FROM postcode_civic WHERE lsoa_code IS NOT NULL").fetchall())
        regions = coverage.load_area_regions(cur, ("lsoa",))
    keep = {gid[len("uk:lsoa:"):] for gid, region in regions.items() if COVERAGE.contains_region(region)}
    postcodes = {pc: lsoa for pc, lsoa in postcodes.items() if lsoa in keep}
    print(f"homes: {len(postcodes)} postcodes in {len(keep)} LSOAs", flush=True)
    found: dict[int, str] = {}
    stats: dict = {"certificate_rows_kept": 0}
    for name in epc_bulk.members(EPC_ZIP):
        with epc_bulk.open_text(EPC_ZIP, name) as text:
            kept = epc_uprns(csv.reader(text), postcodes, found)
        stats["certificate_rows_kept"] += kept
        print(f"homes: {name}: {kept} certificates, {len(found)} UPRNs so far", flush=True)
    os.makedirs(HOMES_DIR, exist_ok=True)
    outs, placed = {}, defaultdict(int)
    try:
        with zipfile.ZipFile(UPRN_ZIP) as archive:
            member = next(n for n in archive.namelist() if n.lower().endswith(".csv"))
            with archive.open(member) as raw:
                lines = io.TextIOWrapper(raw, encoding="utf-8-sig")
                next(lines)
                for lsoa, lon, lat in uprn_points(lines, found):
                    region = regions["uk:lsoa:" + lsoa]
                    if region not in outs:
                        outs[region] = gzip.open(os.path.join(HOMES_DIR, f"{region}.csv.gz.tmp"), "wt")
                    outs[region].write(f"{lsoa},{lon},{lat}\n")
                    placed[region] += 1
    finally:
        for handle in outs.values():
            handle.close()
    for region in outs:
        path = os.path.join(HOMES_DIR, f"{region}.csv.gz")
        os.replace(path + ".tmp", path)
    stats.update(uprns=len(found), placed=sum(placed.values()), by_region=dict(sorted(placed.items())),
                 epc_zip=os.path.basename(EPC_ZIP), uprn_zip=os.path.basename(UPRN_ZIP))
    with open(os.path.join(HOMES_DIR, "stats.json"), "w") as handle:
        json.dump(stats, handle, indent=1)
    print(f"homes: {json.dumps(stats)}")


# --- load: region by region ----------------------------------------------------------------------

# Each region: its boroughs (LADs) merged, its centre latitude for the local projection, and the
# outline grown by BUFFER_METRES that cuts its piece out of walk.osm.pbf.
REGIONS_SQL = """WITH r AS (
  SELECT r.region_code, min(r.region_name) AS name,
         ST_Union(ST_SimplifyPreserveTopology(g.geometry, 0.001)) AS shape
  FROM area_region r JOIN area_geography g ON g.id = r.area_id
  WHERE g.kind = 'lad' AND r.region_code = ANY(%s)
  GROUP BY r.region_code)
SELECT region_code, name, round(ST_Y(ST_Centroid(shape))::numeric, 1)::float AS lat,
       ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Buffer(shape::geography, %s)::geometry, 0.002), 5) AS outline
FROM r ORDER BY region_code"""

SPINE_SQL = """SELECT p.geography_id, ST_X(p.location) AS lon, ST_Y(p.location) AS lat
FROM property p JOIN area_region r ON r.area_id = p.geography_id
WHERE r.region_code = %s"""


def region_homes(cur, region: str, spine: set[str]) -> list[tuple[str, float, float]]:
    """(LSOA id, x, y) in the current projection: the per-home spine, then EPC homes in LSOAs
    the spine does not reach."""
    out = [(row["geography_id"], *project(row["lon"], row["lat"]))
           for row in cur.execute(SPINE_SQL, (region,))]
    path = os.path.join(HOMES_DIR, f"{region}.csv.gz")
    if os.path.exists(path):
        with gzip.open(path, "rt") as handle:
            for line in handle:
                code, lon, lat = line.rstrip("\n").split(",")
                gid = "uk:lsoa:" + code
                if gid not in spine:
                    out.append((gid, *project(float(lon), float(lat))))
    return out


def region_graph(region: str, outline: str):
    """read_opl() over the region's piece of walk.osm.pbf (outline = GeoJSON (multi)polygon)."""
    poly, piece = os.path.join(WORK, f"{region}.geojson"), os.path.join(WORK, f"{region}.osm.pbf")
    with open(poly, "w") as handle:
        json.dump({"type": "Feature", "properties": {}, "geometry": json.loads(outline)}, handle)
    try:
        subprocess.run([OSMIUM, "extract", "-p", poly, WALK_PBF, "-o", piece, "--overwrite"], check=True)
        with subprocess.Popen([OSMIUM, "cat", "-f", "opl,add_metadata=false", piece, "-o", "-"],
                              stdout=subprocess.PIPE, text=True, encoding="utf-8") as proc:
            parsed = read_opl(proc.stdout)
        if proc.returncode:
            raise SystemExit(f"osmium cat failed for {region}")
        return parsed
    finally:
        for path in (poly, piece):
            if os.path.exists(path):
                os.remove(path)


def build(cur) -> dict:
    """Every region's rows: {"values", "breakdown", "utility", "near", "stations", "regions"}.
    Percentiles come out within each region because aggregate() sees one region at a time."""
    regions = cur.execute(REGIONS_SQL, (sorted(COVERAGE.region_codes), BUFFER_METRES)).fetchall()
    parents = {row["id"]: row["parent_id"] for row in cur.execute(
        "SELECT id, parent_id FROM area_geography WHERE parent_id IS NOT NULL")}
    spine = {row["geography_id"] for row in cur.execute("SELECT DISTINCT geography_id FROM property")}
    out: dict = {"values": [], "breakdown": [], "utility": [], "near": [], "stations": {}, "regions": {}}
    for region in regions:
        code = region["region_code"]
        set_latitude(region["lat"])
        homes_here = region_homes(cur, code, spine)
        graph, features, entrances = region_graph(code, region["outline"])
        stations = merge_stations(features, entrances)
        minutes, near = access(graph, stations, homes_here)
        del graph, features, entrances
        values, breakdown, utility = aggregate(homes_here, minutes, parents)
        out["values"] += values
        out["breakdown"] += breakdown
        out["utility"] += utility
        out["near"] += [[lsoa, stations[s].id, value] for (lsoa, s), value in sorted(near.items())]
        for station in stations:
            out["stations"].setdefault(station.id, (station.name, sorted(station.modes),
                                                    *unproject(*station.centre)))
        placed = [m for m in minutes if m is not None]
        out["regions"][code] = {
            "name": region["name"], "lat0": region["lat"], "stations": len(stations), "homes": len(homes_here),
            "placed": len(placed), "median_minutes": round(median(placed), 1) if placed else None,
            "within_10_min_share": (round(sum(m <= WITHIN_MINUTES for m in placed) / len(placed), 3)
                                    if placed else None),
            "lsoa_station_pairs": len(near), "areas": len(values)}
        print(f"load: {code} {json.dumps(out['regions'][code])}", flush=True)
    return out


@contextmanager
def release_lock():
    """mkdir-based lock at $AE_RELEASE_LOCK (shared with other loaders); a no-op when unset."""
    path = os.environ.get("AE_RELEASE_LOCK")
    if not path:
        yield
        return
    path = os.path.expanduser(path)
    while True:
        try:
            os.mkdir(path)
            break
        except FileExistsError:
            time.sleep(20)
    try:
        yield
    finally:
        os.rmdir(path)


def copy_rows(cur, table: str, columns: str, rows) -> None:
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    buffer.seek(0)
    with cur.copy(f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
        copy.write(buffer.read())


EDGE_CAVEAT = {
    "london": "Stations just outside Greater London are not counted, so edge areas can read long.",
    "england": (f"Stations up to {BUFFER_METRES // 1000} km past the region's edge count; walks of more than "
                "about two hours can read long."),
}
HOMES_CAVEAT = {
    "london": "Each home is placed at its OS Open UPRN point and joined to the nearest mapped path.",
    "england": ("Each home is placed at its OS Open UPRN point and joined to the nearest mapped path; "
                "outside London's per-home data, homes are the addresses with a domestic EPC certificate."),
}


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    with open(PBF_DIGEST) as handle:
        digest = handle.read().strip()
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        built = build(cur)
    values, breakdown, utility, near = built["values"], built["breakdown"], built["utility"], built["near"]
    print(json.dumps({"stations": len(built["stations"]),
                      "homes": sum(r["homes"] for r in built["regions"].values()),
                      "placed": sum(r["placed"] for r in built["regions"].values()),
                      "values": len(values), "lsoa_station_pairs": len(near)}), flush=True)
    with release_lock(), psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        source_id = SCOPE["source"]
        taken = {row["id"] for row in cur.execute(
            "SELECT id FROM source_release WHERE id LIKE %s", (source_id + "%",))}
        revision = 1
        while (source_id if revision == 1 else f"{source_id}-r{revision}") in taken:
            revision += 1
        source_id = source_id if revision == 1 else f"{source_id}-r{revision}"
        extra = ("" if COVERAGE.name == "london" else
                 " Contains OS data © Crown copyright and database right 2026 (OS Open UPRN). "
                 "Homes outside London from the domestic EPC register (MHCLG, OGL).")
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'ODbL-1.0', %s, %s, '2021', 'passed', %s)""",
            (source_id, PBF_URL, RELEASE_DATE, digest,
             "© OpenStreetMap contributors (ODbL). Station list and walking-time aggregates "
             f"derived from the {SCOPE['extract']}." + extra,
             ETL_VERSION,
             ["Walking network distance at 4.8 km/h from each home's OS Open UPRN point to the "
              "nearest mapped station entrance (the station itself where no entrance is mapped).",
              HOMES_CAVEAT[COVERAGE.name], EDGE_CAVEAT[COVERAGE.name],
              "Percentiles compare areas within their region.",
              "Lifts, stairs, crossings and waiting times are not modelled."]))
        old = [row["source_release_id"] for row in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = %s", (METRIC_ID,))]
        cur.execute("DELETE FROM lsoa_station_walk")
        cur.execute("DELETE FROM station")
        cur.execute("DELETE FROM metric_value_breakdown WHERE metric_id = %s", (METRIC_ID,))
        cur.execute("DELETE FROM metric_value WHERE metric_id = %s", (METRIC_ID,))
        cur.execute("DELETE FROM factor_utility WHERE factor_id = %s", (METRIC_ID,))

        definition = {
            "label": "Walk to a station", "shortLabel": "Station walk",
            "description": ("Median walking minutes from the area's homes to the nearest rail, "
                            "Underground, metro, DLR or tram station entrance, along mapped "
                            "paths and streets at 4.8 km/h."),
            "legend": legend([row[3] for row in values if row[0].startswith("uk:lsoa:") and row[3] != ""]),
            "sourceId": "osm", "sourceName": f"OpenStreetMap ({SCOPE['extract']})",
            "methodologyPath": "/guide/getting-around", "freshness": PERIOD[:7],
            "caveats": [
                "Network walking distance, not a straight line; lifts, stairs and crossings are not timed.",
                HOMES_CAVEAT[COVERAGE.name], EDGE_CAVEAT[COVERAGE.name],
                "Built from OpenStreetMap, © OpenStreetMap contributors, ODbL.",
            ],
        }
        cur.execute(
            """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
               VALUES (%s, 'lsoa', 'minutes', 'higher-is-more', %s, %s)
               ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,
                 source_release_id = EXCLUDED.source_release_id""",
            (METRIC_ID, json.dumps(definition), source_id))
        copy_rows(cur, "station", "id, name, modes, geom, source_release_id", [
            [sid, name, "{" + ",".join(modes) + "}", f"SRID=4326;POINT({lon:.6f} {lat:.6f})", source_id]
            for sid, (name, modes, lon, lat) in sorted(built["stations"].items())])
        copy_rows(cur, "lsoa_station_walk", "geography_id, station_id, median_minutes, source_release_id",
                  [row + [source_id] for row in near])
        with_source = lambda rows: [row + [source_id] for row in rows]  # noqa: E731
        copy_rows(cur, "metric_value",
                  "geography_id, metric_id, period, value, region_percentile, sample_count, quality,"
                  " source_release_id", with_source(values))
        copy_rows(cur, "metric_value_breakdown",
                  "geography_id, metric_id, period, category, offence_count, source_release_id",
                  with_source(breakdown))
        copy_rows(cur, "factor_utility",
                  "geography_id, factor_id, period, utility, raw_value, unit, carrier_geography_id,"
                  " quality, source_release_id", with_source(utility))
        stage_release.stage(cur, "station-access", [source_id], replace=tuple(old))
    with open(os.path.join(WORK, f"{source_id}.json"), "w") as handle:
        json.dump(built["regions"], handle, indent=1)
    print(f"load: {source_id}: {len(built['stations'])} stations, {len(values)} values, "
          f"{len(near)} LSOA-station pairs within {NEAR_MINUTES} min "
          f"(stamp {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ})")


# --- production bundle -----------------------------------------------------------------------------

BUNDLE_TABLES = (  # (table, columns, metric key column or None for whole tables, ORDER BY)
    ("station", ("id", "name", "modes", "geom", "source_release_id"), None, "id"),
    ("lsoa_station_walk", ("geography_id", "station_id", "median_minutes", "source_release_id"), None,
     "geography_id, station_id"),
    ("metric_value", ("geography_id", "metric_id", "period", "value", "region_percentile", "sample_count",
                      "quality", "source_release_id"), "metric_id", "geography_id"),
    ("metric_value_breakdown", ("geography_id", "metric_id", "period", "category", "offence_count",
                                "source_release_id"), "metric_id", "geography_id, category"),
    ("factor_utility", ("geography_id", "factor_id", "period", "utility", "raw_value", "unit",
                        "carrier_geography_id", "quality", "source_release_id"), "factor_id", "geography_id"),
)


def copy_out(cur, out, table: str, columns, select: str) -> int:
    """Stream `select` into a COPY ... FROM stdin block; returns the row count."""
    out.write(f"COPY {table} ({', '.join(columns)}) FROM stdin WITH (FORMAT csv);\n")
    rows = 0
    with cur.copy(f"COPY ({select}) TO STDOUT WITH (FORMAT csv)") as copy:
        for chunk in copy:
            data = bytes(chunk)
            rows += data.count(b"\n")
            out.write(data.decode("utf-8"))
    out.write("\\.\n")
    return rows


def bundle(url: str, path: str) -> dict:
    """The active station-access build as one transaction for production: its source release,
    definition, stations, near-station pairs and metric rows replace every earlier build, then a
    product release swaps the source in (release_bundle.stage_sql)."""
    import psycopg

    import release_bundle as rb

    counts: dict = {}
    with psycopg.connect(url) as conn, conn.cursor() as cur, gzip.open(path, "wt", encoding="utf-8") as out:
        source_id, unit, direction, definition = cur.execute(
            "SELECT source_release_id, unit, direction, definition::text FROM metric_definition WHERE id = %s",
            (METRIC_ID,)).fetchone()
        names = ("id", "source_url", "release_date", "sha256", "licence", "attribution",
                 "transformation_version", "caveats")
        release = dict(zip(names, cur.execute(
            "SELECT id, source_url, to_char(release_date, 'YYYY-MM-DD'), sha256, licence, attribution, "
            "transformation_version, caveats FROM source_release WHERE id = %s", (source_id,)).fetchone()))
        out.write(f"-- Station access ({source_id}). Apply with:\n"
                  "--   gunzip -c load.sql.gz | psql \"$DB\" -v ON_ERROR_STOP=1\n"
                  "BEGIN;\nSET client_min_messages = notice;\n")
        if COVERAGE.name == "england":
            out.write("DO $$ BEGIN IF (SELECT count(*) FROM area_geography WHERE kind = 'lsoa') < 33755 THEN\n"
                      "  RAISE EXCEPTION 'load the England geography (bundles/core) first'; END IF; END $$;\n")
        out.write(rb.source_release_sql(release) + "\n")
        out.write("INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)\n"
                  f"VALUES ({rb.literal(METRIC_ID)}, 'lsoa', {rb.literal(unit)}, {rb.literal(direction)}, "
                  f"{rb.literal(definition)}::jsonb, {rb.literal(source_id)})\n"
                  "ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,\n"
                  "  source_release_id = EXCLUDED.source_release_id;\n")
        out.write("DELETE FROM lsoa_station_walk;\nDELETE FROM station;\n")
        for table, columns, key, order in BUNDLE_TABLES:
            if key:
                out.write(f"DELETE FROM {table} WHERE {key} = {rb.literal(METRIC_ID)};\n")
            where = f"source_release_id = {rb.literal(source_id)}" + (
                f" AND {key} = {rb.literal(METRIC_ID)}" if key else "")
            counts[table] = copy_out(cur, out, table, columns,
                                     f"SELECT {', '.join(columns)} FROM {table} WHERE {where} ORDER BY {order}")
            print(f"bundle: {table}: {counts[table]}", flush=True)
        out.write(rb.stage_sql("station-access-" + COVERAGE.name, [source_id], [SOURCE_PREFIX]) + "\n")
        out.write("COMMIT;\n")
    counts["source_release_id"] = source_id
    print(json.dumps(counts))
    return counts


# --- NaPTAN cross-check ----------------------------------------------------------------------------

NAPTAN_TYPES = {"RLY": "rail", "MET": "metro/tram"}  # station access areas: one stop per station

NAPTAN_CHECK_SQL = """WITH n AS (
  SELECT n.*, r.region_code,
         (SELECT min(ST_Distance(s.geom::geography, n.geom::geography)) FROM station s
          WHERE ST_DWithin(s.geom::geography, n.geom::geography, 2000)) AS nearest_m
  FROM naptan_station n
  JOIN area_geography g ON g.kind = 'lad' AND ST_Contains(g.geometry, n.geom)
  JOIN area_region r ON r.area_id = g.id)
SELECT region_code, kind, count(*) AS naptan, count(*) FILTER (WHERE nearest_m <= 500) AS matched,
       array_agg(name ORDER BY name) FILTER (WHERE nearest_m IS NULL OR nearest_m > 500) AS missing
FROM n GROUP BY 1, 2 ORDER BY 1, 2"""


def naptan_stations(lines):
    """(ATCO code, name, kind, lon, lat) for active NaPTAN rail and metro/tram stations."""
    for row in csv.DictReader(lines):
        kind = NAPTAN_TYPES.get(row.get("StopType", ""))
        if kind and row.get("Status", "active").lower() in ("active", "act", "") and row.get("Longitude"):
            yield row["ATCOCode"], row["CommonName"], kind, float(row["Longitude"]), float(row["Latitude"])


def naptan_check(url: str) -> None:
    import psycopg

    with urllib.request.urlopen(NAPTAN_URL, timeout=300) as response:
        rows = list(naptan_stations(io.TextIOWrapper(response, encoding="utf-8-sig")))
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE naptan_station (atco text, name text, kind text, "
                    "geom geometry(Point, 4326))")
        copy_rows(cur, "naptan_station", "atco, name, kind, geom",
                  [[a, n, k, f"SRID=4326;POINT({x} {y})"] for a, n, k, x, y in rows])
        print(f"naptan-check: {len(rows)} NaPTAN stations; matched = an OSM station within 500 m")
        for region, kind, total, matched, missing in cur.execute(NAPTAN_CHECK_SQL).fetchall():
            print(f"{region} {kind:10} {matched}/{total} matched; missing: {(missing or [])[:12]}")
        conn.rollback()


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "homes" and len(sys.argv) == 3:
        homes(sys.argv[2])
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    elif stage == "bundle" and len(sys.argv) == 4:
        bundle(sys.argv[2], sys.argv[3])
    elif stage == "naptan-check" and len(sys.argv) == 3:
        naptan_check(sys.argv[2])
    else:
        sys.exit(__doc__)
