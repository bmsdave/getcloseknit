"""Postcode sector zones (migration 057) and the ONS CPIH loader."""
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_cpih  # noqa: E402

FIXTURE = ROOT.parent / "pipelines" / "area-analytics-ingest" / "tests" / "fixtures" / "acquisition" / "ons-cpih-sample.csv"
ONS_CSV = '''"Title","CPIH INDEX 00: ALL ITEMS 2015=100"
"CDID","L522"
"Release date","16-09-2026"
"Important notes",
"2025","139.0"
"2025 Q4","140.1"
"2025 DEC","140.5"
"2026 JAN","140.2"
'''


class CpihTests(unittest.TestCase):
    def test_fixture_months(self):
        rows, released = etl_cpih.parse_csv(str(FIXTURE))
        self.assertEqual(rows[0], (date(2024, 1, 1), 126.4))
        self.assertEqual(len(rows), 3)
        self.assertIsNone(released)

    def test_ons_generator_csv_keeps_months_only(self):
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as handle:
            handle.write(ONS_CSV)
        rows, released = etl_cpih.parse_csv(handle.name)
        self.assertEqual(rows, [(date(2025, 12, 1), 140.5), (date(2026, 1, 1), 140.2)])
        self.assertEqual(released, date(2026, 9, 16))


class MigrationTests(unittest.TestCase):
    def test_migration_is_rebuilt_after_sales_loads(self):
        migration = (ROOT / "migrations" / "057-postcode-sector.sql").read_text()
        for table in ("postcode_sector", "postcode_district", "cpih_month", "zone_ppm_distribution",
                      "zone_price_index", "zone_street", "rebuild_zone_analytics"):
            self.assertIn(table, migration)
        sales = (ROOT / "tools" / "etl_sales.py").read_text()
        self.assertLess(sales.index("rebuild_area_price_bands(%s)"), sales.index("rebuild_zone_analytics(%s)"))


if __name__ == "__main__":
    unittest.main()
