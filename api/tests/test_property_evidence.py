"""House-level evidence: one dwelling's last recorded sale and the parcel
tiles, both gated by the active release like every other reader method."""
import os
import re
import unittest
from unittest import mock

from area_api import evidence
from area_api.evidence import EvidenceReader
from tests.test_production_evidence import OLD_RELEASE, UPRN_RELEASE, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api import tools
except ImportError:  # pragma: no cover
    TestClient = None


class PropertyReaderTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_PER_HOME": "1"})  # floor areas served
        patcher.start()
        self.addCleanup(patcher.stop)
        self.connection = seed_production_fixture()
        self.reader = EvidenceReader(connect=lambda: self.connection)

    def test_property_carries_its_last_sale_and_no_restated_value(self):
        payload = self.reader.get_property("100023336956")

        self.assertEqual(payload["schemaVersion"], "property.v2")
        self.assertEqual(payload["productReleaseId"], OLD_RELEASE)
        prop = payload["property"]
        self.assertEqual(prop["addressId"], "uk:addr:a1b2c3d4e5f6")
        self.assertEqual(prop["parcelId"], "63267097")
        self.assertEqual(prop["location"], [-0.1416, 51.501])
        self.assertNotIn("stockValue", prop)
        self.assertNotIn("restated", repr(payload).lower())
        self.assertEqual(prop["lastSale"], {"date": "2022-11-03", "period": "2022-11", "nominalPrice": 570000,
                                            "floorAreaSquareMetres": 54.0})
        self.assertIn("no home is valued", " ".join(prop["caveats"]).lower())
        self.assertEqual(prop["sourceVersion"], UPRN_RELEASE)

    def test_unknown_or_malformed_uprn(self):
        with self.assertRaises(evidence.PropertyNotFound):
            self.reader.get_property("999")
        with self.assertRaises(evidence.MalformedQuery):
            self.reader.get_property("not-a-uprn")

    def test_address_search_carries_the_dwelling_uprn(self):
        results = self.reader.search_areas("Sample Street")["results"]
        self.assertEqual([r["uprn"] for r in results if "addressId" in r], ["100023336956"])

    def test_find_property_by_address_text(self):
        payload = self.reader.find_property("sample street")
        self.assertEqual(payload["property"]["uprn"], "100023336956")
        with self.assertRaises(evidence.PropertyNotFound):
            self.reader.find_property("nowhere lane")

    def test_property_tile_is_bytes_and_zoom_bounded(self):
        self.assertEqual(self.reader.property_tile(16, 32745, 21792), b"\x1a\x05parcels")
        self.assertEqual(self.reader.property_tile(16, 1, 1), b"")
        with self.assertRaises(evidence.MalformedQuery):
            self.reader.property_tile(11, 0, 0)
        with self.assertRaises(evidence.MalformedQuery):
            self.reader.property_tile(16, 70000, 0)

    def test_sale_tile_is_bytes_and_zoom_bounded(self):
        self.assertEqual(self.reader.sale_tile(16, 1, 1), b"")
        with self.assertRaises(evidence.MalformedQuery):
            self.reader.sale_tile(10, 0, 0)
        with self.assertRaises(evidence.MalformedQuery):
            self.reader.sale_tile(14, 0, 20000)

    def test_place_tile_is_empty_below_zoom_14_and_bounded(self):
        self.assertEqual(self.reader.place_tile(16, 32745, 21792), b"\x1a\x05parcels")
        self.assertEqual(self.reader.place_tile(16, 1, 1), b"")
        statements = len(self.connection.statements)
        self.assertEqual(self.reader.place_tile(13, 0, 0), b"")
        self.assertEqual(len(self.connection.statements), statements, "below zoom 14 never queries")
        with self.assertRaises(evidence.MalformedQuery):
            self.reader.place_tile(14, 0, 20000)
        with self.assertRaises(evidence.MalformedQuery):
            self.reader.place_tile(23, 0, 0)
        self.assertIn("place_tile(%s, %s, %s)", evidence.PLACE_TILE_SQL)


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class PropertyHttpTests(unittest.TestCase):
    def setUp(self):
        tools.clear_catalogue_cache()
        connection = seed_production_fixture()
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_property_route_and_404(self):
        ok = self.client.get("/api/v1/properties/100023336956")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["property"]["lastSale"]["nominalPrice"], 570000)
        self.assertEqual(ok.json()["sources"], [], "fixture ids are not src-hmlr-/src-os-/src-epc- releases")
        history = self.client.get("/api/v1/addresses/uk:addr:a1b2c3d4e5f6/history")
        self.assertEqual(history.status_code, 200)
        self.assertIn("sources", history.json())
        missing = self.client.get("/api/v1/properties/999")
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.json()["detail"]["error"], "property-not-found")

    def test_tile_route_serves_vector_tiles_with_cache_headers(self):
        tile = self.client.get("/api/v1/tiles/properties/16/32745/21792.pbf")
        self.assertEqual(tile.status_code, 200)
        self.assertEqual(tile.headers["content-type"], "application/vnd.mapbox-vector-tile")
        self.assertIn("max-age", tile.headers["cache-control"])
        self.assertEqual(tile.content, b"\x1a\x05parcels")
        empty = self.client.get("/api/v1/tiles/properties/16/1/1.pbf")
        self.assertEqual(empty.status_code, 204)
        self.assertEqual(self.client.get("/api/v1/tiles/properties/9/0/0.pbf").status_code, 400)

    def test_place_tile_route_matches_the_sales_tile_contract(self):
        tile = self.client.get("/api/v1/tiles/places/16/32745/21792.pbf")
        self.assertEqual(tile.status_code, 200)
        self.assertEqual(tile.headers["content-type"], "application/vnd.mapbox-vector-tile")
        self.assertEqual(tile.headers["cache-control"], "public, max-age=3600")
        self.assertEqual(tile.content, b"\x1a\x05parcels")
        for empty in ("/api/v1/tiles/places/16/1/1.pbf", "/api/v1/tiles/places/12/2046/1362.pbf"):
            response = self.client.get(empty)
            self.assertEqual(response.status_code, 204, empty)
            self.assertEqual(response.headers["cache-control"], "public, max-age=3600")
        self.assertEqual(self.client.get("/api/v1/tiles/places/14/0/20000.pbf").status_code, 400)

    def test_stock_value_tool_is_gone(self):
        out = self.client.post("/api/v2/tools/get_stock_value", json={"property_ref": "100023336956"})
        self.assertEqual(out.status_code, 404)


TEST_DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
UPRN_SOURCE = "src-uprn-test"
SALES_SOURCE = "src-sales-test"


class PropertyStockJoinTests(unittest.TestCase):
    """The stock value is stamped with the sales release, the dwelling with the
    UPRN release; joining them on the same release always gave no last sale."""

    def test_stock_value_is_not_tied_to_the_property_release(self):
        for name in ("PROPERTY_SQL", "PROPERTY_SEARCH_SQL"):
            sql = getattr(evidence, name)
            self.assertNotRegex(sql, r"v\.source_release_id\s*=\s*member\.source_release_id", name)
            self.assertRegex(sql, re.compile(r"v\.source_release_id IN\s*\(SELECT", re.I), name)

    @unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database")
    def test_two_releases_on_postgres(self):
        import psycopg
        from psycopg.rows import dict_row

        # TEMP tables shadow any real ones and vanish on close: nothing persists.
        with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row, autocommit=False) as connection:
            for ddl in (
                "CREATE TEMP TABLE active_product_release (release_id text)",
                "CREATE TEMP TABLE product_release_member (release_id text, source_release_id text)",
                "CREATE TEMP TABLE suppressed_dwelling (uprn text, address_id text)",
                "CREATE TEMP TABLE address (id text, display_address text, postcode text, geography_id text,"
                " source_release_id text)",
                "CREATE TEMP TABLE property (uprn text, address_id text, address text, geography_id text,"
                " parcel_id text, location geometry(Point, 4326), source_release_id text)",
                "CREATE TEMP TABLE property_stock_value (uprn text, period date, sale_period date,"
                " completion_date date, nominal_price integer, floor_area_square_metres numeric,"
                " sale_price_per_square_metre numeric, index_carrier text, index_geography_id text,"
                " index_at_sale numeric, index_latest numeric, restated_price_per_square_metre numeric,"
                " restated_value integer, confidence text, source_release_id text)",
            ):
                connection.execute(ddl)
            connection.execute("INSERT INTO active_product_release VALUES ('product-test')")
            connection.execute("INSERT INTO product_release_member VALUES ('product-test', %s), ('product-test', %s)",
                               (UPRN_SOURCE, SALES_SOURCE))
            connection.execute("INSERT INTO address VALUES ('uk:addr:x', '1 Sample Street', 'NW1 0AA',"
                               " 'uk:lsoa:E01000001', %s)", (UPRN_SOURCE,))
            connection.execute("INSERT INTO property VALUES ('100023336956', 'uk:addr:x', '1 Sample Street',"
                               " 'uk:lsoa:E01000001', '1', ST_SetSRID(ST_MakePoint(-0.14, 51.5), 4326), %s)",
                               (UPRN_SOURCE,))
            connection.execute("INSERT INTO property_stock_value VALUES ('100023336956', '2026-06-01', '2022-11-01',"
                               " '2022-11-03', 570000, 54, 10555.56, 'lsoa', 'uk:lsoa:E01000001', 9000, 9800,"
                               " 11494.16, 620667, 'medium', %s)", (SALES_SOURCE,))

            by_uprn = list(connection.execute(evidence.PROPERTY_SQL, ("100023336956",)))
            by_text = list(connection.execute(evidence.PROPERTY_SEARCH_SQL, ("%sample%",) * 3 + ("%", 1)))
            connection.rollback()

        for rows in (by_uprn, by_text):
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["source_release_id"], UPRN_SOURCE)
            self.assertEqual(rows[0]["nominal_price"], 570000)
            self.assertNotIn("restated_value", rows[0])


if __name__ == "__main__":
    unittest.main()
