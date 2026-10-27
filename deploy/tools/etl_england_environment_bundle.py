"""Production bundle for England's environment data (branch england/d6-environment), built from the ETL
database after `etl.py run --theme environment` ran there (the steps in etl_manifest.py).

  load.sql.gz, one transaction, idempotent (each part deletes the rows it owns, then copies them again):
    flood     area_flood and the flood-risk metric for every non-London area (england_flood.py)
    noise     area_noise and the noise layer for every non-London area (england_noise.py)
    air       health_air_lsoa for non-London LSOAs (Defra PCM 1 km, england_air.py), rebuild_area_health(),
              the air-no2 layer's non-London rows and its updated definition; skipped when not loaded
    sites     nature_site for all of England (Natural England LNR + SSSI), rebuild_area_nature(), and the
              nature-score layer's rows refreshed from area_nature (London edge areas may get a nearer site)
    roads     road_casualty and collision_casualty for every English district (STATS19 last 5 years),
              rebuild_area_kids(), the road-collisions metric for every English LSOA
  then stages and activates a release with the new sources, dropping the earlier STATS19 and nature-site
  builds (the national ones replace them). London's flood, noise and air rows stay as they are.

Apply after migrations 103-114 and the core bundle (England geography), and after the people bundle
(area_population for the road-collision rates):

  gunzip -c load.sql.gz | psql "$DB" -v ON_ERROR_STOP=1

  python3 etl_england_environment_bundle.py <database-url> <out.sql.gz>
"""
from __future__ import annotations

import gzip
import json
import sys

import england_air
import england_flood
import england_noise
import release_bundle as rb
from etl_england_people_bundle import copy_out, release_rows

LONDON = "E12000007"
STATS19_PROD_ID = "src-dft-stats19-2025-12-england"  # a fresh id on production, whatever revision the ETL used
METRIC_COLUMNS = ("geography_id", "metric_id", "period", "value", "region_percentile", "sample_count", "quality",
                  "source_release_id")
NOT_LONDON = (f"EXISTS (SELECT 1 FROM area_region r WHERE r.area_id = {{t}}.geography_id "
              f"AND r.region_code <> '{LONDON}')")


def not_london(alias: str) -> str:
    return NOT_LONDON.format(t=alias)


def definition_sql(cur, metric: str, source_id: str, update: bool) -> str:
    row = cur.execute("SELECT carrier, unit, direction, definition FROM metric_definition WHERE id = %s",
                      (metric,)).fetchone()
    if row is None:
        raise SystemExit(f"metric {metric} is not on the ETL database")
    carrier, unit, direction, definition = row
    conflict = ("DO UPDATE SET definition = EXCLUDED.definition" if update else "DO NOTHING")
    return ("INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)\n"
            f"VALUES ({rb.literal(metric)}, {rb.literal(carrier)}, {rb.literal(unit)}, {rb.literal(direction)}, "
            f"{rb.literal(json.dumps(definition))}::jsonb, {rb.literal(source_id)})\nON CONFLICT (id) {conflict};\n")


def one_release(cur, table: str, prefix: str, metric: str | None = None) -> str | None:
    """The one source release starting with `prefix` loaded in `table` (for metric_value, of `metric`)."""
    where = "" if metric is None else f" AND metric_id = {rb.literal(metric)}"
    found = sorted({row[0] for row in cur.execute(
        f"SELECT DISTINCT source_release_id FROM {table} WHERE source_release_id LIKE %s{where}", (prefix + "%",))})
    if len(found) > 1:
        raise SystemExit(f"{table}: more than one {prefix}* load on the ETL database: {found}")
    return found[0] if found else None


def area_rows(cur, out, counts, table: str, columns, release: str, order: str) -> None:
    out.write(f"DELETE FROM {table} t WHERE {not_london('t')};\n")
    counts[table] = copy_out(cur, out, table, columns,
                             f"SELECT {', '.join(columns)} FROM {table} WHERE source_release_id = "
                             f"{rb.literal(release)} ORDER BY {order}")


def metric_rows(cur, out, counts, metric: str, release: str, *, london_too: bool = False,
                rename: str | None = None) -> None:
    """Replace a metric's non-London rows (or every row) with the ETL database's rows of `release`."""
    where = "" if london_too else f" AND {not_london('v')}"
    out.write(f"DELETE FROM metric_value v WHERE v.metric_id = {rb.literal(metric)}{where};\n")
    columns = [c if c != "source_release_id" or rename is None else rb.literal(rename) for c in METRIC_COLUMNS]
    counts[f"metric_value:{metric}"] = copy_out(
        cur, out, "metric_value", METRIC_COLUMNS,
        f"SELECT {', '.join(columns)} FROM metric_value WHERE metric_id = {rb.literal(metric)} "
        f"AND source_release_id = {rb.literal(release)} ORDER BY geography_id")


def build(url: str, path: str) -> dict:
    import psycopg

    counts: dict[str, int] = {}
    with psycopg.connect(url) as conn, conn.cursor() as cur, gzip.open(path, "wt", encoding="utf-8") as out:
        flood = one_release(cur, "area_flood", england_flood.RELEASE_PREFIX)
        noise = one_release(cur, "area_noise", england_noise.RELEASE_ID)
        noise_layer = one_release(cur, "metric_value", england_noise.LAYER_PREFIX, "noise")
        air = one_release(cur, "health_air_lsoa", england_air.SOURCE_ID)
        air_layer = one_release(cur, "metric_value", england_air.LAYER_PREFIX, "air-no2")
        sites = one_release(cur, "nature_site", "src-ne-nature-sites-")
        roads = one_release(cur, "collision_casualty", "src-dft-stats19-")
        if not all((flood, noise, noise_layer, sites, roads)):
            raise SystemExit(f"missing loads: flood={flood} noise={noise} layer={noise_layer} sites={sites} roads={roads}")
        sources = [s for s in (flood, noise, noise_layer, air, air_layer, sites) if s]
        out.write("-- England environment (branch england/d6-environment). Apply with:\n"
                  "--   gunzip -c load.sql.gz | psql \"$DB\" -v ON_ERROR_STOP=1\n"
                  "BEGIN;\nSET client_min_messages = notice;\n"
                  "DO $$ BEGIN\n"
                  "  IF (SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public'\n"
                  "      AND table_name = 'area_nature' AND column_name = 'street_trees') <> 'YES' THEN\n"
                  "    RAISE EXCEPTION 'apply deploy/migrations/112-england-environment.sql first'; END IF;\n"
                  "  IF (SELECT count(*) FROM area_geography WHERE kind = 'lsoa') < 33755 THEN\n"
                  "    RAISE EXCEPTION 'load the England geography (bundles/core) first'; END IF;\n"
                  "  IF (SELECT count(*) FROM area_population p JOIN area_geography g ON g.id = p.geography_id\n"
                  "      AND g.kind = 'lsoa') < 33755 THEN\n"
                  "    RAISE EXCEPTION 'load the England people bundle (area_population) first'; END IF;\n"
                  "END $$;\n")
        for row in release_rows(cur, sorted(sources)):
            out.write(rb.source_release_sql(row) + "\n")
        [stats19] = release_rows(cur, [roads])
        stats19["id"] = STATS19_PROD_ID
        out.write(rb.source_release_sql(stats19) + "\n")

        # Flood: areas and the homes-at-risk metric outside London.
        area_rows(cur, out, counts, "area_flood",
                  ("geography_id", "source", "area_m2", "low_m2", "medium_m2", "high_m2", "source_release_id"),
                  flood, "geography_id, source")
        out.write(definition_sql(cur, "flood-risk", flood, update=False))
        metric_rows(cur, out, counts, "flood-risk", flood)

        # Noise: areas and the noise layer outside London.
        area_rows(cur, out, counts, "area_noise",
                  ("geography_id", "dwellings", "road_55_share", "rail_55_share", "air_55_share", "any_55_share",
                   "any_65_share", "road_lden_median", "road_lden_mapped_share", "source_release_id"),
                  noise, "geography_id")
        out.write(definition_sql(cur, "noise", noise_layer, update=False))
        metric_rows(cur, out, counts, "noise", noise_layer)

        # Air (Defra PCM 1 km) outside London, when it was loaded.
        if air and air_layer:
            area_rows(cur, out, counts, "health_air_lsoa",
                      ("geography_id", "dwellings", "no2", "pm25", "year", "source_release_id"), air, "geography_id")
            out.write("SELECT rebuild_area_health() AS area_health_rows;\n")
            out.write(definition_sql(cur, "air-no2", air_layer, update=True))
            metric_rows(cur, out, counts, "air-no2", air_layer)

        # Nature sites: all of England, then area_nature and the nature-score layer from it.
        out.write("DELETE FROM nature_site;\n")
        counts["nature_site"] = copy_out(cur, out, "nature_site", ("id", "kind", "name", "geometry", "source_release_id"),
                                         "SELECT id, kind, name, geometry, source_release_id FROM nature_site ORDER BY id")
        out.write("SELECT rebuild_area_nature() AS area_nature_rows;\n"
                  "UPDATE metric_value v SET value = n.nature_percentile, region_percentile = n.nature_percentile,\n"
                  "  quality = CASE WHEN n.nature_percentile IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality\n"
                  "FROM area_nature n WHERE v.metric_id = 'nature-score' AND v.geography_id = n.geography_id\n"
                  "  AND v.value IS DISTINCT FROM n.nature_percentile::float8;\n")

        # STATS19: every English district, area_kids and the road-collisions metric for every LSOA.
        out.write("TRUNCATE road_casualty, collision_casualty;\n")
        counts["road_casualty"] = copy_out(
            cur, out, "road_casualty", ("collision_index", "casualty_reference", "year", "severity", "road_user", "child",
                                        "location", "source_release_id"),
            "SELECT collision_index, casualty_reference, year, severity, road_user, child, location, "
            f"{rb.literal(STATS19_PROD_ID)} FROM road_casualty ORDER BY collision_index, casualty_reference")
        counts["collision_casualty"] = copy_out(
            cur, out, "collision_casualty", ("collision_index", "casualty_reference", "year", "severity", "road_user",
                                             "child", "age_band", "dark", "location", "source_release_id"),
            "SELECT collision_index, casualty_reference, year, severity, road_user, child, age_band, dark, location, "
            f"{rb.literal(STATS19_PROD_ID)} FROM collision_casualty ORDER BY collision_index, casualty_reference")
        out.write("SELECT rebuild_area_kids() AS area_kids_rows;\n")
        out.write(definition_sql(cur, "road-collisions", STATS19_PROD_ID, update=True).replace(
            "DO UPDATE SET definition = EXCLUDED.definition",
            "DO UPDATE SET definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id"))
        metric_rows(cur, out, counts, "road-collisions", roads, london_too=True, rename=STATS19_PROD_ID)

        out.write(rb.stage_sql("environment-england", [*sources, STATS19_PROD_ID],
                               ["src-dft-stats19", "src-ne-nature-sites"]) + "\n")
        out.write("COMMIT;\n")
    for key, value in counts.items():
        print(f"{key}: {value}", flush=True)
    return {"counts": counts, "sources": [*sources, STATS19_PROD_ID]}


if __name__ == "__main__":
    if len(sys.argv) == 3:
        print(json.dumps(build(sys.argv[1], sys.argv[2])))
    else:
        sys.exit(__doc__)
