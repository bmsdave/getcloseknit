"""Fill `area_market` and `area_recent_sale` (migration 016) from the loaded `sale` table.

Reads category-A sales of the last eleven years with their LSOA, aggregates
them with area_analytics.market and replaces the table in one transaction.
Run after `etl_sales.py load` (it needs `sale`, `address`, `area_geography`):

  uv run --project api python -m area_analytics.market_load <db-url>
  (with PYTHONPATH=pipelines/area-analytics-ingest)
"""
from __future__ import annotations

import csv
import io
import sys
from datetime import date

from .market import WINDOWS, MarketRow, Sale, aggregate

SALES_SQL = """COPY (
  SELECT a.geography_id, s.sale_month, s.price, s.property_type, s.price_per_square_metre
  FROM sale s JOIN address a ON a.id = s.address_id
  WHERE s.ppd_category = 'A' AND s.sale_month > %s::date - make_interval(years => %s)
) TO STDOUT WITH (FORMAT csv)"""

PARENTS_SQL = """SELECT l.id AS lsoa, m.id AS msoa, m.parent_id AS borough
FROM area_geography l JOIN area_geography m ON m.id = l.parent_id
WHERE l.kind = 'lsoa' AND m.kind = 'msoa'"""

COLUMNS = ("geography_id", "property_type", "window_end", "sales", "median_price", "p5", "p25",
           "p75", "p95", "min_price", "max_price", "ppm_sales", "median_ppm", "source_release_id")


def read_sales(text: str):
    for geography, month, price, kind, ppm in csv.reader(io.StringIO(text)):
        yield Sale(geography, date.fromisoformat(month), int(price), kind, float(ppm) if ppm else None)


def row_values(row: MarketRow, source_release_id: str) -> tuple:
    return (row.geography_id, row.property_type, row.window_end, row.sales, row.median_price,
            row.p5, row.p25, row.p75, row.p95, row.min_price, row.max_price, row.ppm_sales,
            row.median_ppm, source_release_id)


def load(url: str) -> int:
    import psycopg

    with psycopg.connect(url) as connection, connection.cursor() as cursor:
        latest, source = cursor.execute(
            "SELECT max(sale_month), min(source_release_id) FROM sale WHERE ppd_category = 'A'").fetchone()
        if latest is None:
            raise SystemExit("no category-A sales loaded")
        parents = {lsoa: (msoa, borough) for lsoa, msoa, borough in cursor.execute(PARENTS_SQL)}
        buffer = io.BytesIO()
        with cursor.copy(SALES_SQL, (latest, WINDOWS)) as copy:
            for chunk in copy:
                buffer.write(chunk)
        rows = aggregate(read_sales(buffer.getvalue().decode()), parents, latest)
        cursor.execute("DELETE FROM area_market")
        with cursor.copy(f"COPY area_market ({', '.join(COLUMNS)}) FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row_values(row, source))
        cursor.execute("ANALYZE area_market")
        recent = cursor.execute("SELECT rebuild_area_recent_sales()").fetchone()[0]
        print(f"area_market: {len(rows)} rows, windows ending {latest:%Y-%m}, source {source}; "
              f"area_recent_sale: {recent} rows")
        return len(rows)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m area_analytics.market_load <db-url>")
    load(sys.argv[1])
