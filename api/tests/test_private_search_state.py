"""AE-09 canary boundary: private search values must stay out of logs,
telemetry, public URLs, and cached (shared) responses.

Canary values are deliberately unusual so an accidental echo is
unmistakable: exact destination coordinates, a named employer label, and
budgets that do not sit on a rounding boundary.
"""
import json
import unittest

from area_api.privacy import analytics_event, private_response_headers

CANARY_LABEL = "Canary Employer"
CANARY_LATITUDE = "51.501234"
CANARY_LONGITUDE = "-0.141567"
CANARY_TARGET = 617343
CANARY_MAXIMUM = 637211


def canary_profile(consent):
    return {
        "schemaVersion": "preference-profile.v1",
        "market": "buy",
        "targetBudget": CANARY_TARGET,
        "maximumBudget": CANARY_MAXIMUM,
        "bedrooms": 2,
        "forecastHorizon": "1y",
        "analyticsConsent": consent,
        "factors": [{"factorId": "crime", "weight": 4}],
        "commuteDestinations": [{
            "id": "canary-work",
            "label": CANARY_LABEL,
            "latitude": 51.501234,
            "longitude": -0.141567,
            "mode": "transit",
            "arrivalTime": "09:07",
            "targetMinutes": 40,
            "weight": 3,
        }],
        "school": {"phases": ["primary"]},
    }


def assert_canary_absent(test_case, encoded):
    test_case.assertNotIn(CANARY_LABEL, encoded)
    test_case.assertNotIn(CANARY_LATITUDE, encoded)
    test_case.assertNotIn(CANARY_LONGITUDE, encoded)
    test_case.assertNotIn(str(CANARY_TARGET), encoded)
    test_case.assertNotIn(str(CANARY_MAXIMUM), encoded)


class OptInTelemetryTests(unittest.TestCase):
    def test_opt_out_records_nothing(self):
        self.assertIsNone(analytics_event(canary_profile(consent=False)))

    def test_opt_in_event_keeps_existing_redaction_shape(self):
        event = analytics_event(canary_profile(consent=True))
        assert_canary_absent(self, json.dumps(event))
        self.assertEqual(event["budgetBand"], 650000)
        self.assertEqual(event["destinationCount"], 1)
        self.assertEqual(event["destinationModes"], ["transit"])


class SharedCacheTests(unittest.TestCase):
    def test_personalized_responses_are_excluded_from_shared_caches(self):
        headers = private_response_headers()
        self.assertIn("no-store", headers["Cache-Control"])
        self.assertNotIn("public", headers["Cache-Control"])


try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class MatchEndpointPrivacyTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module.load_match_evidence
        app_module.load_match_evidence = lambda profile, regions=None: [{
            "geography_id": "uk:lsoa:E01000001", "name": "Probe area",
            "factor_id": "crime", "raw_value": 42, "utility": 70,
            "unit": "per 1,000", "carrier_geography_id": "uk:lsoa:E01000001",
            "quality": "observed", "source_release_id": "police-2026-06",
        }]
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module.load_match_evidence = self._previous

    def test_match_response_is_not_shared_cached_and_holds_no_canary(self):
        profile = canary_profile(consent=True)
        profile["factors"] = [{
            "factorId": "crime", "weight": 4, "direction": "lower",
            "minimumUtility": None, "maximumUtility": None,
        }]
        response = self.client.post("/api/v1/matches", json=profile)
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers["cache-control"])
        assert_canary_absent(self, response.text)

    def test_validation_errors_do_not_echo_canary_values(self):
        profile = canary_profile(consent=False)
        profile["schemaVersion"] = "preference-profile.v0-canary"
        response = self.client.post("/api/v1/matches", json=profile)
        self.assertEqual(response.status_code, 400)
        assert_canary_absent(self, response.text)


if __name__ == "__main__":
    unittest.main()
