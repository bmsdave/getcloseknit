"""Stage and activate a product release = the active one plus new source releases.

  python3 stage_release.py <database-url> <label> <source-id> [<source-id> ...]

Every named source must exist in `source_release` with validation_status
'passed' (activate_product_release refuses otherwise). Assets and
transformation versions carry over from the active release.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone


def stage(cur, label: str, sources: list[str], replace: tuple[str, ...] = ()) -> str:
    """Stage and activate on an open cursor (dict rows); `replace` names member
    sources the new release drops (an earlier build of the same source)."""
    active = cur.execute("SELECT release_id FROM active_product_release").fetchone()["release_id"]
    base = cur.execute("SELECT * FROM product_release WHERE id = %s", (active,)).fetchone()
    known = {row["id"] for row in cur.execute("SELECT id FROM source_release WHERE id = ANY(%s)", (sources,))}
    missing = sorted(set(sources) - known)
    if missing:
        raise SystemExit(f"unknown source releases: {', '.join(missing)}")
    release_id = f"rel-{datetime.now(timezone.utc):%Y%m%d%H%M}-{label}"
    cur.execute(
        """INSERT INTO product_release (id, geography_vintage, transformation_versions, assets,
             validation_status, validation_record) VALUES (%s, %s, %s, %s, 'passed', %s)""",
        (release_id, base["geography_vintage"], json.dumps(base["transformation_versions"]),
         json.dumps(base["assets"]),
         json.dumps({"supersedes": active, "added": sources, "replaced": list(replace)})))
    cur.execute(
        """INSERT INTO product_release_member (release_id, source_release_id)
           SELECT %s, source_release_id FROM product_release_member
           WHERE release_id = %s AND source_release_id <> ALL(%s::text[])
           UNION SELECT %s, unnest(%s::text[])""",
        (release_id, active, list(replace), release_id, sources))
    # Overview London ranks (migration 054) are derived from the loaded tables: refresh them first.
    if cur.execute("SELECT to_regproc('public.rebuild_area_rank') IS NOT NULL AS t").fetchone()["t"]:
        cur.execute("SELECT rebuild_area_rank()")
    # Good value inputs (migration 069) read those ranks, crime, air and the price bands: refresh them next.
    if cur.execute("SELECT to_regproc('public.rebuild_area_good_value') IS NOT NULL AS t").fetchone()["t"]:
        cur.execute("SELECT rebuild_area_good_value()")
    cur.execute("SELECT activate_product_release(%s)", (release_id,))
    print(f"activated {release_id} (+ {', '.join(sources)})")
    # What the release derives is built by the API's code (release_artifact, migration 128): RELEASE-CHECKLIST.md.
    print("next: build what it derives: docker compose ... exec -T api python -m area_api.release_build --tiers 0,1")
    return release_id


def main(url: str, label: str, sources: list[str]) -> None:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        stage(cur, label, sources)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
