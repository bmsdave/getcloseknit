"""AE-26 planning-context tests: failing first per the common acceptance gate.

Covers duplicate national references, withdrawn applications, boroughs
outside the pilot coverage, stale national entries, and overlapping
constraints. An empty search reports no records in the covered dataset,
never that no development or constraints exist; no absolute no-risk
message exists anywhere in the module. Record joins are validated
against the small reviewed reference fixture, not inline copies.
"""

import unittest
from datetime import date
from pathlib import Path

FIXTURE = (
    Path(__file__).parent / "fixtures" / "planning" / "national-sample.json"
)
AS_OF = date(2026, 9, 6)
BANNED_PHRASES = (
    "no development",
    "no constraints exist",
    "no planning risk",
    "no risk",
    "guaranteed",
    "safe to assume",
)


def load_sample():
    from area_analytics.planning_context import load_pilot_sample

    return load_pilot_sample(FIXTURE)


def unique_records():
    from area_analytics.planning_context import deduplicate_applications

    return deduplicate_applications(load_sample().applications)


class DuplicateReferenceTests(unittest.TestCase):
    def test_duplicate_references_collapse_to_one_record(self):
        sample = load_sample()
        records = unique_records()

        self.assertEqual(len(sample.applications), 8)
        self.assertEqual(len(records), 7)
        references = [record.reference for record in records]
        self.assertEqual(len(set(references)), len(references))

    def test_deduplication_keeps_the_latest_national_entry(self):
        records = unique_records()
        kept = next(
            record for record in records
            if record.reference == "26/01024/FULL"
        )

        self.assertEqual(str(kept.updated), "2026-08-20")


class WithdrawnApplicationTests(unittest.TestCase):
    def test_withdrawn_applications_leave_nearby_results(self):
        from area_analytics.planning_context import search_nearby

        result = search_nearby(unique_records(), "E09000033")

        self.assertEqual(result.status, "records")
        self.assertEqual(
            sorted(record.reference for record in result.records),
            ["24/05110/FULL", "25/08711/FULL", "26/01024/FULL"],
        )
        self.assertEqual(result.withdrawn_excluded, 1)

    def test_withdrawn_applications_stay_labelled_not_silent(self):
        from area_analytics.planning_context import withdrawn_applications

        withdrawn = withdrawn_applications(unique_records(), "E09000033")

        self.assertEqual(len(withdrawn), 1)
        self.assertEqual(withdrawn[0].reference, "25/09120/FULL")
        self.assertEqual(withdrawn[0].status, "withdrawn")
        self.assertIn("withdrawn", withdrawn[0].explanation.lower())


class CoverageTests(unittest.TestCase):
    def test_pilot_boroughs_match_the_reviewed_reference_fixture(self):
        from area_analytics.planning_context import PILOT_BOROUGHS

        sample = load_sample()

        self.assertEqual(tuple(sample.coverage.boroughs), PILOT_BOROUGHS)
        self.assertEqual(sample.source_id, "planning-data-uk-applications")
        self.assertEqual(sample.dataset, "planning-application")

    def test_borough_outside_the_pilot_reports_unknown_not_absent(self):
        from area_analytics.planning_context import search_nearby

        result = search_nearby(unique_records(), "E09000028")

        self.assertEqual(result.status, "no-coverage")
        self.assertEqual(result.records, ())
        self.assertIn("coverage", result.message.lower())
        self.assertIn("unknown", result.message.lower())

    def test_empty_search_names_the_covered_dataset(self):
        from area_analytics.planning_context import search_nearby

        result = search_nearby(
            unique_records(), "E09000007", stage="completed")

        self.assertEqual(result.status, "no-records")
        self.assertEqual(result.records, ())
        self.assertIn("no records were returned", result.message.lower())
        self.assertIn("covered dataset", result.message.lower())
        for phrase in BANNED_PHRASES:
            self.assertNotIn(phrase, result.message.lower())

    def test_no_absolute_no_risk_message_exists(self):
        import area_analytics.planning_context as planning
        from area_analytics.planning_context import search_nearby

        messages = [
            planning.empty_search_message("E09000007"),
            planning.no_coverage_message("E09000028"),
            search_nearby(unique_records(), "E09000028").message,
            search_nearby(
                unique_records(), "E09000007", stage="completed").message,
        ]
        for message in messages:
            with self.subTest(message=message):
                for phrase in BANNED_PHRASES:
                    self.assertNotIn(phrase, message.lower())


class CurrencyTests(unittest.TestCase):
    def test_stale_national_entries_are_flagged(self):
        from area_analytics.planning_context import check_currency

        sample = load_sample()
        stale = next(
            record for record in unique_records()
            if record.reference == "2025/4412/P"
        )
        state = check_currency(stale, sample.dataset_updated, AS_OF)

        self.assertEqual(state.status, "stale")
        self.assertIn("stale", state.explanation.lower())

    def test_current_entries_pass_the_currency_check(self):
        from area_analytics.planning_context import check_currency

        sample = load_sample()
        fresh = next(
            record for record in unique_records()
            if record.reference == "26/01024/FULL"
        )
        state = check_currency(fresh, sample.dataset_updated, AS_OF)

        self.assertEqual(state.status, "current")

    def test_entries_without_an_update_date_are_unverified(self):
        from area_analytics.planning_context import check_currency

        sample = load_sample()
        undated = next(
            record for record in unique_records()
            if record.reference == "2026/0455/P"
        )
        state = check_currency(undated, sample.dataset_updated, AS_OF)

        self.assertEqual(state.status, "unverified")
        self.assertIn("unverified", state.explanation.lower())


class ConstraintTests(unittest.TestCase):
    def test_overlapping_constraints_stay_separately_named(self):
        from area_analytics.planning_context import constraints_for

        names = constraints_for("25/08711/FULL", unique_records())

        self.assertEqual(
            sorted(names),
            ["article-4-direction", "westminster-conservation-area"],
        )

    def test_no_merged_constraint_score_exists(self):
        import area_analytics.planning_context as planning

        self.assertFalse(hasattr(planning, "constraint_score"))
        self.assertFalse(hasattr(planning, "constraintScore"))
        self.assertFalse(hasattr(planning, "planning_score"))
        self.assertFalse(hasattr(planning, "planningScore"))

    def test_planning_risk_prediction_is_unsupported(self):
        from area_analytics.planning_context import estimate_planning_risk

        with self.assertRaisesRegex(ValueError, "unsupported"):
            estimate_planning_risk("26/01024/FULL", unique_records())


class StageTests(unittest.TestCase):
    def test_planned_approved_and_completed_stay_distinct(self):
        from area_analytics.planning_context import (
            search_nearby,
            stage_counts,
        )

        records = unique_records()
        counts = stage_counts(records)

        self.assertEqual(
            counts, {"planned": 3, "approved": 2, "completed": 1})
        planned = search_nearby(records, "E09000033", stage="planned")
        approved = search_nearby(records, "E09000033", stage="approved")
        self.assertEqual(
            [record.reference for record in planned.records],
            ["26/01024/FULL"],
        )
        self.assertEqual(
            [record.reference for record in approved.records],
            ["25/08711/FULL"],
        )

    def test_unknown_stages_are_rejected(self):
        from area_analytics.planning_context import search_nearby

        with self.assertRaisesRegex(ValueError, "unknown planning stage"):
            search_nearby(unique_records(), "E09000033", stage="decided")


class RegistryAndAdapterTests(unittest.TestCase):
    def test_registry_records_authority_status_dates_and_coverage(self):
        from area_analytics.sources import source_definition

        source = source_definition("planning-data-uk-applications")

        for field in ("purpose", "scenario", "resolution",
                      "publication_date", "coverage"):
            self.assertTrue(getattr(source, field), field)
        combined = " ".join((
            source.purpose, source.scenario, source.resolution,
            source.publication_date, source.coverage,
        )).lower()
        self.assertIn("proposal", combined)
        self.assertIn("decision", combined)
        self.assertIn("withdrawn", combined)
        self.assertIn("coverage", combined)

    def test_pilot_boroughs_resolve_to_the_national_source(self):
        from area_analytics.planning_context import borough_source

        sample = load_sample()
        for borough in ("E09000033", "E09000007"):
            self.assertEqual(
                borough_source(borough, sample.coverage),
                "planning-data-uk-applications",
            )

    def test_uncovered_boroughs_get_no_scraped_adapter(self):
        from area_analytics.planning_context import borough_source

        sample = load_sample()
        with self.assertRaisesRegex(ValueError, "no permitted.*interface"):
            borough_source("E09000028", sample.coverage)

    def test_every_record_links_its_council_register(self):
        from area_analytics.planning_context import council_register_url

        url = council_register_url(next(
            record for record in unique_records()
            if record.reference == "26/01024/FULL"
        ))

        self.assertIn("westminster.gov.uk", url)
        self.assertIn("26/01024/FULL", url)


if __name__ == "__main__":
    unittest.main()
