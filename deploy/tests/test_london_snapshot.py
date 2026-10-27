"""The London diff: 200 London cells, the tolerance, intentional differences and the rolled-back probe."""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import area_coverage  # noqa: E402
import etl_manifest as m  # noqa: E402
import london_snapshot as ls  # noqa: E402


def cell(metric="crime", area="uk:lsoa:E01000001", value=10.0, pct=50, quality="observed", theme="crime"):
    return {"theme": theme, "metric": metric, "area": area, "period": "2026-08-01", "value": value,
            "percentile": pct, "quality": quality}


class SnapshotFileTests(unittest.TestCase):
    def test_two_hundred_london_cells_across_the_themes(self):
        cells = ls.load()
        self.assertEqual(len(cells), 200)
        self.assertEqual(len({ls.key(item) for item in cells}), 200)
        counts = {theme: sum(item["theme"] == theme for item in cells) for theme in m.SNAPSHOT_CELLS}
        self.assertEqual(counts, m.SNAPSHOT_CELLS)
        for item in cells:
            self.assertIn(item["metric"], m.THEME_METRICS[item["theme"]])
            code = item["area"].rsplit(":", 1)[1]
            self.assertEqual(area_coverage.region_of_code(code), area_coverage.LONDON_REGION, item["area"])


class CompareTests(unittest.TestCase):
    def test_equal_within_the_tolerance(self):
        report = ls.compare([cell()], {ls.key(cell()): {"value": 10.0000001, "percentile": 50, "quality": "observed"}})
        self.assertEqual(report["crime"]["equal"], 1)
        self.assertFalse(ls.failed(report))

    def test_a_changed_value_percentile_or_quality_fails(self):
        for new in ({"value": 10.5, "percentile": 50, "quality": "observed"},
                    {"value": 10.0, "percentile": 51, "quality": "observed"},
                    {"value": 10.0, "percentile": 50, "quality": "fallback"},
                    {"value": None, "percentile": None, "quality": "observed"}):
            report = ls.compare([cell()], {ls.key(cell()): new})
            self.assertTrue(ls.failed(report), new)
            self.assertEqual(report["crime"]["changed"][0]["old"], 10.0)

    def test_a_missing_row_fails(self):
        report = ls.compare([cell()], {})
        self.assertEqual(len(report["crime"]["missing"]), 1)
        self.assertTrue(ls.failed(report))

    def test_an_intentional_difference_is_listed_and_passes(self):
        item = cell(metric="gp-walk", theme="civic")
        report = ls.compare([item], {ls.key(item): {"value": 11.0, "percentile": 50, "quality": "observed"}},
                            {"gp-walk": "newer GP list"})
        self.assertFalse(ls.failed(report))
        self.assertEqual(report["civic"]["intentional"][0]["why"], "newer GP list")
        self.assertIn("(intentional) gp-walk", ls.summary(report))

    def test_pick_takes_each_themes_metrics_in_turn(self):
        rows = [("crime", f"uk:lsoa:E0100000{i}", "2026-08-01", float(i), i, "observed") for i in range(5)]
        rows += [("income", "uk:msoa:E02000001", "2023-03-01", 1.0, 1, "observed"),
                 ("deprivation", "uk:lsoa:E01000001", "2025-01-01", 2.0, 2, "observed")]
        cells = ls.pick(rows, {"crime": 3, "people": 2})
        self.assertEqual([item["area"] for item in cells[:3]], ["uk:lsoa:E01000000", "uk:lsoa:E01000001",
                                                                 "uk:lsoa:E01000002"])
        self.assertEqual({item["metric"] for item in cells[3:]}, {"deprivation", "income"})


class FakeConnection:
    row_factory = "tuple"

    def __init__(self):
        self.calls = []

    def cursor(self, *args, **kwargs):
        self.calls.append(("cursor", kwargs.get("row_factory")))
        return self

    def execute(self, query, params=None):
        self.calls.append(("execute", query))
        return self

    def commit(self):
        self.calls.append("REAL COMMIT")


class ProbeTests(unittest.TestCase):
    def test_a_probed_loader_cannot_commit_close_or_leave_the_transaction(self):
        real = FakeConnection()
        with ls.SharedConnection(real, "dict") as conn:
            conn.autocommit = True
            conn.execute("DELETE FROM metric_value")
            conn.commit()
            conn.close()
        self.assertNotIn("REAL COMMIT", real.calls)
        self.assertEqual(real.calls[0], ("cursor", "dict"))
        self.assertEqual(conn.row_factory, "dict")
        self.assertFalse(hasattr(real, "autocommit"))
        with self.assertRaises(RuntimeError):
            conn.rollback()

    def test_command_line_splits_environment_and_arguments(self):
        values = {"PY": "/venv/python", "DB": "postgresql://h/db", "W": "/w"}
        parts = ls.command_line("AE_WORK=${W}/hpi ${PY} etl_uk_hpi.py download && ${PY} etl_uk_hpi.py load ${DB}",
                                values)
        self.assertEqual(parts, [({"AE_WORK": "/w/hpi"}, ["etl_uk_hpi.py", "download"]),
                                 ({}, ["etl_uk_hpi.py", "load", "postgresql://h/db"])])


@unittest.skipUnless(os.environ.get("CLOSE_KNIT_ETL_DB"), "set CLOSE_KNIT_ETL_DB to check the ETL database")
class EtlDatabaseTests(unittest.TestCase):
    def test_london_cells_match_the_snapshot(self):
        import psycopg

        cells = ls.load()
        with psycopg.connect(os.environ["CLOSE_KNIT_ETL_DB"]) as conn:
            report = ls.compare(cells, ls.read(conn.cursor(), cells))
        self.assertFalse(ls.failed(report), ls.summary(report))


if __name__ == "__main__":
    unittest.main()
