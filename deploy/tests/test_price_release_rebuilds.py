"""Issue #186: etl_price_release.py must rebuild everything derived from the £/m² index
when it activates a new one, in the etl_sales.py load order."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_price_release  # noqa: E402

SOURCE = (ROOT / "tools" / "etl_price_release.py").read_text()
SALES = (ROOT / "tools" / "etl_sales.py").read_text()

# The index-dependent rebuilds, in the etl_sales.py load order; good value reads the
# freshly rebuilt bands, so it runs last.
CHAIN = ["rebuild_stock_values(%s)", "rebuild_area_price_growth()",
         "rebuild_market_depth()", "rebuild_sale_pins(%s)", "revalue_city_blocks(%s)",
         "rebuild_area_price_bands(%s)", "rebuild_property_sale_bands(%s)",
         "rebuild_zone_analytics(%s)", "rebuild_area_good_value()"]


class PriceReleaseRebuildTests(unittest.TestCase):
    def test_every_index_dependent_rebuild_runs(self):
        for step in CHAIN:
            self.assertIn(f'"{step}"', SOURCE, step)

    def test_rebuilds_follow_the_sales_load_order(self):
        positions = [SOURCE.index(f'"{step}"') for step in CHAIN]
        self.assertEqual(positions, sorted(positions), "rebuild order drifted from etl_sales.py")

    def test_rebuilds_run_before_the_release_is_reported_live(self):
        call = SOURCE.index("        rerun_index_rebuilds(cur)")
        self.assertLess(SOURCE.index("activate_product_release"), call)
        self.assertLess(call, SOURCE.index("activated {release_id}"))

    def test_sales_sourced_rebuilds_use_the_loaded_sales(self):
        self.assertIn("SELECT DISTINCT source_release_id FROM sale", SOURCE)

    def test_sales_load_chain_is_rerun_not_reinvented(self):
        for step in CHAIN:
            if step != "rebuild_area_good_value()":
                self.assertIn(f'"{step}"', SALES)


class DictRowCursor:
    """psycopg dict_row fake: rows are dicts keyed by column name, never tuples."""

    def __init__(self, sales_source):
        self.sales_source = sales_source
        self.calls = []

    def execute(self, sql, args=()):
        self.calls.append((sql, tuple(args)))
        if sql.startswith("SELECT DISTINCT source_release_id"):
            self._row = {"source_release_id": self.sales_source} if self.sales_source else None
        else:
            self._row = {sql.removeprefix("SELECT ").split("(")[0]: 7}
        return self

    def fetchone(self):
        return self._row


class RerunIndexRebuildsTests(unittest.TestCase):
    def test_reads_results_by_column_name_on_dict_rows(self):
        cur = DictRowCursor("src-sales")
        results = etl_price_release.rerun_index_rebuilds(cur)
        self.assertEqual(set(results), {s.split("(")[0] for s in CHAIN})
        self.assertTrue(all(rows == 7 for rows in results.values()), results)
        self.assertEqual([sql for sql, _ in cur.calls[1:]], [f"SELECT {s}" for s in CHAIN])
        self.assertIn(("SELECT rebuild_stock_values(%s)", ("src-sales",)), cur.calls)
        self.assertIn(("SELECT rebuild_area_good_value()", ()), cur.calls)

    def test_sales_sourced_steps_are_skipped_without_sales(self):
        cur = DictRowCursor(None)
        results = etl_price_release.rerun_index_rebuilds(cur)
        self.assertIsNone(results["rebuild_stock_values"])
        self.assertEqual(results["rebuild_area_price_growth"], 7)
        self.assertEqual(results["rebuild_area_good_value"], 7)
        self.assertNotIn("SELECT rebuild_sale_pins(%s)", [sql for sql, _ in cur.calls])


if __name__ == "__main__":
    unittest.main()
