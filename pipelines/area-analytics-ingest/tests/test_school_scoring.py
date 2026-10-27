import unittest

from area_analytics.school_scoring import school_access_utility, weighted_school_facets


class SchoolScoringTests(unittest.TestCase):
    def test_missing_desired_options_score_zero(self):
        self.assertEqual(school_access_utility([90, 60], desired_count=3), 50)

    def test_user_facets_are_weighted_without_a_house_defined_rating(self):
        score = weighted_school_facets(
            {"progress": 80, "attendance": 40, "parent-view": None},
            {"progress": 4, "attendance": 2, "parent-view": 5},
        )

        self.assertEqual(score.value, 67)
        self.assertEqual(score.evidence_completeness, 55)


if __name__ == "__main__":
    unittest.main()
