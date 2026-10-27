"""Rent trend (migration 081): the ONS Price Index of Private Rents series per local authority.

  borough_rent_series  every month in PIPR Table 1 (from January 2015) for every covered LAD with figures
                       (England by default, CLOSE_KNIT_ETL_COVERAGE=london for the 32 boroughs) and its region: index and average (mean) monthly rent for all homes, 1 to 4+ bedrooms,
                       detached, semi-detached, terraced and flat or maisonette
  metric_value         rent-change-1y, rent-change-5y: % change in the all-homes index over 12 and 60
                       months, per borough and month (carrier borough: every area in a borough reads it),
                       with the LAD's percentile within its region that month (ascending: 100 = fastest rise)

The workbook reader is area_analytics.rents (borough_rent, migration 029, keeps the latest month).
PIPR is borough level only and has no City of London row. OGL v3, official statistics in development.

  AE_WORK=~/data/aework/rent-trend python3 etl_rent_trend.py download   [PIPR_URL=… for a newer release]
  AE_WORK=~/data/aework/rent-trend python3 etl_rent_trend.py load <database-url>

Needs psycopg for load; download and parsing are stdlib only.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import sys
import urllib.request
from collections import defaultdict
from collections.abc import Iterable
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))
from area_analytics import coverage  # noqa: E402
from area_analytics.rents import (  # noqa: E402
    PIPR_ATTRIBUTION, PIPR_SHEET, PIPR_URL, _rent, covered, month, xlsx_rows,
)

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "rent-trend"))
URL = os.environ.get("PIPR_URL", PIPR_URL)
WORKBOOK = "pipr.xlsx"
ETL_VERSION = "close-knit-rent-trend-1"
SOURCE_BASE = "src-ons-pipr-series"
LONDON = "E12000007"
CARRIER = "lad"  # metric_definition.carrier (geography_kind)
# Workbook column suffix -> borough_rent_series.category (migration 081's CHECK).
CATEGORIES = {"": "all", " one bed": "1 bedroom", " two bed": "2 bedrooms", " three bed": "3 bedrooms",
              " four or more bed": "4 or more bedrooms", " detached": "detached",
              " semidetached": "semi-detached", " terraced": "terraced", " flat maisonette": "flat or maisonette"}
# metric id -> (months back, label words)
SPANS = {"rent-change-1y": (12, "1 year"), "rent-change-5y": (60, "5 years")}
METRIC_IDS = tuple(SPANS)
COLUMNS = ("borough", "month", "category", "rent", "index")
QUANTILES = (0.1, 0.3, 0.5, 0.7, 0.9)
COLOURS = ("#3a7d44", "#7ba05b", "#f4d35e", "#c96a3b", "#b23a48")
CAVEATS = [
    "Borough-wide: every neighbourhood in a borough reads the borough's change.",
    "Change in the ONS index for all homes: the mean rent of new and existing tenancies, mix-adjusted.",
    "Official statistics in development: ONS may revise recent months.",
    "No City of London figures are published.",
]


def _index(value: str) -> Decimal | None:
    try:
        index = Decimal(value.strip()).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return None
    return index if index > 0 else None


def series_rows(rows: Iterable[list[str]], cov: coverage.Coverage | None = None) -> list[dict]:
    """Every month's index and rent per covered LAD (and region) and category, from Table 1."""
    cov = cov or coverage.from_env()
    rows = iter(rows)
    header = next(row for row in rows if row and row[0].strip() == "Time period")
    where = {name.strip(): index for index, name in enumerate(header)}
    period_at, code_at = where["Time period"], where["Area code"]

    def cell(row: list[str], name: str) -> str:
        at = where.get(name)
        return row[at] if at is not None and at < len(row) else ""

    found = []
    for row in rows:
        code = row[code_at].strip() if len(row) > code_at else ""
        period = month(row[period_at]) if len(row) > period_at and covered(code, cov) else None
        if period is None:
            continue
        for suffix, category in CATEGORIES.items():
            rent, index = _rent(cell(row, f"Rental price{suffix}")), _index(cell(row, f"Index{suffix}"))
            if rent is not None or index is not None:
                found.append({"borough": code, "month": period, "category": category, "rent": rent, "index": index})
    if not found:
        raise ValueError(f"no rents in coverage ({cov.name}) in the workbook")
    return sorted(found, key=lambda item: (item["borough"], item["month"], item["category"]))


def _months_back(day: str, months: int) -> str:
    year, month_ = int(day[:4]), int(day[5:7])
    total = year * 12 + month_ - 1 - months
    return date(total // 12, total % 12 + 1, 1).isoformat()


def change_rows(series: Iterable[dict], months: int, metric_id: str) -> list[list]:
    """metric_value rows: each borough's % change in the all-homes index over `months`, every month with
    a base, and its ascending percentile among the LADs of its region that month (London = the London
    boroughs, as before; regions themselves have no row)."""
    index = {(row["borough"], row["month"]): row["index"] for row in series
             if row["category"] == "all" and row["index"] is not None and coverage.is_english_lad(row["borough"])}
    by_month: dict[tuple[str, str], list[tuple[str, float]]] = defaultdict(list)
    for (borough, day), value in index.items():
        base = index.get((borough, _months_back(day, months)))
        if base:
            change = float(((value / base - 1) * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
            by_month[(day, coverage.region_of_lad(borough))].append((borough, change))
    rows = []
    for day, _region in sorted(by_month):
        values = by_month[(day, _region)]
        for borough, change in sorted(values):
            below = sum(1 for _, other in values if other < change)
            percentile = round(100 * below / (len(values) - 1)) if len(values) > 1 else 50
            rows.append([f"uk:lad:{borough}", metric_id, day, change, percentile, "", "observed"])
    return rows


def _label(value: float) -> str:
    return f"{value:+g}%" if value else "0%"


def legend(values: Iterable[float]) -> list[dict]:
    """Five steps at the 10th–90th percentiles of the latest month's changes; equal steps kept once."""
    ordered = sorted(values)
    stops: list[dict] = []
    for colour, q in zip(COLOURS, QUANTILES):
        value = round(ordered[int((len(ordered) - 1) * q)], 1) if ordered else 0.0
        if stops and value <= stops[-1]["value"]:
            continue
        stops.append({"value": value, "colour": colour, "label": _label(value)})
    if len(stops) == 1:
        stops.append({"value": stops[0]["value"] + 1, "colour": COLOURS[-1], "label": _label(stops[0]["value"] + 1)})
    stops[-1]["label"] += "+"
    return stops


def definition(metric_id: str, latest: list[float], freshness: str = "") -> dict:
    months, words = SPANS[metric_id]
    return {
        "label": f"Rent change, {words}", "shortLabel": "Rent change",
        "description": (f"How much the borough's private rents moved over {words} ({months} months), from the ONS "
                        "Price Index of Private Rents for all homes. Borough level: every area in a borough "
                        "shows the same change."),
        "legend": legend(latest),
        "sourceId": "ons-pipr", "sourceName": "ONS Price Index of Private Rents",
        "methodologyPath": "/guide/home-cost", "freshness": freshness,
        "caveats": [*CAVEATS, PIPR_ATTRIBUTION],
    }


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    target = os.path.join(WORK, WORKBOOK)
    request = urllib.request.Request(URL, headers={"User-Agent": "close-knit-etl"})
    with urllib.request.urlopen(request, timeout=300) as response, open(target + ".tmp", "wb") as handle:
        while chunk := response.read(1 << 20):
            handle.write(chunk)
    os.replace(target + ".tmp", target)
    digest = _sha256(target)
    with open(os.path.join(WORK, "sources.json"), "w") as handle:
        json.dump({"url": URL, "sha256": digest, "retrieved": date.today().isoformat()}, handle)
    print(f"download: {WORKBOOK} {os.path.getsize(target) // 1024} KiB sha256 {digest}", flush=True)


def _copy(cur, table: str, columns: Iterable[str], rows: Iterable[list]) -> None:
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    with cur.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN WITH (FORMAT csv)") as copy:
        copy.write(buffer.getvalue())


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    with open(os.path.join(WORK, "sources.json")) as handle:
        sources = json.load(handle)
    workbook = os.path.join(WORK, WORKBOOK)
    if _sha256(workbook) != sources["sha256"]:
        raise SystemExit("pipr.xlsx changed since download: run download again")
    series = series_rows(xlsx_rows(workbook, PIPR_SHEET))
    latest = max(row["month"] for row in series)
    values = [row for metric_id, (months, _) in SPANS.items() for row in change_rows(series, months, metric_id)]
    print(json.dumps({"sha256": sources["sha256"], "series": len(series), "latest": latest[:7],
                      "values": len(values)}), flush=True)
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        taken = {row["id"] for row in cur.execute("SELECT id FROM source_release WHERE id LIKE %s",
                                                  (SOURCE_BASE + "%",))}
        cov = coverage.from_env()
        source_id = f"{SOURCE_BASE}-{latest[:7]}" + ("" if cov.name == "london" else f"-{cov.name}")
        revision = 1
        while source_id in taken:
            revision += 1
            source_id = f"{SOURCE_BASE}-{latest[:7]}-r{revision}"
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
                 transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)""",
            (source_id, sources["url"], sources["retrieved"], sources["sha256"], PIPR_ATTRIBUTION, ETL_VERSION,
             [f"Monthly series January 2015 to {latest[:7]}, {cov.name} LADs and their regions.", *CAVEATS]))
        old = sorted({row["source_release_id"] for row in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = ANY(%s)", (list(METRIC_IDS),))})
        cur.execute("DELETE FROM borough_rent_series")
        _copy(cur, "borough_rent_series", (*COLUMNS, "source_release_id"),
              ([row[c] for c in COLUMNS] + [source_id] for row in series))
        cur.execute("DELETE FROM metric_value WHERE metric_id = ANY(%s)", (list(METRIC_IDS),))
        for metric_id in METRIC_IDS:
            newest = [row[3] for row in values if row[1] == metric_id and row[2] == latest]
            cur.execute(
                """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
                   VALUES (%s, %s, '%%', 'higher-is-more', %s, %s)
                   ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, definition = EXCLUDED.definition,
                     source_release_id = EXCLUDED.source_release_id""",
                (metric_id, CARRIER, json.dumps(definition(metric_id, newest, latest[:7])), source_id))
        _copy(cur, "metric_value", ("geography_id", "metric_id", "period", "value", "region_percentile",
                                    "sample_count", "quality", "source_release_id"),
              (row + [source_id] for row in values))
        stage_release.stage(cur, "rent-trend", [source_id], replace=tuple(old))
        print(f"load: {source_id}: {len(series)} series rows, {len(values)} change values", flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "download":
        download()
    elif len(sys.argv) == 3 and sys.argv[1] == "load":
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
