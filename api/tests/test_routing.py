import json
import unittest

from area_api.routing import (
    NETWORK_VERSION,
    PREVIOUS_NETWORK_VERSION,
    WEEKDAY_TIMETABLE_DATE,
    WEEKEND_TIMETABLE_DATE,
    CommuteCancelled,
    MatrixCacheKey,
    arrival_band,
    cache_stats,
    journey_response,
    lookup_matrix_journey,
    redact_for_log,
    reset_commute_cache,
    routes_agree,
    screen_commute,
    service_band,
)


class RoutingTests(unittest.TestCase):
    def test_cache_key_uses_coarse_destination_and_time_band(self):
        first = MatrixCacheKey.create(51.50121, -0.12341, "08:47", "transit", "network-v1")
        second = MatrixCacheKey.create(51.50139, -0.12349, "08:53", "transit", "network-v1")

        self.assertEqual(first, second)
        self.assertNotIn("51.50121", repr(first))

    def test_journey_result_exposes_variability_and_network_version(self):
        response = journey_response([31, 35, 42], transfers=1, walking_minutes=8, network_version="network-v1", timetable_date="2026-09-03")

        self.assertEqual(response["medianMinutes"], 35)
        self.assertEqual(response["rangeMinutes"], [31, 42])
        self.assertEqual(response["networkVersion"], "network-v1")

    def test_cache_isolated_by_network_mode_and_service_date(self):
        base = MatrixCacheKey.create(51.5, -0.12, "09:00", "transit", "network-v1", "2026-03-28")

        self.assertNotEqual(base, MatrixCacheKey.create(51.5, -0.12, "09:00", "cycle", "network-v1", "2026-03-28"))
        self.assertNotEqual(base, MatrixCacheKey.create(51.5, -0.12, "09:00", "transit", "network-v2", "2026-03-28"))
        self.assertNotEqual(base, MatrixCacheKey.create(51.5, -0.12, "09:00", "transit", "network-v1", "2026-03-29"))

    def test_unreachable_and_r5_otp_spot_checks_are_explicit(self):
        unreachable = journey_response([], 0, 0, "network-v1", "2026-09-03")

        self.assertEqual(unreachable["status"], "unreachable")
        self.assertTrue(routes_agree(r5_minutes=42, otp_minutes=45, tolerance_minutes=5))
        self.assertFalse(routes_agree(r5_minutes=42, otp_minutes=55, tolerance_minutes=5))


CENTRAL = {
    "id": "central", "label": "Central London",
    "latitude": 51.5074, "longitude": -0.1278,
    "mode": "transit", "arrivalTime": "08:47",
    "targetMinutes": 45, "weight": 5,
}
DOCKLANDS = {
    "id": "docklands", "label": "Docklands office",
    "latitude": 51.503, "longitude": -0.089,
    "mode": "transit", "arrivalTime": "08:47",
    "targetMinutes": 45, "weight": 5,
}
WESTMINSTER = "uk:lsoa:E01000001"


def _screen(origin=WESTMINSTER, destinations=None, **kwargs):
    reset_commute_cache()
    return screen_commute(
        origin, destinations if destinations is not None else [dict(CENTRAL)],
        network_version=kwargs.pop("network_version", NETWORK_VERSION),
        service_date=kwargs.pop("service_date", WEEKDAY_TIMETABLE_DATE),
        **kwargs,
    )


class NetworkVersionTests(unittest.TestCase):
    def test_network_version_change_moves_durations(self):
        current = _screen(network_version=NETWORK_VERSION)
        previous = _screen(network_version=PREVIOUS_NETWORK_VERSION)

        self.assertEqual(current["legs"][0]["status"], "available")
        self.assertEqual(previous["legs"][0]["status"], "available")
        self.assertEqual(current["legs"][0]["medianMinutes"], 32)
        self.assertEqual(previous["legs"][0]["medianMinutes"], 40)
        self.assertNotEqual(
            current["legs"][0]["medianMinutes"],
            previous["legs"][0]["medianMinutes"],
        )

    def test_unknown_network_version_is_unreachable_never_guessed(self):
        result = _screen(network_version="street-network-2099-rtm")

        self.assertTrue(result["hasUnreachable"])
        self.assertFalse(result["eligible"])
        self.assertIsNone(result["legs"][0]["medianMinutes"])


class ReachabilityTests(unittest.TestCase):
    def test_disconnected_destination_is_exposed_not_guessed(self):
        result = _screen(destinations=[dict(DOCKLANDS)])

        leg = result["legs"][0]
        self.assertEqual(leg["status"], "unreachable")
        self.assertIsNone(leg["medianMinutes"])
        self.assertTrue(result["hasUnreachable"])
        self.assertFalse(result["eligible"])
        self.assertIsNone(result["weightedMinutes"])

    def test_arrival_band_change_flips_eligibility(self):
        reachable = _screen()
        night = _screen(destinations=[{**CENTRAL, "arrivalTime": "23:10"}])

        self.assertEqual(arrival_band("08:47"), "08:45")
        self.assertEqual(reachable["legs"][0]["arrivalBand"], "08:45")
        self.assertTrue(reachable["eligible"])
        self.assertEqual(night["legs"][0]["arrivalBand"], "23:00")
        self.assertEqual(night["legs"][0]["status"], "unreachable")
        self.assertFalse(night["eligible"])


class ServiceBandTests(unittest.TestCase):
    def test_weekday_and_weekend_service_dates_differ_for_transit(self):
        self.assertEqual(service_band(WEEKDAY_TIMETABLE_DATE), "weekday")
        self.assertEqual(service_band(WEEKEND_TIMETABLE_DATE), "weekend")
        weekday = _screen(service_date=WEEKDAY_TIMETABLE_DATE)
        weekend = _screen(service_date=WEEKEND_TIMETABLE_DATE)

        self.assertEqual(weekday["legs"][0]["medianMinutes"], 32)
        self.assertEqual(weekend["legs"][0]["medianMinutes"], 45)

    def test_walking_is_identical_across_service_bands(self):
        walking = {**CENTRAL, "mode": "walk", "targetMinutes": 90}
        weekday = _screen(destinations=[dict(walking)])
        weekend = _screen(
            destinations=[dict(walking)], service_date=WEEKEND_TIMETABLE_DATE)

        self.assertEqual(
            weekday["legs"][0]["medianMinutes"],
            weekend["legs"][0]["medianMinutes"],
        )


class DestinationWeightTests(unittest.TestCase):
    def test_zero_weight_destinations_are_ignored(self):
        result = _screen(destinations=[
            dict(CENTRAL), {**DOCKLANDS, "weight": 0},
        ])

        self.assertTrue(result["eligible"])
        self.assertEqual(result["ignoredDestinationIds"], ["docklands"])
        self.assertEqual(len(result["legs"]), 1)
        self.assertEqual(result["weightedMinutes"], 32)

    def test_exceeded_maximum_commute_is_ineligible(self):
        comfortable = _screen()
        exceeded = _screen(
            destinations=[{**CENTRAL, "targetMinutes": 30}])

        self.assertTrue(comfortable["eligible"])
        self.assertFalse(comfortable["exceedsMaximum"])
        self.assertTrue(exceeded["legs"][0]["exceedsTarget"])
        self.assertTrue(exceeded["exceedsMaximum"])
        self.assertFalse(exceeded["eligible"])


class ScreeningHygieneTests(unittest.TestCase):
    def test_fixed_fixtures_repeat_exactly(self):
        first = lookup_matrix_journey(
            WESTMINSTER, 51.5074, -0.1278, "transit", "08:47",
            NETWORK_VERSION, WEEKDAY_TIMETABLE_DATE)
        second = lookup_matrix_journey(
            WESTMINSTER, 51.5074, -0.1278, "transit", "08:53",
            NETWORK_VERSION, WEEKDAY_TIMETABLE_DATE)

        self.assertEqual(first, second)
        self.assertEqual(first["medianMinutes"], 32)
        self.assertEqual(first["rangeMinutes"], [28, 38])
        self.assertEqual(first["transfers"], 1)
        self.assertEqual(first["walkingMinutes"], 8)

    def test_results_are_labelled_approximate_area_origin(self):
        result = _screen()

        self.assertEqual(result["approximation"], "area-origin")
        self.assertIn("approximate", " ".join(result["assumptions"]).lower())
        self.assertEqual(result["networkVersion"], NETWORK_VERSION)
        self.assertEqual(result["timetableDate"], WEEKDAY_TIMETABLE_DATE)

    def test_cancellation_aborts_screening(self):
        with self.assertRaises(CommuteCancelled):
            _screen(cancel=lambda: True)

    def test_unchanged_inputs_reuse_the_cache(self):
        reset_commute_cache()
        screen_commute(WESTMINSTER, [dict(CENTRAL)],
                       NETWORK_VERSION, WEEKDAY_TIMETABLE_DATE)
        screen_commute(WESTMINSTER, [dict(CENTRAL)],
                       NETWORK_VERSION, WEEKDAY_TIMETABLE_DATE)

        self.assertEqual(cache_stats()["computations"], 1)

    def test_logs_carry_no_precise_destinations(self):
        redacted = json.dumps(redact_for_log(_screen()))

        self.assertNotIn("Central London", redacted)
        self.assertNotIn("51.5074", redacted)
        self.assertNotIn("-0.1278", redacted)
        self.assertIn("51507", redacted)


if __name__ == "__main__":
    unittest.main()
