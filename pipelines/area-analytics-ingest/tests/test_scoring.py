import unittest

from area_analytics.scoring import FactorObservation, FactorPreference, score_area


class ScoringTests(unittest.TestCase):
    def test_weighted_match_explains_contributions_and_ignores_zero_weights(self):
        result = score_area(
            "uk:lsoa:E01000001",
            observations={
                "crime": FactorObservation(40, 80, "uk:lsoa:E01000001", "observed"),
                "income": FactorObservation(55_000, 60, "uk:msoa:E02000001", "observed"),
                "social-renting": FactorObservation(15, 5, "uk:lsoa:E01000001", "observed"),
            },
            preferences={
                "crime": FactorPreference(weight=3),
                "income": FactorPreference(weight=1),
                "social-renting": FactorPreference(weight=0),
            },
        )

        self.assertEqual(result.score, 75)
        self.assertEqual(result.evidence_completeness, 100)
        self.assertEqual([component.factor_id for component in result.components], ["crime", "income"])
        self.assertAlmostEqual(sum(component.contribution for component in result.components), 75)

    def test_missing_soft_evidence_renormalises_score_and_lowers_completeness(self):
        result = score_area(
            "uk:lsoa:E01000001",
            observations={"crime": FactorObservation(40, 80, "uk:lsoa:E01000001", "observed")},
            preferences={
                "crime": FactorPreference(weight=1),
                "income": FactorPreference(weight=1),
            },
        )

        self.assertEqual(result.score, 80)
        self.assertEqual(result.evidence_completeness, 50)
        self.assertFalse(result.excluded)

    def test_missing_or_failed_must_have_evidence_excludes_area(self):
        missing = score_area(
            "uk:lsoa:E01000001",
            observations={},
            preferences={"commute": FactorPreference(weight=5, maximum_utility=40)},
        )
        failed = score_area(
            "uk:lsoa:E01000001",
            observations={
                "commute": FactorObservation(70, 35, "uk:lsoa:E01000001", "observed")
            },
            preferences={"commute": FactorPreference(weight=5, minimum_utility=60)},
        )

        self.assertTrue(missing.excluded)
        self.assertEqual(missing.unmet_limits, ("commute:missing",))
        self.assertTrue(failed.excluded)
        self.assertEqual(failed.unmet_limits, ("commute:below-minimum",))


if __name__ == "__main__":
    unittest.main()
