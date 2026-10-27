"""v4 Task 9: My match zones as portal searches. The draw formats match the D1 check byte for byte, /go
rebuilds every target from its parameters (never a URL), a bad polygon is refused, the search id rides
as a fragment, and a failed weekly check sends the pair to the postcode districts."""
import json
import os
import unittest
import unittest.mock
from urllib.parse import parse_qs, urlsplit

from area_api import portal_link_check, portal_zones, usage

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.repository import evidence_connection
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

CLAPHAM = portal_link_check.CLAPHAM
D1_POLYLINE = "_qbyH~m]?_cB~p@??~bB_q@?"
D1_RIGHTMOVE = ("https://www.rightmove.co.uk/property-for-sale/map.html?locationIdentifier=USERDEFINEDAREA%5E%7B%22"
                "polylines%22%3A%22_qbyH~m%5D%3F_cB~p%40%3F%3F~bB_q%40%3F%22%7D&maxPrice=800000&minBedrooms=2")
BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"


def query(url):
    return {key: values[0] for key, values in parse_qs(urlsplit(url).query).items()}


class FakeZoneConnection:
    """Answers the portal-links queries; counts usage inserts (there must be none for from=web)."""

    def __init__(self, checks=()):
        self.checks = list(checks)
        self.inserts = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:portal-station":
            return [{"latitude": 51.4627, "longitude": -0.1145}] if params[0] == "osm:n1" else []
        if marker == "-- evidence:portal-borough-outline":
            ring = [[-0.15 + 0.001 * i, 51.45 + (0.01 if i % 2 else 0)] for i in range(150)]
            return [{"ring": json.dumps({"type": "LineString", "coordinates": ring + ring[:1]})}]
        if marker == "-- evidence:portal-zone-districts":
            return [{"outcode": code, "addresses": 10} for code in ("SW4", "SW9", "SE11")][:params[1]]
        if marker in ("-- evidence:zone-station", "-- evidence:zone-borough", "-- evidence:zone-polygon"):
            return [{"geography_id": "uk:lsoa:E01003000"}]
        if marker == "-- usage:portal-link-check-latest":
            return self.checks
        if marker == "-- usage:insert":
            self.inserts.append(params)
            return []
        raise AssertionError(sql)


class PolylineTests(unittest.TestCase):
    def test_the_d1_box_encodes_to_the_checked_polyline(self):
        self.assertEqual(portal_zones.encode_polyline(CLAPHAM), D1_POLYLINE)
        # A ring already closed encodes the same.
        self.assertEqual(portal_zones.encode_polyline(CLAPHAM + CLAPHAM[:1]), D1_POLYLINE)

    def test_decode_round_trips_and_refuses_junk(self):
        self.assertEqual(portal_zones.decode_polyline(D1_POLYLINE), CLAPHAM + CLAPHAM[:1])
        for junk in ("", "abc def", "_qbyH", "x" * 2000):
            with self.assertRaises(ValueError):
                portal_zones.decode_polyline(junk)

    def test_a_ring_must_be_in_london_with_3_to_100_corners(self):
        self.assertTrue(portal_zones.valid_ring(CLAPHAM))
        self.assertFalse(portal_zones.valid_ring(CLAPHAM[:2]))
        self.assertFalse(portal_zones.valid_ring([(48.85, 2.35), (48.86, 2.35), (48.86, 2.36)]))  # Paris
        self.assertFalse(portal_zones.valid_ring([(51.5, -0.1 + i / 1e4) for i in range(101)]))

    def test_thin_and_circle(self):
        many = [(51.5, -0.1 + i / 1e4) for i in range(250)]
        self.assertEqual(len(portal_zones.thin_ring(many)), 100)
        circle = portal_zones.circle_ring(51.5, -0.1, 800)
        self.assertEqual(len(circle), 24)
        self.assertAlmostEqual(max(lat for lat, _ in circle) - 51.5, 800 / 111_320, places=4)


class PortalUrlTests(unittest.TestCase):
    def test_rightmove_draw_matches_the_d1_url(self):
        self.assertEqual(portal_zones.draw_url("rightmove", "buy", D1_POLYLINE, 800_000, 2), D1_RIGHTMOVE)
        rent = portal_zones.draw_url("rightmove", "rent", D1_POLYLINE, 3000, 2)
        self.assertTrue(rent.startswith("https://www.rightmove.co.uk/property-to-rent/map.html?locationIdentifier=USERDEFINEDAREA"))

    def test_zoopla_draw_is_the_list_view(self):
        buy = portal_zones.draw_url("zoopla", "buy", D1_POLYLINE, 800_000, 2)
        self.assertTrue(buy.startswith("https://www.zoopla.co.uk/for-sale/property/london/?polyenc="))
        self.assertEqual(query(buy), {"polyenc": D1_POLYLINE, "price_max": "800000", "beds_min": "2", "q": "London",
                                      "search_source": "for-sale"})
        rent = query(portal_zones.draw_url("zoopla", "rent", D1_POLYLINE, 3000, 2))
        self.assertEqual((rent["price_frequency"], rent["search_source"]), ("per_month", "to-rent"))
        self.assertIsNone(portal_zones.draw_url("onthemarket", "buy", D1_POLYLINE, 800_000, 2))

    def test_every_london_borough_has_its_rightmove_region(self):
        self.assertEqual(len(portal_zones.RIGHTMOVE_BOROUGH_REGIONS), 33)
        self.assertEqual(portal_zones.borough_url("rightmove", "buy", "E09000022", 800_000, 2),
                         "https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=REGION%5E93971"
                         "&maxPrice=800000&minBedrooms=2")
        self.assertIsNone(portal_zones.borough_url("zoopla", "buy", "E09000022", 800_000, 2))


class GoTargetTests(unittest.TestCase):
    def go(self, portal, **params):
        base = {"kind": "zone", "market": "buy", "max_price": "800000", "beds": "2", "from": "web"}
        return usage.go_target(portal, {**base, **params})

    def test_a_drawn_zone_opens_the_draw_search(self):
        self.assertEqual(self.go("rightmove", shape="draw", poly=D1_POLYLINE), D1_RIGHTMOVE)
        self.assertIn("polyenc=", self.go("zoopla", shape="draw", poly=D1_POLYLINE))

    def test_a_borough_opens_rightmoves_region(self):
        self.assertIn("REGION%5E93971", self.go("rightmove", shape="borough", borough="E09000022"))
        self.assertIsNone(self.go("rightmove", shape="borough", borough="E09000099"))
        self.assertIsNone(self.go("zoopla", shape="borough", borough="E09000022"))

    def test_bad_shapes_and_portals_are_refused(self):
        self.assertIsNone(self.go("onthemarket", shape="draw", poly=D1_POLYLINE))
        self.assertIsNone(self.go("rightmove", shape="draw", poly="not a polyline"))
        paris = portal_zones.encode_polyline([(48.85, 2.35), (48.86, 2.35), (48.86, 2.36)])
        self.assertIsNone(self.go("rightmove", shape="draw", poly=paris))
        self.assertIsNone(self.go("rightmove", shape="circle", poly=D1_POLYLINE))
        self.assertIsNone(self.go("evil", shape="draw", poly=D1_POLYLINE))

    def test_the_search_id_rides_as_a_fragment_only_when_well_formed(self):
        self.assertEqual(self.go("rightmove", shape="draw", poly=D1_POLYLINE, sid="ab12cd34ef"), f"{D1_RIGHTMOVE}#closeknit=ab12cd34ef")
        self.assertEqual(self.go("rightmove", shape="draw", poly=D1_POLYLINE, sid="<script>"), D1_RIGHTMOVE)
        listings = usage.go_target("zoopla", {"outcode": "E8", "market": "buy", "max_price": "600000", "beds": "2",
                                              "sid": "ab12cd34ef"})
        self.assertTrue(listings.endswith("#closeknit=ab12cd34ef"))


class ZoneLinksTests(unittest.TestCase):
    def setUp(self):
        portal_zones._check_cache = None
        self.addCleanup(setattr, portal_zones, "_check_cache", None)

    def links(self, zones, checks=(), env=None):
        from area_api.repository import zone_lsoas

        connection = FakeZoneConnection(checks)
        with unittest.mock.patch.dict(os.environ, env or {}, clear=False):
            return portal_zones.zone_links(connection, zones, "buy", 800_000, 2, zone_lsoas, lambda: connection)

    def hrefs(self, zone):
        return {entry["portal"]: entry["href"] for entry in zone["portals"]}

    def test_each_zone_kind_gets_what_each_portal_takes(self):
        polygon, station, borough, lsoas = self.links([
            {"kind": "polygon", "points": [list(point) for point in CLAPHAM], "label": "Area I drew"},
            {"kind": "station", "stationId": "osm:n1", "maxWalkMinutes": 10, "label": "Clapham North"},
            {"kind": "borough", "id": "uk:lad:E09000022", "label": "Lambeth"},
            {"kind": "lsoas", "ids": ["uk:lsoa:E01003000"]},
        ])
        self.assertEqual(query(self.hrefs(polygon)["rightmove"])["poly"], D1_POLYLINE)
        self.assertTrue(self.hrefs(polygon)["rightmove"].startswith("/go/rightmove?kind=zone"))
        self.assertIsNone(self.hrefs(polygon)["onthemarket"])
        self.assertEqual(query(self.hrefs(station)["zoopla"])["shape"], "draw")
        self.assertEqual(len(portal_zones.decode_polyline(query(self.hrefs(station)["zoopla"])["poly"])), 25)
        self.assertEqual(query(self.hrefs(borough)["rightmove"])["borough"], "E09000022")
        outline = portal_zones.decode_polyline(query(self.hrefs(borough)["zoopla"])["poly"])
        self.assertLessEqual(len(outline), 101)
        self.assertEqual(self.hrefs(lsoas), {"rightmove": None, "zoopla": None, "onthemarket": None})
        for zone in (polygon, station, borough, lsoas):
            self.assertEqual([d["outcode"] for d in zone["districts"]], ["SW4", "SW9", "SE11"])
            link = zone["districts"][0]["links"]["onthemarket"]
            self.assertEqual(query(link)["from"], "web")
            self.assertEqual(usage.go_target("onthemarket", query(link)),
                             "https://www.onthemarket.com/for-sale/property/sw4/?max-price=800000&min-bedrooms=2")
        self.assertEqual((polygon["label"], lsoas["label"]), ("Area I drew", "Chosen areas"))

    def test_an_unknown_station_falls_back_to_districts(self):
        [zone] = self.links([{"kind": "station", "stationId": "osm:n9", "maxWalkMinutes": 10}])
        self.assertEqual(self.hrefs(zone), {"rightmove": None, "zoopla": None, "onthemarket": None})

    def test_a_failed_check_or_the_switch_sends_a_portal_to_the_districts(self):
        zone = {"kind": "polygon", "points": [list(point) for point in CLAPHAM]}
        [failed] = self.links([zone], checks=[{"portal": "rightmove", "kind": "draw", "ok": False}])
        self.assertIsNone(self.hrefs(failed)["rightmove"])
        self.assertIsNotNone(self.hrefs(failed)["zoopla"])
        portal_zones._check_cache = None
        [switched] = self.links([zone], env={"CLOSE_KNIT_PORTAL_DRAW_OFF": "zoopla"})
        self.assertIsNotNone(self.hrefs(switched)["rightmove"])
        self.assertIsNone(self.hrefs(switched)["zoopla"])


class ContractFixtureTests(unittest.TestCase):
    """contracts/fixtures/portal-zones.json: web/tests/portal-zones.test.ts reads the same cases."""

    def test_the_api_builds_exactly_the_fixture(self):
        from pathlib import Path

        fixture = json.loads((Path(__file__).resolve().parents[2] / "contracts" / "fixtures" / "portal-zones.json").read_text())
        self.assertEqual(portal_zones.encode_polyline(fixture["polygon"]["points"]), fixture["polygon"]["polyline"])
        draw = fixture["goDraw"]
        link = portal_zones.go_zone_url(draw["portal"], market=draw["filter"]["market"], max_price=draw["filter"]["maxPrice"],
                                        beds=draw["filter"]["minBedrooms"], poly=fixture["polygon"]["polyline"])
        self.assertEqual(query(link), draw["params"])
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(usage.go_target(case["portal"], case["params"]), case["target"])


class LinkCheckTests(unittest.TestCase):
    def test_rightmove_pages_must_hold_and_zoopla_is_built_only(self):
        pages = {"map.html": '<title data-next-head="">Properties For Sale in Untitled (Drawn Area) | Rightmove</title>'
                             '"resultCount":"29"',
                 "find.html": "<title>Properties For Sale in Lambeth | Rightmove</title>\"resultCount\":\"1,739\""}
        checks = portal_link_check.run(lambda url: next(page for key, page in pages.items() if key in url))
        self.assertEqual([(c.portal, c.kind, c.ok) for c in checks],
                         [("rightmove", "draw", True), ("rightmove", "borough", True), ("zoopla", "draw", True)])

    def test_a_blocked_or_changed_page_fails(self):
        def blocked(url):
            raise OSError("HTTP Error 403: Forbidden")
        checks = portal_link_check.run(blocked)
        self.assertEqual([c.ok for c in checks], [False, False, True])
        changed = portal_link_check.run(lambda url: "<title>Find a place | Rightmove</title>")
        self.assertFalse(changed[0].ok)
        self.assertIn("unexpected page", changed[0].detail)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class PortalLinksHttpTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeZoneConnection()
        app_module._connect = lambda: self.connection
        self.addCleanup(setattr, app_module, "_connect", evidence_connection)
        portal_zones._check_cache = None
        self.addCleanup(setattr, portal_zones, "_check_cache", None)
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def test_the_route_answers_per_zone_and_privately(self):
        response = self.client.post("/api/v1/portal-links", json={
            "market": "buy", "maxPrice": 800_000, "minBedrooms": 2,
            "zones": [{"kind": "polygon", "points": [list(point) for point in CLAPHAM]}]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        body = response.json()
        self.assertEqual(body["schemaVersion"], "portal-links.v1")
        self.assertEqual(len(body["zones"]), 1)

    def test_bad_requests_are_400(self):
        for body in ({"market": "buy", "maxPrice": 800_000},
                     {"market": "lease", "maxPrice": 800_000, "minBedrooms": 2},
                     {"market": "buy", "maxPrice": 800_000, "minBedrooms": 2, "zones": [{"kind": "moon"}]}):
            self.assertEqual(self.client.post("/api/v1/portal-links", json=body).status_code, 400)

    def test_go_redirects_a_zone_and_leaves_web_clicks_to_the_page(self):
        link = portal_zones.go_zone_url("rightmove", market="buy", max_price=800_000, beds=2, poly=D1_POLYLINE)
        response = self.client.get(f"{link}&sid=ab12cd34ef", headers={"user-agent": BROWSER}, follow_redirects=False)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["location"], f"{D1_RIGHTMOVE}#closeknit=ab12cd34ef")
        self.assertEqual(self.connection.inserts, [])


if __name__ == "__main__":
    unittest.main()
