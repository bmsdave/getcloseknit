"""Deprivation, income and social renting for every area of the coverage (England by default).

The three People ranks the area card shows, rebuilt from the national files the London load used
(same files, same sha256), so London's values and percentiles do not change:

  deprivation     IMD 2025 decile per LSOA (MHCLG File 1, sheet IMD25; 1 = most deprived 10% of England)
  income          ONS small-area income FYE 2023, total annual household income per MSOA (£)
  social-renting  Census 2021 TS054: % of households renting from the council or another social
                  landlord, one decimal, per LSOA (from area_census_count, area_analytics.census_people)

region_percentile = round(100 × share of the region's areas with a value at or below this one)
(cume_dist), computed within the area's region (area_region, migration 103; London = London, so the
London numbers are the old ones). The rows go under new national source releases (`<old id>-england`,
same file and vintage) and a product release replaces the London-only ones.

  python3 etl_people_metrics.py check <database-url>   compute and compare London with the loaded rows
  python3 etl_people_metrics.py load <database-url>    write the rows and stage + activate a release

Inputs: $AE_DATA/imd/File_1_IoD2025_Index_of_Multiple_Deprivation.xlsx,
$AE_DATA/income/saie_fye2023_datasetfinal.xlsx, and the census tenure counts already loaded.
Needs psycopg and openpyxl.
"""
from __future__ import annotations

import hashlib
import os
import sys
from bisect import bisect_right
from collections.abc import Iterable, Mapping

import area_coverage as coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
IMD_FILE = os.path.join(DATA, "imd", "File_1_IoD2025_Index_of_Multiple_Deprivation.xlsx")
INCOME_FILE = os.path.join(DATA, "income", "saie_fye2023_datasetfinal.xlsx")
ETL_VERSION = "close-knit-people-metrics-1"
SUFFIX = "-england"
SOCIAL = ("council", "other-social")  # TS054 social rented: from the council, other social landlord

# metric -> (London-only release it replaces, period, carrier)
METRICS = {
    "deprivation": ("src-mhclg-imd-2025", "2025-01-01", "lsoa"),
    "income": ("src-ons-income-fye2023", "2023-01-01", "msoa"),
    "social-renting": ("src-ons-census-tenure-2021", "2021-03-01", "lsoa"),
}


def cume_percentiles(values: Mapping[str, float]) -> dict[str, int]:
    """{key: round(100 × share of values at or below it)}: the London load's rule."""
    ordered = sorted(values.values())
    return {key: round(100 * bisect_right(ordered, value) / len(ordered)) for key, value in values.items()}


def imd_deciles(rows: Iterable[tuple]) -> dict[str, float]:
    """LSOA code -> IMD decile from the IMD25 sheet (header row first)."""
    rows = iter(rows)
    header = [str(cell or "") for cell in next(rows)]
    code_at = header.index("LSOA code (2021)")
    decile_at = next(i for i, name in enumerate(header) if name.startswith("Index of Multiple Deprivation (IMD) Decile"))
    return {row[code_at]: float(row[decile_at]) for row in rows if row[code_at]}


def msoa_incomes(rows: Iterable[tuple]) -> dict[str, float]:
    """MSOA code -> total annual household income from the 'Total annual income' sheet."""
    found: dict[str, float] = {}
    value_at = None
    for row in rows:
        if value_at is None:
            if row and row[0] == "MSOA code":
                value_at = list(row).index("Total annual income (£)")
            continue
        if row[0] and str(row[0]).startswith(("E02", "W02")):
            found[row[0]] = float(row[value_at])
    return found


def social_shares(counts: Mapping[str, Mapping[str, int]]) -> dict[str, float]:
    """{area: % of households in social rent, one decimal} from TS054 tenure counts."""
    out = {}
    for area, by_category in counts.items():
        total = sum(by_category.values())
        if total > 0:
            out[area] = round(100 * sum(by_category.get(category, 0) for category in SOCIAL) / total, 1)
    return out


def metric_rows(values: Mapping[str, float], regions: Mapping[str, str]) -> list[tuple]:
    """(area id, value, percentile within its region) for the areas with a region."""
    covered = {area: value for area, value in values.items() if area in regions}
    ranks = coverage.regional_percentiles(covered, regions, rank=cume_percentiles)
    return [(area, covered[area], ranks[area]) for area in sorted(covered)]


def _sheet(path: str, name: str) -> list[tuple]:
    import openpyxl

    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        return list(book[name].iter_rows(values_only=True))
    finally:
        book.close()


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def compute(cur) -> dict[str, list[tuple]]:
    cov = coverage.from_env()
    regions = {area: region for area, region in coverage.load_area_regions(cur).items()
               if cov.contains_region(region)}
    imd = {f"uk:lsoa:{code}": value for code, value in imd_deciles(_sheet(IMD_FILE, "IMD25")).items()}
    income = {f"uk:msoa:{code}": value
              for code, value in msoa_incomes(_sheet(INCOME_FILE, "Total annual income")).items()}
    tenure: dict[str, dict[str, int]] = {}
    for area, category, count in cur.execute(
            "SELECT c.geography_id, c.category, c.count FROM area_census_count c "
            "JOIN area_geography g ON g.id = c.geography_id AND g.kind = 'lsoa' WHERE c.topic = 'tenure'"):
        tenure.setdefault(area, {})[category] = count
    return {"deprivation": metric_rows(imd, regions), "income": metric_rows(income, regions),
            "social-renting": metric_rows(social_shares(tenure), regions)}


def compare_london(cur, rows: Mapping[str, list[tuple]]) -> dict[str, dict]:
    """London's new rows against the loaded ones: {metric: {old, new, differing}}."""
    report = {}
    for metric, (old_id, _period, _carrier) in METRICS.items():
        old = {area: (value, pct) for area, value, pct in cur.execute(
            "SELECT geography_id, value, region_percentile FROM metric_value "
            "WHERE metric_id = %s AND source_release_id IN (%s, %s)", (metric, old_id, old_id + SUFFIX))}
        london = {area: (value, pct) for area, value, pct in rows[metric]
                  if coverage.region_of_code(area) == coverage.LONDON_REGION}
        report[metric] = {"old": len(old), "new": len(london),
                          "differing": sum(1 for area in old if london.get(area) != old[area])}
    return report


def load(url: str, check_only: bool = False) -> None:
    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        rows = compute(cur)
        print("London old vs new:", compare_london(cur, rows))
        if check_only:
            return
        shas = {"deprivation": _sha256(IMD_FILE), "income": _sha256(INCOME_FILE), "social-renting": None}
        new_ids = []
        for metric, (old_id, period, _carrier) in METRICS.items():
            new_id = old_id + SUFFIX
            stored = cur.execute("SELECT sha256 FROM source_release WHERE id = %s", (old_id,)).fetchone()
            if stored is None:
                raise SystemExit(f"{old_id} is not loaded: this replaces it with the national rows")
            if shas[metric] and shas[metric] != stored[0]:
                raise SystemExit(f"{metric}: the file differs from {old_id}'s (sha256 {stored[0][:12]})")
            # The national release copies the London one's file, licence and vintage.
            cur.execute(
                """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                     attribution, transformation_version, geography_vintage, validation_status, caveats)
                   SELECT %s, source_url, now(), release_date, sha256, licence, attribution, %s,
                          geography_vintage, 'passed',
                          caveats || ARRAY['Every English area; percentiles rank areas within their region.']
                   FROM source_release WHERE id = %s
                   ON CONFLICT (id) DO NOTHING""", (new_id, ETL_VERSION, old_id))
            cur.execute("DELETE FROM metric_value WHERE metric_id = %s AND source_release_id IN (%s, %s)",
                        (metric, old_id, new_id))
            with cur.copy("COPY metric_value (geography_id, metric_id, period, value, region_percentile, "
                          "quality, source_release_id) FROM STDIN") as copy:
                for area, value, pct in rows[metric]:
                    copy.write_row((area, metric, period, value, pct, "observed", new_id))
            cur.execute("UPDATE metric_definition SET source_release_id = %s WHERE id = %s", (new_id, metric))
            new_ids.append(new_id)
            print(f"{metric}: {len(rows[metric])} rows under {new_id}", flush=True)
        import stage_release
        from psycopg.rows import dict_row

        cur.row_factory = dict_row
        stage_release.stage(cur, "people-metrics-england", new_ids,
                            replace=tuple(old_id for old_id, _, _ in METRICS.values()))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] in ("check", "load"):
        load(sys.argv[2], check_only=sys.argv[1] == "check")
    else:
        sys.exit(__doc__)
