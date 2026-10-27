"""Short lets (migration 084): Inside Airbnb listings per LSOA, MSOA and borough, and the map layer.

Inside Airbnb (insideairbnb.com, CC BY 4.0) publishes a quarterly London snapshot of Airbnb listings,
`listings.csv.gz`. Only each listing's point, whether it is an entire home and whether it had a review
in the last 12 months are read; ids, names, hosts and prices are never kept. Points are counted into
LSOAs in the database (each point in one LSOA) and dropped with the transaction:

  area_short_let  listings, entire homes, active in 12 months, Census 2021 households (TS044 counts in
                  area_census_count) and listings per 1,000 homes; MSOAs and boroughs are sums of LSOAs
  metric_value    short-lets-per-1000 per LSOA with its London percentile (suppressed under MIN_HOMES)

under the source release `src-inside-airbnb-london-<snapshot>-<sha>`, then a product release is staged.

  AE_WORK=~/data/aework/short-lets python3 etl_short_lets.py download     (AE_AIRBNB_URL pins a snapshot)
  AE_WORK=~/data/aework/short-lets python3 etl_short_lets.py load <database-url>

Needs psycopg for load; download and parsing are stdlib only.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
from collections.abc import Iterable, Iterator, Mapping
from datetime import date

import crime_rates as cr

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "short-lets"))
ETL_VERSION = "close-knit-short-lets-1"
METRIC_ID = "short-lets-per-1000"
SOURCE_PREFIX = "src-inside-airbnb-london"
DATA_PAGE = "https://insideairbnb.com/get-the-data/"
LONDON_LISTINGS = re.compile(
    r"https://data\.insideairbnb\.com/united-kingdom/england/london/(\d{4}-\d{2}-\d{2})/data/listings\.csv\.gz")
LISTINGS = "listings.csv.gz"
SOURCE_NOTE = "source-url.txt"
ENTIRE_HOME = "Entire home/apt"
MIN_HOMES = 50  # fewer Census households than this: no rate on the map
# Greater London with a margin, WGS84 (lon, lat), as etl_home.py.
LONDON_BBOX = (-0.53, 51.27, 0.35, 51.70)
ATTRIBUTION = "Inside Airbnb, insideairbnb.com, CC BY 4.0."
CAVEATS = [
    "Airbnb moves each listing's point by up to about 150 m, so a listing near a boundary can count in "
    "the next area.",
    "Airbnb only: other platforms and agents' short lets are not counted.",
    "A snapshot of listings on one day; a listing is not a night let, and some are rarely booked.",
    "Homes are Census 2021 households, so empty homes are not in the count.",
    ATTRIBUTION,
]
# Few short lets green to many red (higher is more), fixed so a reload never moves the scale.
# Mirrors web/src/lib/fixtures.ts.
LEGEND = [
    {"value": 0, "colour": "#3a7d44", "label": "0"},
    {"value": 5, "colour": "#7ba05b", "label": "5"},
    {"value": 15, "colour": "#f4d35e", "label": "15"},
    {"value": 40, "colour": "#c96a3b", "label": "40"},
    {"value": 100, "colour": "#b23a48", "label": "100+"},
]

csv.field_size_limit(1 << 30)


def path(name: str) -> str:
    return os.path.join(WORK, name)


def latest_snapshot(html: str) -> str:
    """The newest London listings.csv.gz linked from the get-the-data page."""
    found = {match.group(1): match.group(0) for match in LONDON_LISTINGS.finditer(html)}
    if not found:
        raise SystemExit("get-the-data: no London listings.csv.gz link")
    return found[max(found)]


def snapshot_date(url: str) -> date:
    match = LONDON_LISTINGS.fullmatch(url)
    if not match:
        raise SystemExit(f"not a London listings.csv.gz URL: {url}")
    return date.fromisoformat(match.group(1))


def _get(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": "close-knit-etl"})


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    url = os.environ.get("AE_AIRBNB_URL")
    if not url:
        with urllib.request.urlopen(_get(DATA_PAGE), timeout=120) as response:
            url = latest_snapshot(response.read().decode("utf-8", "replace"))
    snapshot_date(url)
    target = path(LISTINGS)
    with urllib.request.urlopen(_get(url), timeout=900) as response, open(target + ".tmp", "wb") as handle:
        while chunk := response.read(1 << 20):
            handle.write(chunk)
    os.replace(target + ".tmp", target)
    with open(path(SOURCE_NOTE), "w", encoding="utf-8") as handle:
        handle.write(url + "\n")
    print(f"download: {url} {os.path.getsize(target) // 1024} KiB sha256 {sha256(LISTINGS)}", flush=True)


def sha256(name: str) -> str:
    digest = hashlib.sha256()
    with open(path(name), "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _reviews(text: str) -> int:
    try:
        return int(text)
    except ValueError:
        return 0


def listing_points(source: Iterable[str]) -> Iterator[tuple[float, float, bool, bool]]:
    """(lon, lat, entire home, active in 12 months) per London listing; every other column is dropped."""
    for row in csv.DictReader(source):
        try:
            lon, lat = float(row["longitude"]), float(row["latitude"])
        except ValueError:
            continue
        if not (LONDON_BBOX[0] <= lon <= LONDON_BBOX[2] and LONDON_BBOX[1] <= lat <= LONDON_BBOX[3]):
            continue
        yield lon, lat, row["room_type"] == ENTIRE_HOME, _reviews(row.get("number_of_reviews_ltm") or "") > 0


def _rate(listings: int, homes: int) -> float | None:
    return round(1000 * listings / homes, 1) if homes > 0 else None


def area_rows(lsoas: Mapping[str, tuple]) -> list[tuple]:
    """area_short_let rows (id, listings, entire, active, homes, per 1,000) for every LSOA and the sums of
    its MSOA and borough, from {lsoa: (msoa, borough, homes, listings, entire, active)}."""
    sums: dict[str, list[int]] = {}
    for lsoa, (msoa, borough, homes, listings, entire, active) in lsoas.items():
        for gid in (lsoa, msoa, borough):
            if gid is None:
                continue
            total = sums.setdefault(gid, [0, 0, 0, 0])
            for i, n in enumerate((listings, entire, active, homes)):
                total[i] += n
    return [(gid, listings, entire, active, homes, _rate(listings, homes))
            for gid, (listings, entire, active, homes) in sorted(sums.items())]


def metric_values(lsoas: Mapping[str, tuple], period: str) -> list[list]:
    """metric_value rows per LSOA: listings per 1,000 homes and its London percentile."""
    rates = {gid: _rate(row[3], row[2]) if row[2] >= MIN_HOMES else None for gid, row in lsoas.items()}
    pct = cr.ascending_percentiles(rates)
    return [[gid, METRIC_ID, period, rates[gid], pct[gid], lsoas[gid][2], "observed"] if rates[gid] is not None
            else [gid, METRIC_ID, period, "", "", lsoas[gid][2], "suppressed"] for gid in sorted(lsoas)]


def definition(snapshot: str) -> dict:
    return {
        "label": "Short lets", "shortLabel": "Short lets",
        "description": ("Airbnb listings per 1,000 homes (Census 2021 households), from Inside Airbnb's "
                        "London snapshot."),
        "legend": LEGEND,
        "sourceId": "inside-airbnb", "sourceName": "Inside Airbnb (London)",
        "methodologyPath": "/guide/local-market", "freshness": snapshot[:7],
        "caveats": CAVEATS,
    }


POINTS_SQL = "CREATE TEMP TABLE stage_short_let (lon float8, lat float8, entire boolean, active boolean) ON COMMIT DROP"
# Each point in exactly one LSOA (the lowest id where it sits on a boundary); points outside London drop.
LSOA_SQL = """
WITH placed AS (
  SELECT DISTINCT ON (s.n) g.id, s.entire, s.active
  FROM (SELECT row_number() OVER () AS n, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS p, entire, active
        FROM stage_short_let) s
  JOIN area_geography g ON g.kind = 'lsoa' AND ST_Intersects(g.geometry, s.p)
  ORDER BY s.n, g.id
), homes AS (
  SELECT geography_id, sum(count)::int AS homes FROM area_census_count WHERE topic = 'accommodation' GROUP BY 1
)
SELECT g.id, g.parent_id AS msoa, m.parent_id AS borough, coalesce(h.homes, 0) AS homes,
       count(p.id)::int AS listings, count(p.id) FILTER (WHERE p.entire)::int AS entire,
       count(p.id) FILTER (WHERE p.active)::int AS active
FROM area_geography g
LEFT JOIN area_geography m ON m.id = g.parent_id
LEFT JOIN homes h ON h.geography_id = g.id
LEFT JOIN placed p ON p.id = g.id
WHERE g.kind = 'lsoa'
GROUP BY g.id, g.parent_id, m.parent_id, h.homes"""


def _copy(cur, sql: str, rows: Iterable) -> None:
    with cur.copy(sql) as copy:
        for row in rows:
            copy.write_row(row)


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    with open(path(SOURCE_NOTE), encoding="utf-8") as handle:
        source_url = handle.read().strip()
    snapshot = snapshot_date(source_url)
    digest = sha256(LISTINGS)
    with gzip.open(path(LISTINGS), "rt", encoding="utf-8", newline="") as handle:
        points = list(listing_points(handle))
    print(json.dumps({"snapshot": snapshot.isoformat(), "sha256": digest, "london_points": len(points)}), flush=True)

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        release = f"{SOURCE_PREFIX}-{snapshot:%Y%m%d}-{digest[:12]}"
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
                 transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'CC-BY-4.0', %s, %s, '2021', 'passed', %s) ON CONFLICT (id) DO NOTHING""",
            (release, source_url, snapshot, digest, ATTRIBUTION, ETL_VERSION, CAVEATS[:4]))
        cur.execute(POINTS_SQL)
        _copy(cur, "COPY stage_short_let (lon, lat, entire, active) FROM STDIN", points)
        lsoas = {row["id"]: (row["msoa"], row["borough"], row["homes"], row["listings"], row["entire"], row["active"])
                 for row in cur.execute(LSOA_SQL)}
        if not any(row[2] for row in lsoas.values()):
            raise SystemExit("area_census_count has no accommodation counts: load the Census People tables first")
        cur.execute("DELETE FROM area_short_let")
        _copy(cur, "COPY area_short_let (geography_id, listings, entire_home, active_12m, homes, per_1000_homes,"
                   " source_release_id) FROM STDIN", (row + (release,) for row in area_rows(lsoas)))

        old = [row["source_release_id"] for row in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = %s", (METRIC_ID,))]
        cur.execute("DELETE FROM metric_value WHERE metric_id = %s", (METRIC_ID,))
        cur.execute(
            """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
               VALUES (%s, 'lsoa', 'per 1,000 homes', 'higher-is-more', %s, %s)
               ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,
                 source_release_id = EXCLUDED.source_release_id""",
            (METRIC_ID, json.dumps(definition(snapshot.isoformat())), release))
        values = metric_values(lsoas, snapshot.replace(day=1).isoformat())
        buffer = io.StringIO()
        csv.writer(buffer).writerows(row + [release] for row in values)
        with cur.copy("COPY metric_value (geography_id, metric_id, period, value, region_percentile, sample_count,"
                      " quality, source_release_id) FROM STDIN WITH (FORMAT csv)") as copy:
            copy.write(buffer.getvalue())
        stage_release.stage(cur, METRIC_ID, [release], replace=tuple(r for r in old if r != release))
        placed = sum(row[3] for row in lsoas.values())
        print(f"load: {release}: {placed} of {len(points)} points in {len(lsoas)} LSOAs, "
              f"{sum(1 for row in values if row[6] == 'observed')} mapped")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download" and len(sys.argv) == 2:
        download()
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
