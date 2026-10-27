"""Production bundles for England's people data (branch england/d1-people), built from the ETL database
after `etl.py run --theme people` ran there (the steps in etl_manifest.py).

  people    load.sql.gz: Census 2021 counts (area_census_count, census_category, census_region_count),
            mid-2024 population (area_population), TS019 settled (area_settled), ONSPD postcodes and names
            (postcode_civic, civic_name), friendly names and map labels (area_label, map_label), OS Open
            Names streets (street), and the deprivation / income / social-renting metrics under their
            national releases; then stages and activates a release that replaces the London-only ones.
  layers    census-layers.sql.gz: the ~617 census-* map layers for every English LSOA (~21M metric_value
            rows, the big one), under `src-ons-census-2021-layers-england`, replacing every earlier
            `src-ons-census-2021-layers*` build.

Each file is one transaction (BEGIN ... COMMIT inside) and idempotent: it deletes the rows it owns
(whole tables for the People tables, the loader's own source releases elsewhere) and copies them again.
Apply after migrations 103-114 and the core bundle:

  gunzip -c load.sql.gz | psql "$DB" -v ON_ERROR_STOP=1

  python3 etl_england_people_bundle.py people <database-url> <out.sql.gz>
  python3 etl_england_people_bundle.py layers <database-url> <out.sql.gz>
"""
from __future__ import annotations

import gzip
import json
import sys

import etl_census_layers
import etl_people_metrics
import release_bundle as rb

LAYERS_LOCAL = "src-ons-census-2021-layers"           # the ETL database's build (first revision there)
LAYERS_ID = "src-ons-census-2021-layers-england"      # a new id on production, whatever it holds
STREET_SOURCE = "src-os-open-names-2026-10"

# (table, columns, ORDER BY): replaced whole on production.
WHOLE_TABLES = (
    ("census_category", ("topic", "category", "label", "position", "london_count"), "topic, category"),
    ("area_census_count", ("geography_id", "topic", "category", "count", "source_release_id"),
     "geography_id, topic, category"),
    ("census_region_count", ("region_code", "topic", "category", "count"), "region_code, topic, category"),
    ("area_population", ("geography_id", "population", "population_year", "area_km2", "source_release_id"),
     "geography_id"),
    ("area_settled", ("geography_id", "residents", "same_address", "source_release_id"), "geography_id"),
    ("civic_name", ("code", "kind", "name", "source_release_id"), "code, kind"),
    ("postcode_civic", ("postcode", "introduced", "terminated", "country_code", "region_code", "borough_code",
                        "ward_code", "parish_code", "constituency_code", "police_code", "msoa_code", "lsoa_code",
                        "source_release_id"), "postcode"),
    ("area_label", ("geography_id", "friendly_name", "postcode_district", "name_source_release_id",
                    "district_source_release_id"), "geography_id"),
    ("map_label", ("kind", "code", "label", "name", "postcodes", "lon", "lat", "source_release_id"), "kind, code"),
)
STREET_COLUMNS = ("id", "name", "locality", "postcode_district", "easting", "northing", "geography_id",
                  "borough_id", "source_release_id")
METRIC_COLUMNS = ("geography_id", "metric_id", "period", "value", "region_percentile", "sample_count", "quality",
                  "source_release_id")
RELEASE_COLUMNS = ("id", "source_url", "release_date", "sha256", "licence", "attribution",
                   "transformation_version", "geography_vintage", "validation_status", "caveats")


def copy_out(cur, out, table: str, columns, select: str, params=()) -> int:
    """Stream `select` from the ETL database into a COPY ... FROM stdin block; returns the row count."""
    out.write(f"COPY {table} ({', '.join(columns)}) FROM stdin WITH (FORMAT csv);\n")
    rows = 0
    with cur.copy(f"COPY ({select}) TO STDOUT WITH (FORMAT csv)", params) as copy:
        for chunk in copy:
            data = bytes(chunk)
            rows += data.count(b"\n")
            out.write(data.decode("utf-8"))
    out.write("\\.\n")
    return rows


def release_rows(cur, ids) -> list[dict]:
    cur.execute(f"SELECT {', '.join(RELEASE_COLUMNS)}, to_char(release_date, 'YYYY-MM-DD') AS day "
                "FROM source_release WHERE id = ANY(%s) ORDER BY id", (list(ids),))
    names = [d.name for d in cur.description]
    found = [dict(zip(names, row)) for row in cur.fetchall()]
    missing = set(ids) - {row["id"] for row in found}
    if missing:
        raise SystemExit(f"source releases missing on the ETL database: {sorted(missing)}")
    for row in found:
        row["release_date"] = row.pop("day")
    return found


def people(url: str, path: str) -> dict:
    import psycopg

    counts: dict[str, int] = {}
    metric_ids = {metric: old + etl_people_metrics.SUFFIX
                  for metric, (old, _p, _c) in etl_people_metrics.METRICS.items()}
    with psycopg.connect(url) as conn, conn.cursor() as cur, gzip.open(path, "wt", encoding="utf-8") as out:
        sources = {row[0] for table in ("area_census_count", "area_population", "area_settled", "civic_name",
                                        "postcode_civic")
                   for row in cur.execute(f"SELECT DISTINCT source_release_id FROM {table}")}
        sources |= {row[0] for row in cur.execute(
            "SELECT DISTINCT name_source_release_id FROM area_label UNION SELECT DISTINCT district_source_release_id "
            "FROM area_label UNION SELECT DISTINCT source_release_id FROM map_label")}
        sources |= {STREET_SOURCE, *metric_ids.values()}
        out.write("-- England people (branch england/d1-people). Apply with:\n"
                  "--   gunzip -c load.sql.gz | psql \"$DB\" -v ON_ERROR_STOP=1\n"
                  "BEGIN;\nSET client_min_messages = notice;\n"
                  "DO $$ BEGIN IF to_regclass('public.census_region_count') IS NULL THEN\n"
                  "  RAISE EXCEPTION 'apply deploy/migrations/107-england-people.sql first'; END IF;\n"
                  "  IF (SELECT count(*) FROM area_geography WHERE kind = 'lsoa') < 33755 THEN\n"
                  "  RAISE EXCEPTION 'load the England geography (bundles/core) first'; END IF; END $$;\n")
        for row in release_rows(cur, sorted(sources)):
            out.write(rb.source_release_sql(row).replace(", '2021', 'passed',",
                                                         f", {rb.literal(row['geography_vintage'])}, 'passed',") + "\n")
        out.write("DELETE FROM area_census_count;\nDELETE FROM census_region_count;\nDELETE FROM census_category;\n")
        for table, columns, order in WHOLE_TABLES:
            if table not in ("area_census_count", "census_region_count", "census_category"):
                out.write(f"DELETE FROM {table};\n")
            counts[table] = copy_out(cur, out, table, columns,
                                     f"SELECT {', '.join(columns)} FROM {table} ORDER BY {order}")
            print(f"{table}: {counts[table]}", flush=True)
        out.write(f"DELETE FROM street WHERE source_release_id = {rb.literal(STREET_SOURCE)};\n")
        counts["street"] = copy_out(cur, out, "street", STREET_COLUMNS,
                                    f"SELECT {', '.join(STREET_COLUMNS)} FROM street WHERE source_release_id = "
                                    f"{rb.literal(STREET_SOURCE)} ORDER BY id")
        print(f"street: {counts['street']}", flush=True)
        for metric, new_id in metric_ids.items():
            period = etl_people_metrics.METRICS[metric][1]
            # Every row of this metric and period, whichever release loaded it (the key is area, metric, period).
            out.write(f"DELETE FROM metric_value WHERE metric_id = {rb.literal(metric)} AND period = "
                      f"{rb.literal(period)};\n")
            counts[metric] = copy_out(cur, out, "metric_value", METRIC_COLUMNS,
                                      f"SELECT {', '.join(METRIC_COLUMNS)} FROM metric_value WHERE metric_id = "
                                      f"{rb.literal(metric)} AND source_release_id = {rb.literal(new_id)} "
                                      "ORDER BY geography_id")
            out.write(f"UPDATE metric_definition SET source_release_id = {rb.literal(new_id)} "
                      f"WHERE id = {rb.literal(metric)};\n")
            print(f"{metric}: {counts[metric]}", flush=True)
        out.write(rb.stage_sql("people-england", list(metric_ids.values()),
                               [old for old, _p, _c in etl_people_metrics.METRICS.values()]) + "\n")
        out.write("COMMIT;\n")
    return counts


def layers(url: str, path: str) -> dict:
    import psycopg

    metrics = list(etl_census_layers.METRIC_IDS)
    with psycopg.connect(url) as conn, conn.cursor() as cur, gzip.open(path, "wt", encoding="utf-8") as out:
        [row] = release_rows(cur, [LAYERS_LOCAL])
        row["id"] = LAYERS_ID
        out.write("-- England census map layers (branch england/d1-people). Apply after load.sql.gz with:\n"
                  "--   gunzip -c census-layers.sql.gz | psql \"$DB\" -v ON_ERROR_STOP=1\n"
                  "BEGIN;\nSET client_min_messages = notice;\n")
        out.write(rb.source_release_sql(row) + "\n")
        for metric, carrier, unit, direction, definition in cur.execute(
                "SELECT id, carrier, unit, direction, definition FROM metric_definition WHERE id = ANY(%s) ORDER BY id",
                (metrics,)).fetchall():
            out.write("INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)\n"
                      f"VALUES ({rb.literal(metric)}, {rb.literal(carrier)}, {rb.literal(unit)}, "
                      f"{rb.literal(direction)}, {rb.literal(json.dumps(definition))}::jsonb, {rb.literal(LAYERS_ID)})\n"
                      "ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,"
                      " source_release_id = EXCLUDED.source_release_id;\n")
        out.write(f"DELETE FROM metric_value WHERE metric_id = ANY({rb.text_array(metrics)})"
                  " OR source_release_id LIKE 'src-ons-census-2021-layers%';\n")
        columns = [c if c != "source_release_id" else rb.literal(LAYERS_ID) for c in METRIC_COLUMNS]
        rows = copy_out(cur, out, "metric_value", METRIC_COLUMNS,
                        f"SELECT {', '.join(columns)} FROM metric_value WHERE source_release_id = "
                        f"{rb.literal(LAYERS_LOCAL)} ORDER BY metric_id, geography_id")
        out.write(rb.stage_sql("census-layers-england", [LAYERS_ID], ["src-ons-census-2021-layers"]) + "\n")
        out.write("COMMIT;\n")
    print(f"census layers: {len(metrics)} metrics, {rows} rows", flush=True)
    return {"metric_definition": len(metrics), "metric_value": rows}


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] in ("people", "layers"):
        print(json.dumps({"people": people, "layers": layers}[sys.argv[1]](sys.argv[2], sys.argv[3])))
    else:
        sys.exit(__doc__)
