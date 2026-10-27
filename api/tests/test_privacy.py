import json
import unittest

from area_api.privacy import analytics_event


class PrivacyTests(unittest.TestCase):
    def test_profile_is_not_stored_without_explicit_consent(self):
        self.assertIsNone(analytics_event(profile(consent=False)))

    def test_opt_in_event_is_aggregate_and_cannot_reveal_a_destination(self):
        event = analytics_event(profile(consent=True))
        encoded = json.dumps(event)

        self.assertNotIn("Secret employer", encoded)
        self.assertNotIn("51.501234", encoded)
        self.assertEqual(event["destinationCount"], 1)
        self.assertEqual(event["budgetBand"], 650000)

    def test_ordered_list_event_keeps_kinds_never_places_or_values(self):
        # v4 My match sends preference-profile.v2: the same redacted record, from the ordered criteria.
        v2 = {
            "schemaVersion": "preference-profile.v2", "market": "buy", "targetBudget": 600000, "maximumBudget": 632000,
            "bedrooms": 2, "analyticsConsent": True,
            "criteria": [
                {"kind": "budget", "must": True},
                {"kind": "place", "id": "secret-employer", "label": "Secret employer", "mode": "transit", "targetMinutes": 30,
                 "target": {"kind": "point", "latitude": 51.501234, "longitude": -0.1}},
                {"kind": "range", "layer": "crime", "scale": "percentile", "min": None, "max": 50, "softMin": None, "softMax": 75},
            ],
        }
        event = analytics_event(v2)
        encoded = json.dumps(event)
        self.assertNotIn("Secret employer", encoded)
        self.assertNotIn("secret-employer", encoded)
        self.assertNotIn("51.501234", encoded)
        self.assertEqual(event["criteriaOrder"], ["budget", "place", "range:crime"])
        self.assertEqual(event["mustCount"], 1)
        self.assertEqual(event["destinationModes"], ["transit"])
        self.assertIsNone(analytics_event({**v2, "analyticsConsent": False}))


def profile(consent):
    return {
        "schemaVersion": "preference-profile.v1", "market": "buy",
        "maximumBudget": 632000, "bedrooms": 2, "forecastHorizon": "1y",
        "analyticsConsent": consent,
        "factors": [{"factorId": "crime", "weight": 4}],
        "commuteDestinations": [{
            "label": "Secret employer", "latitude": 51.501234,
            "longitude": -0.123456, "mode": "transit",
        }],
        "school": {"phases": ["primary"]},
    }


if __name__ == "__main__":
    unittest.main()
