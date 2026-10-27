"""A data load as one psql script (a "bundle"), for production, whose host has no psycopg.

Loaders build their rows locally (where the raw files and a full database are), then write a
`load.sql.gz` that production applies in one transaction:

  gunzip -c load.sql.gz | psql "$DB" -v ON_ERROR_STOP=1 --single-transaction

The script inserts its source releases (immutable: ON CONFLICT DO NOTHING), replaces the rows
it owns, and stages + activates a product release in SQL, the same steps as stage_release.stage().
"""
from __future__ import annotations

import csv
import gzip
import io
import json
from collections.abc import Iterable, Sequence


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    return "'" + str(value).replace("'", "''") + "'"


def text_array(values: Iterable[str]) -> str:
    return "ARRAY[" + ", ".join(literal(v) for v in values) + "]::text[]"


def source_release_sql(row: dict) -> str:
    """Insert one source release (keys as the table's columns); a rerun keeps the stored one."""
    return (
        "INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,\n"
        "  transformation_version, geography_vintage, validation_status, caveats)\n"
        f"VALUES ({literal(row['id'])}, {literal(row['source_url'])}, now(), {literal(row['release_date'])}, "
        f"{literal(row['sha256'])}, {literal(row['licence'])}, {literal(row['attribution'])}, "
        f"{literal(row['transformation_version'])}, '2021', 'passed', {text_array(row['caveats'])})\n"
        "ON CONFLICT (id) DO NOTHING;")


def copy_sql(table: str, columns: Sequence[str], rows: Iterable[Sequence]) -> str:
    """A COPY ... FROM stdin block (CSV; None is an empty, unquoted field = NULL)."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    for row in rows:
        writer.writerow(["" if value is None else value for value in row])
    return f"COPY {table} ({', '.join(columns)}) FROM stdin WITH (FORMAT csv);\n{buffer.getvalue()}\\."


def metric_sql(metric_id: str, carrier: str, unit: str, direction: str, definition: dict, source_id: str,
               values: Iterable[Sequence]) -> str:
    """Replace one metric: its definition and every value. `values` rows are
    (geography_id, period, value, region_percentile, sample_count, quality)."""
    head = (
        "INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)\n"
        f"VALUES ({literal(metric_id)}, {literal(carrier)}, {literal(unit)}, {literal(direction)}, "
        f"{literal(json.dumps(definition))}::jsonb, {literal(source_id)})\n"
        "ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit, direction = EXCLUDED.direction,\n"
        "  definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id;\n"
        f"DELETE FROM metric_value WHERE metric_id = {literal(metric_id)};")
    rows = ((gid, metric_id, period, value, pct, count, quality, source_id)
            for gid, period, value, pct, count, quality in values)
    return head + "\n" + copy_sql("metric_value", ("geography_id", "metric_id", "period", "value", "region_percentile",
                                                   "sample_count", "quality", "source_release_id"), rows)


def stage_sql(label: str, sources: Sequence[str], replace_prefixes: Sequence[str] = ()) -> str:
    """Stage and activate a release = the active one + `sources`, dropping members that start with a
    prefix in `replace_prefixes` (earlier builds of the same data) unless named in `sources`.
    Rebuilds the derived tables stage_release.stage() rebuilds. Does nothing when the active release
    already holds every source and no member would be dropped (a rerun)."""
    return f"""DO $stage$
DECLARE
    active text;
    base product_release%ROWTYPE;
    added text[] := {text_array(sources)};
    dropped text[];
    rel text := 'rel-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI') || {literal('-' + label)};
BEGIN
    SELECT release_id INTO active FROM active_product_release;
    SELECT * INTO base FROM product_release WHERE id = active;
    IF (SELECT count(*) FROM source_release WHERE id = ANY(added)) <> cardinality(added) THEN
        RAISE EXCEPTION 'unknown source releases in %', added;
    END IF;
    SELECT coalesce(array_agg(source_release_id), '{{}}') INTO dropped FROM product_release_member
    WHERE release_id = active AND source_release_id <> ALL(added)
      AND source_release_id LIKE ANY({text_array(p + '%' for p in replace_prefixes)});
    IF cardinality(dropped) = 0 AND NOT EXISTS (
        SELECT unnest(added) EXCEPT SELECT source_release_id FROM product_release_member WHERE release_id = active) THEN
        RAISE NOTICE 'the active release % already holds %', active, added;
        RETURN;
    END IF;
    INSERT INTO product_release (id, geography_vintage, transformation_versions, assets, validation_status,
                                 validation_record)
    VALUES (rel, base.geography_vintage, base.transformation_versions, base.assets, 'passed',
            jsonb_build_object('supersedes', active, 'added', to_jsonb(added), 'replaced', to_jsonb(dropped)));
    INSERT INTO product_release_member (release_id, source_release_id)
    SELECT rel, source_release_id FROM product_release_member
    WHERE release_id = active AND source_release_id <> ALL(dropped)
    UNION SELECT rel, unnest(added);
    IF to_regproc('public.rebuild_area_rank') IS NOT NULL THEN PERFORM rebuild_area_rank(); END IF;
    IF to_regproc('public.rebuild_area_good_value') IS NOT NULL THEN PERFORM rebuild_area_good_value(); END IF;
    PERFORM activate_product_release(rel);
    RAISE NOTICE 'activated % (+ %, - %)', rel, added, dropped;
END
$stage$;"""


def write(path: str, parts: Iterable[str]) -> str:
    """Write the parts as one gzipped psql script; returns the path."""
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        handle.write("-- Apply with: gunzip -c <this file> | psql \"$DB\" -v ON_ERROR_STOP=1 --single-transaction\n")
        handle.write("SET client_min_messages = notice;\n")
        for part in parts:
            handle.write(part.rstrip("\n") + "\n")
    return path
