"""Noise map layer: share of homes at 55 dB Lden or more per LSOA, suppression and a fixed legend."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import etl_noise_layer as nl  # noqa: E402


class NoiseLayerTests(unittest.TestCase):
    def test_share_is_a_percentage_of_homes(self):
        self.assertEqual(nl.share(400, 0.43), 43.0)
        self.assertEqual(nl.share(30, 0.3333), 33.3)

    def test_few_homes_or_no_share_is_suppressed(self):
        self.assertIsNone(nl.share(9, 0.5))
        self.assertIsNone(nl.share(100, None))
        self.assertEqual(nl.share(10, 0.0), 0.0)

    def test_aggregate_rows_carry_count_percentile_and_quality(self):
        rows = {"uk:lsoa:E01000003": (50, 0.9), "uk:lsoa:E01000001": (200, 0.1), "uk:lsoa:E01000002": (3, 0.5)}
        self.assertEqual(nl.aggregate(rows, "2022-12-01"), [
            ["uk:lsoa:E01000001", "noise", "2022-12-01", 10.0, 0, 200, "observed"],
            ["uk:lsoa:E01000002", "noise", "2022-12-01", "", "", 3, "suppressed"],
            ["uk:lsoa:E01000003", "noise", "2022-12-01", 90.0, 100, 50, "observed"],
        ])

    def test_definition_runs_quiet_green_to_loud_red(self):
        legend = nl.definition()["legend"]
        self.assertEqual(legend[0]["colour"], "#3a7d44")
        self.assertEqual(legend[-1]["colour"], "#b23a48")
        self.assertEqual([stop["value"] for stop in legend], sorted(stop["value"] for stop in legend))


if __name__ == "__main__":
    unittest.main()
