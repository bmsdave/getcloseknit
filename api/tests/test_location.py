"""Stream G3: drawn zones (polygon), "near any of" places, and the location block (conservation
area, ULEZ / Congestion Charge, planning activity) with its card notes."""
import datetime
import json
import unittest
from unittest import mock

from area_api import commute, location, personal_places, share_links
from area_api.matching import InvalidMatchRequest, validate_match_request
from area_api.repository import polygon_geojson, zone_lsoas
from tests.test_personal_places import FakePlaceConnection

SQUARE = {"kind": "polygon", "points": [[51.55, -0.11], [51.55, -0.09], [51.535, -0.09], [51.535, -0.11]]}
OFFICE = {"id": "office", "label": "Either office", "mode": "transit", "targetMinutes": 30, "weight": 4, "must": False,
          "target": {"kind": "any-of", "points": [[51.53, -0.12], [51.45, -0.30]]}}


def _profile(**extra):
    return {"schemaVersion": "preference-profile.v1", "market": "buy", "targetBudget": 300_000,
            "maximumBudget": 500_000, "commuteDestinations": [],
            "factors": [{"factorId": "crime", "weight": 4, "direction": "lower", "minimumUtility": None,
                         "maximumUtility": None}], **extra}


class ValidationTests(unittest.TestCase):
    def test_drawn_zones_and_any_of_places_pass(self):
        validate_match_request(_profile(zones=[SQUARE, {**SQUARE, "label": "Highbury"}], places=[OFFICE]))
        corners = [[51.5 + i * 0.001, -0.1 + (i % 2) * 0.01] for i in range(50)]
        validate_match_request(_profile(zones=[{"kind": "polygon", "points": corners}]))

    def test_malformed_drawn_zones_are_rejected(self):
        corners = [[51.5 + i * 0.001, -0.1 + (i % 2) * 0.01] for i in range(51)]
        bad = [
            {"kind": "polygon", "points": corners[:2]},
            {"kind": "polygon", "points": corners},
            {"kind": "polygon", "points": [[51.5, -0.1], [51.5, -0.1], [51.51, -0.1]]},
            {"kind": "polygon", "points": [[48.85, 2.35], [48.86, 2.35], [48.86, 2.36]]},
            {"kind": "polygon", "points": [[51.5, -0.1], [51.51, -0.1], ["51.5", -0.11]]},
            {"kind": "polygon", "points": [[51.5, -0.1], [51.51, -0.1], [True, -0.11]]},
            {"kind": "polygon", "points": [[51.5, -0.1, 3], [51.51, -0.1], [51.5, -0.11]]},
            {**SQUARE, "colour": "red"},
        ]
        for zone in bad:
            with self.subTest(zone=str(zone)[:60]), self.assertRaises(InvalidMatchRequest):
                validate_match_request(_profile(zones=[zone]))

    def test_malformed_any_of_places_are_rejected(self):
        for points in ([[51.5, -0.1]], [[51.5, -0.1], [91, 0]], [[1, 2], [3, 4], [5, 6], [7, 8]], None):
            with self.subTest(points=points), self.assertRaises(InvalidMatchRequest):
                validate_match_request(_profile(places=[{**OFFICE, "target": {"kind": "any-of", "points": points}}]))


class ZoneTests(unittest.TestCase):
    def test_polygon_geojson_is_lon_lat_and_closed(self):
        ring = json.loads(polygon_geojson(SQUARE["points"]))["coordinates"][0]
        self.assertEqual(ring[0], [-0.11, 51.55])
        self.assertEqual(ring[-1], ring[0])
        self.assertEqual(len(ring), 5)

    def test_a_drawn_zone_expands_to_the_lsoas_it_touches(self):
        class Connection:
            def __init__(self):
                self.calls = []

            def execute(self, sql, params=()):
                self.calls.append((sql.split("\n", 1)[0], params))
                return [{"geography_id": "uk:lsoa:E01000004"}]

        connection = Connection()
        found = zone_lsoas(connection, [SQUARE, {"kind": "lsoas", "ids": ["uk:lsoa:E01000006"]}])
        self.assertEqual(found, {"uk:lsoa:E01000004", "uk:lsoa:E01000006"})
        self.assertEqual(connection.calls[0][0], "-- evidence:zone-polygon")
        self.assertEqual(json.loads(connection.calls[0][1][0])["type"], "Polygon")

    def test_share_link_round_trip(self):
        profile = {**_profile(zones=[SQUARE], places=[OFFICE]), "bedrooms": 2, "forecastHorizon": "1y",
                   "school": {"phases": [], "characteristics": [], "facetWeights": {}, "shortlistUrns": [],
                              "desiredSchoolCount": 3}, "analyticsConsent": False}
        packed = share_links.decode_profile(share_links.encode_profile(profile))
        self.assertEqual(packed[9], [[3, SQUARE["points"]]])
        self.assertEqual(packed[10]["p"][0][2:5], [3, OFFICE["target"]["points"], None])
        self.assertEqual(share_links.profile_from_link("https://x/" + share_links.encode_profile(profile)), profile)


class AnyOfTests(unittest.TestCase):
    def setUp(self):
        personal_places.clear_cache()

    def test_rows_take_the_quicker_point_per_area(self):
        rows = personal_places.place_rows(FakePlaceConnection(), "rel", [OFFICE])
        by_area = {row["geography_id"]: row for row in rows}
        self.assertEqual(set(by_area), {"a", "b"})
        self.assertEqual(by_area["a"]["raw_value"], 0.0)  # area a sits on the first office
        self.assertEqual(by_area["b"]["raw_value"], 0.0)  # area b sits on the second
        self.assertTrue(all(row["factor_id"] == "place:office" for row in rows))

    def test_commute_card_shows_the_quickest_point_in_the_places_mode(self):
        slow = {"placeId": "office", "modes": {"transit": {"minutes": 40}}}
        fast = {"placeId": "office", "modes": {"transit": {"minutes": 25}, "walk": {"minutes": 90}}}
        with mock.patch.object(commute, "area_commute", return_value=[slow, fast]) as routed:
            self.assertIs(commute._quickest_of(None, {}, "uk:lsoa:E01000001", OFFICE), fast)
        targets = [place["target"] for place in routed.call_args.args[3]]
        self.assertEqual(targets, [{"kind": "point", "latitude": 51.53, "longitude": -0.12},
                                   {"kind": "point", "latitude": 51.45, "longitude": -0.30}])
        with mock.patch.object(commute, "area_commute", return_value=[{"placeId": "office", "modes": {}}]):
            self.assertEqual(commute._quickest_of(None, {}, "x", OFFICE)["modes"], {})


def _row(**overrides):
    row = {"geography_id": "uk:lsoa:E01002718", "area_m2": 100_000.0, "conservation_m2": 98_000.0, "ulez_m2": 100_000.0,
           "congestion_m2": 0.0, "planning_applications": 46, "planning_householder": 20, "planning_full": 15,
           "planning_prior_approval": 3, "planning_window_start": datetime.date(2024, 10, 7),
           "planning_window_end": datetime.date(2026, 10, 7), "london_median": 18.0,
           "conservation_release_id": "src-gla", "zones_release_id": "src-tfl", "planning_release_id": "src-pld"}
    row.update(overrides)
    return row


class LocationTests(unittest.TestCase):
    def test_value_and_notes(self):
        value = location.location_value(_row(), [
            {"name": "East Canonbury", "borough": "Islington", "overlap_m2": 60_000.0},
            {"name": "East Canonbury", "borough": "Islington", "overlap_m2": 30_000.0},
            {"name": "De Beauvoir", "borough": "Hackney", "overlap_m2": 8_000.0}])
        self.assertEqual(value["conservation"]["presence"], "inside")
        self.assertEqual([area["name"] for area in value["conservation"]["areas"]], ["East Canonbury", "De Beauvoir"])
        self.assertEqual(value["conservation"]["areas"][0]["share"], 0.9)
        self.assertEqual(value["planning"]["windowStart"], "2024-10-07")
        self.assertNotIn("seeAlso", value["planning"])
        self.assertEqual(value["notes"], [
            "In a conservation area (East Canonbury): extensions are limited",
            "46 planning applications in the last 2 years (London median 18)",
        ])

    def test_partly_and_outside(self):
        value = location.location_value(_row(conservation_m2=30_000.0, ulez_m2=2_000.0, congestion_m2=60_000.0,
                                              planning_applications=1, london_median=None),
                                         [{"name": "Barnsbury", "borough": "Islington", "overlap_m2": 30_000.0}])
        self.assertEqual(value["ulez"]["presence"], "outside")
        self.assertEqual(value["notes"], [
            "Partly in a conservation area (Barnsbury), 30% of the land: extensions are limited there",
            "Inside the Congestion Charge zone: driving in pays a daily charge",
            "1 planning application in the last 2 years",
        ])

    def test_outside_london_keeps_conservation_and_drops_london_only_layers(self):
        value = location.location_value(_row(region_code="E12000003", conservation_release_id="src-pd"),
                                         [{"name": "Chapel Allerton", "borough": "Leeds", "overlap_m2": 98_000.0}])
        self.assertEqual((value["ulez"], value["congestionCharge"], value["planning"]), (None, None, None))
        self.assertEqual(value["rankScope"], {"code": "E12000003", "name": "Yorkshire and The Humber"})
        self.assertEqual(value["notes"], ["In a conservation area (Chapel Allerton): extensions are limited"])
        unpublished = location.location_value(_row(region_code="E12000003", conservation_release_id=None,
                                                   conservation_m2=0.0))
        self.assertIsNone(unpublished["conservation"])
        self.assertEqual(unpublished["notes"],
                         ["The council has not published its conservation areas: check the council's map"])

    def test_rows_are_empty_when_the_layers_are_not_loaded(self):
        class Missing:
            def execute(self, sql, params=()):
                raise RuntimeError("relation area_location does not exist")

        self.assertEqual(location.location_rows(Missing(), ["uk:lsoa:E01000001"]), {})

    def test_rows_carry_their_sources(self):
        class Loaded:
            def execute(self, sql, params=()):
                marker = sql.split("\n", 1)[0]
                if marker == "-- evidence:area-location":
                    return [_row()]
                if marker == "-- evidence:area-conservation":
                    return [{"geography_id": "uk:lsoa:E01002718", "name": "East Canonbury", "borough": "Islington",
                             "overlap_m2": 98_000.0}]
                raise AssertionError(marker)

        value = location.location_rows(Loaded(), ["uk:lsoa:E01002718"])["uk:lsoa:E01002718"]
        self.assertEqual(value["sourceVersions"], ["src-gla", "src-pld", "src-tfl"])
        self.assertEqual(value["conservation"]["areas"][0]["name"], "East Canonbury")


class OverviewSourcesTests(unittest.TestCase):
    def test_overview_cites_the_location_releases(self):
        from tests.test_home_search import StubReader, _match_rows, tools
        if tools is None:
            self.skipTest("pydantic is not installed")
        from area_api import home_search

        context = tools.ToolContext(reader=StubReader(), load_match_rows=_match_rows)
        located = {"notes": ["Inside ULEZ"], "sourceVersions": ["src-gla", "src-tfl"]}
        with mock.patch.object(home_search, "_location", return_value=located):
            out = tools.call_tool("get_area_overview", context, {"area_id": "uk:lsoa:E01000001"})

        self.assertEqual(out["value"]["location"], located)
        releases = {source["release"] for source in out["sources"]}
        self.assertTrue({"src-gla", "src-tfl"} <= releases)


if __name__ == "__main__":
    unittest.main()
