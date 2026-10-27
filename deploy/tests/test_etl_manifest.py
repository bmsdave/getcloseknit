"""The ETL as code: every loader runs from the manifest, in dependency order, with its scope stated."""
import io
import os
import re
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import etl  # noqa: E402
import etl_manifest as m  # noqa: E402

INGEST = TOOLS.parents[1] / "pipelines" / "area-analytics-ingest"
# Libraries, release tooling and bundle helpers: not loaders of their own.
NOT_LOADERS = {"etl.py", "etl_manifest.py", "england_price_tables.py"}


def loaders() -> set[str]:
    names = {path.name for path in TOOLS.glob("etl_*.py")} | {path.name for path in TOOLS.glob("england_*.py")}
    return (names | {"ziprange.py", "boundaries.py", "epc_bulk.py", "school_history_common.py"}) - NOT_LOADERS


class ManifestTests(unittest.TestCase):
    def test_ids_are_unique_and_themes_known(self):
        ids = [step.id for step in m.STEPS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual({step.theme for step in m.STEPS}, set(m.THEMES))

    def test_dependencies_exist_and_have_no_cycle(self):
        ids = {step.id for step in m.STEPS}
        for step in m.STEPS:
            self.assertTrue(set(step.after) <= ids, step.id)
        ordered = [step.id for step in etl.order(list(m.STEPS))]
        for step in m.STEPS:
            for dep in step.after:
                self.assertLess(ordered.index(dep), ordered.index(step.id), (dep, step.id))

    def test_every_placeholder_is_a_variable(self):
        values = etl.variables({})
        for step in m.STEPS:
            for text in (step.run, step.bundle, *step.needs):
                self.assertNotIn("${", etl.expand(text, values), step.id)

    def test_every_loader_runs_from_the_manifest(self):
        runs = " ".join(step.run for step in m.STEPS)
        named = set(re.findall(r"([a-z_0-9]+\.py)\b", runs))
        self.assertEqual(loaders() - named, set(), "loaders no step runs")
        for name in named:
            self.assertTrue((TOOLS / name).exists() or (TOOLS.parents[0] / name).exists(), name)

    def test_every_pipeline_module_exists(self):
        for step in m.STEPS:
            for module in re.findall(r"-m (area_analytics\.[a-z_]+)", step.run):
                self.assertTrue((INGEST / (module.replace(".", "/") + ".py")).exists(), (step.id, module))

    def test_london_scoped_steps_say_why(self):
        for step in m.STEPS:
            self.assertIn(step.scope, ("england", "london"), step.id)
            self.assertEqual(bool(step.why), step.scope == "london", step.id)

    def test_each_theme_bundle_comes_from_a_step(self):
        bundled = {step.theme for step in m.STEPS if step.bundle}
        self.assertEqual(bundled, set(m.THEMES))
        for script in TOOLS.glob("etl_england_*_bundle.py"):
            self.assertTrue(any(script.name in step.run and step.bundle for step in m.STEPS), script.name)

    def test_probe_steps_are_python_loaders_of_the_tools_folder(self):
        for step in m.STEPS:
            if step.probe:
                self.assertEqual(step.cwd, "tools", step.id)
                self.assertNotIn("PSQL", step.run, step.id)


class SelectTests(unittest.TestCase):
    def test_a_theme_runs_in_dependency_order_without_manual_steps(self):
        ids = [step.id for step in etl.select(["prices"])]
        self.assertNotIn("prices.property", ids)
        self.assertNotIn("prices.ownership", ids)
        self.assertLess(ids.index("prices.link"), ids.index("prices.london-linked"))
        self.assertLess(ids.index("prices.price-index"), ids.index("prices.bundle"))
        self.assertEqual({step.theme for step in etl.select(["prices"])}, {"prices"})

    def test_a_manual_step_runs_when_named(self):
        self.assertEqual([step.id for step in etl.select(step_ids=["prices.property"])], ["prices.property"])

    def test_with_deps_adds_what_a_step_waits_for(self):
        ids = [step.id for step in etl.select(step_ids=["crime.release"], with_deps=True)]
        self.assertEqual(ids[:3], ["core.migrate", "core.boundaries", "core.geography"])
        self.assertEqual(ids[-1], "crime.release")

    def test_from_starts_part_way(self):
        ids = [step.id for step in etl.select(["crime"], start="crime.release")]
        self.assertEqual(ids, ["crime.release", "crime.bundle"])

    def test_unknown_names_are_refused(self):
        with self.assertRaises(SystemExit):
            etl.select(["weather"])

    def test_a_cycle_is_refused(self):
        a = m.Step("core.a", "true", ("core.b",))
        b = m.Step("core.b", "true", ("core.a",))
        with mock.patch.object(m, "STEPS", (a, b)), self.assertRaises(SystemExit):
            etl.order([a, b])


class RunTests(unittest.TestCase):
    def test_variables_come_from_the_environment(self):
        values = etl.variables({"CLOSE_KNIT_ETL_DB": "postgresql://x/y", "ETL_E": "/data/e"})
        self.assertEqual(values["DB"], "postgresql://x/y")
        self.assertEqual(etl.expand("${PSQL} ${BUNDLES}", values), f"psql postgresql://x/y {values['BUNDLES']}")
        self.assertEqual(values["PY"], sys.executable)

    def test_a_staging_step_holds_the_release_lock_and_gives_it_back(self):
        with tempfile.TemporaryDirectory() as folder:
            values = dict(etl.variables({}), LOCK=os.path.join(folder, "release.lock"))
            seen = os.path.join(folder, "seen")
            step = m.Step("core.x", f"test -d {values['LOCK']} && touch {seen}", cwd="tools", lock=True)
            with redirect_stdout(io.StringIO()):
                etl.run_step(step, values, dry_run=False)
            self.assertTrue(os.path.exists(seen))
            self.assertFalse(os.path.exists(values["LOCK"]))

    def test_a_failed_step_stops_the_run_and_frees_the_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            values = dict(etl.variables({}), LOCK=os.path.join(folder, "release.lock"))
            with redirect_stdout(io.StringIO()), self.assertRaises(SystemExit):
                etl.run_step(m.Step("core.x", "exit 3", lock=True), values, dry_run=False)
            self.assertFalse(os.path.exists(values["LOCK"]))

    def test_missing_inputs_stop_a_step_before_it_runs(self):
        values = etl.variables({})
        step = m.Step("core.x", "touch /nonexistent/never", needs=("/nonexistent/input.csv",))
        with redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as stopped:
            etl.run_step(step, values, dry_run=False)
        self.assertIn("/nonexistent/input.csv", str(stopped.exception))

    def test_bundle_index_lists_bundles_in_apply_order(self):
        with tempfile.TemporaryDirectory() as folder:
            values = dict(etl.variables({}), BUNDLES=folder)
            Path(folder, "crime").mkdir()
            Path(folder, "crime", "load.sql.gz").write_bytes(b"x")
            steps = [step for step in etl.select(["crime", "people"]) if step.bundle]
            index = etl.bundle_index(steps, values)
        paths = [entry["path"] for entry in index["bundles"]]
        self.assertEqual(paths, [f"{folder}/people/load.sql.gz", f"{folder}/people/census-layers.sql.gz",
                                 f"{folder}/crime/load.sql.gz"])
        self.assertEqual(index["bundles"][2]["sha256"],
                         "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881")

    def test_plan_prints_every_step(self):
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(etl.main(["plan"]), 0)
        self.assertEqual(len(out.getvalue().splitlines()), len(m.STEPS))


if __name__ == "__main__":
    unittest.main()
