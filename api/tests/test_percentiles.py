"""One London percentile rule for tied values (issue #221)."""
import unittest

from area_api.percentiles import competition_percentiles


class CompetitionPercentileTests(unittest.TestCase):
    def test_tied_values_share_the_percentile_of_their_lowest_position(self):
        # 319 LSOAs tied for least deprived, then 3 more: the tie is 0 (as SQL percent_rank), the rest
        # count the 319 below them.
        values = {f"E0{i:04d}": 0.0 for i in range(319)} | {"A": 1.0, "B": 1.0, "C": 2.0}
        pct = competition_percentiles(values)
        self.assertEqual({pct[f"E0{i:04d}"] for i in range(319)}, {0})
        self.assertEqual((pct["A"], pct["B"], pct["C"]), (round(100 * 319 / 321), round(100 * 319 / 321), 100))

    def test_ends_are_0_and_100_and_missing_values_get_none(self):
        self.assertEqual(competition_percentiles({"a": 10.0, "b": None, "c": 30.0, "d": 20.0}), {"a": 0, "c": 100, "d": 50})
        self.assertEqual(competition_percentiles({"a": 1.0, "b": None}), {"a": 0})
        self.assertEqual(competition_percentiles({"b": None}), {})

    def test_all_equal_values_are_all_0(self):
        self.assertEqual(competition_percentiles({"a": 100.0, "b": 100.0}), {"a": 0, "b": 0})


if __name__ == "__main__":
    unittest.main()
