"""Friendly area names and map label points (migration 023)."""
import unittest

from area_api import evidence, labels
from tests.test_production_evidence import FakeConnection, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

MAP_ROWS = [
    {"kind": "borough", "code": "E09000007", "label": "Camden", "name": "Camden", "postcodes": None,
     "lon": -0.153, "lat": 51.545},
    {"kind": "district", "code": "NW5", "label": "NW5 · Kentish Town", "name": "Kentish Town",
     "postcodes": 1200, "lon": -0.141, "lat": 51.552},
    {"kind": "district", "code": "NW1", "label": "NW1 · Camden Town", "name": "Camden Town",
     "postcodes": 900, "lon": -0.143, "lat": 51.538},
]


class LabelConnection(FakeConnection):
    """The production fake with migration 023 rows: friendly names on the
    geography and search reads, and the map_label read."""

    def __init__(self, source):
        self.__dict__.update(source.__dict__)
        self.label_reads = 0
        self.geographies["uk:lsoa:E01000004"].update(friendly_name="Kentish Town North", postcode_district="NW5")

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- labels:map":
            self.label_reads += 1
            return [dict(row) for row in MAP_ROWS]
        return super().execute(sql, params)

    def _search_row(self, geography):
        row = super()._search_row(geography)
        row.update(friendly_name=geography.get("friendly_name"), postcode_district=geography.get("postcode_district"))
        return row


def _reader(connection):
    return evidence.EvidenceReader(connect=lambda: connection)


class FriendlyTitleTests(unittest.TestCase):
    def test_title_joins_name_and_district(self):
        self.assertEqual(evidence.friendly_title("Alperton East", "HA0"), "Alperton East · HA0")
        self.assertEqual(evidence.friendly_title("Brent", None), "Brent")
        self.assertIsNone(evidence.friendly_title(None, "HA0"))


class MapLabelTests(unittest.TestCase):
    def test_points_carry_kind_label_and_rank(self):
        payload = labels.map_labels(_reader(LabelConnection(seed_production_fixture())))
        self.assertEqual(payload["type"], "FeatureCollection")
        first, second = payload["features"][:2]
        self.assertEqual(first["geometry"], {"type": "Point", "coordinates": [-0.153, 51.545]})
        self.assertEqual(first["properties"], {"kind": "borough", "code": "E09000007", "label": "Camden",
                                               "name": "Camden", "rank": 0})
        self.assertEqual(second["properties"]["label"], "NW5 · Kentish Town")
        self.assertEqual(second["properties"]["rank"], 1)

    def test_collection_is_cached_per_active_release(self):
        connection = LabelConnection(seed_production_fixture())
        reader = _reader(connection)
        labels.map_labels(reader)
        labels.map_labels(reader)
        self.assertEqual(connection.label_reads, 1)
        connection.active_id = "rel-next"  # an activation: the cache is keyed by release id
        labels.map_labels(reader)
        self.assertEqual(connection.label_reads, 2)


class FriendlyAreaTests(unittest.TestCase):
    def test_area_response_adds_friendly_name_and_district(self):
        detail = _reader(LabelConnection(seed_production_fixture())).get_area("uk:lsoa:E01000004", "crime", "2026-06")
        self.assertEqual(detail["friendlyName"], "Kentish Town North")
        self.assertEqual(detail["postcodeDistrict"], "NW5")
        self.assertEqual(detail["summary"]["name"], "Camden 001A test area")  # the official name stays

    def test_display_name_is_the_friendly_title_else_the_official_name(self):
        # v4 Task 24: one name to show, fixed once in the API; the official name stays in "name".
        reader = _reader(LabelConnection(seed_production_fixture()))
        detail = reader.get_area("uk:lsoa:E01000004", "crime", "2026-06")
        self.assertEqual(detail["displayName"], "Kentish Town North · NW5")
        bare = _reader(seed_production_fixture()).get_area("uk:lsoa:E01000004", "crime", "2026-06")
        self.assertEqual(bare["displayName"], "Camden 001A test area")
        self.assertEqual(evidence.display_name({"name": "Brent", "friendly_name": "Brent"}), "Brent")
        self.assertIsNone(evidence.display_name({}))

    def test_area_names_resolve_ids_and_leave_unknown_ones_out(self):
        reader = _reader(LabelConnection(seed_production_fixture()))
        payload = reader.area_names(["uk:lsoa:E01000004", "uk:lsoa:E01999999"])
        self.assertEqual(payload["schemaVersion"], "area-names.v1")
        self.assertEqual(payload["names"], {"uk:lsoa:E01000004": "Kentish Town North · NW5"})
        # Where to pin it (a ranking's top 10 on the map): [longitude, latitude], unknown ids left out.
        self.assertEqual(list(payload["centers"]), ["uk:lsoa:E01000004"])
        self.assertEqual(len(payload["centers"]["uk:lsoa:E01000004"]), 2)
        self.assertEqual(reader.area_names([])["names"], {})
        with self.assertRaises(evidence.MalformedQuery):
            reader.area_names(["uk:lsoa:E01000004"] * 51)
        with self.assertRaises(evidence.EvidenceError):
            reader.area_names(["not-an-id"])

    def test_area_without_a_label_row_reads_null(self):
        detail = _reader(seed_production_fixture()).get_area("uk:lsoa:E01000004", "crime", "2026-06")
        self.assertIsNone(detail["friendlyName"])
        self.assertIsNone(detail["postcodeDistrict"])

    def test_search_labels_with_the_friendly_title_and_keeps_the_official_name(self):
        results = _reader(LabelConnection(seed_production_fixture())).search_areas("E01000004")["results"]
        self.assertEqual(results[0]["label"], "Kentish Town North · NW5")
        self.assertEqual(results[0]["secondaryLabel"], "Camden 001A test area · E01000004")
        self.assertEqual(results[0]["friendlyName"], "Kentish Town North")

    def test_search_matches_friendly_names(self):
        sql = evidence.SEARCH_SQL
        self.assertIn("LEFT JOIN area_label", sql)
        self.assertIn("coalesce(l.friendly_name, '')", sql)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class LabelHttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        app_module._reader = _reader(LabelConnection(seed_production_fixture()))
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_labels_endpoint_serves_geojson(self):
        response = self.client.get("/api/v1/labels")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["type"], "FeatureCollection")
        self.assertEqual([f["properties"]["kind"] for f in body["features"]], ["borough", "district", "district"])
        self.assertEqual(response.headers["cache-control"], app_module.PACK_CACHE)  # not fetched again on every open

    def test_names_endpoint_resolves_a_share_links_ids(self):
        response = self.client.get("/api/v1/areas/names?ids=uk:lsoa:E01000004,uk:lsoa:E01000004,uk:lsoa:E01999999")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["names"], {"uk:lsoa:E01000004": "Kentish Town North · NW5"})
        self.assertEqual(self.client.get("/api/v1/areas/names?ids=nope").status_code, 400)

    def test_area_endpoint_carries_friendly_fields(self):
        body = self.client.get("/api/v1/areas/uk:lsoa:E01000004?metric=crime&period=2026-06").json()
        self.assertEqual((body["friendlyName"], body["postcodeDistrict"]), ("Kentish Town North", "NW5"))


if __name__ == "__main__":
    unittest.main()


class EnglandNameTests(unittest.TestCase):
    """G-E24 and G-E15: ONS inverted names read as people say them; a LAD outside London is a council."""

    def test_inverted_names_are_plain(self):
        self.assertEqual(evidence.plain_place_name("Bristol, City of"), "Bristol")
        self.assertEqual(evidence.plain_place_name("Herefordshire, County of"), "Herefordshire")
        self.assertEqual(evidence.plain_place_name("City of London"), "City of London")
        self.assertIsNone(evidence.plain_place_name(" "))
        self.assertEqual(evidence.display_name({"name": "Kingston upon Hull, City of"}), "Kingston upon Hull")

    def test_search_labels_a_council_outside_london(self):
        row = {"id": "uk:lad:E06000014", "name": "York", "official_code": "E06000014", "kind": "lad",
               "friendly_name": "York", "postcode_district": None, "center_lon": -1.08, "center_lat": 53.96}
        self.assertEqual(evidence._search_result(row)["secondaryLabel"], "E06000014 · council")
        camden = {**row, "id": "uk:lad:E09000007", "name": "Camden", "official_code": "E09000007", "friendly_name": "Camden"}
        self.assertEqual(evidence._search_result(camden)["secondaryLabel"], "E09000007 · borough")
        bristol = {**row, "id": "uk:lad:E06000023", "name": "Bristol, City of", "official_code": "E06000023",
                   "friendly_name": "Bristol, City of"}
        self.assertEqual(evidence._search_result(bristol)["label"], "Bristol")

    def test_map_labels_name_a_borough_plainly(self):
        class Rows:
            def execute(self, sql, params=()):
                return [{"kind": "borough", "code": "E06000023", "label": "Bristol, City of", "name": "Bristol, City of",
                         "postcodes": None, "lon": -2.6, "lat": 51.45}]
        props = labels._load(Rows(), None)[0]["properties"]
        self.assertEqual((props["label"], props["name"]), ("Bristol", "Bristol"))
