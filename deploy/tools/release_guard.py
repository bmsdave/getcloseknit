"""One activation per run, after the release is built, and only when no region loses coverage (migration 134).

The loaders stage product releases; none of them activates while CLOSE_KNIT_STAGE_ONLY is set (etl.py sets it,
and PGOPTIONS='-c close_knit.stage_only=on' for psql and psycopg, for every step it runs). At the end of the run
`finish` composes one release from everything the run staged (the active release's members with each staged
release's additions and removals), builds its ranks and coverage, checks the coverage guard, runs
`release_build --tiers 0,1 --release <id>` and only then activates it.

    python3 release_guard.py activate <database-url> [--release-build "<command>"]   finish a run by hand

Environment:
  CLOSE_KNIT_STAGE_ONLY=1                        loaders stage and print the release instead of activating it
  CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT=N   the guard's limit for this run (default 2): the largest share
                                                 of a region's areas a key layer may lose against the active
                                                 release. Raise it only for a drop you have checked and accept.
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STAGE_ONLY_ENV = "CLOSE_KNIT_STAGE_ONLY"
THRESHOLD_ENV = "CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT"
THRESHOLD_SETTING = "close_knit.coverage_drop_threshold_percent"
STAGE_ONLY_SETTING = "close_knit.stage_only"
API = Path(__file__).resolve().parents[2] / "api"


def stage_only(environ=os.environ) -> bool:
    return environ.get(STAGE_ONLY_ENV, "") not in ("", "0", "false", "off")


def step_environment(environ=os.environ) -> dict[str, str]:
    """The environment of a run's steps: stage only, in Python and in every libpq client (psql, psycopg)."""
    env = dict(environ, **{STAGE_ONLY_ENV: "1"})
    options = [env.get("PGOPTIONS", ""), f"-c {STAGE_ONLY_SETTING}=on"]
    if environ.get(THRESHOLD_ENV):
        options.append(f"-c {THRESHOLD_SETTING}={float(environ[THRESHOLD_ENV]):g}")
    env["PGOPTIONS"] = " ".join(option for option in options if option)
    return env


def set_threshold(cur, environ=os.environ) -> None:
    """Pass CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT to the guard for this transaction."""
    if environ.get(THRESHOLD_ENV):
        cur.execute("SELECT set_config(%s, %s, true)", (THRESHOLD_SETTING, f"{float(environ[THRESHOLD_ENV]):g}"))


def activate(cur, release_id: str, environ=os.environ) -> bool:
    """Activate a staged release, unless this run is stage only (then say so). True when it went live."""
    if stage_only(environ):
        print(f"staged {release_id}; not activated ({STAGE_ONLY_ENV} is set: the run activates once at the end)")
        return False
    set_threshold(cur, environ)
    cur.execute("SELECT activate_product_release(%s)", (release_id,))
    return True


STAGED_SQL = """SELECT r.id, r.validation_status, r.transformation_versions, r.assets, r.validation_record,
       ARRAY(SELECT m.source_release_id FROM product_release_member m WHERE m.release_id = r.id
             ORDER BY 1) AS members
FROM product_release r
WHERE r.validation_record ->> 'supersedes' = %(base)s
  AND r.created_at >= %(since)s
  AND NOT r.validation_record ? 'composed_from'
  AND NOT EXISTS (SELECT 1 FROM product_release_activation a WHERE a.release_id = r.id)
ORDER BY r.created_at, r.id"""


def compose(base_members: list[str], staged: list[dict]) -> dict:
    """The release a run leaves: the base's members, minus every member a staged release dropped, plus every
    source one added; transformation versions merged in staging order; assets in order, once each."""
    base = set(base_members)
    added: list[str] = []
    dropped: set[str] = set()
    versions: dict = {}
    assets: list[str] = []
    for release in staged:
        members = set(release["members"])
        dropped |= base - members
        added += [source for source in sorted(members - base) if source not in added]
        versions.update(release["transformation_versions"] or {})
        assets += [asset for asset in release["assets"] or [] if asset not in assets]
    return {"members": sorted((base - dropped) | set(added)), "added": added, "replaced": sorted(dropped),
            "transformation_versions": versions, "assets": assets}


def staged_releases(cur, base: str, since) -> list[dict]:
    return list(cur.execute(STAGED_SQL, {"base": base, "since": since}))


def stage_composed(cur, base_id: str, staged: list[dict], label: str) -> str:
    base = cur.execute("SELECT * FROM product_release WHERE id = %s", (base_id,)).fetchone()
    base_members = [row["source_release_id"] for row in cur.execute(
        "SELECT source_release_id FROM product_release_member WHERE release_id = %s", (base_id,))]
    parts = compose(base_members, staged)
    release_id = f"rel-{datetime.now(timezone.utc):%Y%m%d%H%M}-{label}"
    cur.execute(
        """INSERT INTO product_release (id, geography_vintage, transformation_versions, assets, validation_status,
             validation_record) VALUES (%s, %s, %s, %s, 'passed', %s)""",
        (release_id, base["geography_vintage"], json.dumps({**base["transformation_versions"],
                                                             **parts["transformation_versions"]}),
         json.dumps(list(dict.fromkeys([*base["assets"], *parts["assets"]]))),
         json.dumps({"supersedes": base_id, "composed_from": [release["id"] for release in staged],
                     "added": parts["added"], "replaced": parts["replaced"],
                     "staged": {release["id"]: release["validation_record"] for release in staged}})))
    cur.execute("INSERT INTO product_release_member (release_id, source_release_id) SELECT %s, unnest(%s::text[])",
                (release_id, parts["members"]))
    return release_id


def coverage_refusal(release_id: str, guard: dict) -> str:
    drops = guard["drops"]
    worst = max(drops, key=lambda drop: float(drop["drop_percent"]))
    lines = [f"coverage guard: {release_id} would lose coverage against {guard['baseline_release']} "
             f"(limit {guard['threshold_percent']}% of a region's areas); NOT activated:"]
    lines += [f"  {d['layer']:32} {d['region']}  {d['before']} -> {d['after']}  (-{d['drop_percent']}%)"
              for d in drops[:30]]
    lines.append(f"Fix the load, or to accept this drop re-run with "
                 f"{THRESHOLD_ENV}={int(float(worst['drop_percent'])) + 1} (etl.py activate)")
    return "\n".join(lines)


def release_build_command(command: str, release_id: str) -> list[str]:
    return [*shlex.split(command), "--tiers", "0,1", "--release", release_id]


def finish(url: str, base: str | None = None, since=None, label: str = "refresh",
           release_build: str | None = None, dry_run: bool = False, environ=os.environ) -> str | None:
    """Compose, guard, build and activate what a run staged; the release that went live, or None."""
    import psycopg
    from psycopg.rows import dict_row

    command = release_build or f"{sys.executable} -m area_api.release_build"
    if dry_run:
        print(f"\n== activate: compose the staged releases, check coverage, "
              f"{shlex.join(release_build_command(command, '<release>'))}, activate")
        return None
    with psycopg.connect(url, row_factory=dict_row, autocommit=True) as conn:
        cur = conn.cursor()
        active = cur.execute("SELECT release_id FROM active_product_release").fetchone()["release_id"]
        base = base or active
        if active != base:
            raise SystemExit(f"activate: {active} went live during the run (expected {base}); nothing activated")
        if since is None:
            since = cur.execute("SELECT coalesce(max(activated_at), '-infinity') AS t FROM product_release_activation"
                                ).fetchone()["t"]
        staged = staged_releases(cur, base, since)
        if not staged:
            print(f"activate: nothing staged on top of {base}")
            return None
        failed = [release["id"] for release in staged if release["validation_status"] != "passed"]
        if failed:
            raise SystemExit(f"activate: staged release(s) failed validation: {', '.join(failed)}; nothing "
                             "activated (see their validation_record)")
        if len(staged) == 1:
            release_id = staged[0]["id"]
        else:
            with conn.transaction():
                release_id = stage_composed(cur, base, staged, label)
        print(f"activate: {release_id} from {', '.join(release['id'] for release in staged)}")
        # What the build reads (ranks and coverage) before it runs; activation rebuilds them again.
        cur.execute("SELECT rebuild_metric_ranks(%s)", (release_id,))
        cur.execute("SELECT rebuild_metric_coverage(%s)", (release_id,))
        with conn.transaction():
            set_threshold(cur, environ)
            guard = cur.execute("SELECT check_release_coverage(%s) AS g", (release_id,)).fetchone()["g"]
        if not guard["ok"]:
            raise SystemExit(coverage_refusal(release_id, guard))
    build = release_build_command(command, release_id)
    print(f"activate: {shlex.join(build)}", flush=True)
    result = subprocess.run(build, cwd=API, env=dict({k: v for k, v in environ.items() if k != "PGOPTIONS"},
                                                      CLOSE_KNIT_DATABASE_URL=url))
    if result.returncode:
        raise SystemExit(f"activate: release_build failed (exit {result.returncode}); {release_id} is staged, "
                         "not activated: fix it and run etl.py activate again")
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        activate(cur, release_id, {k: v for k, v in environ.items() if k != STAGE_ONLY_ENV})
    print(f"activated {release_id}; next: release_build --tiers 2,3 in the background")
    return release_id


def main(argv: list[str]) -> None:
    if len(argv) < 3 or argv[1] != "activate":
        sys.exit(__doc__)
    command = argv[argv.index("--release-build") + 1] if "--release-build" in argv else None
    finish(argv[2], release_build=command)


if __name__ == "__main__":
    main(sys.argv)
