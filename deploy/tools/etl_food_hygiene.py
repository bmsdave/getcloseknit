"""Food hygiene near each LSOA: the `food-hygiene` map metric from food_business (migration 031).

For every LSOA's representative point (ST_PointOnSurface, the same point the place and
custom-criteria evidence use) it counts the cafés, restaurants, canteens, takeaways,
sandwich shops, pubs and bars on the FSA register within 800 m in a straight line that
carry a 0-5 rating (Exempt and Awaiting inspection/publication are left out), and how many
of them are rated 4 or 5. Written as:

  metric_value            food-hygiene: % of those rated places rated 4 or 5
                          (sample = rated places; suppressed below MIN_RATED)
  metric_value_breakdown  rated-4-or-5: how many of them

under its own source release `src-fsa-fhrs-hygiene-*` (OGL v3), then a product release that
replaces any earlier build is staged and activated. LSOAs only (like deprivation), every LSOA in the
database (England once food_business holds the national register); the percentile ranks each LSOA
within its region (area_region, migration 103), so London's stay London's.
The value describes nearby food places, never the people who live in the area.

  python3 etl_food_hygiene.py load <database-url>      (needs psycopg; about 10 s)
"""
from __future__ import annotations

import csv
import io
import json
import sys
from collections.abc import Iterable, Mapping

import area_coverage as coverage
import crime_rates as cr

METRIC_ID = "food-hygiene"
SOURCE_PREFIX = "src-fsa-fhrs-hygiene"
ETL_VERSION = "close-knit-food-hygiene-1"
RADIUS_METRES = 800
MIN_RATED = 5  # fewer rated places than this: quality suppressed, no share
GOOD = ("4", "5")
RATED = ("0", "1", "2", "3", "4", "5")
# FSA BusinessTypeID: Restaurant/Cafe/Canteen, Pub/bar/nightclub, Takeaway/sandwich shop.
BUSINESS_TYPES = (1, 7843, 7844)
CATEGORY = "rated-4-or-5"
# Low share red, high share green (higher is better), as the deprivation legend.
COLOURS = ("#b23a48", "#c96a3b", "#f4d35e", "#7ba05b", "#3a7d44")

COUNTS_SQL = """
WITH area AS (
  SELECT g.id, ST_PointOnSurface(g.geometry)::geography AS point
  FROM area_geography g WHERE g.kind = 'lsoa'
)
SELECT area.id AS geography_id,
  count(f.fhrs_id) FILTER (WHERE f.rating = ANY(%(rated)s)) AS rated,
  count(f.fhrs_id) FILTER (WHERE f.rating = ANY(%(good)s)) AS good
FROM area
LEFT JOIN food_business f
  ON f.source_release_id = %(source)s
 AND f.business_type_id = ANY(%(types)s)
 AND ST_DWithin(f.location::geography, area.point, %(radius)s)
GROUP BY area.id
ORDER BY area.id"""


def share(rated: int, good: int) -> float | None:
    """Percentage of rated places rated 4 or 5, one decimal; None below MIN_RATED."""
    if rated < MIN_RATED:
        return None
    return round(100 * good / rated, 1)


def aggregate(counts: Mapping[str, tuple[int, int]], period: str, regions: Mapping[str, str] | None = None):
    """(metric_value rows, breakdown rows) from {lsoa id: (rated, good)}; percentiles within each LSOA's
    region (`regions`: {lsoa id: region code}; without it, one group)."""
    shares = {gid: share(rated, good) for gid, (rated, good) in counts.items()}
    pct = coverage.regional_percentiles(shares, regions or {}, rank=cr.ascending_percentiles)
    values, breakdown = [], []
    for gid in sorted(counts):
        rated, good = counts[gid]
        if shares[gid] is None:
            values.append([gid, METRIC_ID, period, "", "", rated, "suppressed"])
            continue
        values.append([gid, METRIC_ID, period, shares[gid], pct[gid], rated, "observed"])
        breakdown.append([gid, METRIC_ID, period, CATEGORY, good])
    return values, breakdown


def legend(shares: Iterable[float]) -> list[dict]:
    """Quintile stops over LSOA shares, red (low) to green (high)."""
    ordered = sorted(shares)
    if not ordered:
        return []
    cuts = [ordered[int(len(ordered) * q)] for q in (0.2, 0.4, 0.6, 0.8)] + [ordered[-1]]
    return [{"value": round(v), "colour": c, "label": f"{round(v)}%"} for v, c in zip(cuts, COLOURS)]


def definition(lsoa_shares: list[float], fhrs: Mapping[str, str]) -> dict:
    return {
        "label": "Food hygiene nearby", "shortLabel": "Food hygiene",
        "description": (f"Share of the rated cafés, restaurants, takeaways and pubs within {RADIUS_METRES} m of "
                        "the area's centre point that hold a food hygiene rating of 4 or 5 (good or very good). "
                        "It describes nearby food places, not the people who live in the area."),
        "legend": legend(lsoa_shares),
        "sourceId": "fsa-fhrs", "sourceName": "Food Standards Agency, Food Hygiene Rating Scheme",
        "methodologyPath": "/guide/getting-around", "freshness": fhrs["release_date"][:7],
        "caveats": [
            f"Counts places within {RADIUS_METRES} m in a straight line of each area's centre point, "
            "not walking routes.",
            "Exempt businesses and those awaiting inspection or publication are left out; "
            f"areas with fewer than {MIN_RATED} rated places nearby show no share.",
            "A rating reflects the business at its last inspection, which can be months or years ago.",
            "Food hygiene ratings: Food Standards Agency (ratings.food.gov.uk), Open Government Licence v3.0.",
        ],
    }


def source_caveats() -> list[str]:
    return [f"Share of FSA-rated (0-5) restaurants, cafés, canteens, takeaways, sandwich shops, pubs and bars "
            f"within {RADIUS_METRES} m of each LSOA's representative point that are rated 4 or 5.",
            "Exempt businesses and those awaiting inspection or publication are not counted.",
            f"LSOAs with fewer than {MIN_RATED} rated places nearby are suppressed."]


def copy_rows(cur, table: str, columns: str, rows) -> None:
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    buffer.seek(0)
    with cur.copy(f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
        copy.write(buffer.read())


def load(url: str) -> None:
    import psycopg
    import psycopg.rows
    from psycopg.rows import dict_row

    import stage_release

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        loaded = [row["source_release_id"] for row in cur.execute(
            "SELECT DISTINCT source_release_id FROM food_business")]
        if len(loaded) != 1:
            raise SystemExit(f"expected one FHRS load in food_business, found {loaded}")
        fhrs = cur.execute(
            "SELECT id, source_url, to_char(release_date, 'YYYY-MM-DD') AS release_date, sha256, licence,"
            " attribution FROM source_release WHERE id = %s", (loaded[0],)).fetchone()
        period = fhrs["release_date"][:7] + "-01"
        counts = {row["geography_id"]: (row["rated"], row["good"]) for row in cur.execute(
            COUNTS_SQL, {"rated": list(RATED), "good": list(GOOD), "types": list(BUSINESS_TYPES),
                         "radius": RADIUS_METRES, "source": fhrs["id"]})}
        with conn.cursor(row_factory=psycopg.rows.tuple_row) as plain:
            regions = coverage.load_area_regions(plain, ("lsoa",))
        values, breakdown = aggregate(counts, period, regions)
        shares = [row[3] for row in values if row[6] == "observed"]
        print(json.dumps({"lsoas": len(values), "observed": len(shares),
                          "suppressed": len(values) - len(shares),
                          "median_share": sorted(shares)[len(shares) // 2] if shares else None}), flush=True)

        base = f"{SOURCE_PREFIX}-{fhrs['release_date'][:7]}"
        taken = {row["id"] for row in cur.execute(
            "SELECT id FROM source_release WHERE id LIKE %s", (base + "%",))}
        revision = 1
        while (base if revision == 1 else f"{base}-r{revision}") in taken:
            revision += 1
        source_id = base if revision == 1 else f"{base}-r{revision}"
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)""",
            (source_id, fhrs["source_url"], fhrs["release_date"], fhrs["sha256"], fhrs["licence"],
             fhrs["attribution"], ETL_VERSION, source_caveats()))
        old = [row["source_release_id"] for row in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = %s", (METRIC_ID,))]
        cur.execute("DELETE FROM metric_value_breakdown WHERE metric_id = %s", (METRIC_ID,))
        cur.execute("DELETE FROM metric_value WHERE metric_id = %s", (METRIC_ID,))
        cur.execute(
            """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
               VALUES (%s, 'lsoa', '%%', 'higher-is-better', %s, %s)
               ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,
                 source_release_id = EXCLUDED.source_release_id""",
            (METRIC_ID, json.dumps(definition(shares, fhrs)), source_id))
        with_source = lambda rows: [row + [source_id] for row in rows]  # noqa: E731
        copy_rows(cur, "metric_value",
                  "geography_id, metric_id, period, value, region_percentile, sample_count, quality,"
                  " source_release_id", with_source(values))
        copy_rows(cur, "metric_value_breakdown",
                  "geography_id, metric_id, period, category, offence_count, source_release_id",
                  with_source(breakdown))
        stage_release.stage(cur, METRIC_ID, [source_id], replace=tuple(old))
        print(f"load: {source_id}: {len(values)} LSOA values ({len(shares)} observed)")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "load":
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
