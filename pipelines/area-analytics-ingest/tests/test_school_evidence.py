import unittest

from area_analytics.school_evidence import (
    DirectoryEntry,
    InspectionObservation,
    PerformanceObservation,
    apply_cohort_suppression,
    build_directory,
    directory_history,
    inspection_shape,
    missing_observation_kinds,
    observations_for_urn,
    require_reviewed_school_source,
    resolve_current_urn,
    score_parent_priorities,
)


DIRECTORY_ROWS = [
    {
        "urn": "100003",
        "name": "Old Town Primary",
        "previous_names": [],
        "phase": "primary",
        "status": "closed",
        "closed_date": "2024-08-31",
        "predecessor_urn": None,
        "successor_urn": "100004",
        "source_release_id": "directory-fixture-2026-09",
    },
    {
        "urn": "100004",
        "name": "New Town Academy",
        "previous_names": ["Old Town Primary"],
        "phase": "primary",
        "status": "open",
        "closed_date": None,
        "predecessor_urn": "100003",
        "successor_urn": None,
        "source_release_id": "directory-fixture-2026-09",
    },
]


def directory():
    return build_directory(DIRECTORY_ROWS, "directory-fixture-2026-09")


class SchoolDirectoryTests(unittest.TestCase):
    def test_closed_school_resolves_to_its_successor(self):
        resolved = resolve_current_urn(directory(), "100003")

        self.assertEqual(resolved, "100004")

    def test_closed_entry_keeps_closure_date_and_status(self):
        entry = directory()["100003"]

        self.assertIsInstance(entry, DirectoryEntry)
        self.assertEqual(entry.status, "closed")
        self.assertEqual(entry.closed_date, "2024-08-31")
        self.assertEqual(entry.successor_urn, "100004")

    def test_changed_urn_tracks_predecessor_successor_and_renaming(self):
        history = directory_history(directory(), "100004")

        self.assertEqual([entry.urn for entry in history], ["100003", "100004"])
        self.assertEqual(history[-1].predecessor_urn, "100003")
        self.assertIn("Old Town Primary", history[-1].previous_names)

    def test_unknown_urn_cannot_resolve(self):
        with self.assertRaisesRegex(ValueError, "unknown URN"):
            resolve_current_urn(directory(), "999999")


class SchoolObservationTests(unittest.TestCase):
    def test_missing_cohort_is_tracked_not_silent(self):
        observations = [
            PerformanceObservation("100004", "2024/25", "progress", 0.4, None,
                                   "performance-fixture-2026-09"),
        ]

        missing = missing_observation_kinds(observations, [])

        self.assertIn("progress:2024/25:cohort-size", missing)

    def test_small_suppressed_sample_stays_explicit(self):
        observations = [
            PerformanceObservation("100004", "2024/25", "attainment", 62.0, 4,
                                   "performance-fixture-2026-09"),
        ]

        suppressed = apply_cohort_suppression(observations, minimum_cohort=10)

        self.assertTrue(suppressed[0].suppressed)
        self.assertEqual(suppressed[0].value, 62.0)
        self.assertEqual(suppressed[0].cohort_size, 4)

    def test_adequate_cohort_is_not_suppressed(self):
        observations = [
            PerformanceObservation("100004", "2024/25", "attainment", 62.0, 120,
                                   "performance-fixture-2026-09"),
        ]

        suppressed = apply_cohort_suppression(observations, minimum_cohort=10)

        self.assertFalse(suppressed[0].suppressed)

    def test_legacy_and_current_inspection_shapes_stay_distinct(self):
        legacy = InspectionObservation("100004", "2019/20", "legacy-overall",
                                       None, "Good", "ofsted-fixture-2026-09")
        current = InspectionObservation("100004", "2024/25", "report-card",
                                        {"achievement": 3}, None,
                                        "ofsted-fixture-2026-09")

        self.assertEqual(inspection_shape(legacy), "legacy-overall")
        self.assertEqual(inspection_shape(current), "report-card")

    def test_mixed_legacy_and_current_shapes_are_rejected(self):
        mixed = InspectionObservation("100004", "2024/25", "legacy-overall",
                                      {"achievement": 3}, "Good",
                                      "ofsted-fixture-2026-09")

        with self.assertRaisesRegex(ValueError, "legacy"):
            inspection_shape(mixed)

    def test_observations_key_to_the_current_entity(self):
        performances = [
            PerformanceObservation("100003", "2023/24", "attainment", 58.0, 90,
                                   "performance-fixture-2026-09"),
        ]

        resolved, _ = observations_for_urn(directory(), performances, [], "100003")

        self.assertEqual(resolved, "100004")

    def test_every_observation_links_its_publisher_record(self):
        performances = [
            PerformanceObservation("100004", "2024/25", "attainment", 62.0, 120,
                                   "performance-fixture-2026-09"),
        ]
        inspections = [
            InspectionObservation("100004", "2024/25", "report-card",
                                  {"achievement": 3}, None, "ofsted-fixture-2026-09"),
        ]

        _, bundled = observations_for_urn(directory(), performances, inspections, "100004")

        records = [item.source_release_id for group in bundled for item in group]
        self.assertTrue(records)
        self.assertTrue(all(record for record in records))


class SchoolPriorityTests(unittest.TestCase):
    def test_parent_priorities_weight_facets_without_a_universal_score(self):
        score = score_parent_priorities(
            {"progress": 80, "attendance": 40},
            {"progress": 4, "attendance": 2},
        )

        self.assertEqual(score.value, 67)
        self.assertEqual(score.evidence_completeness, 100)

    def test_missing_priorities_raise_instead_of_using_a_default_score(self):
        with self.assertRaisesRegex(ValueError, "parent priorities"):
            score_parent_priorities({"progress": 80}, {})


class SchoolSourceTests(unittest.TestCase):
    def test_unresolved_council_terms_stay_blocked(self):
        with self.assertRaisesRegex(ValueError, "blocked"):
            require_reviewed_school_source("la-admissions-ealing")

    def test_gias_passes_review_under_the_open_government_licence(self):
        self.assertEqual(require_reviewed_school_source("dfe-gias").licence, "OGL-3.0")

    def test_approved_publisher_terms_pass_review(self):
        source = require_reviewed_school_source("ofsted")

        self.assertEqual(source.publisher, "Ofsted")


if __name__ == "__main__":
    unittest.main()
