"""Production bundle for England's civic and services data (branch england/d7-civic), built from the ETL
database after `etl.py run --theme civic` ran there (the steps in etl_manifest.py).

  load.sql.gz   council tax with precepts (council_tax), councillors and MPs (representative), GP practices
                (gp_practice), Ofcom broadband and mobile (area_broadband, area_mobile), Article 4 directions
                and their coverage, listed buildings, and planning.data.gov.uk conservation areas outside London;
                then, on production itself, the derived tables and layers are rebuilt from those rows and
                production's own London-only inputs (air, heat, ULEZ, Planning London Datahub):
                rebuild_area_health, rebuild_area_restriction, rebuild_area_location (production's planning
                window), rebuild_area_mobile_metrics, rebuild_gp_walk, rebuild_broadband_gigabit; and a product
                release is staged that replaces the London-only releases of the same sources.

One transaction (BEGIN ... COMMIT inside), idempotent: the tables above are this load's own and replaced whole,
except conservation_area, where only the planning.data.gov.uk rows (`pd:`/`pdo:`) are replaced (the GLA's
London areas stay). Apply after migrations 103-114 and the core bundle:

  gunzip -c load.sql.gz | psql "$DB" -v ON_ERROR_STOP=1

  python3 etl_england_civic_bundle.py <database-url> <out.sql.gz>
"""
from __future__ import annotations

import gzip
import json
import sys

import release_bundle as rb
from etl_england_people_bundle import copy_out, release_rows

# (table, columns, WHERE, ORDER BY): replaced whole on production (WHERE picks this load's rows).
TABLES = (
    ("council_tax", ("borough_code", "financial_year", "band_d_borough", "band_d_gla", "band_a", "band_b", "band_c",
                     "band_d", "band_e", "band_f", "band_g", "band_h", "band_d_county", "band_d_police", "band_d_fire",
                     "band_d_combined_authority", "band_d_parish", "source_release_id"), None, "borough_code"),
    ("representative", ("role", "area_code", "name", "party", "elected_on", "profile_url", "fetched_on",
                        "source_release_id"), None, "role, area_code, name"),
    ("gp_practice", ("code", "postcode", "location", "patients", "gp_fte", "month", "source_release_id"), None, "code"),
    ("area_broadband", ("geography_id", "premises", "gigabit_premises", "full_fibre_share", "source_release_id"), None,
     "geography_id"),
    ("area_mobile", ("geography_id", "premises", "outdoor_4g_all_mno", "indoor_4g_all_mno", "outdoor_5g_any",
                     "outdoor_5g_all", "source_release_id"), None, "geography_id"),
    ("article4_area", ("id", "name", "reference", "borough_code", "householder", "geom", "source_release_id"), None,
     "id"),
    ("article4_coverage", ("borough_code", "areas", "source_release_id"), None, "borough_code"),
    ("listed_building", ("id", "name", "grade", "location", "source_release_id"), None, "id"),
    ("conservation_area", ("id", "name", "borough", "geom", "source_release_id"), "id ~ '^pdo?:'", "id"),
)
# Earlier (London-only) builds of the same sources: dropped from the product release.
REPLACES = ("src-mhclg-council-tax-2026-27", "src-democracy-club-", "src-uk-parliament-members-", "src-nhs-gp-",
            "src-ofcom-connected-nations-2026-spring", "src-ofcom-mobile-2026-spring", "src-planning-data-article4",
            "src-historic-england-listed", "src-layer-gp-walk-", "src-layer-broadband-gigabit-")
LAYER_METRICS = {"gp-walk": "rebuild_gp_walk", "broadband-gigabit": "rebuild_broadband_gigabit"}


def one(cur, sql: str, params=()):
    row = cur.execute(sql, params).fetchone()
    if row is None or row[0] is None:
        raise SystemExit(f"nothing for: {sql}")
    return row[0]


def build(url: str, path: str) -> dict:
    import psycopg

    counts: dict[str, int] = {}
    with psycopg.connect(url) as conn, conn.cursor() as cur, gzip.open(path, "wt", encoding="utf-8") as out:
        sources: set[str] = set()
        for table, _columns, where, _order in TABLES:
            sources |= {row[0] for row in cur.execute(
                f"SELECT DISTINCT source_release_id FROM {table}" + (f" WHERE {where}" if where else ""))}
        mobile = one(cur, "SELECT min(source_release_id) FROM area_mobile")
        mobile_period = one(cur, "SELECT to_char(min(period), 'YYYY-MM-DD') FROM metric_value WHERE metric_id = "
                                 "'mobile-4g-indoor' AND source_release_id = %s", (mobile,))
        layers = {metric: one(cur, "SELECT source_release_id FROM metric_definition WHERE id = %s", (metric,))
                  for metric in LAYER_METRICS}
        sources |= set(layers.values())
        out.write("-- England civic and services (branch england/d7-civic). Apply with:\n"
                  "--   gunzip -c load.sql.gz | psql \"$DB\" -v ON_ERROR_STOP=1\n"
                  "BEGIN;\nSET client_min_messages = notice;\n"
                  "DO $$ BEGIN\n"
                  "  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'council_tax'\n"
                  "                 AND column_name = 'band_d_county') THEN\n"
                  "    RAISE EXCEPTION 'apply deploy/migrations/113-england-civic.sql first'; END IF;\n"
                  "  IF (SELECT count(*) FROM area_geography WHERE kind = 'lsoa') < 33755 THEN\n"
                  "    RAISE EXCEPTION 'load the England geography (bundles/core) first'; END IF;\n"
                  "  IF NOT EXISTS (SELECT 1 FROM area_location) THEN\n"
                  "    RAISE EXCEPTION 'area_location is empty: the planning window is read from it'; END IF;\n"
                  "END $$;\n")
        for row in release_rows(cur, sorted(sources)):
            out.write(rb.source_release_sql(row).replace(", '2021', 'passed',",
                                                         f", {rb.literal(row['geography_vintage'])}, 'passed',") + "\n")
        out.write("DELETE FROM area_conservation;\n")  # rebuilt below; its rows cite conservation areas
        for table, columns, where, order in TABLES:
            out.write(f"DELETE FROM {table}" + (f" WHERE {where}" if where else "") + ";\n")
            counts[table] = copy_out(cur, out, table, columns,
                                     f"SELECT {', '.join(columns)} FROM {table}" + (f" WHERE {where}" if where else "")
                                     + f" ORDER BY {order}")
            print(f"{table}: {counts[table]}", flush=True)
        out.write("ANALYZE gp_practice;\nANALYZE listed_building;\nANALYZE conservation_area;\nANALYZE article4_area;\n"
                  "SELECT rebuild_area_health();\n"
                  "SELECT rebuild_area_restriction();\n"
                  "DO $$ DECLARE s date; e date; BEGIN\n"
                  "  SELECT planning_window_start, planning_window_end INTO s, e FROM area_location LIMIT 1;\n"
                  "  PERFORM rebuild_area_location(s, e);\nEND $$;\n"
                  f"SELECT rebuild_area_mobile_metrics({rb.literal(mobile)}, {rb.literal(mobile_period)}::date);\n")
        for metric, function in LAYER_METRICS.items():
            out.write(f"SELECT {function}({rb.literal(layers[metric])});\n")
        out.write(rb.stage_sql("civic-england", sorted(sources), REPLACES) + "\n")
        out.write("COMMIT;\n")
    counts["sources"] = len(sources)
    return counts


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(json.dumps(build(sys.argv[1], sys.argv[2])))
