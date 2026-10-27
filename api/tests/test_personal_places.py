"""The household's own places as match criteria: straight-line minute estimates, `place:<id>`
rows, must-limits that relax like any other, and areas the household ruled out."""
import unittest

from area_api import matching, personal_places


def _profile(**overrides):
    profile = {
        "schemaVersion": "preference-profile.v1", "market": "buy", "targetBudget": 500_000,
        "maximumBudget": 700_000, "commuteDestinations": [], "analyticsConsent": False,
        "factors": [{"factorId": "crime", "weight": 2, "direction": "lower", "minimumUtility": None,
                     "maximumUtility": None}],
        "places": [
            {"id": "work", "label": "Office", "target": {"kind": "point", "latitude": 51.53, "longitude": -0.12},
             "mode": "transit", "targetMinutes": 30, "weight": 5, "must": True},
            {"id": "park", "label": "Any park", "target": {"kind": "category", "category": "park"},
             "mode": "walk", "targetMinutes": 10, "weight": 2, "must": False},
        ],
    }
    profile.update(overrides)
    return profile


def _rows(area, crime_utility, work_minutes, park_minutes):
    base = {"geography_id": area, "name": area, "carrier_geography_id": area, "quality": "observed"}
    return [
        {**base, "factor_id": "crime", "raw_value": 40, "utility": crime_utility, "unit": "per 1,000",
         "source_release_id": "crime"},
        {**base, "factor_id": "place:work", "raw_value": work_minutes, "utility": None, "unit": "minutes",
         "quality": "fallback", "source_release_id": personal_places.ESTIMATE_RELEASE},
        {**base, "factor_id": "place:park", "raw_value": park_minutes, "utility": None, "unit": "minutes",
         "quality": "fallback", "source_release_id": personal_places.ESTIMATE_RELEASE},
    ]


class EstimateTests(unittest.TestCase):
    def test_walk_and_cycle_stretch_the_straight_line(self):
        self.assertAlmostEqual(personal_places.estimate_minutes(1.0, "walk"), 16.25)
        self.assertAlmostEqual(personal_places.estimate_minutes(5.0, "cycle"), 26.0)

    def test_transit_adds_the_station_walk_and_a_wait_but_short_hops_are_walked(self):
        self.assertAlmostEqual(personal_places.estimate_minutes(10.0, "transit", 6.0), 6 + 5 + 25)
        self.assertAlmostEqual(personal_places.estimate_minutes(0.5, "transit", 12.0), 0.5 * 1.3 / 4.8 * 60)
        self.assertAlmostEqual(personal_places.estimate_minutes(10.0, "transit", None), 15 + 5 + 25)


class FakePlaceConnection:
    def __init__(self):
        self.statements = []

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        self.statements.append(marker)
        if marker == "-- evidence:place-area-points":
            return [{"geography_id": "a", "name": "A", "lon": -0.12, "lat": 51.53, "station_walk": 4.0},
                    {"geography_id": "b", "name": "B", "lon": -0.30, "lat": 51.45, "station_walk": None}]
        if marker == "-- evidence:place-nearest-park":
            return [{"geography_id": "a", "metres": 200.0}, {"geography_id": "b", "metres": None}]
        raise AssertionError(marker)


class PlaceRowsTests(unittest.TestCase):
    def setUp(self):
        personal_places.clear_cache()

    def test_rows_per_area_and_place_with_cached_lookups(self):
        connection = FakePlaceConnection()
        places = _profile()["places"]

        rows = personal_places.place_rows(connection, "rel", places)
        personal_places.place_rows(connection, "rel", places)

        by_key = {(row["geography_id"], row["factor_id"]): row for row in rows}
        self.assertEqual(by_key[("a", "place:work")]["raw_value"], 0.0)
        self.assertGreater(by_key[("b", "place:work")]["raw_value"], 40)
        self.assertEqual(by_key[("a", "place:park")]["raw_value"], round(0.2 * 1.3 / 4.8 * 60, 1))
        self.assertNotIn(("b", "place:park"), by_key)  # no park found: no evidence, not "zero minutes"
        self.assertTrue(all(row["quality"] == "fallback" for row in rows))
        self.assertEqual(connection.statements.count("-- evidence:place-area-points"), 1)
        self.assertEqual(connection.statements.count("-- evidence:place-nearest-park"), 1)


class PlaceMatchingTests(unittest.TestCase):
    def test_places_score_like_commute_legs_and_must_is_a_limit(self):
        profile = _profile()
        pack = matching.build_match_pack(profile, _rows("near", 80, 20, 5) + _rows("far", 90, 45, 5))

        near, far = sorted(pack["values"], key=lambda r: r["geographyId"] != "near")
        self.assertEqual(near["rank"], 1)
        work = next(c for c in near["components"] if c["factorId"] == "place:work")
        # A Must place: inside the time it fits fully, beyond it the area is out (no soft edge, no weight).
        self.assertEqual((work["utility"], work["targetMinutes"], work["unit"], work["weight"]), (100, 30, "minutes", 0))
        self.assertTrue(far["excluded"])
        self.assertEqual(far["unmetLimits"], ["place:work:outside"])
        self.assertEqual(matching.describe_unmet_limits(far, profile), ["Office: about 45 min, over your 30"])

        relaxed = matching.apply_relaxation(pack, ["place:work"])
        self.assertFalse(next(r for r in relaxed["values"] if r["geographyId"] == "far")["excluded"])

    def test_brands_sports_and_school_rules_validate(self):
        base = {"id": "ms", "label": "M&S", "mode": "walk", "targetMinutes": 10, "weight": 3, "must": False}
        matching.validate_places([{**base, "target": {"kind": "category", "category": "supermarket", "brand": "M&S"}}])
        matching.validate_places([{**base, "target": {"kind": "category", "category": "sports_club", "sport": "tennis"}}])
        matching.validate_places([{**base, "target": {"kind": "school", "phase": "secondary", "top": 10}}])
        for target in ({"kind": "category", "category": "supermarket", "brand": "x" * 41},
                       {"kind": "school", "phase": "nursery", "top": 10}, {"kind": "school", "phase": "primary", "top": 0}):
            with self.subTest(target=target), self.assertRaises(matching.InvalidMatchRequest):
                matching.validate_places([{**base, "target": target}])
        self.assertEqual(personal_places.brand_patterns("Marks and Spencer"), ["m&s%", "marks%spencer%"])
        self.assertEqual(personal_places.brand_patterns("Budgens"), ["budgens%"])

    def test_a_place_is_minutes_with_a_soft_edge(self):
        # v4 Task 21: fit 1 up to the time set, falling to 0 at +50% (softMinutes), 0 beyond; mirrors
        # web/tests/matching-places.test.ts.
        from area_api import match_model

        nice = {**_profile()["places"][0], "must": False}
        spec = next(item for item in match_model.specs(_profile(places=[nice], factors=[])) if item["kind"] == "place")
        cases = [(0, 1.0), (30, 1.0), (37.5, 0.5), (45, 0.0), (90, 0.0)]
        self.assertEqual([match_model.range_fit(m, spec["min"], spec["max"], spec["softMin"], spec["softMax"])
                          for m, _ in cases], [fit for _, fit in cases])

    def test_ruled_out_areas_leave_the_ranking(self):
        profile = _profile(marks={"liked": [], "excluded": ["uk:lsoa:E01000001"], "notes": {}})
        pack = matching.build_match_pack(profile, _rows("uk:lsoa:E01000001", 90, 10, 5))

        result = pack["values"][0]
        self.assertEqual(result["unmetLimits"], ["mark:excluded"])
        self.assertEqual(matching.describe_unmet_limits(result, profile), ["You ruled this area out"])

    def test_invalid_places_and_marks_are_rejected(self):
        bad_places = [
            [{**_profile()["places"][0], "id": "Work!"}],
            [_profile()["places"][0]] * 2,
            [{**_profile()["places"][1], "target": {"kind": "category", "category": "casino"}}],
            [{**_profile()["places"][0], "targetMinutes": 0}],
            [{**_profile()["places"][0], "must": "yes"}],
        ]
        for places in bad_places:
            with self.subTest(places=places):
                with self.assertRaises(matching.InvalidMatchRequest):
                    matching.validate_match_request(_profile(places=places))
        for marks in ({"liked": ["nope"], "excluded": [], "notes": {}},
                      {"liked": [], "excluded": [], "notes": {"uk:lsoa:E01000001": "x" * 281}}):
            with self.subTest(marks=marks):
                with self.assertRaises(matching.InvalidMatchRequest):
                    matching.validate_match_request(_profile(marks=marks))
        matching.validate_match_request(_profile(propertyType="house"))


if __name__ == "__main__":
    unittest.main()


class BallparkAffordabilityTests(unittest.TestCase):
    def test_ballpark_price_rows_feed_the_affordability_limit(self):
        from area_api import repository

        level = {"geography_id": "a", "name": "A", "factor_id": "market-level", "raw_value": 10_000.0, "utility": 70,
                 "unit": "£/m²", "carrier_geography_id": "a", "quality": "observed", "source_release_id": "prices"}
        row = repository.ballpark_price_row(level, 3)
        self.assertEqual((row["factor_id"], row["raw_value"], row["quality"]), ("affordability", 900_000, "fallback"))

        strict = _profile(places=[], factors=[{"factorId": "affordability", "weight": 1, "direction": "higher",
                                               "minimumUtility": 1, "maximumUtility": None}])
        self.assertTrue(repository._wants(strict, "affordability"))
        over = matching.build_match_pack(strict, [repository.ballpark_price_row(level, 3)])["values"][0]
        self.assertEqual(over["unmetLimits"], ["affordability:outside"])
        self.assertEqual(matching.describe_unmet_limits(over, strict), ["Ballpark £900k is over your £700k"])
        under = matching.build_match_pack(strict, [repository.ballpark_price_row(level, 1)])["values"][0]
        self.assertFalse(under["excluded"])


class CachedTests(unittest.TestCase):
    def setUp(self):
        personal_places.clear_cache()
        self.addCleanup(personal_places.clear_cache)

    def test_concurrent_callers_of_a_cold_key_share_one_load(self):
        import threading
        import time
        calls = []

        def load():
            calls.append(1)
            time.sleep(0.05)
            return "value"

        results = []
        threads = [threading.Thread(target=lambda: results.append(personal_places._cached(("k",), load))) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(calls), 1)
        self.assertEqual(results, ["value"] * 6)

    def test_a_failed_load_keeps_nothing(self):
        def broken():
            raise RuntimeError("cancelled")

        with self.assertRaises(RuntimeError):
            personal_places._cached(("k",), broken)
        self.assertEqual(personal_places._cached(("k",), lambda: 2), 2)
