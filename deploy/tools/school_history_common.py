"""Shared pieces of the school history loaders (migration 048).

  * LONDON_LAS: DfE local authority code -> name as school.attributes.localAuthority spells it (London's
    council admissions tables, which stay London-only).
  * COVERAGE (area_coverage.from_env(): England unless CLOSE_KNIT_ETL_COVERAGE=london) and
    coverage_las(): the DfE LA codes whose establishments lie in the coverage's regions, read from GIAS.
  * http_get(url, dest): download once (skip when dest exists) with a browser User-Agent and
    retries, writing dest + '.sha256'; returns the sha256. DfE's performance tables answer 403
    to non-browser agents; the Wayback Machine gets an honest agent and is fetched raw (id_).
  * raw_dir(source): ~/data/<source>/<YYYY-MM>/, the month of retrieval.
  * register_release(cur, ...): insert a source_release once; a different sha256 under the same
    id is refused (source releases are immutable), so a changed file needs a new id.
  * GIAS (OGL v3.0): fetch_gias() keeps the coverage's establishments (<coverage>-establishments-<stamp>.csv)
    and links without personal fields under ~/data/gias/<YYYY-MM>/; UrnResolver maps a URN or LAESTAB, including a
    predecessor's, to the current school in table `school` (None when unknown or ambiguous).

  python3 school_history_common.py gias <database-url>   fetch GIAS, fill school.predecessor_urn/
                                                          successor_urn, print resolver coverage
  python3 school_history_common.py stage <database-url>  after every loader: stage and activate ONE
                                                          product release with every source release
                                                          behind the history tables (every council's
                                                          distances) that the active release
                                                          lacks; drops SUPERSEDED members no school
                                                          card cites any more
"""
from __future__ import annotations

import csv
import hashlib
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import date, timedelta
from functools import lru_cache

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import area_coverage as coverage  # noqa: E402

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
DEFAULT_DB_URL = os.environ.get("AE_DB_URL", "postgresql://postgres@127.0.0.1:5434/area_explorer")
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
ETL_UA = "close-knit-etl/1 (+https://getcloseknit.com)"
ETL_VERSION = "close-knit-school-history-1"

LONDON_LAS = {
    201: "City of London", 202: "Camden", 203: "Greenwich", 204: "Hackney",
    205: "Hammersmith and Fulham", 206: "Islington", 207: "Kensington and Chelsea",
    208: "Lambeth", 209: "Lewisham", 210: "Southwark", 211: "Tower Hamlets",
    212: "Wandsworth", 213: "Westminster", 301: "Barking and Dagenham", 302: "Barnet",
    303: "Bexley", 304: "Brent", 305: "Bromley", 306: "Croydon", 307: "Ealing",
    308: "Enfield", 309: "Haringey", 310: "Harrow", 311: "Havering", 312: "Hillingdon",
    313: "Hounslow", 314: "Kingston upon Thames", 315: "Merton", 316: "Newham",
    317: "Redbridge", 318: "Richmond upon Thames", 319: "Sutton", 320: "Waltham Forest",
}

# England unless CLOSE_KNIT_ETL_COVERAGE=london (the London-only build of before).
COVERAGE = coverage.from_env()
# The coverage's region names, lower case, as Ofsted's and DfE's files print them ("london").
COVERAGE_REGION_NAMES = frozenset(name.lower() for code, name in coverage.REGIONS.items()
                                  if code in COVERAGE.region_codes)

GIAS_BASE = "https://ea-edubase-api-prod.azurewebsites.net/edubase/downloads/public/"
GIAS_LICENCE = "OGL-3.0"
GIAS_ATTRIBUTION = ("Department for Education, Get Information about Schools. Contains public sector "
                    "information licensed under the Open Government Licence v3.0.")
# Kept from edubasealldata; head teacher names and other personal fields are dropped.
GIAS_COLUMNS = (
    "URN", "LA (code)", "LA (name)", "EstablishmentNumber", "EstablishmentName",
    "EstablishmentStatus (name)", "OpenDate", "CloseDate", "ReasonEstablishmentOpened (name)",
    "ReasonEstablishmentClosed (name)", "TypeOfEstablishment (name)", "PhaseOfEducation (name)",
    "StatutoryLowAge", "StatutoryHighAge", "NurseryProvision (name)", "SchoolCapacity",
    "AdmissionsPolicy (name)", "ReligiousCharacter (name)", "OfficialSixthForm (name)",
    "PreviousLA (code)", "PreviousEstablishmentNumber", "Postcode", "DistrictAdministrative (code)",
)
LINK_COLUMNS = ("URN", "LinkURN", "LinkName", "LinkType", "LinkEstablishedDate")
# Every establishment's point (no personal fields): etl_schools.py places schools whose postcode is
# beyond the London grid with it (#225).
POINT_COLUMNS = ("URN", "LA (code)", "Easting", "Northing")


def raw_dir(source: str, month: str | None = None) -> str:
    """~/data/<source>/<YYYY-MM>/ (created), the month defaulting to this one."""
    path = os.path.join(DATA, source, month or date.today().strftime("%Y-%m"))
    os.makedirs(path, exist_ok=True)
    return path


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def wayback_raw(url: str) -> str:
    """A Wayback snapshot URL that serves the archived bytes, not the replay page."""
    return re.sub(r"(web\.archive\.org/web/\d{14})(?:[a-z]{2}_)?/", r"\1id_/", url, count=1)


def http_get(url: str, dest: str, *, attempts: int = 4, timeout: int = 300,
             headers: dict | None = None) -> str:
    """Download url to dest unless dest exists; write dest.sha256; return the sha256."""
    if os.path.exists(dest):
        return recorded_sha256(dest)
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    target = wayback_raw(url)
    # The Wayback Machine answers 429 to a browser User-Agent sent by urllib; it accepts an honest one.
    agent = ETL_UA if "web.archive.org/" in target else BROWSER_UA
    request = urllib.request.Request(target, headers={"User-Agent": agent, **(headers or {})})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response, open(dest + ".tmp", "wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
            break
        except urllib.error.HTTPError as error:
            if error.code in (403, 404, 410) or attempt == attempts - 1:
                raise
            if error.code in (429, 503):  # Wayback and councils throttle: wait as asked, or longer
                time.sleep(max(int(error.headers.get("Retry-After") or 0), 30 * (attempt + 1)))
                continue
        except OSError:
            if attempt == attempts - 1:
                raise
        time.sleep(2 ** attempt * 3)
    os.replace(dest + ".tmp", dest)
    return _write_sha(dest)


def recorded_sha256(path: str) -> str:
    """The sha256 in path.sha256, written when it is missing."""
    if os.path.exists(path + ".sha256"):
        with open(path + ".sha256") as handle:
            return handle.read().split()[0]
    return _write_sha(path)


def _write_sha(path: str) -> str:
    digest = sha256_file(path)
    with open(path + ".sha256", "w") as handle:
        handle.write(f"{digest}  {os.path.basename(path)}\n")
    return digest


def register_release(cur, release_id: str, url: str, sha256: str, licence: str, attribution: str,
                     caveats: list[str], release_date: str | date,
                     transformation_version: str = ETL_VERSION) -> None:
    """Insert the source release once. Same id with another sha256 is an error, not an update."""
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
             attribution, transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
           ON CONFLICT (id) DO NOTHING""",
        (release_id, url, release_date, sha256, licence, attribution, transformation_version, caveats))
    stored = cur.execute("SELECT sha256 FROM source_release WHERE id = %s", (release_id,)).fetchone()
    stored = stored["sha256"] if isinstance(stored, dict) else stored[0]
    if stored != sha256:
        raise SystemExit(f"{release_id}: already registered with sha256 {stored[:12]}…, "
                         f"this file is {sha256[:12]}…; give the new file a new release id")


# --- GIAS ---------------------------------------------------------------------------------

def gias_dir() -> str:
    return raw_dir("gias")


def fetch_gias(day: date | None = None, max_back: int = 7) -> tuple[str, str, dict]:
    """(establishments csv, links csv, {file: sha256 of the published file}) for COVERAGE.

    GIAS publishes both files daily under the date; falls back up to max_back days.
    The full download carries head teacher names, so only GIAS_COLUMNS are kept."""
    folder = gias_dir()
    prefix = f"{COVERAGE.name}-establishments-"
    done = sorted(f for f in os.listdir(folder) if f.startswith(prefix))
    if done:
        stamp = done[-1].removeprefix(prefix).removesuffix(".csv")
        return (os.path.join(folder, done[-1]), os.path.join(folder, f"{COVERAGE.name}-links-{stamp}.csv"),
                _read_shas(folder, stamp))
    day = day or date.today()
    for back in range(max_back + 1):
        stamp = (day - timedelta(days=back)).strftime("%Y%m%d")
        full = os.path.join(folder, f"edubasealldata{stamp}.csv")
        try:
            sha_all = http_get(f"{GIAS_BASE}edubasealldata{stamp}.csv", full, attempts=2)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                continue
            raise
        links_full = os.path.join(folder, f"links_edubasealldata{stamp}.csv")
        sha_links = http_get(f"{GIAS_BASE}links_edubasealldata{stamp}.csv", links_full, attempts=2)
        est, links = _slim_gias(folder, stamp, full, links_full)
        _write_points(full, points_file(folder, stamp))
        with open(os.path.join(folder, f"sources-{stamp}.txt"), "w") as handle:
            handle.write(f"{sha_all}  edubasealldata{stamp}.csv  {GIAS_BASE}edubasealldata{stamp}.csv\n")
            handle.write(f"{sha_links}  links_edubasealldata{stamp}.csv  {GIAS_BASE}links_edubasealldata{stamp}.csv\n")
        for path in (full, links_full):  # personal fields: keep the sha256, not the file
            os.remove(path)
        return est, links, _read_shas(folder, stamp)
    raise SystemExit(f"GIAS: no file in the {max_back} days to {day}")


def points_file(folder: str, stamp: str) -> str:
    return os.path.join(folder, f"points-{stamp}.csv")


def _write_points(full: str, out: str) -> None:
    with open(full, newline="", encoding="cp1252") as src, open(out + ".tmp", "w", newline="") as dest:
        writer = csv.writer(dest)
        writer.writerow(POINT_COLUMNS)
        for row in csv.DictReader(src):
            if row.get("Easting") and row.get("Northing"):
                writer.writerow([row.get(column, "") for column in POINT_COLUMNS])
    os.replace(out + ".tmp", out)


def fetch_gias_points(day: date | None = None, max_back: int = 7) -> str:
    """points-<stamp>.csv (POINT_COLUMNS of every establishment in England) in the GIAS folder,
    downloaded once; the full file, with its personal fields, is not kept."""
    folder = gias_dir()
    done = sorted(f for f in os.listdir(folder) if f.startswith("points-") and f.endswith(".csv"))
    if done:
        return os.path.join(folder, done[-1])
    day = day or date.today()
    for back in range(max_back + 1):
        stamp = (day - timedelta(days=back)).strftime("%Y%m%d")
        full = os.path.join(folder, f"edubasealldata{stamp}.csv")
        try:
            sha = http_get(f"{GIAS_BASE}edubasealldata{stamp}.csv", full, attempts=2)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                continue
            raise
        out = points_file(folder, stamp)
        _write_points(full, out)
        with open(os.path.join(folder, f"sources-points-{stamp}.txt"), "w") as handle:
            handle.write(f"{sha}  edubasealldata{stamp}.csv  {GIAS_BASE}edubasealldata{stamp}.csv\n")
        for path in (full, full + ".sha256"):
            if os.path.exists(path):
                os.remove(path)
        return out
    raise SystemExit(f"GIAS: no file in the {max_back} days to {day}")


def _read_shas(folder: str, stamp: str) -> dict:
    with open(os.path.join(folder, f"sources-{stamp}.txt")) as handle:
        return {parts[1]: {"sha256": parts[0], "url": parts[2]} for parts in (line.split() for line in handle)}


def las_in_coverage(rows, cover: coverage.Coverage | None = None) -> frozenset[int]:
    """DfE LA codes whose GIAS establishments mostly lie in the coverage's regions (each row's ONS district,
    "DistrictAdministrative (code)", gives its region)."""
    cover = cover or COVERAGE
    votes: dict[int, Counter] = defaultdict(Counter)
    for row in rows:
        la, lad = (row.get("LA (code)") or "").strip(), (row.get("DistrictAdministrative (code)") or "").strip()
        if la.isdigit() and lad:
            votes[int(la)][coverage.region_of_lad(lad)] += 1
    if not votes:
        raise SystemExit("GIAS rows without DistrictAdministrative (code): fetch a new extract")
    return frozenset(la for la, count in votes.items() if count.most_common(1)[0][0] in cover.region_codes)


@lru_cache(maxsize=1)
def coverage_las() -> frozenset[int]:
    """The DfE LA codes of COVERAGE: London's are LONDON_LAS; England's are read from GIAS."""
    if COVERAGE is coverage.LONDON:
        return frozenset(LONDON_LAS)
    return las_in_coverage(read_csv(fetch_gias()[0]))


def _slim_gias(folder: str, stamp: str, full: str, links_full: str) -> tuple[str, str]:
    if COVERAGE is coverage.LONDON:
        keep = {str(code) for code in LONDON_LAS}
    else:
        with open(full, newline="", encoding="cp1252") as src:
            keep = {str(code) for code in las_in_coverage(csv.DictReader(src))}
    urns = set()
    est = os.path.join(folder, f"{COVERAGE.name}-establishments-{stamp}.csv")
    with open(full, newline="", encoding="cp1252") as src, open(est + ".tmp", "w", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(GIAS_COLUMNS)
        for row in csv.DictReader(src):
            if row["LA (code)"] in keep or row.get("PreviousLA (code)") in keep:
                urns.add(row["URN"])
                writer.writerow([row.get(column, "") for column in GIAS_COLUMNS])
    links = os.path.join(folder, f"{COVERAGE.name}-links-{stamp}.csv")
    with open(links_full, newline="", encoding="cp1252") as src, open(links + ".tmp", "w", newline="") as out:
        writer = csv.writer(out)
        writer.writerow(LINK_COLUMNS)
        for row in csv.DictReader(src):
            if row["URN"] in urns or row["LinkURN"] in urns:
                writer.writerow([row.get(column, "") for column in LINK_COLUMNS])
    os.replace(est + ".tmp", est)
    os.replace(links + ".tmp", links)
    return est, links


def laestab(la: str | int, estab: str | int) -> str:
    return f"{int(la):03d}{int(estab):04d}"


class UrnResolver:
    """Maps a URN or 7-digit LAESTAB to the current school's URN in table `school`.

    A URN in `school` maps to itself. Otherwise GIAS successor links are followed (a
    predecessor that converted, merged or was amalgamated) until a school in `school` is
    reached; two different current schools or none gives None. LinkType names what LinkURN is
    to URN ('Successor', 'Predecessor - merged', …); split-school links are ignored."""

    def __init__(self, current: set[str], establishments: list[dict], links: list[dict]):
        self.current = set(current)
        self.by_laestab: dict[str, list[dict]] = defaultdict(list)
        self.establishment: dict[str, dict] = {}
        for row in establishments:
            self.establishment[row["URN"]] = row
            if row["LA (code)"].isdigit() and row["EstablishmentNumber"].isdigit():
                self.by_laestab[laestab(row["LA (code)"], row["EstablishmentNumber"])].append(row)
        self.successors: dict[str, set[str]] = defaultdict(set)
        self.predecessors: dict[str, set[str]] = defaultdict(set)
        for row in links:
            kind = row["LinkType"].lower()
            if "split" in kind:  # a school split off another: the old history is not its own
                continue
            if kind.startswith("successor"):
                old, new = row["URN"], row["LinkURN"]
            elif kind.startswith("predecessor"):
                old, new = row["LinkURN"], row["URN"]
            else:
                continue
            self.successors[old].add(new)
            self.predecessors[new].add(old)

    def resolve(self, key: str | int | None) -> str | None:
        key = str(key or "").strip()
        if re.fullmatch(r"\d{6}", key):
            return self._current(key)
        if re.fullmatch(r"\d{7}", key):
            found = {self._current(row["URN"]) for row in self.by_laestab.get(key, [])} - {None}
            return found.pop() if len(found) == 1 else None
        return None

    def _current(self, urn: str) -> str | None:
        seen, frontier, found = {urn}, [urn], set()
        while frontier:
            step = frontier.pop()
            if step in self.current:
                found.add(step)
                continue
            for nxt in self.successors.get(step, ()):
                if nxt not in seen:
                    seen.add(nxt)
                    frontier.append(nxt)
        return found.pop() if len(found) == 1 else None

    def names(self, la_code: int) -> list[tuple[str, str]]:
        """(name, current urn) for every GIAS establishment of the LA that resolves, open or closed."""
        out = []
        for urn, row in self.establishment.items():
            if row["LA (code)"] == str(la_code):
                current = self._current(urn)
                if current:
                    out.append((row["EstablishmentName"], current))
        return out


def read_csv(path: str) -> list[dict]:
    with open(path, newline="") as handle:
        return list(csv.DictReader(handle))


def load_resolver(cur) -> UrnResolver:
    """Resolver over the schools in the database and the latest GIAS extract of COVERAGE."""
    est, links, _ = fetch_gias()
    rows = cur.execute("SELECT urn FROM school").fetchall()
    current = {row["urn"] if isinstance(row, dict) else row[0] for row in rows}
    return UrnResolver(current, read_csv(est), read_csv(links))


def link_pairs(resolver: UrnResolver) -> list[tuple[str, str]]:
    """(predecessor, successor) pairs where both URNs are schools in the database."""
    pairs = {(old, new) for new, olds in resolver.predecessors.items() for old in olds
             if old in resolver.current and new in resolver.current and old != new}
    return sorted(pair for pair in pairs if pair[::-1] not in pairs)


def fill_links(cur, resolver: UrnResolver) -> int:
    """Set school.predecessor_urn / successor_urn where both schools exist; returns pairs set."""
    pairs = link_pairs(resolver)
    cur.executemany("UPDATE school SET predecessor_urn = %s WHERE urn = %s", [(old, new) for old, new in pairs])
    cur.executemany("UPDATE school SET successor_urn = %s WHERE urn = %s", [(new, old) for old, new in pairs])
    return len(pairs)


# Source releases behind the history tables. Every council's distances are staged (owner decision
# 2026-10-15: shown with per-council attribution and a link); publishable stays in the data as
# "re-use confirmed". A council that objects is dropped by leaving its releases out of a new release.
HISTORY_RELEASES_SQL = """SELECT source_release_id FROM school_observation
UNION SELECT source_release_id FROM school_inspection
UNION SELECT source_release_id FROM school_admission_demand
UNION SELECT source_release_id FROM school_admission_observation
UNION SELECT source_release_id FROM school_national_rank
UNION SELECT source_release_id FROM school_profile
UNION SELECT source_release_id FROM school_parent_view
UNION SELECT source_release_id FROM school_workforce
UNION SELECT source_release_id FROM school_finance
UNION SELECT source_release_id FROM school_destination
UNION SELECT source_release_id FROM school_feeder_flow"""
# Council distance releases loaded before 2026-10-15 carry the old review caveat; staging rewrites it.
REUSE_CAVEAT_OLD = "The council's terms do not confirm re-use: loaded for review, publishable = false."
REUSE_CAVEAT = "The council's terms do not confirm re-use: shown credited, with a link to the council's table."
RECAVEAT_SQL = """UPDATE source_release SET caveats = array_replace(caveats, %s, %s)
WHERE id LIKE 'src-la-admissions-%%' AND %s = ANY(caveats)"""
IMMUTABLE_SQL = "SELECT to_regproc('public.reject_source_release_change') IS NOT NULL AS t"
# KS2 2024/25 on the primary cards now comes from src-dfe-cscp-ks2-2024-25 (etl_school_performance.py).
SUPERSEDED = ("src-dfe-ks2-2024-25-revised",)


def stage(cur) -> str | None:
    """Stage and activate one release adding the history sources the active one lacks (dict rows)."""
    import stage_release

    # A database whose source releases are immutable (trigger reject_source_release_change) keeps the old caveat.
    immutable = cur.execute(IMMUTABLE_SQL).fetchone()
    if immutable and immutable["t"]:
        print("school history: source releases are immutable here, caveats not rewritten")
    else:
        cur.execute(RECAVEAT_SQL, (REUSE_CAVEAT_OLD, REUSE_CAVEAT, REUSE_CAVEAT_OLD))
    active = {row["source_release_id"] for row in cur.execute(
        """SELECT source_release_id FROM product_release_member
           WHERE release_id = (SELECT release_id FROM active_product_release)""")}
    new = sorted({row["source_release_id"] for row in cur.execute(HISTORY_RELEASES_SQL)} - active)
    replace = tuple(old for old in SUPERSEDED if old in active and not cur.execute(
        "SELECT 1 FROM school WHERE attributes::text LIKE %s LIMIT 1", (f'%"{old}"%',)).fetchone())
    if not new and not replace:
        print("school history: the active release already holds every source")
        return None
    return stage_release.stage(cur, "school-history", new, replace=replace)


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("gias", "stage"):
        raise SystemExit(__doc__)
    import psycopg

    url = argv[2] if len(argv) > 2 else DEFAULT_DB_URL
    if argv[1] == "stage":
        from psycopg.rows import dict_row

        with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
            stage(cur)
        return
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        resolver = load_resolver(cur)
        pairs = fill_links(cur, resolver)
        closed = [u for u, row in resolver.establishment.items()
                  if u not in resolver.current and row["EstablishmentStatus (name)"].startswith("Closed")]
        mapped = sum(1 for u in closed if resolver.resolve(u))
        print(f"gias: {len(resolver.establishment)} {COVERAGE.name} establishments, {len(resolver.current)} schools; "
              f"{mapped} of {len(closed)} closed establishments map to a current school; "
              f"{pairs} predecessor/successor pairs set")


if __name__ == "__main__":
    main(sys.argv)
