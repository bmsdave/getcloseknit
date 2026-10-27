import unittest

from area_analytics.school_admissions import (
    AdmissionObservation,
    VerifiedPriorityBoundary,
    build_admission_evidence,
)


class SchoolAdmissionTests(unittest.TestCase):
    def test_verified_reusable_boundary_takes_precedence(self):
        boundary = VerifiedPriorityBoundary("2026/27", "council-release-v1", True)

        evidence = build_admission_evidence([], 500, verified_boundary=boundary)

        self.assertEqual(evidence.kind, "verified-boundary")
        self.assertEqual(evidence.boundary, boundary)
        self.assertFalse(evidence.is_probability)

    def test_three_comparable_years_produce_factual_historical_reach(self):
        observations = [
            AdmissionObservation(2023, 900, "straight-line", "distance", "site-a", "source-2023"),
            AdmissionObservation(2024, 750, "straight-line", "distance", "site-a", "source-2024"),
            AdmissionObservation(2025, 820, "straight-line", "distance", "site-a", "source-2025"),
        ]

        evidence = build_admission_evidence(observations, home_distance_metres=800)

        self.assertEqual(evidence.kind, "historical-reach")
        self.assertEqual(evidence.years_within, 2)
        self.assertEqual(evidence.years_observed, 3)
        self.assertFalse(evidence.is_probability)

    def test_changed_rule_or_too_few_years_returns_unavailable(self):
        observations = [
            AdmissionObservation(2023, 900, "straight-line", "distance", "site-a", "source-2023"),
            AdmissionObservation(2024, 750, "walking", "distance", "site-a", "source-2024"),
            AdmissionObservation(2025, 820, "straight-line", "catchment", "site-a", "source-2025"),
        ]

        evidence = build_admission_evidence(observations, home_distance_metres=800)

        self.assertEqual(evidence.kind, "unavailable")
        self.assertEqual(evidence.years_observed, 0)


class PilotAdmissionTests(unittest.TestCase):
    def test_conflicting_measurement_methods_are_unavailable(self):
        from area_analytics.school_admissions import (
            AuthorityGuide,
            PriorityCutoff,
            assess_pilot_admissions,
        )

        cutoffs = [
            PriorityCutoff("2023/24", "distance", 900, "straight-line", "https://example.invalid/a23", "rel-23"),
            PriorityCutoff("2024/25", "distance", 750, "walking-route", "https://example.invalid/a24", "rel-24"),
            PriorityCutoff("2025/26", "distance", 820, "straight-line", "https://example.invalid/a25", "rel-25"),
        ]
        guide = AuthorityGuide(
            "E09000033", "Westminster", "2026/27",
            ("sibling priority", "distance"), "straight-line",
            "no priority area published", "https://example.invalid/guide", "rel-26",
        )

        assessment = assess_pilot_admissions(
            cutoffs, 700, guide=guide, expected_years=("2023/24", "2024/25", "2025/26"),
        )

        self.assertEqual(assessment.claim, "unavailable")
        self.assertTrue(assessment.conflicting)
        self.assertFalse(assessment.is_probability)

    def test_multiple_priority_groups_never_merge_into_one_reach(self):
        from area_analytics.school_admissions import PriorityCutoff, assess_pilot_admissions

        cutoffs = [
            PriorityCutoff("2023/24", "distance", 900, "straight-line", "https://example.invalid/a23", "rel-23"),
            PriorityCutoff("2024/25", "distance", 750, "straight-line", "https://example.invalid/a24", "rel-24"),
            PriorityCutoff("2025/26", "distance", 820, "straight-line", "https://example.invalid/a25", "rel-25"),
            PriorityCutoff("2025/26", "sibling", 2500, "straight-line", "https://example.invalid/a25", "rel-25"),
        ]

        assessment = assess_pilot_admissions(
            cutoffs, 800, expected_years=("2023/24", "2024/25", "2025/26"),
        )

        self.assertEqual(assessment.years_observed, 3)
        self.assertIn("sibling", assessment.explanation)

    def test_missing_recent_year_is_unavailable_with_gap(self):
        from area_analytics.school_admissions import PriorityCutoff, assess_pilot_admissions

        cutoffs = [
            PriorityCutoff("2022/23", "distance", 900, "straight-line", "https://example.invalid/a22", "rel-22"),
            PriorityCutoff("2023/24", "distance", 750, "straight-line", "https://example.invalid/a23", "rel-23"),
        ]

        assessment = assess_pilot_admissions(
            cutoffs, 700, expected_years=("2022/23", "2023/24", "2024/25", "2025/26"),
        )

        self.assertEqual(assessment.claim, "unavailable")
        self.assertIn("2025/26", assessment.missing_years)
        self.assertIn("gap", assessment.explanation)

    def test_property_just_within_historical_distance_gets_no_guarantee(self):
        from area_analytics.school_admissions import PriorityCutoff, assess_pilot_admissions

        cutoffs = [
            PriorityCutoff("2023/24", "distance", 900, "straight-line", "https://example.invalid/a23", "rel-23"),
            PriorityCutoff("2024/25", "distance", 750, "straight-line", "https://example.invalid/a24", "rel-24"),
            PriorityCutoff("2025/26", "distance", 820, "straight-line", "https://example.invalid/a25", "rel-25"),
        ]

        assessment = assess_pilot_admissions(
            cutoffs, 819, expected_years=("2023/24", "2024/25", "2025/26"),
        )

        self.assertNotEqual(assessment.claim, "guaranteed-place")
        self.assertEqual(assessment.claim, "historical-only")
        self.assertIn("distance alone", assessment.explanation)
        self.assertFalse(assessment.is_probability)

    def test_admission_probabilities_are_unsupported(self):
        from area_analytics.school_admissions import estimate_admission_probability

        with self.assertRaises(ValueError):
            estimate_admission_probability([], 800)

    def test_pilot_authority_coverage_is_reported(self):
        from area_analytics.school_admissions import (
            PILOT_ADMISSION_AUTHORITIES,
            pilot_admission_coverage,
        )

        inside = pilot_admission_coverage(PILOT_ADMISSION_AUTHORITIES[0].code)
        outside = pilot_admission_coverage("E09000099")

        self.assertTrue(inside.covered)
        self.assertFalse(outside.covered)
        self.assertEqual(len(inside.pilot_codes), len(PILOT_ADMISSION_AUTHORITIES))
        self.assertGreaterEqual(len(PILOT_ADMISSION_AUTHORITIES), 2)

    def test_admission_questions_record_without_child_details(self):
        from area_analytics.school_admissions import (
            AdmissionQuestion,
            record_admission_question,
        )

        questions = record_admission_question([], "What counts as sibling priority?")

        self.assertEqual(len(questions), 1)
        self.assertIsInstance(questions[0], AdmissionQuestion)
        self.assertFalse(hasattr(questions[0], "child_age"))
        self.assertFalse(hasattr(questions[0], "child_name"))
        self.assertFalse(hasattr(questions[0], "date_of_birth"))


if __name__ == "__main__":
    unittest.main()
