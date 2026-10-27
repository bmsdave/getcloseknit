"""AE-36: bounded read-only evidence operations for assistant workflows.

TDD-first contract: every tool response carries supporting sources, never
silently substitutes fixture data, bounds result sizes, maps every failure
to a structured reason, redacts private destinations, and keeps every claim
traceable to returned evidence. Reuses the AE-06 EvidenceReader (no new SQL,
no analytics writes, no separate ingestion).
"""
import json
import unittest

from tests.test_private_search_state import CANARY_LABEL, canary_profile
from tests.test_production_evidence import (
    NEW_CRIME,
    NEW_RELEASE,
    OLD_CRIME,
    OLD_RELEASE,
    _geography,
    seed_production_fixture,
)

from area_api import agent_evidence


def make_toolkit(connection):
    return lambda: connection


class ToolSurfaceTests(unittest.TestCase):
    def test_only_bounded_read_operations_are_exposed(self):
        self.assertEqual(
            sorted(agent_evidence.TOOL_OPERATIONS),
            ["compare_shortlist", "lookup_areas", "prepare_brief", "retrieve_evidence"],
        )
        for name in agent_evidence.TOOL_OPERATIONS:
            self.assertTrue(callable(getattr(agent_evidence, name)))


class LookupTests(unittest.TestCase):
    def test_lookup_returns_results_with_supporting_release(self):
        connection = seed_production_fixture()

        response = agent_evidence.lookup_areas(make_toolkit(connection), "E01000004")

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["productReleaseId"], OLD_RELEASE)
        self.assertEqual(response["results"][0]["geographyId"], "uk:lsoa:E01000004")
        self.assertEqual(response["sources"][0]["release"], OLD_RELEASE)

    def test_lookup_rejects_invalid_query_with_structured_reason(self):
        connection = seed_production_fixture()

        response = agent_evidence.lookup_areas(make_toolkit(connection), "x")

        self.assertEqual(response["status"], "error")
        self.assertEqual(response["reason"], "invalid-query")

    def test_lookup_rejects_excessive_limits_without_querying(self):
        connection = seed_production_fixture()

        response = agent_evidence.lookup_areas(
            make_toolkit(connection), "camden",
            limit=agent_evidence.MAX_AGENT_RESULTS + 1)

        self.assertEqual(response["status"], "unavailable")
        self.assertEqual(response["reason"], "result-limit-exceeded")
        self.assertEqual(response["maxAllowed"], agent_evidence.MAX_AGENT_RESULTS)
        self.assertEqual(connection.statements, [])

    def test_lookup_without_active_release_is_unavailable(self):
        connection = seed_production_fixture()
        connection.active_id = None

        response = agent_evidence.lookup_areas(make_toolkit(connection), "camden")

        self.assertEqual(response["status"], "unavailable")
        self.assertEqual(response["reason"], "release-unavailable")

    def test_lookup_cancellation_issues_no_queries(self):
        connection = seed_production_fixture()

        response = agent_evidence.lookup_areas(
            make_toolkit(connection), "camden", cancel=lambda: True)

        self.assertEqual(response["reason"], "request-cancelled")
        self.assertEqual(connection.statements, [])


class RetrieveTests(unittest.TestCase):
    def test_evidence_carries_sources_for_every_claim(self):
        connection = seed_production_fixture()

        response = agent_evidence.retrieve_evidence(
            make_toolkit(connection), "uk:lsoa:E01000004", "crime", "2026-06")

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["evidence"]["summary"]["value"], 56.0)
        self.assertGreaterEqual(len(response["sources"]), 1)
        for source in response["sources"]:
            self.assertTrue(source["release"])
            self.assertTrue(source["observedAt"])
        summary = response["evidence"]["summary"]
        self.assertTrue(any(
            source["release"] == summary["sourceVersion"]
            and source["observedAt"] == summary["period"]
            for source in response["sources"]))

    def test_missing_values_stay_unknown_never_zero(self):
        connection = seed_production_fixture()

        response = agent_evidence.retrieve_evidence(
            make_toolkit(connection), "uk:lsoa:E01000005", "crime", "2026-06")

        self.assertEqual(response["status"], "ok")
        self.assertIsNone(response["evidence"]["summary"]["value"])
        self.assertEqual(len(response["unavailable"]), 1)
        self.assertNotIn('"value": 0', json.dumps(response["evidence"]))

    def test_invalid_ids_map_to_structured_reasons(self):
        connection = seed_production_fixture()
        cases = [
            (("not-an-id", "crime", "2026-06"), "invalid-query"),
            (("uk:lsoa:E01009999", "crime", "2026-06"), "area-not-found"),
            (("uk:lsoa:E01000004", "noise", "2026-06"), "metric-not-found"),
            (("uk:lsoa:E01000004", "crime", "june-2026"), "invalid-query"),
            (("uk:lsoa:E01000004", "crime", "2019-01"), "period-not-found"),
        ]
        for args, reason in cases:
            with self.subTest(args=args):
                response = agent_evidence.retrieve_evidence(
                    make_toolkit(connection), *args)
                self.assertEqual(response["reason"], reason, args)

    def test_metric_outside_active_release_is_unavailable(self):
        connection = seed_production_fixture()
        connection.metrics["crime"]["source_release_id"] = NEW_CRIME

        response = agent_evidence.retrieve_evidence(
            make_toolkit(connection), "uk:lsoa:E01000004", "crime", "2026-06")

        self.assertEqual(response["status"], "unavailable")
        self.assertEqual(response["reason"], "release-unavailable")

    def test_unsupported_expected_release_is_a_mismatch(self):
        connection = seed_production_fixture()

        response = agent_evidence.retrieve_evidence(
            make_toolkit(connection), "uk:lsoa:E01000004", "crime", "2026-06",
            options={"expected_release": "product-2099-01"})

        self.assertEqual(response["status"], "unavailable")
        self.assertEqual(response["reason"], "release-mismatch")
        self.assertEqual(response["actualRelease"], OLD_RELEASE)

    def test_supported_expected_release_passes_through(self):
        connection = seed_production_fixture()

        response = agent_evidence.retrieve_evidence(
            make_toolkit(connection), "uk:lsoa:E01000004", "crime", "2026-06",
            options={"expected_release": OLD_RELEASE})

        self.assertEqual(response["status"], "ok")

    def test_cancelled_retrieval_issues_no_queries(self):
        connection = seed_production_fixture()

        response = agent_evidence.retrieve_evidence(
            make_toolkit(connection), "uk:lsoa:E01000004", "crime", "2026-06",
            options={"cancel": lambda: True})

        self.assertEqual(response["reason"], "request-cancelled")
        self.assertEqual(connection.statements, [])

    def test_evidence_reads_never_write_analytics(self):
        connection = seed_production_fixture()
        toolkit = make_toolkit(connection)

        agent_evidence.lookup_areas(toolkit, "camden")
        agent_evidence.retrieve_evidence(
            toolkit, "uk:lsoa:E01000004", "crime", "2026-06")

        for sql, _ in connection.statements:
            self.assertNotIn("analytics", sql)


class CompareTests(unittest.TestCase):
    AREAS = ["uk:lsoa:E01000004", "uk:lsoa:E01000005"]

    def test_comparison_marks_leader_without_ranking_unknown(self):
        connection = seed_production_fixture()

        response = agent_evidence.compare_shortlist(
            make_toolkit(connection), list(self.AREAS), "crime", "2026-06")

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["productReleaseId"], OLD_RELEASE)
        observed = [c for c in response["columns"] if c["state"] == "observed"]
        unknown = [c for c in response["columns"] if c["state"] == "unknown"]
        self.assertEqual(len(observed), 1)
        self.assertEqual(len(unknown), 1)
        self.assertTrue(observed[0]["leader"])
        self.assertFalse(unknown[0]["leader"])
        self.assertGreaterEqual(len(response["uncertainty"]), 1)

    def test_comparison_claims_trace_to_returned_sources(self):
        connection = seed_production_fixture()

        response = agent_evidence.compare_shortlist(
            make_toolkit(connection), list(self.AREAS), "crime", "2026-06")

        for conclusion in response["conclusions"]:
            for claim in conclusion["claims"]:
                self.assertTrue(any(
                    source["release"] == claim["release"]
                    and source["observedAt"] == claim["observedAt"]
                    for source in response["sources"]), claim)

    def test_comparison_rejects_bad_shortlists(self):
        connection = seed_production_fixture()
        toolkit = make_toolkit(connection)
        bad = [
            ["uk:lsoa:E01000004"],
            ["uk:lsoa:E01000004"] * 5,
            ["uk:lsoa:E01000004", "uk:lsoa:E01000004"],
            ["not-an-id", "uk:lsoa:E01000004"],
        ]
        for areas in bad:
            with self.subTest(areas=areas):
                response = agent_evidence.compare_shortlist(
                    toolkit, areas, "crime", "2026-06")
                self.assertNotEqual(response["status"], "ok", areas)
                self.assertEqual(connection.statements, [])

    def test_comparison_release_mismatch_is_structured(self):
        connection = seed_production_fixture()

        response = agent_evidence.compare_shortlist(
            make_toolkit(connection), list(self.AREAS), "crime", "2026-06",
            options={"expected_release": NEW_RELEASE})

        self.assertEqual(response["reason"], "release-mismatch")

    def test_comparison_matches_human_reviewed_fixture(self):
        connection = seed_production_fixture()
        with open("tests/agent_comparison_fixture.json", encoding="utf-8") as handle:
            fixture = json.load(handle)

        response = agent_evidence.compare_shortlist(
            make_toolkit(connection), fixture["input"]["geographyIds"],
            fixture["input"]["metricId"], fixture["input"]["period"])

        self.assertEqual(response["status"], "ok")
        self.assertEqual(
            [c["geographyId"] for c in response["columns"]],
            [c["geographyId"] for c in fixture["expected"]["columns"]])
        for actual, expected in zip(response["columns"], fixture["expected"]["columns"]):
            self.assertEqual(actual["state"], expected["state"])
            self.assertEqual(actual["value"], expected["value"])
            self.assertEqual(actual["leader"], expected["leader"])
        self.assertEqual(response["conclusions"], fixture["expected"]["conclusions"])

    def test_comparison_ranks_coarser_metrics_by_their_carrier_values(self):
        """Issue #206: two LSOAs in different MSOAs compared on MSOA-carried income
        rank by their MSOAs' values instead of both reading unknown."""
        connection = seed_production_fixture()
        connection.geographies["uk:msoa:E02000005"] = _geography(
            "uk:msoa:E02000005", "msoa", "E02000005", "Camden 002 test area",
            "uk:lad:E09000007", -0.13, 51.55)
        connection.geographies["uk:lsoa:E01000005"]["parent_id"] = "uk:msoa:E02000005"
        connection.metrics["income"] = {
            "id": "income", "carrier": "msoa", "unit": "GBP/year", "direction": "higher-is-more",
            "definition": dict(connection.metrics["crime"]["definition"]),
            "source_release_id": OLD_CRIME,
        }
        for geography_id, value in (("uk:msoa:E02000004", 60240.0), ("uk:msoa:E02000005", 84536.0)):
            connection.values.append({
                "geography_id": geography_id, "metric_id": "income", "period": "2026-06", "value": value,
                "region_percentile": 10, "country_percentile": None, "sample_count": None,
                "quality": "observed", "source_release_id": OLD_CRIME})

        response = agent_evidence.compare_shortlist(
            make_toolkit(connection), ["uk:lsoa:E01000004", "uk:lsoa:E01000005"], "income", "2026-06")

        self.assertEqual(response["status"], "ok")
        columns = {c["geographyId"]: c for c in response["columns"]}
        self.assertEqual([c["state"] for c in response["columns"]], ["observed", "observed"])
        self.assertEqual((columns["uk:lsoa:E01000004"]["value"], columns["uk:lsoa:E01000005"]["value"]),
                         (60240.0, 84536.0))
        self.assertTrue(columns["uk:lsoa:E01000005"]["leader"])
        self.assertFalse(columns["uk:lsoa:E01000004"]["leader"])
        self.assertEqual({c["quality"] for c in response["columns"]}, {"fallback"})


class BriefTests(unittest.TestCase):
    def _comparison(self):
        connection = seed_production_fixture()
        response = agent_evidence.compare_shortlist(
            make_toolkit(connection),
            ["uk:lsoa:E01000004", "uk:lsoa:E01000005"], "crime", "2026-06")
        self.assertEqual(response["status"], "ok")
        return response

    def test_brief_redacts_private_destinations_by_default(self):
        profile = canary_profile(consent=True)

        brief = agent_evidence.prepare_brief(
            self._comparison(), profile=profile, candidates=[])

        self.assertEqual(brief["status"], "ok")
        self.assertTrue(brief["redacted"])
        encoded = json.dumps(brief)
        self.assertNotIn(CANARY_LABEL, encoded)
        self.assertNotIn("51.501234", encoded)
        self.assertNotIn("-0.141567", encoded)

    def test_brief_includes_destinations_only_when_asked(self):
        profile = canary_profile(consent=True)

        brief = agent_evidence.prepare_brief(
            self._comparison(), profile=profile, candidates=[],
            include_private=True)

        self.assertFalse(brief["redacted"])
        self.assertIn(CANARY_LABEL, json.dumps(brief))
        self.assertNotIn("51.501234", json.dumps(brief))

    def test_listing_urls_are_data_never_fetched(self):
        candidate = {
            "address": "12 Example Road",
            "askingAmount": 450000,
            "referenceUrl": "https://example.com/listings/12",
            "notes": "Bright kitchen, noisy road.",
        }

        brief = agent_evidence.prepare_brief(
            self._comparison(), candidates=[candidate])

        encoded = json.dumps(brief)
        self.assertIn("https://example.com/listings/12", encoded)
        self.assertIn("unverified", encoded)
        self.assertIn("never fetched", encoded)

    def test_unsafe_listing_url_is_not_linked(self):
        candidate = {
            "address": "12 Example Road",
            "referenceUrl": "javascript:alert(1)",
        }

        brief = agent_evidence.prepare_brief(
            self._comparison(), candidates=[candidate])

        encoded = json.dumps(brief)
        self.assertNotIn("javascript:alert(1)", encoded)
        self.assertIn("not shown as a link", encoded)

    def test_brief_documents_uncertainty_instead_of_inventing(self):
        brief = agent_evidence.prepare_brief(
            self._comparison(), candidates=[])

        kinds = [line["kind"] for section in brief["sections"]
                 for line in section["lines"]]
        self.assertIn("unknown", kinds)
        markdown = agent_evidence.render_brief_markdown(brief)
        self.assertIn("unknown", markdown)
        self.assertNotIn("valuation", markdown)

    def test_brief_needs_evidence_or_a_candidate(self):
        response = agent_evidence.prepare_brief(None, candidates=[])

        self.assertEqual(response["status"], "error")
        self.assertEqual(response["reason"], "brief-needs-evidence")

    def test_brief_marks_unavailable_comparison(self):
        stalled = {"status": "unavailable", "reason": "release-mismatch",
                   "message": "stale", "actualRelease": OLD_RELEASE}

        brief = agent_evidence.prepare_brief(stalled, candidates=[])

        self.assertEqual(brief["status"], "ok")
        tradeoffs = next(s for s in brief["sections"] if s["id"] == "trade-offs")
        self.assertTrue(any(line["kind"] == "unknown" for line in tradeoffs["lines"]))


if __name__ == "__main__":
    unittest.main()
