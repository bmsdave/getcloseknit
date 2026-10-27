"""AE-32: data health readiness, run summaries, and correction reports.

TDD contract for the data-health slice: readiness is tied to the active
release, required tile assets, source freshness, and join coverage (the
static OK health response is gone); run summaries carry source versions,
rejected rows, cadence, last publication, and a rollback reference; failed
publication keeps the last usable release; every failure surfaces one
diagnosable code shared by the API response and the server logs; correction
reports carry observation/release IDs plus an optional description,
distinguish publisher from transformation errors, and never echo a raw
search profile or destinations.
"""
import unittest

from area_api import repository
from area_api.repository import ReleaseStore
from tests.test_objections import FakeObjectionConnection


NOW = "2026-09-06"


def healthy_state(**overrides):
    state = {
        "activeReleaseId": "product-2026-07",
        "previousReleaseId": "product-2026-06",
        "validationStatus": "passed",
        "assets": ["tiles/crime-2026-07.pmtiles"],
        "requiredAssets": ["tiles/"],
        "sources": [
            {
                "sourceId": "police-uk",
                "release": "police-uk-2026-08",
                "retrievedAt": "2026-08-28T10:00:00Z",
                "staleAfterDays": 45,
            },
        ],
        "now": NOW,
        "rejectedRows": 0,
        "quarantinedJoins": [],
        "lastRun": {"status": "passed", "releaseId": "product-2026-07"},
    }
    state.update(overrides)
    return state


def release_manifest(release_id, status="passed"):
    return {
        "id": release_id,
        "geographyVintage": "2021",
        "transformationVersions": {"crime": "crime-v1"},
        "members": [
            {
                "source": "police-uk",
                "release": "police-uk-2026-08",
                "validationStatus": "passed",
                "cadence": "monthly",
            },
        ],
        "assets": ["tiles/crime-2026-07.pmtiles"],
        "validationStatus": status,
        "validationRecord": {"checks": ["schema"], "passed": status == "passed"},
    }


class ReadinessTests(unittest.TestCase):
    def test_healthy_release_is_ready_with_release_id(self):
        report = repository.assess_readiness(healthy_state())

        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["code"], "ready")
        self.assertEqual(report["productReleaseId"], "product-2026-07")

    def test_empty_database_is_not_ready(self):
        report = repository.assess_readiness(
            healthy_state(activeReleaseId=None, lastRun=None))

        self.assertEqual(report["status"], "not-ready")
        self.assertEqual(report["code"], "empty-database")
        self.assertIsNone(report["productReleaseId"])

    def test_stale_source_is_degraded_with_provenance_id(self):
        state = healthy_state(sources=[
            {
                "sourceId": "police-uk",
                "release": "police-uk-2026-03",
                "retrievedAt": "2026-03-01T10:00:00Z",
                "staleAfterDays": 45,
            },
        ])

        report = repository.assess_readiness(state)

        self.assertEqual(report["status"], "degraded")
        self.assertEqual(report["code"], "stale-source")
        self.assertEqual(report["productReleaseId"], "product-2026-07")
        self.assertTrue(any("police-uk-2026-03" in reason
                            for reason in report["unavailableReasons"]))

    def test_missing_tile_asset_is_not_ready(self):
        report = repository.assess_readiness(healthy_state(assets=[]))

        self.assertEqual(report["status"], "not-ready")
        self.assertEqual(report["code"], "missing-tile-asset")

    def test_failed_refresh_without_usable_release(self):
        state = healthy_state(
            activeReleaseId=None,
            lastRun={"status": "failed", "releaseId": "product-2026-08"})

        report = repository.assess_readiness(state)

        self.assertEqual(report["status"], "not-ready")
        self.assertEqual(report["code"], "refresh-failed")

    def test_failed_active_validation_is_not_ready(self):
        report = repository.assess_readiness(
            healthy_state(validationStatus="failed"))

        self.assertEqual(report["status"], "not-ready")
        self.assertEqual(report["code"], "refresh-failed")

    def test_quarantined_bad_join_is_degraded_with_reason(self):
        state = healthy_state(
            rejectedRows=41,
            quarantinedJoins=[
                {"join": "price-epc-uprn", "reason": "unmatched-uprn",
                 "count": 41, "sourceReleaseId": "hmlr-epc-2026-08"},
            ])

        report = repository.assess_readiness(state)

        self.assertEqual(report["status"], "degraded")
        self.assertEqual(report["code"], "quarantined-join")
        self.assertTrue(any("price-epc-uprn" in reason
                            for reason in report["unavailableReasons"]))

    def test_failed_publication_keeps_last_usable_release(self):
        store = ReleaseStore()
        store.stage_release(release_manifest("product-2026-06"))
        store.activate_release("product-2026-06")
        store.stage_release(release_manifest("product-2026-08", status="failed"))

        with self.assertRaises(Exception):
            store.activate_release("product-2026-08")

        self.assertEqual(store.active_release_id(), "product-2026-06")
        report = repository.assess_readiness(
            healthy_state(activeReleaseId=store.active_release_id(),
                          previousReleaseId=None))
        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["code"], "ready")


class HealthCodeTests(unittest.TestCase):
    def test_not_ready_maps_to_503_and_ready_maps_to_200(self):
        failing = repository.assess_readiness(
            healthy_state(activeReleaseId=None, lastRun=None))
        degraded = repository.assess_readiness(
            healthy_state(sources=[
                {"sourceId": "police-uk", "release": "police-uk-2026-03",
                 "retrievedAt": "2026-03-01T10:00:00Z", "staleAfterDays": 45},
            ]))

        self.assertEqual(repository.health_http_status(failing), 503)
        self.assertEqual(repository.health_http_status(degraded), 200)
        self.assertEqual(
            repository.health_http_status(repository.assess_readiness(healthy_state())),
            200)

    def test_one_code_is_shared_by_api_body_and_log_line(self):
        report = repository.assess_readiness(
            healthy_state(activeReleaseId=None, lastRun=None))

        with self.assertLogs("area_api.repository", level="WARNING") as logs:
            repository.log_health_report(report)

        self.assertEqual(report["code"], "empty-database")
        self.assertTrue(
            any("empty-database" in line for line in logs.output),
            f"server logs must carry the API error code: {logs.output}")
        self.assertIn("code", repository.health_log_line(report))


class RunSummaryTests(unittest.TestCase):
    def test_summary_carries_versions_rejections_cadence_and_rollback(self):
        summary = repository.build_run_summary({
            "releaseId": "product-2026-08",
            "status": "passed",
            "members": [
                {"source": "police-uk", "release": "police-uk-2026-08",
                 "cadence": "monthly"},
                {"source": "hmlr-epc", "release": "hmlr-epc-2026-08",
                 "cadence": "monthly"},
            ],
            "rejectedRows": 41,
            "quarantinedJoins": [{"join": "price-epc-uprn", "count": 41}],
            "lastPublication": "product-2026-07",
            "rollbackRef": "product-2026-07",
        })

        self.assertEqual(summary["releaseId"], "product-2026-08")
        self.assertEqual(summary["sourceVersions"],
                         {"police-uk": "police-uk-2026-08",
                          "hmlr-epc": "hmlr-epc-2026-08"})
        self.assertEqual(summary["rejectedRows"], 41)
        self.assertEqual(summary["expectedCadence"],
                         {"police-uk": "monthly", "hmlr-epc": "monthly"})
        self.assertEqual(summary["lastPublication"], "product-2026-07")
        self.assertEqual(summary["rollbackRef"], "product-2026-07")

    def test_failed_run_keeps_rollback_reference(self):
        summary = repository.build_run_summary({
            "releaseId": "product-2026-08",
            "status": "failed",
            "members": [{"source": "police-uk",
                         "release": "police-uk-2026-08", "cadence": "monthly"}],
            "rejectedRows": 0,
            "quarantinedJoins": [],
            "lastPublication": "product-2026-07",
            "rollbackRef": "product-2026-07",
        })

        self.assertEqual(summary["status"], "failed")
        self.assertEqual(summary["rollbackRef"], "product-2026-07")

    def test_summary_rejects_missing_provenance(self):
        with self.assertRaises(ValueError):
            repository.build_run_summary({"releaseId": "product-2026-08"})


class CorrectionReportTests(unittest.TestCase):
    def test_report_carries_observation_and_release_ids(self):
        report = repository.prepare_correction_report({
            "observationId": "uk:lsoa:E01000004:crime:2026-06",
            "productReleaseId": "product-2026-07",
            "sourceReleaseId": "police-uk-2026-08",
            "kind": "publisher-error",
            "description": "Force total looks low against the publisher bulletin.",
        })

        self.assertEqual(report["observationId"], "uk:lsoa:E01000004:crime:2026-06")
        self.assertEqual(report["productReleaseId"], "product-2026-07")
        self.assertEqual(report["sourceReleaseId"], "police-uk-2026-08")
        self.assertEqual(report["kind"], "publisher-error")
        self.assertIn("Force total", report["description"])

    def test_report_distinguishes_publisher_from_transformation(self):
        publisher = repository.prepare_correction_report({
            "sourceReleaseId": "police-uk-2026-08", "kind": "publisher-error"})
        transformation = repository.prepare_correction_report({
            "sourceReleaseId": "police-uk-2026-08",
            "kind": "transformation-error"})

        self.assertNotEqual(publisher["route"], transformation["route"])
        self.assertEqual(publisher["route"], "publisher")
        self.assertEqual(transformation["route"], "transformation")

    def test_report_requires_an_observation_or_release_id(self):
        with self.assertRaises(repository.CorrectionError) as raised:
            repository.prepare_correction_report({"kind": "publisher-error"})

        self.assertEqual(raised.exception.code, "invalid-correction-report")

    def test_report_rejects_unknown_kind(self):
        with self.assertRaises(repository.CorrectionError) as raised:
            repository.prepare_correction_report({
                "sourceReleaseId": "police-uk-2026-08", "kind": "stale-data"})

        self.assertEqual(raised.exception.code, "invalid-correction-report")

    def test_report_never_includes_raw_profile_or_destinations(self):
        canary_label = "Canary Employer AE-32"
        report = repository.prepare_correction_report({
            "observationId": "uk:lsoa:E01000004:crime:2026-06",
            "productReleaseId": "product-2026-07",
            "kind": "transformation-error",
            "market": "buy",
            "maximumBudget": 617343,
            "commuteDestinations": [
                {"label": canary_label, "latitude": 51.501234,
                 "longitude": -0.141567, "mode": "transit"}],
            "destinationModes": ["transit"],
            "factors": [{"factorId": "crime", "weight": 3}],
        })

        encoded = repr(report)
        self.assertNotIn(canary_label, encoded)
        self.assertNotIn("617343", encoded)
        self.assertNotIn("51.501234", encoded)
        self.assertNotIn("commuteDestinations", encoded)
        self.assertEqual(report["kind"], "transformation-error")


class LoadReadinessTests(unittest.TestCase):
    def test_loader_reports_ready_from_release_rows(self):
        connection = _fake_connection(
            readiness=[{
                "release_id": "product-2026-07",
                "previous_release_id": "product-2026-06",
                "validation_status": "passed",
                "assets": ["tiles/crime-2026-07.pmtiles"],
            }],
            sources=[{
                "id": "police-uk-2026-08",
                "retrieved_at": "2026-08-28T10:00:00+00:00",
            }],
        )

        report = repository.load_readiness(
            lambda: connection, now="2026-09-06",
            stale_after_days={"police-uk-2026-08": 45})

        self.assertEqual(report["status"], "ready")
        self.assertEqual(report["productReleaseId"], "product-2026-07")

    def test_windows_come_from_the_source_list(self):
        self.assertEqual(repository.stale_after_days_for("src-hmlr-pp-complete-2026-07"), 45)
        self.assertEqual(repository.stale_after_days_for("src-hmlr-inspire-2026-09"), 100)
        self.assertEqual(repository.stale_after_days_for("src-epc-bulk-2012-2026"), 100)
        self.assertEqual(repository.stale_after_days_for("src-os-open-uprn-2026-08"), 100)
        self.assertEqual(repository.stale_after_days_for("src-osm-greater-london-2026-09"), 100)
        self.assertEqual(repository.stale_after_days_for("src-police-uk-crime-12m"), 45)

    def test_loader_uses_per_source_windows(self):
        def report_for(source_id):
            connection = _fake_connection(
                readiness=[{"release_id": "product-2026-10", "previous_release_id": None,
                            "validation_status": "passed", "assets": ["tiles/x.pmtiles"]}],
                sources=[{"id": source_id, "retrieved_at": "2026-09-10T10:00:00+00:00"}])
            return repository.load_readiness(lambda: connection, now="2026-10-27")

        self.assertEqual(report_for("src-epc-bulk-2012-2026")["status"], "ready")
        stale = report_for("src-hmlr-pp-complete-2026-07")
        self.assertEqual(stale["code"], "stale-source")
        self.assertIn("45-day", repr(stale))

    def test_loader_reports_empty_database_without_rows(self):
        connection = _fake_connection(readiness=[], sources=[])

        report = repository.load_readiness(lambda: connection, now=NOW)

        self.assertEqual(report["status"], "not-ready")
        self.assertEqual(report["code"], "empty-database")


class _FakeConnection:
    def __init__(self, readiness, sources):
        self._readiness = readiness
        self._sources = sources

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- health:readiness":
            return list(self._readiness)
        if marker == "-- health:sources":
            return list(self._sources)
        raise AssertionError(f"unexpected statement: {marker}")


def _fake_connection(readiness, sources):
    return _FakeConnection(readiness, sources)


try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None
    app_module = None


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class DataHealthHttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        self._previous_loader = app_module._health_loader
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous
        app_module._health_loader = self._previous_loader

    def test_health_reports_single_code_for_empty_database(self):
        app_module._reader = None
        app_module._health_loader = lambda: repository.assess_readiness(
            healthy_state(activeReleaseId=None, lastRun=None))

        with self.assertLogs("area_api.repository", level="WARNING"):
            response = self.client.get("/health")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "empty-database")

    def test_correction_endpoint_rejects_id_less_reports(self):
        response = self.client.post("/api/v1/corrections",
                                    json={"kind": "publisher-error"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["error"],
                         "invalid-correction-report")

    def test_correction_endpoint_accepts_minimal_report(self):
        connection = FakeObjectionConnection()
        app_module._connect = lambda: connection
        self.addCleanup(setattr, app_module, "_connect", repository.evidence_connection)
        response = self.client.post(
            "/api/v1/corrections",
            json={"sourceReleaseId": "police-uk-2026-08",
                  "kind": "transformation-error"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["route"], "transformation")
        self.assertEqual(response.json()["id"], 1)
        self.assertEqual(connection.corrections[0]["kind"], "transformation-error")


if __name__ == "__main__":
    unittest.main()
