import unittest

from area_analytics.utilities import empirical_percentile, preference_utility


class UtilityTests(unittest.TestCase):
    def test_empirical_percentile_uses_london_distribution(self):
        self.assertEqual(empirical_percentile(30, [10, 20, 30, 40, 50]), 50)

    def test_direction_and_target_range_are_explicit(self):
        self.assertEqual(preference_utility(80, "higher"), 80)
        self.assertEqual(preference_utility(80, "lower"), 20)
        self.assertEqual(preference_utility(50, "target-range"), 100)
        self.assertEqual(preference_utility(80, "target-range"), 40)


if __name__ == "__main__":
    unittest.main()
