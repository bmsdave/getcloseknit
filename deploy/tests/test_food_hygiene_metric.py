"""Food hygiene metric: share of rated nearby food places rated 4 or 5, suppression and legend."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import etl_food_hygiene as fh  # noqa: E402

FHRS = {"release_date": "2026-10-06"}


class FoodHygieneMetricTests(unittest.TestCase):
    def test_share_is_a_percentage_of_rated_places(self):
        self.assertEqual(fh.share(8, 6), 75.0)
        self.assertEqual(fh.share(9, 3), 33.3)  # rounds to one decimal

    def test_fewer_than_five_rated_places_is_suppressed(self):
        self.assertIsNone(fh.share(4, 4))
        self.assertIsNone(fh.share(0, 0))
        self.assertEqual(fh.share(5, 5), 100.0)

    def test_aggregate_rows_carry_count_percentile_and_quality(self):
        counts = {"uk:lsoa:E01000003": (10, 9), "uk:lsoa:E01000001": (20, 10), "uk:lsoa:E01000002": (2, 2)}
        values, breakdown = fh.aggregate(counts, "2026-10-01")
        self.assertEqual(values, [
            ["uk:lsoa:E01000001", "food-hygiene", "2026-10-01", 50.0, 0, 20, "observed"],
            ["uk:lsoa:E01000002", "food-hygiene", "2026-10-01", "", "", 2, "suppressed"],
            ["uk:lsoa:E01000003", "food-hygiene", "2026-10-01", 90.0, 100, 10, "observed"],
        ])
        self.assertEqual(breakdown, [
            ["uk:lsoa:E01000001", "food-hygiene", "2026-10-01", "rated-4-or-5", 10],
            ["uk:lsoa:E01000003", "food-hygiene", "2026-10-01", "rated-4-or-5", 9],
        ])

    def test_legend_runs_red_to_green_in_percent(self):
        stops = fh.legend([float(v) for v in range(50, 101)])
        self.assertEqual([stop["colour"] for stop in stops], list(fh.COLOURS))
        self.assertEqual(stops[-1], {"value": 100, "colour": "#3a7d44", "label": "100%"})
        self.assertEqual([stop["value"] for stop in stops], sorted(stop["value"] for stop in stops))
        self.assertEqual(fh.legend([]), [])

    def test_definition_describes_places_not_residents(self):
        definition = fh.definition([80.0, 90.0], FHRS)
        text = " ".join([definition["description"], *definition["caveats"]]).lower()
        self.assertIn("not the people who live in the area", text)
        self.assertNotIn("resident", text)
        self.assertEqual(definition["methodologyPath"], "/guide/getting-around")
        self.assertEqual(definition["freshness"], "2026-10")
        self.assertIn("Open Government Licence", definition["caveats"][-1])
        for key in ("label", "shortLabel", "description", "legend", "sourceId", "sourceName"):
            self.assertTrue(definition[key], key)

    def test_counts_only_rated_food_service_places(self):
        self.assertEqual(fh.BUSINESS_TYPES, (1, 7843, 7844))
        self.assertNotIn("Exempt", fh.RATED)
        self.assertNotIn("AwaitingInspection", fh.RATED)
        self.assertIn("ST_DWithin(f.location::geography, area.point, %(radius)s)", fh.COUNTS_SQL)
        self.assertEqual(fh.RADIUS_METRES, 800)


if __name__ == "__main__":
    unittest.main()
