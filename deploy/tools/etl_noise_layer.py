"""The `noise` map layer: each LSOA's share of homes at 55 dB Lden or more from road, rail or aircraft.

Reads `area_noise` (etl_noise.py load, migration 009: Defra strategic noise mapping Round 4,
2022; air-inclusive loads carry Defra airport noise) and writes it as a map metric, the figure
the area card's Noise section already shows:

  metric_value  noise: % of the LSOA's homes whose louder of road, rail and aircraft is
                55 dB Lden or more (sample = homes with a point; suppressed below MIN_DWELLINGS)

under its own source release `src-defra-noise-layer-*` (OGL v3), then a product release that
replaces any earlier build is staged and activated. LSOAs only. Run after etl_noise.py load.

  python3 etl_noise_layer.py load <database-url>      (needs psycopg; a few seconds)
  python3 etl_noise_layer.py sql <database-url> <out.sql.gz>
        the same load as a psql bundle for production (release_bundle.py), built from this
        database's area_noise; the bundle refuses a database holding another Defra load
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
from collections.abc import Mapping

import area_coverage as coverage
import crime_rates as cr

METRIC_ID = "noise"
SOURCE_PREFIX = "src-defra-noise-layer"
ETL_VERSION = "close-knit-noise-layer-1"
PERIOD = "2022-12-01"  # Round 4 models 2022
MIN_DWELLINGS = 10  # fewer homes with a point than this: suppressed, no share
# Quiet green to loud red (higher is more noise), fixed so a reload never moves the scale.
# Mirrors web/src/lib/fixtures.ts.
LEGEND = [
    {"value": 0, "colour": "#3a7d44", "label": "0%"},
    {"value": 10, "colour": "#7ba05b", "label": "10%"},
    {"value": 25, "colour": "#f4d35e", "label": "25%"},
    {"value": 45, "colour": "#c96a3b", "label": "45%"},
    {"value": 70, "colour": "#b23a48", "label": "70%+"},
]

ROWS_SQL = """
SELECT n.geography_id, n.dwellings, n.any_55_share
FROM area_noise n JOIN area_geography g ON g.id = n.geography_id AND g.kind = 'lsoa'
ORDER BY n.geography_id"""


def share(dwellings: int, any_55_share: float | None) -> float | None:
    """Percentage of homes at 55 dB Lden or more, one decimal; None below MIN_DWELLINGS."""
    if dwellings < MIN_DWELLINGS or any_55_share is None:
        return None
    return round(100 * float(any_55_share), 1)


def aggregate(rows: Mapping[str, tuple[int, float | None]], period: str = PERIOD,
              regions: Mapping[str, str | None] | None = None) -> list[list]:
    """metric_value rows from {lsoa id: (dwellings, any_55_share 0..1)}, ranked within each LSOA's
    region (`regions`: id -> region code; without it every row ranks together, London's old rule)."""
    shares = {gid: share(dwellings, value) for gid, (dwellings, value) in rows.items()}
    pct = coverage.regional_percentiles(shares, regions or {}, rank=cr.ascending_percentiles)
    values = []
    for gid in sorted(rows):
        dwellings = rows[gid][0]
        if shares[gid] is None:
            values.append([gid, METRIC_ID, period, "", "", dwellings, "suppressed"])
        else:
            values.append([gid, METRIC_ID, period, shares[gid], pct[gid], dwellings, "observed"])
    return values


def definition() -> dict:
    return {
        "label": "Road, rail and aircraft noise", "shortLabel": "Noise",
        "description": ("Share of the area's homes where modelled road, rail or aircraft noise reaches "
                        "55 dB Lden or more (Defra strategic noise mapping, 2022; airport noise where the "
                        "Defra load includes it, e.g. src-defra-noise-round4-2022-road-rail-air)."),
        "legend": LEGEND,
        "sourceId": "defra-noise", "sourceName": "Defra strategic noise mapping (Round 4)",
        "methodologyPath": "/guide/noise", "freshness": "2022-12",
        "caveats": [
            "Modelled annual averages at 4 m above ground on a 10 m grid, not measurements.",
            "Levels under 40 dB Lden are not mapped.",
            "Aircraft noise is included when the Defra load carries it (the released "
            "src-defra-noise-round4-2022-road-rail-air does); road-and-rail-only loads exclude it.",
            f"Areas with fewer than {MIN_DWELLINGS} homes with a point show no share.",
            "Defra strategic noise mapping Round 4, Open Government Licence v3.0.",
        ],
    }


def copy_rows(cur, table: str, columns: str, rows) -> None:
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    buffer.seek(0)
    with cur.copy(f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv)") as copy:
        copy.write(buffer.read())


def _plain(cur):
    """A tuple-row cursor on the same connection (coverage.load_area_regions reads tuples)."""
    from psycopg.rows import tuple_row

    return cur.connection.cursor(row_factory=tuple_row)


def read(cur) -> tuple[dict, list[list]]:
    """(the Defra source release row, metric_value rows) from area_noise on an open dict-row cursor.
    area_noise may hold London's per-home load and England's area load (england_noise.py): the
    release row is London's (the one that is not `*-england`) when both are there."""
    loaded = sorted(row["source_release_id"] for row in cur.execute(
        "SELECT DISTINCT source_release_id FROM area_noise"))
    main = [r for r in loaded if not r.endswith("-england")] or loaded
    if len(main) != 1:
        raise SystemExit(f"expected one Defra noise load (plus England's) in area_noise, found {loaded}")
    defra = cur.execute(
        "SELECT id, source_url, to_char(release_date, 'YYYY-MM-DD') AS release_date, sha256, licence,"
        " attribution FROM source_release WHERE id = %s", (main[0],)).fetchone()
    defra["loaded"] = loaded
    rows = {row["geography_id"]: (row["dwellings"], row["any_55_share"]) for row in cur.execute(ROWS_SQL)}
    values = aggregate(rows, regions=coverage.load_area_regions(_plain(cur), ("lsoa",)))
    shares = [row[3] for row in values if row[6] == "observed"]
    print(json.dumps({"lsoas": len(values), "observed": len(shares),
                      "median_share": sorted(shares)[len(shares) // 2] if shares else None}), flush=True)
    return defra, values


def bundle_parts(defra: dict, values: list[list]) -> list[str]:
    """The load as psql statements: a guard that the target holds the same Defra load, the layer's
    source release (named by a digest of its rows, so a rerun changes nothing), the metric and the stage."""
    import release_bundle as rb

    digest = hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()[:8]
    source_id = f"{SOURCE_PREFIX}-{digest}"
    loaded = defra.get("loaded") or [defra["id"]]
    guard = f"""DO $guard$ BEGIN
    IF (SELECT array_agg(DISTINCT source_release_id ORDER BY source_release_id) FROM area_noise)
       IS DISTINCT FROM {rb.text_array(sorted(loaded))} THEN
        RAISE EXCEPTION 'area_noise is not the Defra load this bundle was built from ({", ".join(loaded)})';
    END IF;
END $guard$;"""
    release = {**defra, "id": source_id, "transformation_version": ETL_VERSION, "caveats": definition()["caveats"][:3]}
    metric_rows = [(gid, period, None if value == "" else value, None if pct == "" else pct, count, quality)
                   for gid, _, period, value, pct, count, quality in values]
    return [guard, rb.source_release_sql(release),
            rb.metric_sql(METRIC_ID, "lsoa", "%", "higher-is-more", definition(), source_id, metric_rows),
            rb.stage_sql("noise-layer", [source_id], [SOURCE_PREFIX])]


def bundle(url: str, out: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import release_bundle as rb

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        defra, values = read(cur)
    print(f"sql: {rb.write(out, bundle_parts(defra, values))}")


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        defra, values = read(cur)
        shares = [row[3] for row in values if row[6] == "observed"]

        taken = {row["id"] for row in cur.execute(
            "SELECT id FROM source_release WHERE id LIKE %s", (SOURCE_PREFIX + "%",))}
        revision = 1
        while (SOURCE_PREFIX if revision == 1 else f"{SOURCE_PREFIX}-r{revision}") in taken:
            revision += 1
        source_id = SOURCE_PREFIX if revision == 1 else f"{SOURCE_PREFIX}-r{revision}"
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)""",
            (source_id, defra["source_url"], defra["release_date"], defra["sha256"], defra["licence"],
             defra["attribution"], ETL_VERSION, definition()["caveats"][:3]))
        old = [row["source_release_id"] for row in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = %s", (METRIC_ID,))]
        cur.execute("DELETE FROM metric_value WHERE metric_id = %s", (METRIC_ID,))
        cur.execute(
            """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
               VALUES (%s, 'lsoa', '%%', 'higher-is-more', %s, %s)
               ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,
                 source_release_id = EXCLUDED.source_release_id""",
            (METRIC_ID, json.dumps(definition()), source_id))
        copy_rows(cur, "metric_value",
                  "geography_id, metric_id, period, value, region_percentile, sample_count, quality,"
                  " source_release_id", [row + [source_id] for row in values])
        stage_release.stage(cur, METRIC_ID, [source_id], replace=tuple(old))
        print(f"load: {source_id}: {len(values)} LSOA values ({len(shares)} observed)")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "load":
        load(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == "sql":
        bundle(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
