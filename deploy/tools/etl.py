"""Run the ETL from its manifest (etl_manifest.py): one command per theme, steps in dependency order.

    python3 deploy/tools/etl.py plan [--theme T ...] [--with-deps]     the order, without running anything
    python3 deploy/tools/etl.py run --theme T [--theme T2] [--step S ...] [--from S] [--with-deps] [--dry-run]
    python3 deploy/tools/etl.py refresh prices [--from S] [--dry-run]  a refresh (etl_manifest.REFRESH) in its order
    python3 deploy/tools/etl.py activate                               finish a run: build and activate what it staged
    python3 deploy/tools/etl.py bundle [--theme T ...] [--dry-run]     every bundle step, then bundles/manifest.json
    python3 deploy/tools/etl.py london-diff [--theme T ...] [--probe] [--take]
    python3 deploy/tools/etl.py themes                                 steps per theme, London-scoped ones named
    (or python -m deploy.tools.etl ... from the checkout)

run takes only the selected steps; their dependencies outside the selection are taken as done unless
--with-deps adds them. Steps marked manual (paid, days long, an owner login) run only when named with --step.
Before a step runs, its `needs` must exist (EPC = the domestic EPC download, epc_bulk.source()). Steps that
stage a product release hold the release lock (${LOCK}, a directory) while they run.

One activation per run: when a run (run, refresh, bundle) has a step that stages a release, every step runs stage
only (CLOSE_KNIT_STAGE_ONLY=1, PGOPTIONS -c close_knit.stage_only=on: activate_product_release refuses), and at
the end release_guard.finish composes one release from what they staged, checks the coverage guard (migration
134), builds it with ${RELEASE_BUILD} --tiers 0,1 --release <id> and activates it. A failed step or build leaves
the releases staged and nothing activated: fix it, then `etl.py activate` (or rerun with --from).

london-diff compares London's cells in london-snapshot.json with the database (${DB}); --probe first runs the
themes' probe steps on the inputs already there (no download) with every write rolled back
(london_snapshot.probe), so a loader is checked against
London on the shared ETL database without changing it; --take rewrites the snapshot from the database.
A difference fails (exit 1) unless the metric is in etl_manifest.INTENTIONAL_LONDON_DIFFS.

Variables (${DB}, ${E}, ...) come from etl_manifest.VARS; ETL_<NAME> in the environment overrides one
(CLOSE_KNIT_ETL_DB overrides DB too). ${PY} is this interpreter.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import etl_manifest as manifest  # noqa: E402
import london_snapshot as snapshot  # noqa: E402

REPO = TOOLS.parents[1]
CWD = {"tools": TOOLS, "ingest": REPO / "pipelines" / "area-analytics-ingest", "repo": REPO, "deploy": REPO / "deploy"}


def variables(environ=os.environ) -> dict[str, str]:
    values = dict(manifest.VARS, PY=sys.executable)
    if environ.get("CLOSE_KNIT_ETL_DB"):
        values["DB"] = environ["CLOSE_KNIT_ETL_DB"]
    for name in values:
        if environ.get(f"ETL_{name}"):
            values[name] = environ[f"ETL_{name}"]
    return {name: os.path.expanduser(value) if value.startswith("~") else value for name, value in values.items()}


def expand(text: str, values: dict[str, str]) -> str:
    return snapshot.manifest_expand(text, values)


def select(themes=(), step_ids=(), start: str | None = None, with_deps: bool = False) -> list[manifest.Step]:
    """The chosen steps in dependency order (manifest order among equals)."""
    by_id = {item.id: item for item in manifest.STEPS}
    unknown = [name for name in (*step_ids, *([start] if start else [])) if name not in by_id]
    unknown += [theme for theme in themes if theme not in manifest.THEMES]
    if unknown:
        raise SystemExit(f"etl: unknown step or theme: {', '.join(unknown)}")
    chosen = {item.id for item in manifest.STEPS
              if (not themes and not step_ids) or item.theme in themes or item.id in step_ids}
    if themes and not step_ids:
        chosen = {name for name in chosen if not by_id[name].manual}
    if with_deps:
        stack = list(chosen)
        while stack:
            for dep in by_id[stack.pop()].after:
                if dep not in chosen:
                    chosen.add(dep)
                    stack.append(dep)
    ordered = order([by_id[name] for name in chosen])
    if start:
        ids = [item.id for item in ordered]
        if start not in ids:
            raise SystemExit(f"etl: --from {start} is not among the selected steps")
        ordered = ordered[ids.index(start):]
    return ordered


def order(steps: list[manifest.Step]) -> list[manifest.Step]:
    """Topological order of `steps` (Kahn's algorithm, manifest order breaking ties); a cycle is an error."""
    position = {item.id: index for index, item in enumerate(manifest.STEPS)}
    chosen = {item.id: item for item in steps}
    waiting = {item.id: {dep for dep in item.after if dep in chosen} for item in steps}
    done: list[manifest.Step] = []
    while waiting:
        ready = sorted((name for name, deps in waiting.items() if not deps), key=position.__getitem__)
        if not ready:
            raise SystemExit(f"etl: dependency cycle among {sorted(waiting)}")
        name = ready[0]
        done.append(chosen[name])
        del waiting[name]
        for deps in waiting.values():
            deps.discard(name)
    return done


def missing_inputs(item: manifest.Step, values: dict[str, str]) -> list[str]:
    import epc_bulk

    paths = [epc_bulk.source() if need == "EPC" else expand(need, values) for need in item.needs]
    return [path for path in paths if not os.path.exists(path)]


def describe(item: manifest.Step) -> str:
    flags = [item.scope + (f" ({item.why})" if item.why else "")]
    if item.lock:
        flags.append("stages a release")
    if item.bundle:
        flags.append("bundle")
    if item.manual:
        flags.append(f"manual: {item.manual}")
    after = f"  after {', '.join(item.after)}" if item.after else ""
    return f"{item.id:28} {'; '.join(flags)}{after}"


def run_step(item: manifest.Step, values: dict[str, str], dry_run: bool, env: dict[str, str] | None = None) -> None:
    command = expand(item.run, values)
    print(f"\n== {item.id} [{item.cwd}]\n{command}", flush=True)
    if dry_run:
        return
    missing = missing_inputs(item, values)
    if missing:
        raise SystemExit(f"etl: {item.id} needs {', '.join(missing)}")
    lock = Path(values["LOCK"]) if item.lock else None
    if lock:
        lock.parent.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                lock.mkdir()
                break
            except FileExistsError:
                print(f"etl: waiting for the release lock {lock}", flush=True)
                time.sleep(20)
    try:
        started = time.time()
        result = subprocess.run(["bash", "-o", "pipefail", "-c", command], cwd=CWD[item.cwd], env=env)
        if result.returncode:
            raise SystemExit(f"etl: {item.id} failed (exit {result.returncode})")
        print(f"== {item.id} done in {time.time() - started:.0f} s", flush=True)
    finally:
        if lock:
            lock.rmdir()


def refresh_steps(name: str | None, start: str | None = None) -> list[manifest.Step]:
    """A refresh's steps in its own order (etl_manifest.REFRESH), from `start` when given."""
    if name not in manifest.REFRESH:
        raise SystemExit(f"etl: refresh one of {', '.join(manifest.REFRESH)} (got {name})")
    ids = list(manifest.REFRESH[name])
    if start:
        if start not in ids:
            raise SystemExit(f"etl: --from {start} is not a step of the {name} refresh")
        ids = ids[ids.index(start):]
    return [manifest.step(step_id) for step_id in ids]


def run_start(url: str) -> tuple[str, object]:
    """The active release and the database's clock when a run starts: what finish composes on top of."""
    import psycopg

    with psycopg.connect(url) as conn:
        return conn.execute("SELECT (SELECT release_id FROM active_product_release), now()").fetchone()


def run_steps(steps: list[manifest.Step], values: dict[str, str], dry_run: bool, label: str = "run",
              finish=None) -> str | None:
    """Run the steps. When one stages a release, every step runs stage only and the run ends with one activation
    (release_guard.finish); returns the release that went live."""
    import release_guard

    if not any(item.lock for item in steps):
        for item in steps:
            run_step(item, values, dry_run)
        return None
    env = release_guard.step_environment()
    base, since = (None, None) if dry_run else run_start(values["DB"])
    for item in steps:
        run_step(item, values, dry_run, env)
    return (finish or release_guard.finish)(values["DB"], base=base, since=since, label=label,
                                            release_build=expand("${RELEASE_BUILD}", values), dry_run=dry_run)


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def bundle_index(steps: list[manifest.Step], values: dict[str, str]) -> dict:
    """The production apply list: every bundle the steps write, in apply order, with its sha256."""
    bundles = []
    for item in steps:
        for path in expand(item.bundle, values).split():
            entry = {"step": item.id, "theme": item.theme, "scope": item.scope, "path": path}
            if os.path.exists(path):
                entry.update(bytes=os.path.getsize(path), sha256=sha256(path))
            bundles.append(entry)
    return {"apply": "gunzip -c <path> | psql \"$DB\" -v ON_ERROR_STOP=1, in this order", "bundles": bundles}


def london_diff(themes: list[str], probe: bool, take: bool, values: dict[str, str]) -> int:
    import psycopg

    if take:
        with psycopg.connect(values["DB"]) as conn:
            cells = snapshot.take(conn.cursor())
        snapshot.save(cells, "ETL database, latest period of each metric")
        print(f"london-diff: {len(cells)} cells -> {snapshot.SNAPSHOT}")
        return 0
    cells = [cell for cell in snapshot.load() if not themes or cell["theme"] in themes]
    if probe:
        # Same inputs as the loaded rows: a probe never downloads (a newer file would be a refresh, not a check).
        steps = [{"id": item.id, "theme": item.theme, "cwd": str(CWD[item.cwd]),
                  "argv": [part for part in snapshot.command_line(item.run, values)
                           if part[1][1:2] not in (["download"], ["fetch"])]}
                 for item in select(themes) if item.probe]
        if not steps:
            raise SystemExit(f"etl: no probe steps in {', '.join(themes) or 'any theme'}")
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(steps, handle)
        result = subprocess.run([sys.executable, str(TOOLS / "london_snapshot.py"), "probe", values["DB"],
                                 str(snapshot.SNAPSHOT), handle.name], capture_output=True, text=True)
        os.unlink(handle.name)
        sys.stderr.write(result.stderr[-4000:])
        if result.returncode:
            raise SystemExit(f"etl: the probe failed (exit {result.returncode})")
        report = json.loads(result.stdout.strip().splitlines()[-1])["report"]
    else:
        with psycopg.connect(values["DB"]) as conn:
            report = snapshot.compare(cells, snapshot.read(conn.cursor(), cells))
    print(snapshot.summary(report))
    return 1 if snapshot.failed(report) else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="etl.py", description=__doc__.split("\n\n")[0])
    parser.add_argument("command", choices=("plan", "run", "refresh", "activate", "bundle", "london-diff", "themes"))
    parser.add_argument("name", nargs="?", help="refresh: which one (etl_manifest.REFRESH)")
    parser.add_argument("--theme", action="append", default=[])
    parser.add_argument("--step", action="append", default=[])
    parser.add_argument("--from", dest="start")
    parser.add_argument("--with-deps", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--take", action="store_true")
    args = parser.parse_args(argv)
    values = variables()
    if args.command == "themes":
        for theme in manifest.THEMES:
            steps = [item for item in manifest.STEPS if item.theme == theme]
            london = [item.id.split(".", 1)[1] for item in steps if item.scope == "london"]
            print(f"{theme:12} {len(steps):2} steps" + (f"; London-scoped: {', '.join(london)}" if london else ""))
        return 0
    if args.command == "london-diff":
        return london_diff(args.theme, args.probe, args.take, values)
    if args.command == "activate":
        import release_guard

        release_guard.finish(values["DB"], release_build=expand("${RELEASE_BUILD}", values), dry_run=args.dry_run)
        return 0
    if args.command == "refresh":
        steps = refresh_steps(args.name, args.start)
    else:
        steps = select(args.theme, args.step, args.start, args.with_deps)
    if args.command == "plan":
        for number, item in enumerate(steps, 1):
            print(f"{number:3}. {describe(item)}")
        return 0
    if args.command == "bundle":
        steps = [item for item in steps if item.bundle]
    label = f"{args.name}-refresh" if args.command == "refresh" else "-".join(args.theme) or "run"
    run_steps(steps, values, args.dry_run, label=label)
    if args.command == "bundle" and not args.dry_run:
        index = Path(values["BUNDLES"]) / "manifest.json"
        index.parent.mkdir(parents=True, exist_ok=True)
        index.write_text(json.dumps(bundle_index(steps, values), indent=1) + "\n")
        print(f"bundle: {index}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
