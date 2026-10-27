"""Door-to-door minutes from the routing release: places near a hub are routed through it
(hub minutes + a walk), feed the match as observed evidence, and show per mode for an area."""
import unittest

from tests.test_production_evidence import OLD_RELEASE, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api import commute, home_search, personal_places
    from area_api.evidence import EvidenceReader
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

NETWORK = {"id": "net-test", "timetable_source_release_id": "src-tfl-timetables-test"}
KINGS_CROSS = {"id": "kings-cross", "name": "King's Cross St Pancras", "station_id": "osm:n1",
               "latitude": 51.5306, "longitude": -0.1239}
OFFICE = {"id": "office", "label": "Office", "target": {"kind": "point", "latitude": 51.5353, "longitude": -0.1246},
          "mode": "transit", "targetMinutes": 30, "weight": 5, "must": True}
FARAWAY = {**OFFICE, "id": "far", "label": "Far", "target": {"kind": "point", "latitude": 51.40, "longitude": 0.10}}


def _connection():
    connection = seed_production_fixture()
    connection.network = NETWORK
    connection.commute_hubs = [KINGS_CROSS]
    connection.hub_minutes = {("uk:lsoa:E01000004", "kings-cross", "transit"): (21, 17, 26),
                              ("uk:lsoa:E01000004", "kings-cross", "cycle"): (24, 24, 24),
                              ("uk:lsoa:E01000004", "kings-cross", "car"): (30, 19, 30),
                              ("uk:lsoa:E01000005", "kings-cross", "transit"): (35, 30, 41)}
    msoa = connection.geographies["uk:lsoa:E01000004"]["parent_id"]
    connection.itineraries = {(msoa, "kings-cross"): [
        {"option": 1, "total_minutes": 20, "transfers": 0, "walking_minutes": 6,
         "legs": [{"mode": "subway", "line": "Victoria", "from": "Walthamstow Central", "to": "King's Cross St. Pancras",
                   "minutes": 14, "waitMinutes": 2}]}]}
    connection.street_routes = {(msoa, "kings-cross"): [
        {"mode": "cycle", "km": 9.4, "coordinates": [[-0.02, 51.58], [-0.1239, 51.5306]]}]}
    return connection


@unittest.skipIf(TestClient is None, "dependencies are not installed")
class CommuteTests(unittest.TestCase):
    def setUp(self):
        commute.clear_cache()
        personal_places.clear_cache()

    def test_places_snap_to_a_hub_within_reach(self):
        hub, km = commute.nearest_hub([KINGS_CROSS], 51.5353, -0.1246)
        self.assertEqual(hub["id"], "kings-cross")
        self.assertLess(km, 1)
        self.assertIsNone(commute.nearest_hub([KINGS_CROSS], 51.40, 0.10))

    def test_area_commute_by_mode_through_the_hub(self):
        connection = _connection()
        out = commute.area_commute(connection, NETWORK, "uk:lsoa:E01000004", [OFFICE, FARAWAY])
        office, far = out
        walk = round(commute.last_leg_minutes(commute.nearest_hub([KINGS_CROSS], 51.5353, -0.1246)[1]))
        self.assertEqual(office["hub"], {"id": "kings-cross", "name": "King's Cross St Pancras", "walkFromHubMinutes": walk,
                                         "location": [KINGS_CROSS["longitude"], KINGS_CROSS["latitude"]]})
        self.assertEqual(office["modes"]["transit"]["minutes"], 21 + walk)
        ride = commute.last_leg_minutes(commute.nearest_hub([KINGS_CROSS], 51.5353, -0.1246)[1], "cycle")
        self.assertLess(ride, walk)  # riders and drivers go on to the door instead of walking from the station
        self.assertEqual(office["modes"]["cycle"]["minutes"], round(24 + ride))
        self.assertEqual(office["modes"]["car"]["range"], [round(19 + ride), round(30 + ride)])
        self.assertNotIn("walk", office["modes"])
        self.assertEqual(office["routes"][0]["legs"][0]["line"], "Victoria")
        self.assertEqual(far["routes"], [])
        self.assertEqual(office["paths"]["cycle"]["coordinates"][-1], [-0.1239, 51.5306])
        self.assertEqual(office["hub"]["location"], [KINGS_CROSS["longitude"], KINGS_CROSS["latitude"]])
        self.assertEqual(far["paths"], {})
        self.assertEqual((far["hub"], far["modes"]), (None, {}))

    def test_a_place_with_no_hub_says_the_minutes_my_match_scores(self):
        # v4.5 (round 2 #44): the area page said "No time yet" while the My match row said 12′ for the same place.
        connection = _connection()
        far = commute.area_commute(connection, NETWORK, "uk:lsoa:E01000004", [FARAWAY], OLD_RELEASE)[0]
        scored = {row["geography_id"]: row for row in personal_places.place_rows(connection, OLD_RELEASE, [FARAWAY])}
        match = scored["uk:lsoa:E01000004"]
        self.assertEqual(match["quality"], "fallback")
        self.assertIsNone(far["hub"])
        self.assertTrue(far["estimate"])
        # The list shows Math.round of the match's tenths: the page says the same whole minutes.
        self.assertEqual(far["modes"]["transit"]["minutes"], int(match["raw_value"] + 0.5))
        self.assertEqual(set(far["modes"]), {"transit", "walk", "cycle", "car"})
        self.assertEqual((commute.whole_minutes(12.5), round(12.5)), (13, 12))  # half up, as Math.round; not Python's
        reader = EvidenceReader(connect=lambda: connection)
        payload = reader.get_commute("uk:lsoa:E01000004", [OFFICE, FARAWAY])
        self.assertEqual([place.get("estimate", False) for place in payload["places"]], [False, True])

    def test_routed_places_are_observed_evidence_for_the_match(self):
        connection = _connection()
        connection.execute("-- evidence:active-release\nSELECT 1")
        rows = personal_places.place_rows(connection, OLD_RELEASE, [OFFICE])
        routed = {row["geography_id"]: row for row in rows}
        self.assertEqual(routed["uk:lsoa:E01000004"]["quality"], "observed")
        self.assertEqual(routed["uk:lsoa:E01000004"]["source_release_id"], "src-tfl-timetables-test")
        self.assertGreater(routed["uk:lsoa:E01000005"]["raw_value"], routed["uk:lsoa:E01000004"]["raw_value"])

    def test_reader_and_http_route(self):
        connection = _connection()
        reader = EvidenceReader(connect=lambda: connection)
        payload = reader.get_commute("uk:lsoa:E01000004", [OFFICE])
        self.assertEqual(payload["schemaVersion"], "area-commute.v1")
        self.assertEqual(payload["places"][0]["modes"]["transit"]["range"][0] < payload["places"][0]["modes"]["transit"]["range"][1], True)

        previous = app_module._reader
        app_module._reader = reader
        try:
            client = TestClient(app_module.app)
            ok = client.post("/api/v1/commute", json={"areaId": "uk:lsoa:E01000004", "places": [OFFICE]})
            self.assertEqual(ok.status_code, 200, ok.text)
            self.assertIn("no-store", ok.headers["cache-control"])
            bad = client.post("/api/v1/commute", json={"areaId": "uk:lsoa:E01000004", "places": [{**OFFICE, "mode": "fly"}]})
            self.assertEqual(bad.status_code, 400)
        finally:
            app_module._reader = previous

    def test_find_areas_says_where_place_minutes_come_from(self):
        routed = home_search._place_caveats([{"factorId": "place:office", "quality": "observed"}])
        self.assertIn("TfL Open Data", routed[0])
        both = home_search._place_caveats([{"factorId": "place:office", "quality": "observed"},
                                           {"factorId": "place:gym", "quality": "fallback"},
                                           {"factorId": "crime", "quality": "fallback"}])
        self.assertEqual(len(both), 2)
        self.assertEqual(home_search._place_caveats([{"factorId": "crime", "quality": "observed"}]), [])

    def test_kinds_of_place_name_the_nearest_and_what_is_close_instead(self):
        connection = seed_production_fixture()
        connection.area_amenities = [
            {"name": "Corner Grocer", "brand": None, "sport": None, "metres": 300.0},
            {"name": "Tesco Express", "brand": "Tesco Express", "sport": None, "metres": 650.0},
            {"name": "M&S Simply Food", "brand": "M&S Simply Food", "sport": None, "metres": 1600.0},
        ]
        place = {"id": "ms", "label": "An M&S", "target": {"kind": "category", "category": "supermarket", "brand": "M&S"},
                 "mode": "walk", "targetMinutes": 10, "weight": 3, "must": False}
        [entry] = commute.local_places(connection, "rel", "uk:lsoa:E01000004", [place])
        self.assertEqual(entry["nearest"], {"name": "M&S Simply Food", "metres": 1600})
        self.assertEqual(entry["modes"]["walk"]["minutes"], round(personal_places.estimate_minutes(1.6, "walk")))
        self.assertEqual([alt["label"] for alt in entry["alternatives"]], ["Any supermarket", "Tesco"])

        observation = lambda value: [{"measure": "Grade 5+ in English and maths (%)", "value": value, "cohortSize": 120,
                                      "suppressed": False, "academicYear": "2024/25"}]
        connection.school_observations = [{"urn": "1", "observations": observation(91)}, {"urn": "2", "observations": observation(60)},
                                          {"urn": "3", "observations": observation(88)}]
        connection.area_school_rows = [{"urn": "2", "name": "Middling", "metres": 200.0}, {"urn": "3", "name": "Second", "metres": 900.0},
                                       {"urn": "1", "name": "Best", "metres": 1500.0}]
        school = {**place, "id": "school", "label": "Top-2 secondary", "target": {"kind": "school", "phase": "secondary", "top": 2}}
        [entry] = commute.local_places(connection, "rel", "uk:lsoa:E01000004", [school])
        self.assertEqual(entry["nearest"], {"name": "Second", "metres": 900, "rank": 2})
        self.assertEqual(entry["alternatives"], [{"label": "#1 Best", "metres": 1500}])

    def test_a_park_names_the_nearest_park_for_local_places(self):
        connection = seed_production_fixture()
        connection.area_parks = [{"name": "Highbury Fields", "metres": 420.4}]
        park = {"id": "park", "label": "Park", "target": {"kind": "category", "category": "park"},
                "mode": "walk", "targetMinutes": 10, "weight": 2, "must": False}
        [entry] = commute.local_places(connection, "rel", "uk:lsoa:E01000004", [park])
        self.assertEqual((entry["placeId"], entry["nearest"], entry["alternatives"]),
                         ("park", {"name": "Highbury Fields", "metres": 420}, []))
        self.assertEqual(entry["modes"]["walk"]["minutes"], round(personal_places.estimate_minutes(0.4204, "walk")))
        connection.area_parks = []
        self.assertEqual(commute.local_places(connection, "rel", "uk:lsoa:E01000004", [park]), [])

    def test_no_routing_release_means_no_times_not_an_error(self):
        connection = seed_production_fixture()
        payload = EvidenceReader(connect=lambda: connection).get_commute("uk:lsoa:E01000004", [OFFICE])
        self.assertEqual((payload["network"], payload["places"]), (None, []))

    def test_national_rail_only_area_is_flagged_with_a_named_caveat(self):
        # #210: the timetable router models TfL services only; an area whose stations
        # within ~15 min walk are National Rail only must not report high confidence.
        connection = _connection()
        connection.nr_stations = [{"geography_id": "uk:lsoa:E01000004", "name": "East Croydon",
                                   "modes": ["national-rail"]}]
        payload = EvidenceReader(connect=lambda: connection).get_commute("uk:lsoa:E01000004", [OFFICE])
        self.assertTrue(payload["nationalRailNotModelled"])
        self.assertTrue(payload["places"][0]["nationalRailNotModelled"])
        self.assertTrue(any("East Croydon" in caveat and "National Rail" in caveat
                            for caveat in payload["caveats"]))

    def test_national_rail_only_commute_confidence_is_low(self):
        self.assertEqual(home_search.commute_confidence({"network": NETWORK, "nationalRailNotModelled": True}), "low")
        self.assertEqual(home_search.commute_confidence({"network": NETWORK}), "high")
        self.assertEqual(home_search.commute_confidence({"network": None}), "none")

    def test_transit_slower_than_cycle_flags_a_far_hub(self):
        # Sanity flag (#210): a hub over 10 km from the area whose transit minutes read
        # slower than cycling is implausible (the timetable misses the fast service).
        connection = _connection()
        connection.area_points = [{"geography_id": "uk:lsoa:E01000004", "name": "n", "lon": -0.30, "lat": 51.60,
                                   "station_walk": None}]
        [entry] = commute.area_commute(connection, NETWORK, "uk:lsoa:E01000004", [OFFICE])
        self.assertGreater(entry["modes"]["transit"]["minutes"], entry["modes"]["cycle"]["minutes"])
        self.assertTrue(entry["transitSlowerThanCycle"])

    def test_national_rail_only_area_is_unknown_not_excluded_under_a_must_place(self):
        # #210: find_areas scores the area as unknown instead of excluding it under a must place limit.
        from area_api import match_model

        connection = _connection()
        connection.nr_stations = [{"geography_id": "uk:lsoa:E01000004", "name": "East Croydon",
                                   "modes": ["national-rail"]}]
        connection.execute("-- evidence:active-release\nSELECT 1")
        rows = personal_places.place_rows(connection, OLD_RELEASE, [OFFICE])
        flagged = {row["geography_id"]: row for row in rows}
        self.assertTrue(flagged["uk:lsoa:E01000004"]["nationalRailNotModelled"])
        profile = {"schemaVersion": "preference-profile.v2", "market": "buy", "targetBudget": 500_000,
                   "maximumBudget": 650_000, "bedrooms": 2,
                   "criteria": [{"kind": "place", "id": "office", "label": "Office",
                                 "target": {"kind": "point", "latitude": 51.5353, "longitude": -0.1246},
                                 "mode": "transit", "targetMinutes": 20, "weight": 5, "must": True}]}
        pack = match_model.score_pack(profile, rows)
        result = next(item for item in pack["values"] if item["geographyId"] == "uk:lsoa:E01000004")
        self.assertFalse(result["excluded"])
        component = next(item for item in result["components"] if item["factorId"] == "place:office")
        self.assertTrue(component["nationalRailNotModelled"])

    def test_find_areas_carries_the_national_rail_caveat(self):
        caveats = home_search._place_caveats([{"factorId": "place:office", "quality": "observed",
                                               "nationalRailNotModelled": True}])
        self.assertTrue(any("National Rail" in caveat for caveat in caveats))
        plain = home_search._place_caveats([{"factorId": "place:office", "quality": "observed"}])
        self.assertFalse(any("National Rail" in caveat for caveat in plain))

    def test_mode_over_the_matrix_cap_is_kept_as_capped_not_dropped(self):
        # #223: R5 stops at 120 minutes; over-cap pairs are stored unreachable (median null). The mode
        # stays, marked capped, routes over the cap are not listed, and the caveat names the cap.
        connection = _connection()
        connection.hub_minutes[("uk:lsoa:E01000004", "kings-cross", "transit")] = (None, None, None)
        connection.hub_minutes[("uk:lsoa:E01000004", "kings-cross", "walk")] = (None, None, None)
        msoa = connection.geographies["uk:lsoa:E01000004"]["parent_id"]
        connection.itineraries[(msoa, "kings-cross")] = [
            {"option": 1, "total_minutes": 142, "transfers": 3, "walking_minutes": 12, "legs": []},
            {"option": 2, "total_minutes": 120, "transfers": 2, "walking_minutes": 9, "legs": []}]
        payload = EvidenceReader(connect=lambda: connection).get_commute("uk:lsoa:E01000004", [OFFICE])
        [entry] = payload["places"]
        for mode in ("transit", "walk"):
            self.assertEqual(entry["modes"][mode], {"minutes": None, "range": None, "capped": True, "capMinutes": 120})
        self.assertIn("cycle", entry["modes"])
        self.assertEqual([route["totalMinutes"] for route in entry["routes"]], [120])
        self.assertTrue(any("120 minutes" in caveat for caveat in payload["caveats"]))
        self.assertTrue(payload["capped"])
        self.assertEqual(home_search.commute_confidence(payload), "low")

    def test_place_outside_london_gets_no_minutes_instead_of_a_straight_line_guess(self):
        # #224: a pin outside Greater London gets minutes null and a reason, never a haversine estimate.
        connection = _connection()
        edinburgh = {**OFFICE, "id": "edi", "label": "Edinburgh",
                     "target": {"kind": "point", "latitude": 55.95, "longitude": -3.19}}
        null_island = {**OFFICE, "id": "null", "label": "Null island",
                       "target": {"kind": "point", "latitude": 0, "longitude": 0}}
        reader = EvidenceReader(connect=lambda: connection)
        payload = reader.get_commute("uk:lsoa:E01000004", [edinburgh, null_island])
        for entry in payload["places"]:
            self.assertEqual(entry["reason"], "outside-london")
            self.assertNotIn("estimate", entry)
            self.assertEqual({mode: value["minutes"] for mode, value in entry["modes"].items()},
                             {"transit": None, "walk": None, "cycle": None, "car": None})
        self.assertTrue(any("Edinburgh" in caveat and "outside Greater London" in caveat for caveat in payload["caveats"]))
        self.assertEqual(payload["outsideLondon"], "all")
        self.assertEqual(home_search.commute_confidence(payload), "none")
        mixed = reader.get_commute("uk:lsoa:E01000004", [OFFICE, edinburgh])
        self.assertEqual(mixed["outsideLondon"], "some")
        self.assertEqual(home_search.commute_confidence(mixed), "low")
        self.assertEqual(mixed["places"][0]["modes"]["transit"]["minutes"], 21 + mixed["places"][0]["hub"]["walkFromHubMinutes"])

    def test_estimated_minutes_inside_london_carry_the_screening_caveat(self):
        # #224: a London pin with no hub near it is still a straight-line estimate, and the response says so.
        connection = _connection()
        connection.execute("-- evidence:active-release\nSELECT 1")
        payload = EvidenceReader(connect=lambda: connection).get_commute("uk:lsoa:E01000004", [FARAWAY])
        [entry] = payload["places"]
        self.assertTrue(entry["estimate"])
        self.assertTrue(any("straight-line" in caveat for caveat in payload["caveats"]))

    def test_kind_of_place_with_nothing_within_the_radius_says_so(self):
        # #246: amenities are searched within 4 km; an empty result names the radius instead of a bare null.
        connection = _connection()
        connection.area_amenities = []
        gym = {"id": "gym", "label": "Gym", "target": {"kind": "category", "category": "gym"},
               "mode": "walk", "targetMinutes": 15, "weight": 3, "must": False}
        payload = EvidenceReader(connect=lambda: connection).get_commute("uk:lsoa:E01000004", [gym])
        [entry] = payload["places"]
        self.assertIsNone(entry["nearest"])
        self.assertEqual(entry["searchedRadiusM"], 4000)
        self.assertEqual(entry["modes"], {})
        self.assertTrue(any("No Gym within 4 km" in caveat for caveat in payload["caveats"]))

    def test_minutes_always_lie_inside_the_range(self):
        # #248: one rounding helper for minutes and both range ends, over the fixture's matrix rows and
        # the half-minute cases where Python's round and the page's half-up rounding used to disagree.
        cells = list(_connection().hub_minutes.values()) + [(50, 29, 50), (36.46, 18.5, 36.46), (24.5, 24.5, 24.5),
                                                            (12, None, None), (35.96, 35.5, 36.04)]
        extras = [0, 0.04, 0.47, 0.5, 0.96, 1.46, 2.5, 7.55]
        for median, p10, p90 in cells:
            for extra in extras:
                with self.subTest(cell=(median, p10, p90), extra=extra):
                    entry = commute.mode_entry(median, p10, p90, extra)
                    low, high = entry["range"]
                    self.assertLessEqual(low, entry["minutes"])
                    self.assertLessEqual(entry["minutes"], high)
                    self.assertEqual(entry["minutes"], commute.whole_minutes(median + extra))
        self.assertEqual(commute.mode_entry(50, 29, 50, 0.47), {"minutes": 51, "range": [30, 51]})
        # Through area_commute: a pin a few hundred metres from the hub (extra 0.47 for car) with median = p90.
        connection = _connection()
        connection.hub_minutes[("uk:lsoa:E01000004", "kings-cross", "car")] = (50, 29, 50)
        near = {**OFFICE, "target": {"kind": "point", "latitude": 51.5314, "longitude": -0.1239}}
        [entry] = commute.area_commute(connection, NETWORK, "uk:lsoa:E01000004", [near])
        for mode, value in entry["modes"].items():
            with self.subTest(mode=mode):
                self.assertTrue(value["range"][0] <= value["minutes"] <= value["range"][1])


if __name__ == "__main__":
    unittest.main()
