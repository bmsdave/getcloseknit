"""The London diff: 200 London cells of the map metrics, kept in london-snapshot.json, checked against a database.

A cell is (metric, area, period) with its value, region percentile and quality. The cells are spread over
the themes of etl_manifest.THEME_METRICS (SNAPSHOT_CELLS each) and chosen in a fixed order (md5 of area and
metric) among London's observed rows of each metric's latest period, so a retake picks the same cells.

    take(cur)                          the cells, read from a database
    compare(cells, current)            {theme: equal / changed / missing / intentional}
    probe(url, steps, cells)           run loader steps with every write rolled back, then read the cells

A probe is how a loader is checked against London without touching the shared database: the steps run in
this process (runpy, the step's own command line) with psycopg.connect handing them one connection whose
commit does nothing; the cells are read on that connection and the transaction is rolled back.

    python3 london_snapshot.py probe <database-url> <snapshot.json> <steps.json>   (etl.py london-diff --probe)
"""
from __future__ import annotations

import json
import math
import os
import runpy
import shlex
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import etl_manifest as manifest  # noqa: E402

SNAPSHOT = Path(__file__).with_name("london-snapshot.json")
LONDON = "E12000007"
# (signature, result, body) of the functions a probe runs as no-ops: see probe().
SKIPPED_FUNCTIONS = (("activate_product_release(text)", "text", "SELECT $1"),
                     ("rebuild_area_rank()", "integer", "SELECT 0"),
                     ("rebuild_area_good_value()", "integer", "SELECT 0"))

TAKE_SQL = """
WITH latest AS (
  SELECT metric_id, max(period) AS period FROM metric_value WHERE metric_id = ANY(%(metrics)s) GROUP BY metric_id)
SELECT v.metric_id, v.geography_id, to_char(v.period, 'YYYY-MM-DD') AS period, v.value, v.region_percentile,
       v.quality::text AS quality
FROM metric_value v
JOIN latest l ON l.metric_id = v.metric_id AND l.period = v.period
JOIN area_region r ON r.area_id = v.geography_id AND r.region_code = %(region)s
WHERE v.quality = 'observed'
ORDER BY md5(v.geography_id || v.metric_id)
"""


def key(cell: Mapping) -> tuple[str, str, str]:
    return cell["metric"], cell["area"], cell["period"]


def theme_of(metric: str) -> str:
    for theme, metrics in manifest.THEME_METRICS.items():
        if metric in metrics:
            return theme
    return "other"


def pick(rows: Iterable[tuple], quotas: Mapping[str, int]) -> list[dict]:
    """Round-robin over each theme's metrics, in the rows' order, until the theme's quota is met.
    `rows` are (metric, area, period, value, percentile, quality)."""
    by_metric: dict[str, list[tuple]] = {}
    for row in rows:
        by_metric.setdefault(row[0], []).append(row)
    cells = []
    for theme, quota in quotas.items():
        queues = [list(reversed(by_metric.get(metric, []))) for metric in manifest.THEME_METRICS[theme]]
        taken = 0
        while taken < quota and any(queues):
            for queue in queues:
                if queue and taken < quota:
                    metric, area, period, value, pct, quality = queue.pop()
                    cells.append({"theme": theme, "metric": metric, "area": area, "period": period,
                                  "value": value, "percentile": pct, "quality": quality})
                    taken += 1
    return cells


def take(cur, quotas: Mapping[str, int] = manifest.SNAPSHOT_CELLS) -> list[dict]:
    metrics = [metric for theme in quotas for metric in manifest.THEME_METRICS[theme]]
    rows = cur.execute(TAKE_SQL, {"metrics": metrics, "region": LONDON}).fetchall()
    return pick(rows, quotas)


def read(cur, cells: list[dict]) -> dict[tuple, dict]:
    """The cells' current (value, percentile, quality), keyed like the snapshot; a missing row is absent."""
    found = {}
    for metric in sorted({cell["metric"] for cell in cells}):
        areas = [cell["area"] for cell in cells if cell["metric"] == metric]
        for area, period, value, pct, quality in cur.execute(
                "SELECT geography_id, to_char(period, 'YYYY-MM-DD'), value, region_percentile, quality::text "
                "FROM metric_value WHERE metric_id = %s AND geography_id = ANY(%s)", (metric, areas)).fetchall():
            found[(metric, area, period)] = {"value": value, "percentile": pct, "quality": quality}
    return found


def same(old: Mapping, new: Mapping, tolerance: Mapping = manifest.TOLERANCE) -> bool:
    if old["quality"] != new["quality"]:
        return False
    a, b = old["value"], new["value"]
    if (a is None) != (b is None):
        return False
    if a is not None and not math.isclose(a, b, rel_tol=tolerance["rel"], abs_tol=tolerance["abs"]):
        return False
    p, q = old["percentile"], new["percentile"]
    if (p is None) != (q is None):
        return False
    return p is None or abs(p - q) <= tolerance["percentile"]


def compare(cells: list[dict], current: Mapping[tuple, Mapping],
            intentional: Mapping[str, str] = manifest.INTENTIONAL_LONDON_DIFFS) -> dict[str, dict]:
    """Per theme: cells, equal, and the changed / missing cells (each listed with old and new);
    differences in a metric of `intentional` go to `intentional` instead and never fail."""
    report: dict[str, dict] = {}
    for cell in cells:
        theme = report.setdefault(cell["theme"], {"cells": 0, "equal": 0, "changed": [], "missing": [],
                                                  "intentional": []})
        theme["cells"] += 1
        new = current.get(key(cell))
        if new is not None and same(cell, new):
            theme["equal"] += 1
            continue
        entry = {"metric": cell["metric"], "area": cell["area"], "period": cell["period"],
                 "old": cell["value"], "new": None if new is None else new["value"]}
        if cell["metric"] in intentional:
            theme["intentional"].append({**entry, "why": intentional[cell["metric"]]})
        else:
            theme["missing" if new is None else "changed"].append(entry)
    return report


def failed(report: Mapping[str, Mapping]) -> bool:
    return any(theme["changed"] or theme["missing"] for theme in report.values())


def summary(report: Mapping[str, Mapping]) -> str:
    lines = []
    for theme, row in sorted(report.items()):
        lines.append(f"{theme:12} {row['equal']:3}/{row['cells']:3} equal, {len(row['changed'])} changed, "
                     f"{len(row['missing'])} missing, {len(row['intentional'])} intentional")
        for entry in (row["changed"] + row["missing"])[:10]:
            lines.append(f"  {entry['metric']} {entry['area']} {entry['period']}: {entry['old']} -> {entry['new']}")
        for entry in row["intentional"][:3]:
            lines.append(f"  (intentional) {entry['metric']} {entry['area']}: {entry['old']} -> {entry['new']}: "
                         f"{entry['why']}")
    return "\n".join(lines)


def load(path: Path = SNAPSHOT) -> list[dict]:
    return json.loads(path.read_text())["cells"]


def save(cells: list[dict], source: str, path: Path = SNAPSHOT) -> None:
    lines = ",\n".join(json.dumps(cell, sort_keys=True) for cell in cells)
    path.write_text(f'{{"source": {json.dumps(source)},\n"cells": [\n{lines}\n]}}\n')


# --- probe: loaders in a rolled-back transaction -------------------------------------------------

class SharedConnection:
    """What psycopg.connect returns during a probe: the probe's one connection, whose commit, close and
    context exit do nothing, so every write stays in the transaction the probe rolls back."""

    def __init__(self, conn, row_factory=None):
        self._conn = conn
        self._row_factory = row_factory

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def __setattr__(self, name, value):
        if name in ("autocommit", "row_factory") and not name.startswith("_"):
            if name == "row_factory":
                object.__setattr__(self, "_row_factory", value)
            return  # autocommit would end the transaction: ignored
        object.__setattr__(self, name, value)

    @property
    def row_factory(self):
        return self._row_factory or self._conn.row_factory

    def cursor(self, *args, **kwargs):
        if self._row_factory is not None:
            kwargs.setdefault("row_factory", self._row_factory)
        return self._conn.cursor(*args, **kwargs)

    def execute(self, query, params=None, **kwargs):
        return self.cursor().execute(query, params, **kwargs)

    def commit(self):
        pass

    def close(self):
        pass

    def rollback(self):
        raise RuntimeError("a probed step rolled back: its run cannot be checked")


def command_line(run: str, variables: Mapping[str, str]) -> list[tuple[dict, list[str]]]:
    """A step's `run` as [(env, argv)], one per `&&` part: `A=1 B=2 ${PY} script.py args`."""
    parts = []
    for part in run.split("&&"):
        words = shlex.split(manifest_expand(part, variables))
        env = {}
        while words and "=" in words[0] and not words[0].startswith("-"):
            name, value = words.pop(0).split("=", 1)
            env[name] = os.path.expanduser(value)
        parts.append((env, [os.path.expanduser(word) for word in words[1:]]))  # words[0] is the interpreter
    return parts


def manifest_expand(text: str, variables: Mapping[str, str]) -> str:
    from string import Template

    for _ in range(3):  # variables may name variables (PSQL holds ${DB})
        text = Template(text).substitute(variables)
    return text


def probe(url: str, steps: list[dict], cells: list[dict]) -> dict[tuple, dict]:
    """Run `steps` ({"id", "run", "cwd"} with variables expanded) on one connection, read the cells, roll back."""
    import psycopg

    real_connect = psycopg.connect
    conn = real_connect(url)
    conn.execute("SET lock_timeout = '60s'")
    # Activation and the area-wide rebuilds touch neither the cells' values nor their region percentiles, and
    # take minutes on England: inside the probe's transaction they resolve to no-ops in a scratch schema
    # (created, used and dropped by the rollback; no other session sees it).
    schema = f"etl_probe_{conn.info.backend_pid}"
    conn.execute(f"CREATE SCHEMA {schema}")
    for signature, result, body in SKIPPED_FUNCTIONS:
        conn.execute(f"CREATE FUNCTION {schema}.{signature} RETURNS {result} LANGUAGE sql AS '{body}'")
    conn.execute(f"SET LOCAL search_path = {schema}, public")
    psycopg.connect = lambda *args, **kwargs: SharedConnection(conn, kwargs.get("row_factory"))
    here = os.getcwd()
    try:
        for item in steps:
            for env, argv in item["argv"]:
                os.chdir(item["cwd"])
                saved_env, saved_argv = dict(os.environ), sys.argv
                os.environ.update(env)
                sys.argv = argv
                print(f"probe {item['id']}: {' '.join(argv)}", file=sys.stderr, flush=True)
                try:
                    if argv[0] == "-m":
                        sys.argv = argv[1:]
                        runpy.run_module(argv[1], run_name="__main__", alter_sys=True)
                    else:
                        runpy.run_path(argv[0], run_name="__main__")
                except SystemExit as exit_:
                    if exit_.code not in (None, 0):
                        raise RuntimeError(f"{item['id']} exited with {exit_.code}") from None
                finally:
                    os.environ.clear()
                    os.environ.update(saved_env)
                    sys.argv = saved_argv
        return read(conn.cursor(), cells)
    finally:
        os.chdir(here)
        psycopg.connect = real_connect
        conn.rollback()
        conn.close()


def main(argv: list[str]) -> None:
    if len(argv) == 5 and argv[1] == "probe":
        cells = json.loads(Path(argv[3]).read_text())["cells"]
        steps = json.loads(Path(argv[4]).read_text())
        themes = {item["theme"] for item in steps}
        cells = [cell for cell in cells if cell["theme"] in themes]
        current = probe(argv[2], steps, cells)
        print(json.dumps({"report": compare(cells, current)}, default=str))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
