"""Rebuild the £/m² metric from standard market sales and publish it.

Reads the EPC-linked London sales ($AE_DATA/price-linked.sqlite: one row per
Price Paid transaction with floor area and 2021 LSOA/MSOA/borough, written by
`etl_england_prices.py london-linked` with each sale's category; an older file
without it takes the categories from $AE_WORK/ppd-london.sqlite, `etl_sales.py
extract`), applies the `price_index.qualifies` gates, computes the rolling
12-month median per LSOA with MSOA/borough fallback for every month, and swaps
it into a new product release in one transaction. After activation it reruns
every rebuild that depends on the index (stock values, bands, zone analytics,
good value, growth, market depth, pins, blocks) in the `etl_sales.py` load
order, so no derived value is left adjusted by the previous release's index
(issue #186).

  AE_DATA=~/data AE_WORK=~/data/aework/sales \
      python3 etl_price_release.py 2026-06 postgresql://… [--dry-run]
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

import price_index as pi

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "sales"))
LINKED_DB = os.path.join(DATA, "price-linked.sqlite")
PPD_DB = os.path.join(WORK, "ppd-london.sqlite")
FIRST_PERIOD = "2006-06"
ETL_VERSION = "close-knit-price-category-a-1"
METRIC = "price-per-square-metre"


def load_sales():
    db = sqlite3.connect(LINKED_DB)
    if "category" in {row[1] for row in db.execute("PRAGMA table_info(sale)")}:
        # etl_england_prices.py london-linked: the category travels with the sale.
        rows = db.execute("SELECT month, price, floor, lsoa, msoa, borough, ptype, category FROM sale")
    else:
        db.execute(f"ATTACH DATABASE '{PPD_DB}' AS p")
        rows = db.execute(
            """SELECT s.month, s.price, s.floor, s.lsoa, s.msoa, s.borough, s.ptype, p.ppd.category
               FROM sale s JOIN p.ppd ON p.ppd.txn = trim(s.txn, '{}')""")
    by = {"lsoa": {}, "msoa": {}, "borough": {}}
    seen = kept = 0
    for month, price, floor, lsoa, msoa, borough, ptype, category in rows:
        seen += 1
        if not pi.qualifies(category, ptype, price, floor):
            continue
        kept += 1
        point = (pi.month_index(month), price / floor)
        for kind, code in (("lsoa", lsoa), ("msoa", msoa), ("borough", borough)):
            by[kind].setdefault(code, []).append(point)
    series = {kind: {code: pi.Series(sales) for code, sales in areas.items()} for kind, areas in by.items()}
    return series, {"linked_sales": seen, "qualifying_sales": kept}


def build(end: str, geography: list[dict]):
    series, counts = load_sales()
    parent = {g["id"]: g["parent_id"] for g in geography}
    lsoas = sorted(g["official_code"] for g in geography if g["kind"] == "lsoa")
    msoas = sorted(g["official_code"] for g in geography if g["kind"] == "msoa")
    boroughs = sorted(g["official_code"] for g in geography if g["kind"] == "lad")
    empty = pi.Series([])
    rows, latest_values = [], []
    quality_latest = {"observed": 0, "fallback": 0, "suppressed": 0}
    for index in range(pi.month_index(FIRST_PERIOD), pi.month_index(end) + 1):
        values, cells = {}, {}
        for code in lsoas:
            gid = f"uk:lsoa:{code}"
            msoa = (parent.get(gid) or "").rsplit(":", 1)[-1]
            borough = (parent.get(parent.get(gid) or "") or "").rsplit(":", 1)[-1]
            own = series["lsoa"].get(code, empty).window(index)
            parents = [(f"uk:msoa:{msoa}", series["msoa"].get(msoa, empty).window(index)),
                       (f"uk:lad:{borough}", series["borough"].get(borough, empty).window(index))]
            cells[gid] = pi.carrier_value(own, parents)
            values[gid] = cells[gid][0]
        # The wider areas' own rolling series: an MSOA reads its own sales (20+
        # sales to observe) and falls back to its borough; a borough reads its
        # own sales. Issue #208: until these rows exist, get_area aggregates
        # LSOA values on the fly and must label them honestly.
        for code in msoas:
            gid = f"uk:msoa:{code}"
            borough = (parent.get(gid) or "").rsplit(":", 1)[-1]
            own = series["msoa"].get(code, empty).window(index)
            parents = [(f"uk:lad:{borough}", series["borough"].get(borough, empty).window(index))]
            cells[gid] = pi.carrier_value(own, parents)
        for code in boroughs:
            gid = f"uk:lad:{code}"
            own = series["borough"].get(code, empty).window(index)
            cells[gid] = pi.carrier_value(own, [])
        pct = pi.ascending_percentiles(values)
        period = f"{pi.index_month(index)}-01"
        for gid, (value, n, quality, carrier_id, carrier_n) in cells.items():
            # Percentiles are ranked within LSOAs only; wider areas leave them empty.
            rows.append([gid, METRIC, period, "" if value is None else value,
                         pct.get(gid, ""), n, quality, carrier_id or "", carrier_n or ""])
            if index == pi.month_index(end) and gid.startswith("uk:lsoa:"):
                quality_latest[quality] += 1
                if value is not None:
                    latest_values.append(value)
    return rows, latest_values, {**counts, "lsoa_quality_latest": quality_latest}


LEGEND_COLOURS = ("#2a6f97", "#4a9b8e", "#f4d35e", "#c96a3b", "#c44536")


def base_definition(latest: list[float]) -> dict:
    """The definition for a database that has none yet: the legend's stops are the latest LSOA values'
    quintiles and the top value."""
    ordered = sorted(latest) or [0.0]
    stops = [ordered[min(len(ordered) - 1, len(ordered) * q // 5)] for q in (1, 2, 3, 4)] + [ordered[-1]]
    return {
        "label": "Price per square metre", "shortLabel": "Price / m²",
        "legend": [{"value": round(stop, 1), "colour": colour, "label": f"£{round(stop):,}" + ("+" if i == 4 else "")}
                   for i, (stop, colour) in enumerate(zip(stops, LEGEND_COLOURS))],
        "sourceId": "hmlr-price-paid", "sourceName": "HM Land Registry Price Paid + MHCLG EPC",
        "methodologyPath": "/guide/price-per-m2",
    }


# The index-dependent rebuilds in the etl_sales.py load order; good value reads the freshly
# rebuilt bands, so it runs last. Steps with %s take the sales source release.
INDEX_REBUILDS = ("rebuild_stock_values(%s)", "rebuild_area_price_growth()",
                  "rebuild_market_depth()", "rebuild_sale_pins(%s)", "revalue_city_blocks(%s)",
                  "rebuild_area_price_bands(%s)", "rebuild_property_sale_bands(%s)",
                  "rebuild_zone_analytics(%s)", "rebuild_area_good_value()")


def rerun_index_rebuilds(cur) -> dict[str, int | None]:
    """Rerun every rebuild derived from the index on a dict_row cursor (#186). Returns
    {function name: rows}, None for steps skipped because no sales are loaded."""
    sales_source = cur.execute("SELECT DISTINCT source_release_id FROM sale").fetchone()
    sales_source = sales_source["source_release_id"] if sales_source else None
    results: dict[str, int | None] = {}
    for step in INDEX_REBUILDS:
        name = step.split("(")[0]
        if "%s" in step and sales_source is None:
            print(f"price release: no sales loaded, skipping {name}")
            results[name] = None
            continue
        args = (sales_source,) if "%s" in step else ()
        # dict_row rows are keyed by column name, which for `SELECT f(...)` is `f`.
        results[name] = cur.execute(f"SELECT {step}", args).fetchone()[name]
        print(f"price release: {name} -> {results[name]} rows")
    return results


def main(argv: list[str]) -> None:
    import psycopg
    from psycopg.rows import dict_row

    end, url = argv[1], argv[2]
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        geography = list(cur.execute(
            "SELECT id, kind::text AS kind, official_code, parent_id FROM area_geography"
            " WHERE kind IN ('lsoa', 'msoa', 'lad')"))
        rows, latest, record = build(end, geography)
        ordered = sorted(latest)
        london_median = ordered[len(ordered) // 2] if ordered else None
        print(json.dumps({**record, "rows": len(rows), "lsoa_median_latest": london_median}))
        if "--dry-run" in argv:
            return

        source_id = f"src-hmlr-pp-category-a-{end}"
        checksum = hashlib.sha256(json.dumps(record, sort_keys=True).encode()).hexdigest()
        cur.execute("DELETE FROM source_release WHERE id = %s AND NOT EXISTS"
                    " (SELECT 1 FROM product_release_member WHERE source_release_id = %s)",
                    (source_id, source_id))
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, 'https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads',
                 now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)""",
            (source_id, f"{end}-01", checksum,
             "Contains HM Land Registry data © Crown copyright and database right 2026. This data is "
             "licensed under the Open Government Licence v3.0. Floor areas: EPC open data (OGL v3.0).",
             ETL_VERSION,
             ["Standard market sales only (PPD category A); repossessions, buy-to-let and company sales are excluded.",
              "Floor area comes from the dwelling's latest EPC, not necessarily one lodged at the sale."]))
        cur.execute("DELETE FROM metric_value WHERE metric_id = %s", (METRIC,))
        buffer = io.StringIO()
        csv.writer(buffer).writerows(row + [source_id] for row in rows)
        buffer.seek(0)
        with cur.copy("COPY metric_value (geography_id, metric_id, period, value, region_percentile,"
                      " sample_count, quality, carrier_geography_id, carrier_sample_count,"
                      " source_release_id) FROM STDIN WITH (FORMAT csv)") as copy:
            copy.write(buffer.read())
        stored = cur.execute("SELECT definition FROM metric_definition WHERE id = %s", (METRIC,)).fetchone()
        definition = stored["definition"] if stored else base_definition(latest)
        definition.update({
            "description": ("Rolling 12-month median achieved price per square metre of standard market "
                            "sales (Price Paid category A), using each home's EPC floor area."),
            "freshness": end,
            "caveats": [
                "Areas with fewer than 20 qualifying sales in the 12 months fall back to their MSOA, then borough.",
                "Excludes repossessions, buy-to-let and company sales (category B) and 'other' property types.",
                "Sales without an EPC floor area, under £20,000, or outside 15–1,000 m² or £500–£40,000/m² are excluded.",
                "Land Registry registers sales with a lag of up to a few months, so the latest window is still filling.",
            ],
        })
        cur.execute("""INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
                       VALUES (%s, 'lsoa', '£/m²', 'higher-is-more', %s, %s)
                       ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,
                         source_release_id = EXCLUDED.source_release_id""",
                    (METRIC, json.dumps(definition), source_id))
        active = cur.execute("SELECT release_id FROM active_product_release").fetchone()["release_id"]
        base = cur.execute("SELECT * FROM product_release WHERE id = %s", (active,)).fetchone()
        release_id = f"rel-{datetime.now(timezone.utc):%Y%m%d%H%M}-price-a-{end}"
        cur.execute(
            """INSERT INTO product_release (id, geography_vintage, transformation_versions, assets,
                 validation_status, validation_record) VALUES (%s, %s, %s, %s, 'passed', %s)""",
            (release_id, base["geography_vintage"],
             json.dumps({**base["transformation_versions"], "price": ETL_VERSION}),
             json.dumps(base["assets"]), json.dumps({**record, "supersedes": active})))
        cur.execute(
            """INSERT INTO product_release_member (release_id, source_release_id)
               SELECT %s, source_release_id FROM product_release_member WHERE release_id = %s
               UNION SELECT %s, %s""", (release_id, active, release_id, source_id))
        cur.execute("SELECT activate_product_release(%s)", (release_id,))
        # A new index moves every value derived from it (#186): rerun the index-dependent
        # rebuilds in the etl_sales.py load order — stock values -> stock-value layer, pins and
        # blocks; bands -> typical-price layer -> good value; zone index; growth; market depth —
        # so nothing on the site is still adjusted by the previous release's index. (This
        # supersedes the growth+market_depth-only rebuild from #163.)
        rerun_index_rebuilds(cur)
        print(f"activated {release_id} with {source_id}")


if __name__ == "__main__":
    main(sys.argv)
