"""CLOSE_KNIT_ENGLAND in the API: coverage checks take England's box, reasons read outside-coverage, London-only
sources say so cleanly, and area payloads carry rankScope. With the flag off every answer is London's as before."""
import os
import unittest
from unittest import mock

from area_api import (coverage, listing_card, matching, personal_places, photos, portal_zones, regions,
                      search_text)
from area_api.evidence import MalformedQuery
from area_api.matching import InvalidMatchRequest

MANCHESTER = [[53.48, -2.25], [53.49, -2.24], [53.47, -2.23]]
EDINBURGH = [[55.95, -3.19], [55.96, -3.18], [55.94, -3.17]]


class FlagCase(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ("CLOSE_KNIT_ENGLAND", "CLOSE_KNIT_ACCESS"):
            os.environ.pop(name, None)

    def england(self):
        os.environ["CLOSE_KNIT_ENGLAND"] = "1"


class CoverageChecksTests(FlagCase):
    def test_drawn_zone_in_manchester_needs_the_flag(self):
        zone = {"kind": "polygon", "points": MANCHESTER}
        with self.assertRaisesRegex(InvalidMatchRequest, "in London"):
            matching.validate_zones([zone])
        self.england()
        matching.validate_zones([zone])
        with self.assertRaisesRegex(InvalidMatchRequest, "in England"):
            matching.validate_zones([{"kind": "polygon", "points": EDINBURGH}])

    def test_portal_ring_in_manchester_needs_the_flag(self):
        ring = [tuple(point) for point in MANCHESTER]
        self.assertFalse(portal_zones.valid_ring(ring))
        self.england()
        self.assertTrue(portal_zones.valid_ring(ring))
        self.assertFalse(portal_zones.valid_ring([tuple(point) for point in EDINBURGH]))

    def test_listing_card_looks_up_points_in_england_with_the_flag(self):
        looked_up = []
        reader = mock.MagicMock()
        reader.area_at.side_effect = lambda lng, lat, cancel=None: looked_up.append((lat, lng)) or "uk:lsoa:E01000001"
        context = mock.MagicMock(reader=reader)

        def resolve(lat, lng):
            request = listing_card.ListingCardRequest(portal="rightmove", listingId="1", lat=lat, lng=lng,
                                                      url="https://www.rightmove.co.uk/1")
            with mock.patch.object(listing_card.card_cache, "release_id", return_value=None):
                return listing_card.resolve_area(context, request)
        self.assertIsNone(resolve(53.48, -2.24))  # Manchester: outside London's box, not looked up
        self.assertEqual(resolve(51.5, -0.12), "uk:lsoa:E01000001")
        self.assertEqual(listing_card.outside_card()["blocks"][0]["title"], "Close Knit covers London only")
        self.england()
        self.assertEqual(resolve(53.48, -2.24), "uk:lsoa:E01000001")
        self.assertIsNone(resolve(55.95, -3.19))  # Edinburgh
        self.assertEqual(looked_up, [(51.5, -0.12), (53.48, -2.24)])
        self.assertEqual(listing_card.outside_card()["blocks"][0]["title"], "Close Knit covers England only")

    def test_photos_take_points_in_england_with_the_flag(self):
        reader = mock.MagicMock()
        with self.assertRaisesRegex(MalformedQuery, "London"):
            photos.nearby_photos(reader, 53.48, -2.24)
        self.england()
        with self.assertRaisesRegex(MalformedQuery, "England"):
            photos.nearby_photos(reader, 55.95, -3.19)
        reader._connect.return_value.__enter__.return_value.execute.return_value = [{"t": False}]
        self.assertEqual(photos.nearby_photos(reader, 53.48, -2.24)["photos"], [])

    def test_empty_search_reason_follows_the_coverage(self):
        self.assertEqual(search_text.empty_reason("M1 1AE"), "outside-london")
        self.assertEqual(search_text.reason_text("unknown-postcode"), search_text.EMPTY_REASONS["unknown-postcode"])
        self.england()
        self.assertEqual(search_text.empty_reason("M1 1AE"), "unknown-postcode")
        self.assertEqual(search_text.empty_reason("LS1"), "unknown-postcode")
        self.assertEqual(search_text.empty_reason("N1 9ZZ"), "unknown-postcode")
        self.assertEqual(search_text.empty_reason("EH1 1YZ"), "outside-coverage")
        self.assertEqual(search_text.empty_reason("BT1"), "outside-coverage")
        self.assertIn("English postcode", search_text.reason_text("unknown-postcode"))
        self.assertIn("England", search_text.reason_text("outside-coverage"))

    def test_outside_reason_text_names_the_scope_not_a_fixed_place(self):
        from area_api import scope
        self.england()
        with mock.patch.object(search_text, "current_scope", return_value=scope.ENGLAND.within(("E12000002",))):
            self.assertEqual(search_text.reason_text("outside-coverage"),
                             "Nothing found: that postcode is outside Close Knit's coverage (North West).")
        # The London-only code and its text stay for older clients.
        self.assertIn("London", search_text.reason_text("outside-london"))

    def test_england_postcode_areas_hold_every_london_one(self):
        self.assertLessEqual(search_text.LONDON_POSTCODE_AREAS, search_text.ENGLAND_POSTCODE_AREAS)
        self.assertNotIn("EH", search_text.ENGLAND_POSTCODE_AREAS)
        self.assertNotIn("CF", search_text.ENGLAND_POSTCODE_AREAS)
        self.assertEqual(len(search_text.ENGLAND_POSTCODE_AREAS), 104)


class PortalDistrictFallbackTests(FlagCase):
    class Connection:
        def __init__(self):
            self.markers = []

        def execute(self, sql, params=()):
            marker = sql.split("\n", 1)[0]
            self.markers.append(marker)
            if marker == "-- evidence:portal-borough-outline":
                ring = [[-2.25 + 0.001 * i, 53.48 + (0.01 if i % 2 else 0)] for i in range(40)]
                return [{"ring": '{"type": "LineString", "coordinates": %s}' % (ring + ring[:1])}]
            if marker == "-- evidence:portal-zone-districts":
                return []  # no address rows outside London
            if marker == "-- evidence:portal-zone-postcode-districts":
                assert params[0] == ["E01005000"], params
                return [{"outcode": "M1", "addresses": 40}, {"outcode": "M4", "addresses": 12}]
            return []

    def links(self):
        connection = self.Connection()
        found = portal_zones.zone_links(connection, [{"kind": "borough", "id": "uk:lad:E08000003"}], "buy",
                                        300_000, 2, lambda connection, zones: {"uk:lsoa:E01005000"}, None)
        return connection, found[0]

    def test_a_borough_outside_london_gets_its_outline_and_postcode_districts(self):
        self.england()
        connection, zone = self.links()
        hrefs = {entry["portal"]: entry["href"] for entry in zone["portals"]}
        self.assertIn("shape=draw", hrefs["rightmove"])  # no Rightmove REGION id outside London: its outline
        self.assertIn("shape=draw", hrefs["zoopla"])
        self.assertEqual([district["outcode"] for district in zone["districts"]], ["M1", "M4"])

    def test_flag_off_never_asks_the_postcode_directory(self):
        connection, zone = self.links()
        self.assertNotIn("-- evidence:portal-zone-postcode-districts", connection.markers)
        self.assertEqual(zone["districts"], [])


class CommuteOutsideLondonTests(FlagCase):
    def setUp(self):
        super().setUp()
        from area_api import commute
        commute.clear_cache()
        personal_places.clear_cache()
        self.addCleanup(commute.clear_cache)
        self.addCleanup(personal_places.clear_cache)

    def connection(self, lat, lon):
        from tests.test_commute import _connection

        connection = _connection()
        connection.area_points = [{"geography_id": "uk:lsoa:E01000004", "name": "x", "lon": lon, "lat": lat,
                                   "station_walk": None}]
        return connection

    def commute(self, connection):
        from area_api.evidence import EvidenceReader
        from tests.test_commute import OFFICE

        return EvidenceReader(connect=lambda: connection).get_commute("uk:lsoa:E01000004", [OFFICE])

    def test_an_area_outside_london_gets_no_minutes_and_says_why(self):
        self.england()
        payload = self.commute(self.connection(53.48, -2.24))
        [entry] = payload["places"]
        self.assertEqual(entry["reason"], "outside-coverage")
        self.assertEqual(entry["modes"]["transit"]["minutes"], None)
        self.assertEqual(payload["outsideLondon"], "all")
        self.assertIn("Door-to-door times cover London only (TfL timetables): no minutes from this area.",
                      payload["caveats"])

    def test_a_london_area_is_routed_as_before_with_the_flag(self):
        self.england()
        payload = self.commute(self.connection(51.53, -0.12))
        self.assertNotIn("reason", payload["places"][0])
        self.assertIsNone(payload["outsideLondon"])

    def test_a_london_area_is_routed(self):
        payload = self.commute(self.connection(51.52, -0.16))
        self.assertNotIn("reason", payload["places"][0])


class RankScopeTests(unittest.TestCase):
    class Connection:
        rows = [{"area_id": "uk:lsoa:E01000001", "region_code": "E12000007"},
                {"area_id": "uk:lsoa:E01005000", "region_code": "E12000002"}]

        def __init__(self, fail=False):
            self.fail = fail
            self.calls = 0

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, sql, params=()):
            self.calls += 1
            if self.fail:
                raise RuntimeError("relation area_region does not exist")
            assert sql.startswith("-- regions:area-regions")
            return self.rows

    def setUp(self):
        regions.clear_cache()
        self.addCleanup(regions.clear_cache)

    def test_rank_scope_names_the_region_and_is_cached(self):
        connection = self.Connection()
        self.assertEqual(regions.rank_scope(lambda: connection, "uk:lsoa:E01005000"),
                         {"code": "E12000002", "name": "North West"})
        self.assertEqual(regions.rank_scope(lambda: connection, "uk:lsoa:E01000001"),
                         {"code": "E12000007", "name": "London"})
        self.assertIsNone(regions.rank_scope(lambda: connection, "uk:lsoa:E01999999"))
        self.assertEqual(connection.calls, 1)

    def test_without_the_table_rank_scope_is_null(self):
        payload = regions.with_rank_scope({"a": 1}, lambda: self.Connection(fail=True), "uk:lsoa:E01005000")
        self.assertEqual(payload, {"a": 1, "rankScope": None})
        self.assertEqual(regions.with_rank_scope([1], lambda: self.Connection(), "x"), [1])

    def test_area_routes_carry_rank_scope(self):
        try:
            from fastapi.testclient import TestClient

            import area_api.app as app_module
        except ImportError:  # pragma: no cover
            self.skipTest("dependencies are not installed")
        connection = self.Connection()
        reader = mock.MagicMock()
        reader._connect = lambda: connection
        reader.get_profile.side_effect = lambda area_id, period, cancel=None: {
            "schemaVersion": "area-profile.v1", "geographyId": area_id}
        client = TestClient(app_module.app)
        with mock.patch.object(app_module, "get_reader", return_value=reader), \
                mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "1"}):
            body = client.get("/api/v1/areas/uk:lsoa:E01005000/profile?period=2025-01").json()
        self.assertEqual(body["rankScope"], {"code": "E12000002", "name": "North West"})
        self.assertEqual(body["geographyId"], "uk:lsoa:E01005000")
        # Flag off: London answers as before (rankScope London); an area elsewhere is not found.
        with mock.patch.object(app_module, "get_reader", return_value=reader), \
                mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "0"}):
            london = client.get("/api/v1/areas/uk:lsoa:E01000001/profile?period=2025-01")
            elsewhere = client.get("/api/v1/areas/uk:lsoa:E01005000/profile?period=2025-01")
        self.assertEqual(london.json()["rankScope"], {"code": "E12000007", "name": "London"})
        self.assertEqual(elsewhere.status_code, 404)


if __name__ == "__main__":
    unittest.main()
