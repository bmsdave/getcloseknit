"""One activation per refresh (release_guard.py, etl.py), after the October Price Paid refresh activated its sales
release straight away, before the England bundle, release_build and any coverage check. The guard's SQL runs on
the PostGIS fixture in api/tests/test_refresh_guards_postgis.py; this is the Python side."""
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))

import etl  # noqa: E402
import etl_manifest as m  # noqa: E402
import release_guard  # noqa: E402


class StageOnlyTests(unittest.TestCase):
    def test_a_run_step_stages_only_in_python_and_in_every_libpq_client(self):
        env = release_guard.step_environment({"PGOPTIONS": "-c jit=off", release_guard.THRESHOLD_ENV: "5"})
        self.assertTrue(release_guard.stage_only(env))
        self.assertEqual(env["PGOPTIONS"], "-c jit=off -c close_knit.stage_only=on "
                                           "-c close_knit.coverage_drop_threshold_percent=5")

    def test_activate_stages_only_inside_a_run(self):
        cur = mock.Mock()
        with redirect_stdout(io.StringIO()):
            self.assertFalse(release_guard.activate(cur, "rel-x", {release_guard.STAGE_ONLY_ENV: "1"}))
        cur.execute.assert_not_called()
        self.assertTrue(release_guard.activate(cur, "rel-x", {}))
        cur.execute.assert_called_once_with("SELECT activate_product_release(%s)", ("rel-x",))

    def test_every_activating_loader_goes_through_the_guard(self):
        for name in ("etl_sales.py", "etl_price_release.py", "etl_crime_release.py", "stage_release.py"):
            source = (DEPLOY / "tools" / name).read_text()
            self.assertIn("release_guard.activate(cur, release_id", source, name)
            self.assertNotIn("SELECT activate_product_release", source, name)
        bundle = (DEPLOY / "tools" / "release_bundle.py").read_text()
        self.assertLess(bundle.index("close_knit.stage_only"), bundle.index("PERFORM activate_product_release(rel)"))


class ComposeTests(unittest.TestCase):
    def test_the_run_leaves_one_release_with_every_staged_change(self):
        base = ["src-hmlr-pp-category-a-2026-07", "src-hmlr-pp-sales-2026-07", "src-police-2026-08",
                "src-hmlr-pp-sales-2026-07-england"]
        staged = [
            {"members": [*base, "src-hmlr-pp-category-a-2026-08"], "assets": [], "transformation_versions": {"price": 2}},
            {"members": ["src-hmlr-pp-category-a-2026-07", "src-police-2026-08", "src-hmlr-pp-sales-2026-07-england",
                         "src-hmlr-pp-sales-2026-08"], "assets": ["tiles/sale_tile"],
             "transformation_versions": {"sales": 3}},
            {"members": ["src-hmlr-pp-sales-2026-07", "src-police-2026-08", "src-hmlr-pp-category-a-2026-08-england",
                         "src-hmlr-pp-sales-2026-08-england"], "assets": [], "transformation_versions": {}},
        ]
        parts = release_guard.compose(base, staged)
        self.assertEqual(parts["members"], sorted(["src-police-2026-08", "src-hmlr-pp-category-a-2026-08",
                                                   "src-hmlr-pp-sales-2026-08", "src-hmlr-pp-category-a-2026-08-england",
                                                   "src-hmlr-pp-sales-2026-08-england"]))
        self.assertEqual(parts["replaced"], ["src-hmlr-pp-category-a-2026-07", "src-hmlr-pp-sales-2026-07",
                                             "src-hmlr-pp-sales-2026-07-england"])
        self.assertEqual(parts["assets"], ["tiles/sale_tile"])
        self.assertEqual(parts["transformation_versions"], {"price": 2, "sales": 3})

    def test_a_refusal_names_the_override(self):
        message = release_guard.coverage_refusal("rel-x", {
            "baseline_release": "rel-old", "threshold_percent": 2,
            "drops": [{"layer": "typical-price", "region": "E12000006", "before": 3300, "after": 0,
                       "drop_percent": 100.0}]})
        self.assertIn("typical-price", message)
        self.assertIn("CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT=101", message)
        self.assertIn("NOT activated", message)

    def test_the_release_build_command_is_expanded(self):
        self.assertEqual(etl.expand("${RELEASE_BUILD}", etl.variables({})), f"{sys.executable} -m area_api.release_build")

    def test_release_build_builds_the_staged_release(self):
        self.assertEqual(release_guard.release_build_command("python -m area_api.release_build", "rel-x"),
                         ["python", "-m", "area_api.release_build", "--tiers", "0,1", "--release", "rel-x"])


class RefreshOrderTests(unittest.TestCase):
    def test_the_price_paid_refresh_runs_spine_index_sales_then_the_england_bundle(self):
        ids = [step.id for step in etl.refresh_steps("prices")]
        order = ["prices.address-spine", "prices.price-index", "prices.sales", "prices.bundle"]
        self.assertEqual([step for step in ids if step in order], order)
        self.assertEqual(ids[-1], "prices.bundle")
        self.assertEqual(etl.refresh_steps("prices", "prices.sales")[0].id, "prices.sales")

    def test_a_theme_run_keeps_the_same_order(self):
        ids = [step.id for step in etl.select(["prices"])]
        positions = [ids.index(s) for s in ("prices.address-spine", "prices.price-index", "prices.sales",
                                            "prices.bundle")]
        self.assertEqual(positions, sorted(positions))

    def test_every_step_stages_only_and_the_run_activates_once_at_the_end(self):
        with tempfile.TemporaryDirectory() as folder:
            seen = Path(folder, "seen")
            values = dict(etl.variables({}), LOCK=str(Path(folder, "release.lock")))
            steps = [m.Step(f"prices.s{n}", f"echo {n} `printenv CLOSE_KNIT_STAGE_ONLY` `printenv PGOPTIONS` >> {seen}",
                            lock=n == 2)
                     for n in (1, 2, 3)]
            calls = []

            def finish(url, **kwargs):
                calls.append((seen.read_text().splitlines(), kwargs))
                return "rel-composed"

            with mock.patch.object(etl, "run_start", return_value=("rel-active", "t0")), \
                    redirect_stdout(io.StringIO()):
                live = etl.run_steps(steps, values, dry_run=False, label="prices-refresh", finish=finish)
        self.assertEqual(live, "rel-composed")
        lines, kwargs = calls[0]
        self.assertEqual(len(calls), 1)
        self.assertEqual([line.split()[0] for line in lines], ["1", "2", "3"])  # finish ran after the last step
        self.assertTrue(all(" 1 " in line and "close_knit.stage_only=on" in line for line in lines), lines)
        self.assertEqual((kwargs["base"], kwargs["since"], kwargs["label"]), ("rel-active", "t0", "prices-refresh"))

    def test_a_run_that_stages_nothing_activates_nothing(self):
        finish = mock.Mock()
        with redirect_stdout(io.StringIO()):
            etl.run_steps([m.Step("core.x", "true")], etl.variables({}), dry_run=False, finish=finish)
        finish.assert_not_called()


class DocumentedTests(unittest.TestCase):
    def test_the_checklist_has_the_refresh_command_and_the_rollback_note(self):
        checklist = " ".join((DEPLOY.parent / "RELEASE-CHECKLIST.md").read_text().split())
        self.assertIn("deploy/tools/etl.py refresh prices", checklist)
        self.assertIn("CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT", checklist)
        self.assertIn("does not restore", checklist)
        self.assertIn("bundles/prices/load.sql.gz", checklist)

    def test_preflight_fails_on_the_shared_data_checks(self):
        preflight = (DEPLOY / "preflight.sh").read_text()
        self.assertIn("SELECT ok, check_name, detail FROM release_data_health(true)", preflight)
        self.assertIn('f) fail "$name: $detail"', preflight)

    def test_the_override_is_a_documented_flag(self):
        self.assertIn("CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT", (DEPLOY.parent / "FLAGS.md").read_text())


if __name__ == "__main__":
    unittest.main()
