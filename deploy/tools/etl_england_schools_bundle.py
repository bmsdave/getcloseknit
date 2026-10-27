"""England schools for production as one psql script (branch england/d4-schools, migration 110).

Built from the ETL database after the England school loads (`etl.py run --theme schools`); production
applies it in one transaction, after migrations 103-114 and the core geography bundle:

  gunzip -c load.sql.gz | psql "$DB" -v ON_ERROR_STOP=1

What it does, idempotently:
  * source releases behind every row it copies (ON CONFLICT DO NOTHING: releases are immutable);
  * `school`: England's schools are inserted; a school production already holds is left as it is
    (London's rows and their attributes stay exactly as they were); predecessor/successor links are set
    where production has none;
  * history by source release (delete that release's rows, copy them again, London's included):
    school_observation, school_national_rank, school_sixth_form_rank, school_admission_demand;
    school_inspection is upserted (report text extracted on production is kept) and rows of its releases
    that the bundle does not hold are deleted;
  * whole tables the loaders replace: school_profile, school_finance, school_workforce, school_destination,
    school_parent_view, independent_school, nursery_setting (place_id matched again on production),
    road_casualty, collision_casualty, cycle_lane; then rebuild_area_kids() and the `road-collisions` metric;
  * good-schools-nearby is rebuilt for every LSOA when production has that layer (migration 100);
  * one product release adds the new sources and drops the earlier GIAS profile / independent / Kids builds.
London-only school tables are untouched: school_admission_observation (council tables), school_priority_area,
school_feeder_flow (GLA London Schools Atlas).

  .ae-venv/bin/python deploy/tools/etl_england_schools_bundle.py <etl-db-url> <out.sql.gz>
"""
from __future__ import annotations

import gzip
import sys

import release_bundle as rb

# Release prefixes whose earlier builds the new release replaces (their loaders replace the whole table).
REPLACED = ("src-gias-profile-", "src-gias-independent-", "src-ofsted-early-years-", "src-dft-stats19-",
            "src-tfl-cycle-infrastructure-")
SCHOOL_COLUMNS = ("urn", "school_id", "name", "phase", "attributes", "location", "source_release_id")
BY_RELEASE = ("school_observation", "school_national_rank", "school_sixth_form_rank", "school_admission_demand")
WHOLE = ("school_profile", "school_finance", "school_workforce", "school_destination", "school_parent_view",
         "independent_school", "nursery_setting", "road_casualty", "collision_casualty", "cycle_lane")
# Columns production fills itself: region_code (migration 110 trigger); a nursery's map place (ids differ).
SKIP = {"region_code", "place_id"}
INSPECTION_TEXT = ("improve_text", "key_findings", "text_extracted_at")
COLLISION_METRIC = "road-collisions"
METRIC_COLUMNS = ("geography_id", "metric_id", "period", "value", "region_percentile", "sample_count", "quality",
                  "source_release_id")
PLACE_MATCH_SQL = """UPDATE nursery_setting n SET place_id = m.id FROM (
  SELECT DISTINCT ON (n2.urn) n2.urn, p.id
  FROM nursery_setting n2 JOIN place p
    ON p.category IN ('childcare', 'kindergarten')
   AND ST_DWithin(ST_Transform(p.location, 27700), n2.location, 100)
   AND similarity(lower(p.name), lower(n2.name)) >= 0.4
  ORDER BY n2.urn, similarity(lower(p.name), lower(n2.name)) DESC) m
WHERE m.urn = n.urn;"""
GOOD_SCHOOLS_SQL = """DO $gsn$
DECLARE layer text;
BEGIN
    SELECT member.source_release_id INTO layer FROM product_release_member member
    WHERE member.release_id = (SELECT release_id FROM active_product_release)
      AND member.source_release_id LIKE 'src-layer-good-schools-nearby-%' ORDER BY 1 DESC LIMIT 1;
    IF layer IS NOT NULL AND to_regproc('public.rebuild_good_schools_nearby') IS NOT NULL THEN
        RAISE NOTICE 'good-schools-nearby: % rows (%)', rebuild_good_schools_nearby(layer), layer;
    END IF;
END
$gsn$;"""


def columns(cur, table: str) -> list[str]:
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' "
                "AND table_name = %s ORDER BY ordinal_position", (table,))
    return [row[0] for row in cur.fetchall() if row[0] not in SKIP]


def copy_out(cur, out, table: str, cols, select: str, params=()) -> int:
    out.write(f"COPY {table} ({', '.join(cols)}) FROM stdin WITH (FORMAT csv);\n")
    with cur.copy(f"COPY ({select}) TO STDOUT WITH (FORMAT csv)", params) as copy:
        for chunk in copy:
            out.write(bytes(chunk).decode("utf-8"))
    out.write("\\.\n")
    return cur.rowcount  # rows, not lines: inspection text holds newlines


def release_ids(cur, table: str) -> list[str]:
    cur.execute(f"SELECT DISTINCT source_release_id FROM {table} ORDER BY 1")
    return [row[0] for row in cur.fetchall()]


def build(url: str, path: str) -> dict:
    import psycopg

    from etl_england_people_bundle import release_rows

    counts: dict[str, int] = {}
    with psycopg.connect(url) as conn, conn.cursor() as cur, gzip.open(path, "wt", encoding="utf-8") as out:
        sources: set[str] = set()
        for table in ("school", "school_inspection", *BY_RELEASE, *WHOLE):
            sources.update(release_ids(cur, table))
        cur.execute("SELECT DISTINCT o->>'sourceRelease' FROM school, jsonb_array_elements(attributes->'observations') o "
                    "WHERE o ? 'sourceRelease'")
        sources.update(row[0] for row in cur.fetchall())
        cur.execute("SELECT source_release_id FROM metric_definition WHERE id = %s", (COLLISION_METRIC,))
        collision_source = cur.fetchone()[0]
        sources.add(collision_source)
        out.write("-- England schools (branch england/d4-schools). Apply with:\n"
                  "--   gunzip -c load.sql.gz | psql \"$DB\" -v ON_ERROR_STOP=1\n"
                  "BEGIN;\nSET client_min_messages = notice;\n"
                  "DO $$ BEGIN\n"
                  "  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'school'\n"
                  "                 AND column_name = 'region_code') THEN\n"
                  "    RAISE EXCEPTION 'apply deploy/migrations/110-england-schools.sql first'; END IF;\n"
                  "  IF to_regclass('public.independent_school') IS NULL OR to_regclass('public.school_sixth_form_rank') IS NULL\n"
                  "    THEN RAISE EXCEPTION 'apply migrations 067 and 094 first'; END IF;\n"
                  "  IF (SELECT count(*) FROM area_geography WHERE kind = 'lad') < 296 THEN\n"
                  "    RAISE EXCEPTION 'load the England geography (bundles/core) first'; END IF;\n"
                  "END $$;\n")
        for row in release_rows(cur, sorted(sources)):
            out.write(rb.source_release_sql(row).replace(", '2021', 'passed',",
                                                         f", {rb.literal(row['geography_vintage'])}, 'passed',") + "\n")

        # school: new schools only; links where production has none.
        out.write(f"CREATE TEMP TABLE bundle_school ({', '.join(f'{c} text' for c in SCHOOL_COLUMNS)}, "
                  "predecessor_urn text, successor_urn text) ON COMMIT DROP;\n")
        counts["school"] = copy_out(cur, out, "bundle_school", (*SCHOOL_COLUMNS, "predecessor_urn", "successor_urn"),
                                    f"SELECT {', '.join(SCHOOL_COLUMNS)}, predecessor_urn, successor_urn FROM school "
                                    "ORDER BY urn")
        out.write(f"INSERT INTO school ({', '.join(SCHOOL_COLUMNS)})\n"
                  "SELECT urn, school_id, name, phase, attributes::jsonb, location::geometry, source_release_id\n"
                  "FROM bundle_school ON CONFLICT (urn) DO NOTHING;\n"
                  "UPDATE school s SET predecessor_urn = b.predecessor_urn FROM bundle_school b\n"
                  "WHERE s.urn = b.urn AND s.predecessor_urn IS NULL AND b.predecessor_urn IS NOT NULL\n"
                  "  AND EXISTS (SELECT 1 FROM school p WHERE p.urn = b.predecessor_urn);\n"
                  "UPDATE school s SET successor_urn = b.successor_urn FROM bundle_school b\n"
                  "WHERE s.urn = b.urn AND s.successor_urn IS NULL AND b.successor_urn IS NOT NULL\n"
                  "  AND EXISTS (SELECT 1 FROM school p WHERE p.urn = b.successor_urn);\n")

        for table in BY_RELEASE:
            ids = release_ids(cur, table)
            cols = columns(cur, table)
            out.write(f"DELETE FROM {table} WHERE source_release_id = ANY({rb.text_array(ids)});\n")
            counts[table] = copy_out(cur, out, table, cols, f"SELECT {', '.join(cols)} FROM {table} ORDER BY 1, 2, 3")
            print(f"{table}: {counts[table]}", flush=True)

        # school_inspection: upsert, keeping report text production extracted.
        cols = columns(cur, "school_inspection")
        ids = release_ids(cur, "school_inspection")
        out.write("CREATE TEMP TABLE bundle_inspection (LIKE school_inspection) ON COMMIT DROP;\n")
        counts["school_inspection"] = copy_out(cur, out, "bundle_inspection", cols,
                                               f"SELECT {', '.join(cols)} FROM school_inspection ORDER BY urn, inspection_number")
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ("urn", "inspection_number", *INSPECTION_TEXT))
        keep = ", ".join(f"{c} = coalesce(school_inspection.{c}, EXCLUDED.{c})" for c in INSPECTION_TEXT)
        out.write(f"INSERT INTO school_inspection ({', '.join(cols)}) SELECT {', '.join(cols)} FROM bundle_inspection\n"
                  f"ON CONFLICT (urn, inspection_number) DO UPDATE SET {updates}, {keep};\n"
                  f"DELETE FROM school_inspection s WHERE s.source_release_id = ANY({rb.text_array(ids)})\n"
                  "  AND NOT EXISTS (SELECT 1 FROM bundle_inspection b WHERE b.urn = s.urn\n"
                  "                  AND b.inspection_number = s.inspection_number);\n")

        for table in WHOLE:
            cols = columns(cur, table)
            out.write(f"DELETE FROM {table};\n")
            counts[table] = copy_out(cur, out, table, cols, f"SELECT {', '.join(cols)} FROM {table} ORDER BY 1")
            print(f"{table}: {counts[table]}", flush=True)
        out.write(PLACE_MATCH_SQL + "\nSELECT rebuild_area_kids() AS area_kids_rows;\n")

        cur.execute("SELECT carrier, unit, direction, definition::text FROM metric_definition WHERE id = %s",
                    (COLLISION_METRIC,))
        carrier, unit, direction, definition = cur.fetchone()
        out.write("INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)\n"
                  f"VALUES ({rb.literal(COLLISION_METRIC)}, {rb.literal(carrier)}, {rb.literal(unit)}, "
                  f"{rb.literal(direction)}, {rb.literal(definition)}::jsonb, {rb.literal(collision_source)})\n"
                  "ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit, direction = "
                  "EXCLUDED.direction,\n  definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id;\n"
                  f"DELETE FROM metric_value WHERE metric_id = {rb.literal(COLLISION_METRIC)};\n")
        counts[COLLISION_METRIC] = copy_out(
            cur, out, "metric_value", METRIC_COLUMNS,
            f"SELECT {', '.join(METRIC_COLUMNS)} FROM metric_value WHERE metric_id = %s ORDER BY geography_id",
            (COLLISION_METRIC,))
        out.write(GOOD_SCHOOLS_SQL + "\n")
        # The release adds what the ETL database's active release holds (a superseded source a school's attributes
        # still cite, e.g. src-dfe-ks2-2024-25-revised, stays out).
        cur.execute("SELECT source_release_id FROM product_release_member "
                    "WHERE release_id = (SELECT release_id FROM active_product_release)")
        added = sorted(sources & {row[0] for row in cur.fetchall()})
        out.write(rb.stage_sql("schools-england", added, REPLACED) + "\n")
        out.write("COMMIT;\n")
    counts["sources"] = len(sources)
    counts["staged"] = len(added)
    return counts


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    print(build(sys.argv[1], sys.argv[2]))
