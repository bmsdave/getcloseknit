"""Layers v5 (PR 3): map layers built from tables already loaded (batch 1: migration 100; batch 2: 101).

  typical-rent (+ -1-bed, -3-bed)   borough_rent (029, ONS PIPR)           rebuild_typical_rent
  flood-risk                        dwelling_flood (018, EA NaFRA2)        rebuild_flood_risk
  good-schools-nearby (+ -secondary) school_national_rank (055, DfE)      rebuild_good_schools_nearby
  student-share                     area_census_count TS066 (015, Census)  rebuild_student_share
  supermarket-walk                  place shop=supermarket (034, OSM)      rebuild_supermarket_walk  (101)
  gp-walk                           area_health.gp_nearest_m (061, NHS)    rebuild_gp_walk           (101)
  broadband-gigabit                 area_broadband (063, Ofcom)            rebuild_broadband_gigabit (101)

For each layer it writes a source release `src-layer-<layer>-<digest>` copied from the inputs' own
releases (licence, attribution, URL; the digest covers their checksums and this ETL's version, so a
rerun on the same inputs reuses it), calls the rebuild, then stages one product release that replaces
the layers' earlier builds. Universities (Student areas' points) are read live from `place` by the API.

  python3 etl_layers_v5.py load <database-url> [layer ...]     (default: all seven; needs psycopg)
"""
from __future__ import annotations

import hashlib
import sys

ETL_VERSION = "close-knit-layers-v5-1"
SOURCE_PREFIX = "src-layer-"
ACTIVE_MEMBERS = """source_release_id IN (SELECT m.source_release_id FROM product_release_member m
    WHERE m.release_id = (SELECT release_id FROM active_product_release))"""

# layer -> (rebuild function, its metric ids, SQL listing the input source releases)
LAYERS: dict[str, tuple[str, tuple[str, ...], str]] = {
    "typical-rent": ("rebuild_typical_rent", ("typical-rent", "typical-rent-1-bed", "typical-rent-3-bed"),
                     "SELECT DISTINCT source_release_id AS id FROM borough_rent"),
    "flood-risk": ("rebuild_flood_risk", ("flood-risk",),
                   "SELECT DISTINCT source_release_id AS id FROM dwelling_flood"),
    "good-schools-nearby": ("rebuild_good_schools_nearby", ("good-schools-nearby", "good-schools-nearby-secondary"),
                            f"""SELECT DISTINCT source_release_id AS id FROM school_national_rank
                                WHERE NOT EXISTS (SELECT 1 FROM active_product_release) OR {ACTIVE_MEMBERS}
                                UNION SELECT DISTINCT source_release_id FROM school"""),
    "student-share": ("rebuild_student_share", ("student-share",),
                      "SELECT DISTINCT source_release_id AS id FROM area_census_count WHERE topic = 'economic-activity'"),
    # Batch 2 (migration 101).
    "supermarket-walk": ("rebuild_supermarket_walk", ("supermarket-walk",),
                         """SELECT DISTINCT source_release_id AS id FROM place WHERE tags @> '{"shop": "supermarket"}'"""),
    "gp-walk": ("rebuild_gp_walk", ("gp-walk",),
                "SELECT DISTINCT gp_release_id AS id FROM area_health WHERE gp_nearest_m IS NOT NULL"),
    "broadband-gigabit": ("rebuild_broadband_gigabit", ("broadband-gigabit",),
                          "SELECT DISTINCT source_release_id AS id FROM area_broadband"),
}
BATCH_1 = ("typical-rent", "flood-risk", "good-schools-nearby", "student-share")  # migration 100
BATCH_2 = ("supermarket-walk", "gp-walk", "broadband-gigabit")  # migration 101

INPUTS_SQL = """SELECT id, source_url, to_char(release_date, 'YYYY-MM-DD') AS release_date, sha256, licence,
  attribution FROM source_release WHERE id = ANY(%s) ORDER BY id"""


def derived_release(layer: str, inputs: list[dict]) -> dict:
    """The layer's source release row from its inputs' rows: their checksums (and the ETL version) name it."""
    if not inputs:
        raise SystemExit(f"{layer}: no input rows loaded")
    digest = hashlib.sha256("\n".join([ETL_VERSION, *(f"{row['id']}:{row['sha256']}" for row in inputs)])
                            .encode()).hexdigest()

    def joined(key: str, sep: str) -> str:
        return sep.join(dict.fromkeys(row[key] for row in inputs))

    return {
        "id": f"{SOURCE_PREFIX}{layer}-{digest[:12]}", "source_url": inputs[0]["source_url"],
        "release_date": max(row["release_date"] for row in inputs), "sha256": digest,
        "licence": joined("licence", "; "), "attribution": joined("attribution", " "),
        "caveats": [f"Built by deploy/tools/etl_layers_v5.py ({ETL_VERSION}) from: "
                    + ", ".join(row["id"] for row in inputs) + "."],
    }


def build(cur, layer: str) -> tuple[str, list[str]]:
    """Write one layer: (its source release id, the earlier releases its metrics used)."""
    function, metric_ids, inputs_sql = LAYERS[layer]
    ids = [row["id"] for row in cur.execute(inputs_sql)]
    release = derived_release(layer, list(cur.execute(INPUTS_SQL, (ids,))))
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
             transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%(id)s, %(source_url)s, now(), %(release_date)s, %(sha256)s, %(licence)s, %(attribution)s,
             %(version)s, '2021', 'passed', %(caveats)s) ON CONFLICT (id) DO NOTHING""",
        {**release, "version": ETL_VERSION})
    old = sorted({row["source_release_id"] for row in cur.execute(
        "SELECT source_release_id FROM metric_definition WHERE id = ANY(%s) AND source_release_id <> %s",
        (list(metric_ids), release["id"]))})
    rows = cur.execute(f"SELECT {function}(%s) AS n", (release["id"],)).fetchone()["n"]
    summary = cur.execute(
        """SELECT metric_id, count(*) AS n, count(*) FILTER (WHERE quality = 'observed') AS observed,
             min(value) AS min, max(value) AS max FROM metric_value WHERE metric_id = ANY(%s) GROUP BY 1 ORDER BY 1""",
        (list(metric_ids),))
    for row in summary:
        print(f"{layer}: {row['metric_id']} {row['n']} values ({row['observed']} observed), "
              f"{row['min']}..{row['max']}", flush=True)
    print(f"{layer}: {release['id']}: {rows} rows", flush=True)
    return release["id"], old


def load(url: str, layers: list[str]) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        sources, replaced = [], []
        for layer in layers:
            source_id, old = build(cur, layer)
            sources.append(source_id)
            replaced.extend(old)
        stage_release.stage(cur, "layers-v5", sources, replace=tuple(sorted(set(replaced) - set(sources))))


if __name__ == "__main__":
    chosen = sys.argv[3:] or list(LAYERS)
    if len(sys.argv) < 3 or sys.argv[1] != "load" or set(chosen) - set(LAYERS):
        sys.exit(__doc__)
    load(sys.argv[2], chosen)
