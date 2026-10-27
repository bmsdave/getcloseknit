"""Layers v5 batch 2 in the API: the Supermarket and GP walks read better when shorter, Gigabit broadband
when higher; none is descriptive, so all three can be a find_areas range."""
import unittest

from area_api import layers, matching


def _row(metric_id: str, value: float, percentile: int, unit: str, direction: str) -> dict:
    return {"id": metric_id, "value": value, "region_percentile": percentile, "direction": direction,
            "label": metric_id, "unit": unit, "year_ago": None, "period": "2026-09"}


class BatchTwoTests(unittest.TestCase):
    def test_short_walks_stand_high(self):
        for metric_id in ("supermarket-walk", "gp-walk"):
            tile = layers.layer(_row(metric_id, 3.2, 10, "minutes", "higher-is-more"))
            self.assertEqual(tile["standing"], 90, metric_id)
            self.assertEqual(tile["display"], "3 min", metric_id)

    def test_more_gigabit_stands_high(self):
        tile = layers.layer(_row("broadband-gigabit", 97.4, 80, "%", "higher-is-better"))
        self.assertEqual((tile["standing"], tile["display"]), (80, "97.4%"))

    def test_all_three_can_be_ranges(self):
        for metric_id in ("supermarket-walk", "gp-walk", "broadband-gigabit"):
            self.assertFalse(matching.is_descriptive_layer(metric_id), metric_id)
        matching.validate_ranges([{"layer": "supermarket-walk", "max": 10, "importance": 3},
                                  {"layer": "broadband-gigabit", "min": 90, "importance": 2}])


if __name__ == "__main__":
    unittest.main()
