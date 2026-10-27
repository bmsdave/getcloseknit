"""Issue #208: the £/m² release stores each MSOA's and borough's own rolling series,
with its own sample count and quality (20+ sales to observe, else borough fallback)."""
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import price_index as pi  # noqa: E402
import etl_price_release as etl  # noqa: E402

GEOGRAPHY = [
    {"id": "uk:msoa:E02000821", "kind": "msoa", "official_code": "E02000821",
     "parent_id": "uk:lad:E09000028"},
    {"id": "uk:msoa:E02000822", "kind": "msoa", "official_code": "E02000822",
     "parent_id": "uk:lad:E09000028"},
    {"id": "uk:lad:E09000028", "kind": "lad", "official_code": "E09000028",
     "parent_id": None},
]


def _series():
    """MSOA 821: 18 sales at £6,500/m²; MSOA 822: 30 at £9,000/m²; the borough: all 48."""
    def monthly(value, n):
        return [(pi.month_index("2026-06"), value)] * n

    return {
        "msoa": {"E02000821": pi.Series(monthly(6500.0, 18)),
                 "E02000822": pi.Series(monthly(9000.0, 30))},
        "borough": {"E09000028": pi.Series(monthly(6500.0, 18) + monthly(9000.0, 30))},
        "lsoa": {},
    }, {"linked_sales": 48, "qualifying_sales": 48}


class WiderAreaRowsTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(setattr, etl, "FIRST_PERIOD", etl.FIRST_PERIOD)
        etl.FIRST_PERIOD = "2026-06"

    def test_build_writes_msoa_and_borough_rows_with_their_own_sample_counts(self):
        with mock.patch.object(etl, "load_sales", _series):
            rows, _, _ = etl.build("2026-06", GEOGRAPHY)

        by_id = {row[0]: row for row in rows}
        self.assertIn("uk:lad:E09000028", by_id)
        self.assertEqual(by_id["uk:lad:E09000028"][5:7], [48, "observed"])
        self.assertEqual(by_id["uk:lad:E09000028"][3], 9000.0)
        self.assertEqual(by_id["uk:lad:E09000028"][4], "")  # no LSOA percentile rank
        self.assertIn("uk:msoa:E02000821", by_id)
        self.assertEqual(by_id["uk:msoa:E02000821"][5:7], [18, "fallback"])  # 18 < 20: the borough
        self.assertEqual(by_id["uk:msoa:E02000821"][3], 9000.0)
        self.assertIn("uk:msoa:E02000822", by_id)
        self.assertEqual(by_id["uk:msoa:E02000822"][5:7], [30, "observed"])
        self.assertEqual(by_id["uk:msoa:E02000822"][3], 9000.0)

    def test_build_still_writes_no_lsoa_rows_without_lsoa_sales(self):
        with mock.patch.object(etl, "load_sales", _series):
            rows, _, _ = etl.build("2026-06", GEOGRAPHY)

        self.assertTrue(all(not row[0].startswith("uk:lsoa:") for row in rows))


if __name__ == "__main__":
    unittest.main()
