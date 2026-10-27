"""Production bundle for England's places (branch england/d5-places), built from the ETL database after the
loads of `etl.py run --theme places` ran there (the steps in etl_manifest.py).

  load.sql.gz  the unified `place` table for England (London in full, elsewhere confidence 0.6+), OSM
               stations, parks and amenities (place_station / place_park / place_amenity), the national
               FSA register (food_business), the `food-hygiene` and `supermarket-walk` layers for every
               English LSOA, their source releases, then a product release that replaces the London-only
               builds (and rebuilds area_rank: park distance).

One transaction (BEGIN ... COMMIT inside), idempotent: the five tables are replaced whole (TRUNCATE: their
old rows' space is freed at commit, and API reads of them wait for the few minutes the load takes), the two
metrics' rows and definitions are replaced. place_poi, overture_place and fsq_place stay as they are
(London): the API reads none of them once `place` is loaded. Apply after migrations 103-114 and the core
geography bundle:

  gunzip -c load.sql.gz | psql "$DB" -v ON_ERROR_STOP=1

  python3 etl_england_places_bundle.py <database-url> <out.sql.gz>
"""
from __future__ import annotations

import gzip
import json
import sys

import release_bundle as rb

# (table, ORDER BY): replaced whole on production; columns are read from the ETL database.
TABLES = (("place", "id"), ("place_station", "id"), ("place_park", "id"), ("place_amenity", "id"),
          ("food_business", "fhrs_id"))
METRICS = ("food-hygiene", "supermarket-walk")
METRIC_COLUMNS = ("geography_id", "metric_id", "period", "value", "region_percentile", "sample_count", "quality",
                  "source_release_id")
BREAKDOWN_COLUMNS = ("geography_id", "metric_id", "period", "category", "offence_count", "source_release_id")
RELEASE_COLUMNS = ("id", "source_url", "release_date", "sha256", "licence", "attribution",
                   "transformation_version", "geography_vintage", "validation_status", "caveats")
# Members of the active release the two layers replace (earlier builds of the same layers). The place
# tables are read without a release filter, so their releases are recorded but not made members.
REPLACES = ("src-fsa-fhrs-hygiene", "src-layer-supermarket-walk")


def copy_out(cur, out, table: str, columns, select: str) -> int:
    """Stream `select` from the ETL database into a COPY ... FROM stdin block; returns the row count."""
    out.write(f"COPY {table} ({', '.join(columns)}) FROM stdin WITH (FORMAT csv);\n")
    rows = 0
    with cur.copy(f"COPY ({select}) TO STDOUT WITH (FORMAT csv)") as copy:
        for chunk in copy:
            data = bytes(chunk)
            rows += data.count(b"\n")
            out.write(data.decode("utf-8"))
    out.write("\\.\n")
    return rows


def columns(cur, table: str) -> list[str]:
    return [row[0] for row in cur.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = %s "
        "ORDER BY ordinal_position", (table,))]


def unified_inputs(caveats: list[str]) -> list[str]:
    """The input source releases a unified build lists in its caveats ("Inputs: a, b, c, d. Records ...")."""
    for caveat in caveats:
        if caveat.startswith("Inputs: ") and ". Records kept" in caveat:
            return [part.strip() for part in caveat[len("Inputs: "):caveat.index(". Records kept")].split(",")]
    raise SystemExit("unified release without an Inputs caveat")


def release_rows(cur, ids) -> list[dict]:
    cur.execute(f"SELECT {', '.join(RELEASE_COLUMNS)}, to_char(release_date, 'YYYY-MM-DD') AS day "
                "FROM source_release WHERE id = ANY(%s) ORDER BY id", (sorted(ids),))
    names = [d.name for d in cur.description]
    found = [dict(zip(names, row)) for row in cur.fetchall()]
    missing = set(ids) - {row["id"] for row in found}
    if missing:
        raise SystemExit(f"source releases missing on the ETL database: {sorted(missing)}")
    for row in found:
        row["release_date"] = row.pop("day")
    return found


def single(cur, sql: str) -> str:
    found = [row[0] for row in cur.execute(sql) if row[0]]
    if len(found) != 1:
        raise SystemExit(f"expected one release from {sql!r}, found {found}")
    return found[0]


def bundle(url: str, path: str) -> dict:
    import psycopg

    counts: dict[str, int] = {}
    with psycopg.connect(url) as conn, conn.cursor() as cur, gzip.open(path, "wt", encoding="utf-8") as out:
        unified = single(cur, "SELECT DISTINCT source_release_id FROM place")
        [unified_row] = release_rows(cur, [unified])
        osm = single(cur, "SELECT DISTINCT source_release_id FROM place_amenity")
        fhrs = single(cur, "SELECT DISTINCT source_release_id FROM food_business")
        metric_sources = {metric: single(cur, f"SELECT source_release_id FROM metric_definition WHERE id = '{metric}'")
                          for metric in METRICS}
        tfl = {row[0] for row in cur.execute("SELECT DISTINCT tfl_source_release_id FROM place_station")} - {None}
        sources = {unified, osm, fhrs, *metric_sources.values(), *tfl, *unified_inputs(unified_row["caveats"])}
        out.write("-- England places (branch england/d5-places). Apply with:\n"
                  "--   gunzip -c load.sql.gz | psql \"$DB\" -v ON_ERROR_STOP=1\n"
                  "BEGIN;\nSET client_min_messages = notice;\n"
                  "DO $$ BEGIN IF (SELECT count(*) FROM area_geography WHERE kind = 'lsoa') < 33755 THEN\n"
                  "  RAISE EXCEPTION 'load the England geography (bundles/core) first'; END IF; END $$;\n")
        for row in release_rows(cur, sources):
            out.write(rb.source_release_sql(row).replace(", '2021', 'passed',",
                                                         f", {rb.literal(row['geography_vintage'])}, 'passed',") + "\n")
        for table, order in TABLES:
            names = columns(cur, table)
            out.write(f"TRUNCATE {table};\n")
            counts[table] = copy_out(cur, out, table, names, f"SELECT {', '.join(names)} FROM {table} ORDER BY {order}")
            print(f"{table}: {counts[table]}", flush=True)
        for metric in METRICS:
            carrier, unit, direction, definition = cur.execute(
                "SELECT carrier, unit, direction, definition FROM metric_definition WHERE id = %s", (metric,)).fetchone()
            source = metric_sources[metric]
            out.write("INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)\n"
                      f"VALUES ({rb.literal(metric)}, {rb.literal(carrier)}, {rb.literal(unit)}, {rb.literal(direction)}, "
                      f"{rb.literal(json.dumps(definition))}::jsonb, {rb.literal(source)})\n"
                      "ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,\n"
                      "  direction = EXCLUDED.direction, definition = EXCLUDED.definition,\n"
                      "  source_release_id = EXCLUDED.source_release_id;\n"
                      f"DELETE FROM metric_value_breakdown WHERE metric_id = {rb.literal(metric)};\n"
                      f"DELETE FROM metric_value WHERE metric_id = {rb.literal(metric)};\n")
            counts[metric] = copy_out(cur, out, "metric_value", METRIC_COLUMNS,
                                      f"SELECT {', '.join(METRIC_COLUMNS)} FROM metric_value "
                                      f"WHERE metric_id = {rb.literal(metric)} ORDER BY geography_id")
            counts[f"{metric} breakdown"] = copy_out(cur, out, "metric_value_breakdown", BREAKDOWN_COLUMNS,
                                                     f"SELECT {', '.join(BREAKDOWN_COLUMNS)} FROM metric_value_breakdown "
                                                     f"WHERE metric_id = {rb.literal(metric)} ORDER BY geography_id, category")
            print(f"{metric}: {counts[metric]}", flush=True)
        out.write(rb.stage_sql("places-england", sorted(metric_sources.values()), REPLACES) + "\n")
        out.write("COMMIT;\n")
    counts["sources"] = len(sources)
    return counts


if __name__ == "__main__":
    if len(sys.argv) == 3:
        print(json.dumps(bundle(sys.argv[1], sys.argv[2])))
    else:
        sys.exit(__doc__)
